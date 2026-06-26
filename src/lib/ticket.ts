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
} from "discord.js";
import prisma from "../lib/prisma.js";
import { sendLog, errorEmbed } from "../lib/utils.js";
import { generateTranscript } from "./transcript.js";
import { E } from "../config/emoji.js";

// Cooldown map to prevent spam ticket creation (userId -> timestamp)
const creationCooldown = new Map<string, number>();
const COOLDOWN_MS = 10_000; // 10 seconds

/**
 * Creates a new ticket channel for the given user and reason.
 * Returns { channel, isExisting: true } if user already has an open ticket.
 * Returns null if on cooldown or reason not found.
 */
export async function createTicket(
  guild: Guild,
  member: GuildMember,
  reasonValue: string
): Promise<{ channel: TextChannel; isExisting: boolean } | null> {
  // Cooldown check
  const now = Date.now();
  const lastCreated = creationCooldown.get(member.id) ?? 0;
  if (now - lastCreated < COOLDOWN_MS) {
    return null;
  }

  const reason = await prisma.ticketReason.findUnique({
    where: {
      guildId_value: { guildId: guild.id, value: reasonValue },
    },
  });

  if (!reason) return null;

  // ── Cek tiket yang sudah ada ───────────────────────────────────────────────
  const existingTicket = await prisma.ticket.findFirst({
    where: {
      guildId: guild.id,
      creatorId: member.id,
      status: "OPEN",
    },
  });

  if (existingTicket) {
    const existingChannel = guild.channels.cache.get(existingTicket.channelId) as TextChannel | undefined;
    if (existingChannel) {
      // Kembalikan channel lama + flag isExisting = true
      return { channel: existingChannel, isExisting: true };
    }
    // Channel sudah dihapus di Discord tapi masih OPEN di DB → auto-fix statusnya
    await prisma.ticket.update({
      where: { id: existingTicket.id },
      data: { status: "DELETED" },
    });
  }

  // Set cooldown SETELAH semua cek lolos (baru tiket benar-benar akan dibuat)
  creationCooldown.set(member.id, now);

  const guildData = await prisma.guild.findUnique({
    where: { id: guild.id },
  });

  const ticketCount = await prisma.ticket.count({ where: { guildId: guild.id } });
  const channelName = `ticket-${(ticketCount + 1).toString().padStart(4, "0")}`;

  const permissionOverwrites: any[] = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
      type: OverwriteType.Role,
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
      type: OverwriteType.Member,
    },
    {
      id: reason.supportRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
      ],
      type: OverwriteType.Role,
    },
  ];

  if (guildData?.setupRoleId && guildData.setupRoleId !== reason.supportRoleId) {
    permissionOverwrites.push({
      id: guildData.setupRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
      ],
      type: OverwriteType.Role,
    });
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
      channelId: channel.id,
      creatorId: member.id,
      reasonId: reason.id,
      status: "OPEN",
    },
  });

  const welcomeEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${E.TICKET} Tiket #${ticket.id} — ${reason.label}`)
    .setDescription(
      `Halo ${member.toString()}! Tiket kamu telah dibuat.\n\nTim support kami akan segera membantu kamu.\n\n**Alasan:** ${reason.label}\n${reason.description ? `**Deskripsi:** ${reason.description}` : ""}`
    )
    .setFooter({ text: `ID Tiket: ${ticket.id}` })
    .setTimestamp();

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticket.id}`)
      .setLabel(`${E.TICKET_CLOSE} Tutup Tiket`)
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `${member.toString()} | <@&${reason.supportRoleId}>`,
    embeds: [welcomeEmbed],
    components: [actionRow],
  });

  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(`${E.TICKET} Tiket Dibuat`)
      .addFields(
        { name: "Tiket", value: `#${ticket.id} — ${channelName}`, inline: true },
        { name: "Pembuat", value: member.toString(), inline: true },
        { name: "Alasan", value: reason.label, inline: true },
        { name: "Channel", value: channel.toString(), inline: true }
      )
      .setTimestamp()
  );

  return { channel, isExisting: false };
}


/**
 * Closes a ticket: locks the channel, renames it, saves transcript.
 */
