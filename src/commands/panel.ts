import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { ensureGuild, hasSetupPermission, errorEmbed, successEmbed } from "../lib/utils.js";
import { buildPanelMessage } from "../lib/ticket.js";
import { Command } from "../types.js";

const data = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Buat panel tiket di channel ini")
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Buat panel tiket (button atau dropdown)")
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Tipe panel tiket")
          .setRequired(true)
          .addChoices({ name: "Button", value: "button" }, { name: "Dropdown (Select Menu)", value: "dropdown" })
      )
      .addStringOption((opt) => opt.setName("title").setDescription("Judul panel (opsional)"))
      .addStringOption((opt) => opt.setName("description").setDescription("Deskripsi panel (opsional)"))
  );

async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild() || !interaction.channel) {
    return interaction.reply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di server.")], ephemeral: true });
  }

  await ensureGuild(interaction.guild.id);
  if (!(await hasSetupPermission(interaction.guild, interaction.member))) {
    return interaction.reply({ embeds: [errorEmbed("Kamu tidak memiliki izin untuk menjalankan command ini.")], ephemeral: true });
  }

  const type = interaction.options.getString("type", true) as "button" | "dropdown";
  const panel = await buildPanelMessage(interaction.guild, type, {
    title: interaction.options.getString("title"),
    description: interaction.options.getString("description"),
  });

  if (!panel) {
    return interaction.reply({
      embeds: [errorEmbed("Belum ada alasan tiket! Tambahkan dengan `/reason add` terlebih dahulu.")],
      ephemeral: true,
    });
  }

  await interaction.channel.send(panel);
  return interaction.reply({ embeds: [successEmbed(`Panel tiket (${type}) berhasil dibuat!`)], ephemeral: true });
}

export const commands: Command[] = [{ data, execute }];
