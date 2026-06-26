import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from "discord.js";
import { ensureGuild, hasSetupPermission, errorEmbed } from "../lib/utils.js";
import prisma from "../lib/prisma.js";
import { E } from "../config/emoji.js";

export const data = new SlashCommandBuilder()
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
          .addChoices(
            { name: "Button", value: "button" },
            { name: "Dropdown (Select Menu)", value: "dropdown" }
          )
      )
      .addStringOption((opt) =>
        opt
          .setName("title")
          .setDescription("Judul panel (opsional)")
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("description")
          .setDescription("Deskripsi panel (opsional)")
          .setRequired(false)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.channel) {
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

  const reasons = await prisma.ticketReason.findMany({
    where: { guildId: interaction.guild.id },
    orderBy: { id: "asc" },
  });

  if (reasons.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed("Belum ada alasan tiket! Tambahkan dengan `/reason add` terlebih dahulu.")],
      ephemeral: true,
    });
  }

  const panelType = interaction.options.getString("type", true);
  const title = interaction.options.getString("title") ?? `${E.TICKET} Pusat Bantuan`;
  const description =
    interaction.options.getString("description") ??
    "Butuh bantuan? Buat tiket di sini dan tim kami akan segera membantu kamu!\n\n**Pilih alasan yang sesuai dengan kebutuhanmu.**";

  const panelEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .addFields({
      name: `${E.LIST} Alasan Tersedia`,
      value: reasons.map((r: { label: string; description: string | null }) => `• **${r.label}**${r.description ? ` — ${r.description}` : ""}`).join("\n"),
    })
    .setFooter({ text: "Klik tombol atau pilih alasan di bawah ini untuk membuat tiket." })
    .setTimestamp();

  if (panelType === "button") {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("panel:create_ticket")
        .setLabel(`${E.TICKET} Buat Tiket`)
        .setStyle(ButtonStyle.Primary)
    );

    await (interaction.channel as TextChannel).send({ embeds: [panelEmbed], components: [row] });
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setDescription(`${E.SUCCESS} Panel tiket (button) berhasil dibuat!`),
      ],
      ephemeral: true,
    });
  }

  if (panelType === "dropdown") {
    // Discord allows max 25 options in a select menu
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

    await (interaction.channel as TextChannel).send({ embeds: [panelEmbed], components: [row] });
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setDescription(`${E.SUCCESS} Panel tiket (dropdown) berhasil dibuat!`),
      ],
      ephemeral: true,
    });
  }
}
