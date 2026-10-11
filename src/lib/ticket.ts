import {
  Guild,
  GuildMember,
  TextChannel,
  PermissionFlagsBits,
  Colors,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  OverwriteType,
  OverwriteResolvable,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageCreateOptions,
} from "discord.js";
import { TicketReason } from "@prisma/client";
import prisma from "../lib/prisma.js";
import { sendLog, ensureGuild, isTicketStaff, ticketSupportRole } from "../lib/utils.js";
import { generateTranscript, ticketLabel, reasonLabel } from "./transcript.js";
import { setOpenTicket, flushMessages } from "./messageQueue.js";
import { getConfig, fmt, GuildConfig } from "./guildConfig.js";

// Cooldown map to prevent spam ticket creation (userId -> timestamp)
const creationCooldown = new Map<string, number>();
const COOLDOWN_MS = 10_000;
// User yang sedang dalam proses pembuatan tiket (mencegah double-click membuat 2 channel)
const creating = new Set<string>();

type ActionResult = { success: boolean; message: string };

export type CreateTicketResult =
  | { status: "created" | "existing"; channel: TextChannel }
  | { status: "cooldown" | "busy" | "no_reason" };

const STAFF_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

/**
 * Rename channel tanpa menunggu: Discord hanya mengizinkan ~2 rename / 10 menit
 * per channel, dan discord.js akan menahan request sampai limit lewat.
 * Menunggunya akan membuat interaksi terasa "hang".
 */
function renameInBackground(channel: TextChannel, name: string) {
  channel.setName(name).catch((err) => console.error(`[ticket] Gagal rename ${channel.id}:`, err));
}

export function openTicketButtons(ticketId: number, cfg: GuildConfig, claimed = false) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticketId}`)
      .setLabel("Tutup Tiket")
      .setEmoji(cfg.e.TICKET_CLOSE)
      .setStyle(ButtonStyle.Danger)
  );
  if (!claimed) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:claim:${ticketId}`)
        .setLabel("Klaim")
        .setEmoji(cfg.e.TICKET_CLAIM)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return row;
}

export function reasonSelectMenu(reasons: TicketReason[], cfg: GuildConfig) {
  const options = reasons.slice(0, 25).map((r) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(r.label.slice(0, 100))
      .setValue(r.value)
      .setDescription((r.description ?? `Buat tiket untuk: ${r.label}`).slice(0, 100))
      .setEmoji(cfg.e.TICKET)
  );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("panel:select_reason")
      .setPlaceholder("Pilih alasan tiket kamu...")
      .addOptions(options)
  );
}

/**
 * Membuat payload pesan panel tiket. Dipakai oleh /panel dan dashboard.
 */
