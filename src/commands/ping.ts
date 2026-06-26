import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { E } from "../config/emoji.js";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Test apakah bot merespon interaction");

export async function execute(interaction: ChatInputCommandInteraction) {
  const latency = Date.now() - interaction.createdTimestamp;
  await interaction.reply({
    content: `${E.PING} Pong! Latency: **${latency}ms** | API: **${interaction.client.ws.ping}ms**`,
    ephemeral: true,
  });
}
