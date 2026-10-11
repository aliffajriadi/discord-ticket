import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  GuildMember,
  EmbedBuilder,
  Colors,
  TextChannel,
} from "discord.js";
import prisma from "../lib/prisma.js";
import {
  createTicket,
  closeTicket,
  reopenTicket,
  deleteTicket,
  claimTicket,
  reasonSelectMenu,
  openTicketButtons,
} from "../lib/ticket.js";
import { generateTranscript } from "../lib/transcript.js";
import { errorEmbed, successEmbed, isTicketStaff, ticketSupportRole, hasSetupPermission, ensureGuild } from "../lib/utils.js";
import { getConfig } from "../lib/guildConfig.js";
import { repostSticky, removeStickyMessage, invalidateSticky } from "../lib/sticky.js";

/**
 * Handles "panel:create_ticket" button click — shows the reason select menu.
 */
export async function handlePanelCreateTicket(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ embeds: [errorEmbed("Tidak dapat memproses interaksi ini.")], ephemeral: true });
  }

  // Balas dulu agar tidak kena batas 3 detik Discord, baru ambil data
  await interaction.deferReply({ ephemeral: true });

  const reasons = await prisma.ticketReason.findMany({
    where: { guildId: interaction.guild.id },
    orderBy: { id: "asc" },
  });

  if (reasons.length === 0) {
    return interaction.editReply({ embeds: [errorEmbed("Belum ada alasan tiket yang dikonfigurasi.")] });
  }

  const cfg = await getConfig(interaction.guild);
  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(cfg.color)
        .setTitle(`${cfg.e.TICKET} Pilih Alasan Tiket`)
        .setDescription("Silakan pilih alasan yang sesuai dengan kebutuhanmu dari menu di bawah."),
    ],
    components: [reasonSelectMenu(reasons, cfg)],
  });
}

/**
 * Handles "panel:select_reason" select menu — creates the ticket.
 */
export async function handleSelectReason(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ embeds: [errorEmbed("Tidak dapat memproses interaksi ini.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  // Panel dropdown publik: reset pilihan agar user bisa memilih opsi yang sama lagi
  if (!interaction.message.flags.has("Ephemeral")) {
    await interaction.message.edit({ components: interaction.message.components }).catch(() => null);
  }

  const cfg = await getConfig(interaction.guild);
  const result = await createTicket(interaction.guild, interaction.member, interaction.values[0]);

  switch (result.status) {
    case "cooldown":
    case "busy":
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Orange)
            .setDescription(`${cfg.e.CLOCK} Mohon tunggu beberapa saat sebelum membuat tiket baru.`),
        ],
      });
    case "no_reason":
      return interaction.editReply({ embeds: [errorEmbed("Alasan tiket ini sudah tidak tersedia.")] });
    case "existing":
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle(`${cfg.e.WARNING} Tiket Sudah Ada`)
            .setDescription(
              `Kamu sudah memiliki tiket yang terbuka!\n\nSilakan selesaikan tiket yang ada terlebih dahulu sebelum membuat yang baru.\n\n**Tiket kamu:** ${result.channel.toString()}`
            ),
        ],
      });
    case "created":
      return interaction.editReply({
        embeds: [successEmbed(`Tiket berhasil dibuat! Silakan menuju ${result.channel.toString()}.`)],
      });
  }
}

/**
 * Handles ticket action buttons: close, reopen, delete, claim, transcript.
 * Pengecekan izin dilakukan di lib/ticket.ts.
 */
export async function handleTicketButton(interaction: ButtonInteraction, action: string, ticketId: number) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ embeds: [errorEmbed("Tidak dapat memproses interaksi ini.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const { guild, member } = interaction;

  const respond = (result: { success: boolean; message: string }) =>
    interaction.editReply({ embeds: [result.success ? successEmbed(result.message) : errorEmbed(result.message)] });

  if (action === "close") return respond(await closeTicket(guild, member, ticketId));
  if (action === "reopen") return respond(await reopenTicket(guild, member, ticketId));
  if (action === "claim") {
    const result = await claimTicket(guild, member, ticketId);
    if (result.success) {
      // Hilangkan tombol "Klaim" dari pesan yang diklik
      const cfg = await getConfig(guild);
      await interaction.message.edit({ components: [openTicketButtons(ticketId, cfg, true)] }).catch(() => null);
    }
    return respond(result);
  }

  if (action === "delete") {
    const result = await deleteTicket(guild, member, ticketId);
    // Jika sukses, channel sudah terhapus — tidak perlu balasan
    if (!result.success) return respond(result);
    return;
  }

  if (action === "transcript") {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { reason: true } });
    if (!ticket || ticket.guildId !== guild.id) return respond({ success: false, message: "Tiket tidak ditemukan." });

    const isCreator = interaction.user.id === ticket.creatorId;
    if (!isCreator && !(await isTicketStaff(guild, member, ticketSupportRole(ticket)))) {
      return respond({ success: false, message: "Hanya pembuat tiket atau staff yang dapat mengambil transkrip." });
    }

    const result = await generateTranscript(guild, ticket, interaction.channel as TextChannel);
    return respond(
      result.success
        ? { success: true, message: `Transkrip berhasil dikirim ke DM <@${ticket.creatorId}>.` }
        : { success: false, message: `Gagal mengirim transkrip: ${result.reason}` }
    );
  }
}

/**
 * Modal "sticky:set:<channelId>" dari /sticky set.
 */
export async function handleStickyModal(interaction: ModalSubmitInteraction, channelId: string) {
  if (!interaction.inCachedGuild()) return;
  if (!(await hasSetupPermission(interaction.guild, interaction.member as GuildMember))) {
    return interaction.reply({ embeds: [errorEmbed("Kamu tidak memiliki izin.")], ephemeral: true });
  }

  const title = interaction.fields.getTextInputValue("title").trim() || null;
  const content = interaction.fields.getTextInputValue("content").trim();
  const colorRaw = interaction.fields.getTextInputValue("color").trim().replace(/^#/, "");
  const imageUrl = interaction.fields.getTextInputValue("image").trim() || null;

  if (colorRaw && !/^[0-9a-f]{6}$/i.test(colorRaw)) {
    return interaction.reply({ embeds: [errorEmbed("Format warna harus hex, contoh `#5865F2`.")], ephemeral: true });
  }
  if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) {
    return interaction.reply({ embeds: [errorEmbed("URL gambar tidak valid.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  await ensureGuild(interaction.guild.id);

  const old = await prisma.stickyNote.findUnique({ where: { channelId } });
  if (old) await removeStickyMessage(interaction.guild, old);

  const data = {
    title,
    content,
    color: colorRaw ? parseInt(colorRaw, 16) : null,
    imageUrl,
    enabled: true,
    lastMessageId: null,
  };
  await prisma.stickyNote.upsert({
    where: { channelId },
    create: { ...data, guildId: interaction.guild.id, channelId, createdById: interaction.user.id },
    update: data,
  });
  invalidateSticky(channelId);
  await repostSticky(interaction.guild, channelId);

  return interaction.editReply({ embeds: [successEmbed(`Sticky note di <#${channelId}> berhasil disimpan.`)] });
}