export async function closeTicket(
  guild: Guild,
  closedBy: GuildMember,
  ticketId: number
): Promise<{ success: boolean; message: string }> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { reason: true },
  });

  if (!ticket || ticket.guildId !== guild.id) {
    return { success: false, message: "Tiket tidak ditemukan." };
  }

  if (ticket.status !== "OPEN") {
    return { success: false, message: "Tiket sudah dalam status tertutup." };
  }

  const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;

  if (!channel) {
    return { success: false, message: "Channel tiket tidak ditemukan." };
  }

  // Update DB
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: closedBy.id,
    },
  });

  // Rename channel
  await channel.setName(`closed-${channel.name}`).catch(console.error);

  // Remove user's send permission
  await channel.permissionOverwrites.edit(ticket.creatorId, {
    SendMessages: false,
  }).catch(console.error);

  // Generate and send transcript
  const transcriptResult = await generateTranscript(guild, ticket as any, channel);

  // Closed embed in channel
  const closedEmbed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle(`${E.TICKET_CLOSE} Tiket Ditutup`)
    .setDescription(
      `Tiket ini telah ditutup oleh ${closedBy.toString()}.\nHanya staff yang dapat membuka kembali atau menghapus tiket ini.`
    )
    .setTimestamp();

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:reopen:${ticket.id}`)
      .setLabel(`${E.TICKET_REOPEN} Buka Kembali`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticket:delete:${ticket.id}`)
      .setLabel(`${E.TICKET_DELETE} Hapus Tiket`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket:transcript:${ticket.id}`)
      .setLabel(`${E.TICKET_SAVE} Kirim Ulang Transkrip`)
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [closedEmbed], components: [actionRow] });

  // Log
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle(`${E.TICKET_CLOSE} Tiket Ditutup`)
      .addFields(
        { name: "Tiket", value: `#${ticket.id}`, inline: true },
        { name: "Ditutup oleh", value: closedBy.toString(), inline: true },
        { name: "Alasan", value: ticket.reason?.label ?? "Tanpa Alasan", inline: true },
        {
          name: "Transkrip",
          value: transcriptResult.success
            ? `${E.SUCCESS} Terkirim via DM`
            : `${E.ERROR} Gagal — ${transcriptResult.reason}`,
          inline: false,
        }
      )
      .setTimestamp()
  );

  return { success: true, message: "Tiket berhasil ditutup." };
}

/**
 * Reopens a closed ticket.
 */
export async function reopenTicket(
  guild: Guild,
  reopenedBy: GuildMember,
  ticketId: number
): Promise<{ success: boolean; message: string }> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { reason: true },
  });

  if (!ticket || ticket.guildId !== guild.id) {
    return { success: false, message: "Tiket tidak ditemukan." };
  }

  if (ticket.status !== "CLOSED") {
    return { success: false, message: "Tiket tidak dalam status tertutup." };
  }

  const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;

  if (!channel) {
    return { success: false, message: "Channel tiket tidak ditemukan." };
  }

  // Update DB
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "OPEN", closedAt: null, closedById: null },
  });

  // Restore channel name
  const newName = channel.name.replace(/^closed-/, "");
  await channel.setName(newName).catch(console.error);

  // Restore user's send permission
  await channel.permissionOverwrites.edit(ticket.creatorId, {
    SendMessages: true,
    ViewChannel: true,
  }).catch(console.error);

  const reopenEmbed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setDescription(`${E.TICKET_REOPEN} Tiket dibuka kembali oleh ${reopenedBy.toString()}.`)
    .setTimestamp();

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticket.id}`)
      .setLabel(`${E.TICKET_CLOSE} Tutup Tiket`)
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ embeds: [reopenEmbed], components: [actionRow] });

  // Log
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(`${E.TICKET_REOPEN} Tiket Dibuka Kembali`)
      .addFields(
        { name: "Tiket", value: `#${ticket.id}`, inline: true },
        { name: "Dibuka oleh", value: reopenedBy.toString(), inline: true },
        { name: "Alasan", value: ticket.reason?.label ?? "Tanpa Alasan", inline: true }
      )
      .setTimestamp()
  );

  return { success: true, message: "Tiket berhasil dibuka kembali." };
}

/**
 * Permanently deletes a ticket channel and marks it deleted in DB.
 */
export async function deleteTicket(
  guild: Guild,
  deletedBy: GuildMember,
  ticketId: number
): Promise<{ success: boolean; message: string }> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { reason: true },
  });

  if (!ticket || ticket.guildId !== guild.id) {
    return { success: false, message: "Tiket tidak ditemukan." };
  }

  if (ticket.status === "DELETED") {
    return { success: false, message: "Tiket sudah dihapus." };
  }

  // Log before channel deletion
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(`${E.TICKET_DELETE} Tiket Dihapus`)
      .addFields(
        { name: "Tiket", value: `#${ticket.id}`, inline: true },
        { name: "Dihapus oleh", value: deletedBy.toString(), inline: true },
        { name: "Alasan", value: ticket.reason?.label ?? "Tanpa Alasan", inline: true },
        { name: "Pembuat Tiket", value: `<@${ticket.creatorId}>`, inline: true }
      )
      .setTimestamp()
  );

  // Update DB
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "DELETED" },
  });

  // Delete the channel
  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel) {
    await channel.delete(`Dihapus oleh ${deletedBy.user.tag}`).catch(console.error);
  }

  return { success: true, message: "Tiket berhasil dihapus." };
}