export async function buildPanelMessage(
  guild: Guild,
  type: "button" | "dropdown",
  overrides: { title?: string | null; description?: string | null } = {}
): Promise<MessageCreateOptions | null> {
  const cfg = await getConfig(guild);
  const reasons = await prisma.ticketReason.findMany({
    where: { guildId: guild.id },
    orderBy: { id: "asc" },
  });
  if (reasons.length === 0) return null;

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${cfg.e.TICKET} ${overrides.title || cfg.t.panelTitle}`)
    .setDescription(overrides.description || cfg.t.panelDescription)
    .addFields({
      name: "Layanan Tersedia",
      value: reasons
        .slice(0, 25)
        .map((r) => `${cfg.e.TICKET} **${r.label}**${r.description ? `\n-# ${r.description}` : ""}`)
        .join("\n")
        .slice(0, 1024),
    })
    .setFooter({ text: cfg.t.panelFooter });
  if (guild.iconURL()) embed.setThumbnail(guild.iconURL());

  const components =
    type === "button"
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("panel:create_ticket")
              .setLabel(cfg.t.panelButton.slice(0, 80))
              .setEmoji(cfg.e.TICKET)
              .setStyle(ButtonStyle.Primary)
          ),
        ]
      : [reasonSelectMenu(reasons, cfg)];

  return { embeds: [embed], components };
}

/**
 * Creates a new ticket channel for the given user and reason.
 */
export async function createTicket(
  guild: Guild,
  member: GuildMember,
  reasonValue: string
): Promise<CreateTicketResult> {
  if (creating.has(member.id)) return { status: "busy" };

  const now = Date.now();
  if (now - (creationCooldown.get(member.id) ?? 0) < COOLDOWN_MS) return { status: "cooldown" };

  creating.add(member.id);
  try {
    await ensureGuild(guild.id);

    const reason = await prisma.ticketReason.findUnique({
      where: { guildId_value: { guildId: guild.id, value: reasonValue } },
    });
    if (!reason) return { status: "no_reason" };

    const existingTicket = await prisma.ticket.findFirst({
      where: { guildId: guild.id, creatorId: member.id, status: "OPEN" },
    });

    if (existingTicket) {
      const existingChannel = guild.channels.cache.get(existingTicket.channelId) as TextChannel | undefined;
      if (existingChannel) return { status: "existing", channel: existingChannel };
      // Channel sudah dihapus manual di Discord tapi masih OPEN di DB → perbaiki statusnya
      await prisma.ticket.update({ where: { id: existingTicket.id }, data: { status: "DELETED" } });
      setOpenTicket(existingTicket.channelId, null);
    }

    creationCooldown.set(member.id, now);
    const cfg = await getConfig(guild);

    // Server dari versi lama: samakan penghitung dengan tiket yang sudah ada agar nomor tidak kembar
    const existingCount = await prisma.ticket.count({ where: { guildId: guild.id } });
    await prisma.guild.updateMany({
      where: { id: guild.id, ticketCounter: { lt: existingCount } },
      data: { ticketCounter: existingCount },
    });

    // Nomor tiket per-server (atomic increment)
    const guildData = await prisma.guild.update({
      where: { id: guild.id },
      data: { ticketCounter: { increment: 1 } },
    });
    const number = guildData.ticketCounter;
    const channelName = `ticket-${number.toString().padStart(4, "0")}`;

    const permissionOverwrites: OverwriteResolvable[] = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role },
      {
        id: guild.client.user.id,
        allow: [...STAFF_PERMS, PermissionFlagsBits.ManageChannels],
        type: OverwriteType.Member,
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
        type: OverwriteType.Member,
      },
      { id: reason.supportRoleId, allow: STAFF_PERMS, type: OverwriteType.Role },
    ];

    if (guildData.setupRoleId && guildData.setupRoleId !== reason.supportRoleId) {
      permissionOverwrites.push({ id: guildData.setupRoleId, allow: STAFF_PERMS, type: OverwriteType.Role });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: reason.categoryId,
      permissionOverwrites,
      topic: `Tiket dari ${member.user.tag} | Alasan: ${reason.label}`,
    });

    const ticket = await prisma.ticket.create({
      data: {
        guildId: guild.id,
        number,
        channelId: channel.id,
        creatorId: member.id,
        creatorTag: member.user.tag,
        reasonId: reason.id,
        reasonLabel: reason.label,
        supportRoleId: reason.supportRoleId,
        status: "OPEN",
      },
    });
    setOpenTicket(channel.id, ticket.id);

    const vars = { user: member.toString(), reason: reason.label, number, server: guild.name };
    const welcomeEmbed = new EmbedBuilder()
      .setColor(cfg.color)
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setTitle(`${cfg.e.TICKET} ${fmt(cfg.t.ticketWelcomeTitle, vars)}`)
      .setDescription(fmt(cfg.t.ticketWelcome, vars))
      .addFields(
        { name: `${cfg.e.TAG} Alasan`, value: reason.label, inline: true },
        { name: `${cfg.e.USER} Pembuat`, value: member.toString(), inline: true },
        { name: `${cfg.e.DATE} Dibuat`, value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
      )
      .setFooter({ text: `Tiket #${number} • ${guild.name}` })
      .setTimestamp();
    if (reason.description) welcomeEmbed.addFields({ name: "Deskripsi", value: reason.description });

    await channel.send({
      content: `${member.toString()} | <@&${reason.supportRoleId}>`,
      embeds: [welcomeEmbed],
      components: [openTicketButtons(ticket.id, cfg)],
    });

    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(`${cfg.e.TICKET} Tiket Dibuat`)
        .addFields(
          { name: "Tiket", value: `#${number} — ${channelName}`, inline: true },
          { name: "Pembuat", value: member.toString(), inline: true },
          { name: "Alasan", value: reason.label, inline: true },
          { name: "Channel", value: channel.toString(), inline: true }
        )
        .setTimestamp()
    );

    return { status: "created", channel };
  } finally {
    creating.delete(member.id);
  }
}

