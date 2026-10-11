import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from "discord.js";
import { errorEmbed, successEmbed, hasSetupPermission, truncate } from "../lib/utils.js";
import { getConfig } from "../lib/guildConfig.js";
import { removeStickyMessage, repostSticky, invalidateSticky } from "../lib/sticky.js";
import prisma from "../lib/prisma.js";
import { Command } from "../types.js";

const STICKY_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice] as const;

const data = new SlashCommandBuilder()
  .setName("sticky")
  .setDescription("Pesan yang selalu tampil di paling bawah channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((s) =>
    s
      .setName("set")
      .setDescription("Buat / ubah sticky note (form akan muncul)")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel (default: channel ini)").addChannelTypes(...STICKY_CHANNELS)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Hapus sticky note")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel (default: channel ini)").addChannelTypes(...STICKY_CHANNELS)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("toggle")
      .setDescription("Aktifkan / jeda sticky note")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel (default: channel ini)").addChannelTypes(...STICKY_CHANNELS)
      )
  )
  .addSubcommand((s) => s.setName("list").setDescription("Lihat semua sticky note"));

async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }
  const i = interaction;
  if (!(await hasSetupPermission(i.guild, i.member)) && !i.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return i.reply({ embeds: [errorEmbed("Kamu tidak memiliki izin.")], ephemeral: true });
  }

  const sub = i.options.getSubcommand();
  const channelId = i.options.getChannel("channel")?.id ?? i.channelId;
  const existing = sub === "list" ? null : await prisma.stickyNote.findUnique({ where: { channelId } });

  if (sub === "set") {
    // Modal mendukung teks multi-baris, jauh lebih nyaman daripada opsi slash command
    const modal = new ModalBuilder()
      .setCustomId(`sticky:set:${channelId}`)
      .setTitle("Sticky Note")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Judul (opsional)")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(200)
            .setRequired(false)
            .setValue(existing?.title ?? "")
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("content")
            .setLabel("Isi pesan (mendukung markdown Discord)")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(4000)
            .setRequired(true)
            .setValue(existing?.content ?? "")
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("color")
            .setLabel("Warna hex (opsional), contoh #5865F2")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(7)
            .setRequired(false)
            .setValue(existing?.color != null ? `#${existing.color.toString(16).padStart(6, "0")}` : "")
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("image")
            .setLabel("URL gambar (opsional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(existing?.imageUrl ?? "")
        )
      );
    return i.showModal(modal);
  }

  if (sub === "remove") {
    if (!existing) return i.reply({ embeds: [errorEmbed(`Tidak ada sticky note di <#${channelId}>.`)], ephemeral: true });
    await removeStickyMessage(i.guild, existing);
    await prisma.stickyNote.delete({ where: { id: existing.id } });
    return i.reply({ embeds: [successEmbed(`Sticky note di <#${channelId}> dihapus.`)], ephemeral: true });
  }

  if (sub === "toggle") {
    if (!existing) return i.reply({ embeds: [errorEmbed(`Tidak ada sticky note di <#${channelId}>.`)], ephemeral: true });
    const enabled = !existing.enabled;
    await prisma.stickyNote.update({ where: { id: existing.id }, data: { enabled } });
    invalidateSticky(channelId);
    if (enabled) await repostSticky(i.guild, channelId);
    else await removeStickyMessage(i.guild, existing);
    return i.reply({
      embeds: [successEmbed(`Sticky note di <#${channelId}> ${enabled ? "diaktifkan" : "dijeda"}.`)],
      ephemeral: true,
    });
  }

  const cfg = await getConfig(i.guild);
  const stickies = await prisma.stickyNote.findMany({ where: { guildId: i.guild.id } });
  return i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(cfg.color)
        .setTitle(`${cfg.e.STICKY} Sticky Notes`)
        .setDescription(
          stickies.length === 0
            ? "Belum ada sticky note. Buat dengan `/sticky set`."
            : truncate(
                stickies
                  .map((s) => `${s.enabled ? "🟢" : "⏸️"} <#${s.channelId}> — **${s.title ?? "Tanpa judul"}**\n-# ${truncate(s.content.replace(/\n/g, " "), 90)}`)
                  .join("\n"),
                4000
              )
        ),
    ],
    ephemeral: true,
  });
}

export const commands: Command[] = [{ data, execute }];
