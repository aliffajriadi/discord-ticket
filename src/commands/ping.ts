import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { E } from "../config/emoji.js";
import { Command } from "../types.js";

const data = new SlashCommandBuilder().setName("ping").setDescription("Cek latency bot");

async function execute(interaction: ChatInputCommandInteraction) {
  const latency = Date.now() - interaction.createdTimestamp;
  await interaction.reply({
    content: `${E.PING} Pong! Latency: **${latency}ms** | API: **${interaction.client.ws.ping}ms**`,
    ephemeral: true,
  });
}

export const commands: Command[] = [{ data, execute }];
