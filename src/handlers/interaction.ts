import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  GuildMember,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  Colors,
} from "discord.js";
import prisma from "../lib/prisma.js";
import { createTicket, closeTicket, reopenTicket, deleteTicket } from "../lib/ticket.js";
import { generateTranscript } from "../lib/transcript.js";
import { errorEmbed } from "../lib/utils.js";
import { E } from "../config/emoji.js";

/**
 * Handles "panel:create_ticket" button click — shows the reason select menu.
 */
export async function handlePanelCreateTicket(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({ embeds: [errorEmbed("Tidak dapat memproses interaksi ini.")], ephemeral: true });
  }

  const reasons = await prisma.ticketReason.findMany({
    where: { guildId: interaction.guild.id },
    orderBy: { id: "asc" },
  });

  if (reasons.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed("Belum ada alasan tiket yang dikonfigurasi.")],
      ephemeral: true,
    });
  }

  const options = reasons.slice(0, 25).map((r: { label: string; value: string; description: string | null }) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(r.label)
      .setValue(r.value)
      .setDescription(r.description ?? `Buat tiket untuk: ${r.label}`)
      .setEmoji(E.TICKET)
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("panel:select_reason")
    .setPlaceholder("Pilih alasan tiket kamu...")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Pilih Alasan Tiket")
        .setDescription("Silakan pilih alasan yang sesuai dengan kebutuhanmu dari menu di bawah."),
    ],
    components: [row],
    ephemeral: true,
  });
}

/**
 * Handles "panel:select_reason" select menu — creates the ticket.
 */
export async function handleSelectReason(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({ embeds: [errorEmbed("Tidak dapat memproses interaksi ini.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const reasonValue = interaction.values[0];
  const member = interaction.member as GuildMember;

  const result = await createTicket(interaction.guild, member, reasonValue);

  // null = cooldown aktif
  if (!result) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Orange)
          .setDescription(`${E.CLOCK} Mohon tunggu beberapa saat sebelum membuat tiket baru.`),
      ],
    });
  }

  const { channel, isExisting } = result;

  // User sudah punya tiket terbuka → arahkan ke tiket yang ada
  if (isExisting) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Orange)
          .setTitle(`${E.WARNING} Tiket Sudah Ada`)
          .setDescription(
            `Kamu sudah memiliki tiket yang terbuka!\n\nSilakan selesaikan tiket yang ada terlebih dahulu sebelum membuat yang baru.\n\n**Tiket kamu:** ${channel.toString()}`
          ),
      ],
    });
  }

  // Tiket baru berhasil dibuat
  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Green)
        .setDescription(`${E.SUCCESS} Tiket berhasil dibuat! Silakan menuju ${channel.toString()}.`),
    ],
  });
}

/**
 * Handles ticket action buttons: close, reopen, delete, transcript.
 */
export async function handleTicketButton(interaction: ButtonInteraction, action: string, ticketId: number) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({ embeds: [errorEmbed("Tidak dapat memproses interaksi ini.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member as GuildMember;

  if (action === "close") {
    const result = await closeTicket(interaction.guild, member, ticketId);
    return interaction.editReply({
      embeds: [result.success ? 
        new EmbedBuilder().setColor(Colors.Green).setDescription(`${E.SUCCESS} ${result.message}`) :
        errorEmbed(result.message)],
    });
  }

  if (action === "reopen") {
    // Permission check
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { reason: true },
    });

    if (!ticket) {
      return interaction.editReply({ embeds: [errorEmbed("Tiket tidak ditemukan.")] });
    }

    const guildData = await prisma.guild.findUnique({ where: { id: interaction.guild.id } });
    const isStaff =
      interaction.guild.ownerId === interaction.user.id ||
      (ticket.reason ? member.roles.cache.has(ticket.reason.supportRoleId) : false) ||
      (guildData?.setupRoleId ? member.roles.cache.has(guildData.setupRoleId) : false);

    if (!isStaff) {
      return interaction.editReply({ embeds: [errorEmbed("Hanya **Staff** yang dapat membuka kembali tiket.")] });
    }

    const result = await reopenTicket(interaction.guild, member, ticketId);
    return interaction.editReply({
      embeds: [result.success ?
        new EmbedBuilder().setColor(Colors.Green).setDescription(`${E.SUCCESS} ${result.message}`) :
        errorEmbed(result.message)],
    });
  }

  if (action === "delete") {
    // Permission check
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { reason: true },
    });

    if (!ticket) {
      return interaction.editReply({ embeds: [errorEmbed("Tiket tidak ditemukan.")] });
    }

    const guildData = await prisma.guild.findUnique({ where: { id: interaction.guild.id } });
    const isStaff =
      interaction.guild.ownerId === interaction.user.id ||
      (ticket.reason ? member.roles.cache.has(ticket.reason.supportRoleId) : false) ||
      (guildData?.setupRoleId ? member.roles.cache.has(guildData.setupRoleId) : false);

    if (!isStaff) {
      return interaction.editReply({ embeds: [errorEmbed("Hanya **Staff** yang dapat menghapus tiket.")] });
    }

    const result = await deleteTicket(interaction.guild, member, ticketId);
    if (!result.success) {
      return interaction.editReply({ embeds: [errorEmbed(result.message)] });
    }
    // Channel is deleted — no further reply needed
    return;
  }

  if (action === "transcript") {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { reason: true },
    });

    if (!ticket) {
      return interaction.editReply({ embeds: [errorEmbed("Tiket tidak ditemukan.")] });
    }

    // Only admin/staff or ticket creator can request transcript
    const guildData = await prisma.guild.findUnique({ where: { id: interaction.guild.id } });
    const isStaff =
      interaction.guild.ownerId === interaction.user.id ||
      (ticket.reason ? member.roles.cache.has(ticket.reason.supportRoleId) : false) ||
      (guildData?.setupRoleId ? member.roles.cache.has(guildData.setupRoleId) : false);
    const isCreator = interaction.user.id === ticket.creatorId;

    if (!isStaff && !isCreator) {
      return interaction.editReply({ embeds: [errorEmbed("Hanya pembuat tiket atau staff yang dapat mengambil transkrip.")] });
    }

    const channel = interaction.channel as any;
    const result = await generateTranscript(interaction.guild, ticket as any, channel);

    return interaction.editReply({
      embeds: [
        result.success
          ? new EmbedBuilder().setColor(Colors.Green).setDescription(`${E.SUCCESS} Transkrip berhasil dikirim ke DM kamu!`)
          : errorEmbed(`Gagal mengirim transkrip: ${result.reason}`),
      ],
    });
  }
}
