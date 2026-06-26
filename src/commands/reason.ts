import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  ChannelType,
} from "discord.js";
import { ensureGuild, hasSetupPermission, errorEmbed, successEmbed } from "../lib/utils.js";
import prisma from "../lib/prisma.js";

export const data = new SlashCommandBuilder()
  .setName("reason")
  .setDescription("Kelola alasan tiket")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Tambah alasan tiket baru")
      .addStringOption((opt) =>
        opt.setName("label").setDescription("Nama alasan (tampil di dropdown)").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("value").setDescription("ID unik alasan (huruf_kecil, tanpa spasi)").setRequired(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName("category")
          .setDescription("Kategori channel tempat tiket dibuat")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addRoleOption((opt) =>
        opt.setName("support_role").setDescription("Role petugas yang menangani tiket ini").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("description").setDescription("Deskripsi singkat alasan (opsional)").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("Lihat daftar semua alasan tiket")
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Hapus alasan tiket berdasarkan value-nya")
      .addStringOption((opt) =>
        opt.setName("value").setDescription("ID unik alasan yang akan dihapus").setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    return interaction.reply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di server.")], ephemeral: true });
  }

  await ensureGuild(interaction.guild.id);
  const hasPermission = await hasSetupPermission(interaction.guild, interaction.user.id);

  if (!hasPermission) {
    return interaction.reply({
      embeds: [errorEmbed("Kamu tidak memiliki izin untuk menjalankan command ini.")],
      ephemeral: true,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  // ── ADD ──────────────────────────────────────────────────────────────
  if (subcommand === "add") {
    const label = interaction.options.getString("label", true);
    const value = interaction.options.getString("value", true).toLowerCase().replace(/\s+/g, "_");
    const category = interaction.options.getChannel("category", true);
    const supportRole = interaction.options.getRole("support_role", true);
    const description = interaction.options.getString("description") ?? undefined;

    // Validate value format
    if (!/^[a-z0-9_]+$/.test(value)) {
      return interaction.reply({
        embeds: [errorEmbed("Value hanya boleh mengandung huruf kecil, angka, dan underscore.")],
        ephemeral: true,
      });
    }

    // Check duplicate
    const existing = await prisma.ticketReason.findUnique({
      where: { guildId_value: { guildId: interaction.guild.id, value } },
    });

    if (existing) {
      return interaction.reply({
        embeds: [errorEmbed(`Alasan dengan value \`${value}\` sudah ada.`)],
        ephemeral: true,
      });
    }

    await prisma.ticketReason.create({
      data: {
        guildId: interaction.guild.id,
        label,
        value,
        description,
        categoryId: category.id,
        supportRoleId: supportRole.id,
      },
    });

    return interaction.reply({
      embeds: [
        successEmbed(
          `Alasan **${label}** (\`${value}\`) berhasil ditambahkan!\n\n**Kategori:** <#${category.id}>\n**Role:** ${supportRole.toString()}`
        ),
      ],
      ephemeral: true,
    });
  }

  // ── LIST ─────────────────────────────────────────────────────────────
  if (subcommand === "list") {
    const reasons = await prisma.ticketReason.findMany({
      where: { guildId: interaction.guild.id },
      orderBy: { id: "asc" },
    });

    if (reasons.length === 0) {
      return interaction.reply({
        embeds: [errorEmbed("Belum ada alasan tiket. Gunakan `/reason add` untuk menambahkan.")],
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📋 Daftar Alasan Tiket")
      .setDescription(
        reasons
          .map(
            (r: { label: string; value: string; categoryId: string; supportRoleId: string; description: string | null }, i: number) =>
              `**${i + 1}. ${r.label}** (\`${r.value}\`)\n> Kategori: <#${r.categoryId}> | Role: <@&${r.supportRoleId}>${r.description ? `\n> ${r.description}` : ""}`
          )
          .join("\n\n")
      )
      .setFooter({ text: `Total: ${reasons.length} alasan` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── DELETE ───────────────────────────────────────────────────────────
  if (subcommand === "delete") {
    const value = interaction.options.getString("value", true);

    const reason = await prisma.ticketReason.findUnique({
      where: { guildId_value: { guildId: interaction.guild.id, value } },
    });

    if (!reason) {
      return interaction.reply({
        embeds: [errorEmbed(`Alasan dengan value \`${value}\` tidak ditemukan.`)],
        ephemeral: true,
      });
    }

    await prisma.ticketReason.delete({ where: { id: reason.id } });

    return interaction.reply({
      embeds: [successEmbed(`Alasan **${reason.label}** (\`${value}\`) berhasil dihapus.`)],
      ephemeral: true,
    });
  }
}