async function loadTicket(guild: Guild, ticketId: number) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { reason: true } });
  if (!ticket || ticket.guildId !== guild.id) return null;
  return ticket;
}

/**
 * Closes a ticket: locks the channel, renames it, sends transcript.
 * Boleh dilakukan oleh pembuat tiket atau staff.
 */
export async function closeTicket(guild: Guild, closedBy: GuildMember, ticketId: number): Promise<ActionResult> {
  const ticket = await loadTicket(guild, ticketId);
  if (!ticket) return { success: false, message: "Tiket tidak ditemukan." };
  if (ticket.status !== "OPEN") return { success: false, message: "Tiket sudah dalam status tertutup." };

  const isCreator = closedBy.id === ticket.creatorId;
  if (!isCreator && !(await isTicketStaff(guild, closedBy, ticketSupportRole(ticket)))) {
    return { success: false, message: "Hanya pembuat tiket atau staff yang dapat menutup tiket." };
  }

  const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
  if (!channel) return { success: false, message: "Channel tiket tidak ditemukan." };

  // Simpan pesan terakhir sebelum status berubah agar ikut masuk transkrip
  await flushMessages();

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "CLOSED", closedAt: new Date(), closedById: closedBy.id },
  });
  setOpenTicket(channel.id, null);

  const cfg = await getConfig(guild);

  renameInBackground(channel, `closed-${channel.name.replace(/^closed-/, "")}`);
  await channel.permissionOverwrites
    .edit(ticket.creatorId, { SendMessages: false })
    .catch(console.error);

  const transcriptResult = await generateTranscript(guild, ticket, channel);

  const closedEmbed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle(`${cfg.e.TICKET_CLOSE} Tiket Ditutup`)
    .setDescription(fmt(cfg.t.ticketClosed, { staff: closedBy.toString(), number: ticket.number ?? ticket.id }))
    .addFields({
      name: "Transkrip",
      value: transcriptResult.success
        ? `${cfg.e.SUCCESS} Terkirim ke DM pembuat tiket`
        : `${cfg.e.ERROR} Gagal — ${transcriptResult.reason}`,
    })
    .setTimestamp();

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:reopen:${ticket.id}`)
      .setLabel("Buka Kembali")
      .setEmoji(cfg.e.TICKET_REOPEN)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticket:delete:${ticket.id}`)
      .setLabel("Hapus Tiket")
      .setEmoji(cfg.e.TICKET_DELETE)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket:transcript:${ticket.id}`)
      .setLabel("Kirim Ulang Transkrip")
      .setEmoji(cfg.e.TICKET_SAVE)
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [closedEmbed], components: [actionRow] });

  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle(`${cfg.e.TICKET_CLOSE} Tiket Ditutup`)
      .addFields(
        { name: "Tiket", value: ticketLabel(ticket), inline: true },
        { name: "Ditutup oleh", value: closedBy.toString(), inline: true },
        { name: "Alasan", value: reasonLabel(ticket), inline: true },
        {
          name: "Transkrip",
          value: transcriptResult.success
            ? `${cfg.e.SUCCESS} Terkirim via DM`
            : `${cfg.e.ERROR} Gagal — ${transcriptResult.reason}`,
        }
      )
      .setTimestamp()
  );

  return { success: true, message: "Tiket berhasil ditutup." };
}

/**
 * Reopens a closed ticket. Hanya staff.
 */
export async function reopenTicket(guild: Guild, reopenedBy: GuildMember, ticketId: number): Promise<ActionResult> {
  const ticket = await loadTicket(guild, ticketId);
  if (!ticket) return { success: false, message: "Tiket tidak ditemukan." };
  if (!(await isTicketStaff(guild, reopenedBy, ticketSupportRole(ticket)))) {
    return { success: false, message: "Hanya **Staff** yang dapat membuka kembali tiket." };
  }
  if (ticket.status !== "CLOSED") return { success: false, message: "Tiket tidak dalam status tertutup." };

  const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
  if (!channel) return { success: false, message: "Channel tiket tidak ditemukan." };

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "OPEN", closedAt: null, closedById: null },
  });
  setOpenTicket(channel.id, ticket.id);

  const cfg = await getConfig(guild);
  renameInBackground(channel, channel.name.replace(/^closed-/, ""));
  await channel.permissionOverwrites
    .edit(ticket.creatorId, { SendMessages: true, ViewChannel: true })
    .catch(console.error);

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Green)
        .setDescription(`${cfg.e.TICKET_REOPEN} Tiket dibuka kembali oleh ${reopenedBy.toString()}.`)
        .setTimestamp(),
    ],
    components: [openTicketButtons(ticket.id, cfg, !!ticket.claimedById)],
  });

  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(`${cfg.e.TICKET_REOPEN} Tiket Dibuka Kembali`)
      .addFields(
        { name: "Tiket", value: ticketLabel(ticket), inline: true },
        { name: "Dibuka oleh", value: reopenedBy.toString(), inline: true },
        { name: "Alasan", value: reasonLabel(ticket), inline: true }
      )
      .setTimestamp()
  );

  return { success: true, message: "Tiket berhasil dibuka kembali." };
}

/**
 * Staff mengklaim tiket agar staff lain tahu siapa yang menangani.
 */
export async function claimTicket(guild: Guild, staff: GuildMember, ticketId: number): Promise<ActionResult> {
  const ticket = await loadTicket(guild, ticketId);
  if (!ticket) return { success: false, message: "Tiket tidak ditemukan." };
  if (!(await isTicketStaff(guild, staff, ticketSupportRole(ticket)))) {
    return { success: false, message: "Hanya **Staff** yang dapat mengklaim tiket." };
  }
  if (ticket.status !== "OPEN") return { success: false, message: "Tiket tidak dalam status terbuka." };
  if (ticket.claimedById) return { success: false, message: `Tiket sudah diklaim oleh <@${ticket.claimedById}>.` };

  await prisma.ticket.update({ where: { id: ticketId }, data: { claimedById: staff.id } });

  const cfg = await getConfig(guild);
  const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
  await channel?.send({
    embeds: [
      new EmbedBuilder()
        .setColor(cfg.color)
        .setDescription(`${cfg.e.TICKET_CLAIM} ${fmt(cfg.t.ticketClaimed, { staff: staff.toString() })}`),
    ],
  });
  return { success: true, message: "Tiket berhasil diklaim." };
}

/**
 * Permanently deletes a ticket channel and marks it deleted in DB. Hanya staff.
 */
export async function deleteTicket(guild: Guild, deletedBy: GuildMember, ticketId: number): Promise<ActionResult> {
  const ticket = await loadTicket(guild, ticketId);
  if (!ticket) return { success: false, message: "Tiket tidak ditemukan." };
  if (!(await isTicketStaff(guild, deletedBy, ticketSupportRole(ticket)))) {
    return { success: false, message: "Hanya **Staff** yang dapat menghapus tiket." };
  }
  if (ticket.status === "DELETED") return { success: false, message: "Tiket sudah dihapus." };

  const cfg = await getConfig(guild);
  await flushMessages();

  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(`${cfg.e.TICKET_DELETE} Tiket Dihapus`)
      .addFields(
        { name: "Tiket", value: ticketLabel(ticket), inline: true },
        { name: "Dihapus oleh", value: deletedBy.toString(), inline: true },
        { name: "Alasan", value: reasonLabel(ticket), inline: true },
        { name: "Pembuat Tiket", value: `<@${ticket.creatorId}>`, inline: true }
      )
      .setTimestamp()
  );

  await prisma.ticket.update({ where: { id: ticketId }, data: { status: "DELETED" } });
  setOpenTicket(ticket.channelId, null);

  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel) await channel.delete(`Dihapus oleh ${deletedBy.user.tag}`).catch(console.error);

  return { success: true, message: "Tiket berhasil dihapus." };
}
