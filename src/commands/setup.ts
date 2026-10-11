import { SlashCommandBuilder, ChannelType, EmbedBuilder } from "discord.js";
import { ensureGuild, hasSetupPermission, errorEmbed, successEmbed } from "../lib/utils.js";
import { getConfig } from "../lib/guildConfig.js";
import prisma from "../lib/prisma.js";
import { Command } from "../types.js";

const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Konfigurasi bot")
  .addSubcommand((sub) =>
    sub
      .setName("log-channel")
      .setDescription("Atur channel log aktivitas tiket")
      .addChannelOption((opt) =>
        opt.setName("channel").setDescription("Channel tujuan log").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("mod-log")
      .setDescription("Atur channel log moderasi (ban, kick, lockdown, dll)")
      .addChannelOption((opt) =>
        opt.setName("channel").setDescription("Channel tujuan log").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("admin-role")
      .setDescription("Atur role yang dapat mengkonfigurasi bot (hanya owner)")
      .addRoleOption((opt) => opt.setName("role").setDescription("Role admin bot").setRequired(true))
  )
  .addSubcommand((sub) => sub.setName("view").setDescription("Lihat konfigurasi bot saat ini"));

async function execute(interaction: import("discord.js").ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di dalam server.")], ephemeral: true });
  }
  await ensureGuild(interaction.guild.id);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "admin-role" && interaction.guild.ownerId !== interaction.user.id) {
    return interaction.reply({ embeds: [errorEmbed("Hanya **Server Owner** yang dapat mengatur admin role.")], ephemeral: true });
  }
  if (!(await hasSetupPermission(interaction.guild, interaction.member))) {
    return interaction.reply({ embeds: [errorEmbed("Kamu tidak memiliki izin untuk menjalankan command ini.")], ephemeral: true });
  }

  const where = { id: interaction.guild.id };

  if (subcommand === "log-channel" || subcommand === "mod-log") {
    const channel = interaction.options.getChannel("channel", true);
    await prisma.guild.update({
      where,
      data: subcommand === "log-channel" ? { logChannelId: channel.id } : { modLogChannelId: channel.id },
    });
    return interaction.reply({
      embeds: [successEmbed(`${subcommand === "log-channel" ? "Log tiket" : "Log moderasi"} diatur ke ${channel}.`)],
      ephemeral: true,
    });
  }

  if (subcommand === "admin-role") {
    const role = interaction.options.getRole("role", true);
    await prisma.guild.update({ where, data: { setupRoleId: role.id } });
    return interaction.reply({ embeds: [successEmbed(`Admin role berhasil diatur ke ${role}.`)], ephemeral: true });
  }

  if (subcommand === "view") {
    const g = await prisma.guild.findUnique({ where });
    const cfg = await getConfig(interaction.guild);
    const show = (id: string | null | undefined, kind: "#" | "@&") => (id ? `<${kind}${id}>` : "`belum diatur`");
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(cfg.color)
          .setTitle(`⚙️ Konfigurasi ${interaction.guild.name}`)
          .addFields(
            { name: "Log Tiket", value: show(g?.logChannelId, "#"), inline: true },
            { name: "Log Moderasi", value: show(g?.modLogChannelId, "#"), inline: true },
            { name: "Admin Role", value: show(g?.setupRoleId, "@&"), inline: true },
            { name: "Total Tiket", value: String(g?.ticketCounter ?? 0), inline: true },
            { name: "Total Kasus", value: String(g?.caseCounter ?? 0), inline: true }
          ),
      ],
      ephemeral: true,
    });
  }
}

export const commands: Command[] = [{ data, execute }];
