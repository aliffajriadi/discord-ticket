import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, TextChannel, ChannelType } from "discord.js";
import { ensureGuild, hasSetupPermission, errorEmbed, successEmbed } from "../lib/utils.js";
import prisma from "../lib/prisma.js";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Konfigurasi bot tiket")
  .addSubcommand((sub) =>
    sub
      .setName("log-channel")
      .setDescription("Atur channel untuk logging aktivitas tiket")
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Channel tujuan log")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("admin-role")
      .setDescription("Atur role yang dapat mengkonfigurasi bot")
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("Role admin bot").setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di dalam server.")], ephemeral: true });
  }

  await ensureGuild(interaction.guild.id);

  // Server owner can always use this command; others need setup role
  const hasPermission = await hasSetupPermission(interaction.guild, interaction.user.id);
  const subcommand = interaction.options.getSubcommand();

  // For admin-role subcommand, only server owner can set it
  if (subcommand === "admin-role" && interaction.guild.ownerId !== interaction.user.id) {
    return interaction.reply({
      embeds: [errorEmbed("Hanya **Server Owner** yang dapat mengatur admin role.")],
      ephemeral: true,
    });
  }

  if (!hasPermission) {
    return interaction.reply({
      embeds: [errorEmbed("Kamu tidak memiliki izin untuk menjalankan command ini.")],
      ephemeral: true,
    });
  }

  if (subcommand === "log-channel") {
    const channel = interaction.options.getChannel("channel", true) as TextChannel;

    await prisma.guild.update({
      where: { id: interaction.guild.id },
      data: { logChannelId: channel.id },
    });

    return interaction.reply({
      embeds: [successEmbed(`Log channel berhasil diatur ke ${channel.toString()}.`)],
      ephemeral: true,
    });
  }

  if (subcommand === "admin-role") {
    const role = interaction.options.getRole("role", true);

    await prisma.guild.update({
      where: { id: interaction.guild.id },
      data: { setupRoleId: role.id },
    });

    return interaction.reply({
      embeds: [successEmbed(`Admin role berhasil diatur ke ${role.toString()}.`)],
      ephemeral: true,
    });
  }
}
