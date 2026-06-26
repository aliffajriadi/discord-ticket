import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import prisma from "./lib/prisma.js";
import { handleMessage } from "./handlers/message.js";
import {
  handlePanelCreateTicket,
  handleSelectReason,
  handleTicketButton,
} from "./handlers/interaction.js";

// ── Command Imports ─────────────────────────────────────────────────────────
import * as setupCmd from "./commands/setup.js";
import * as reasonCmd from "./commands/reason.js";
import * as panelCmd from "./commands/panel.js";
import * as pingCmd from "./commands/ping.js";
import {
  closeData,
  executeClose,
  reopenData,
  executeReopen,
  deleteData,
  executeDelete,
  addData,
  executeAdd,
  removeData,
  executeRemove,
} from "./commands/ticket.js";

// ── Environment Validation ──────────────────────────────────────────────────
const { DISCORD_TOKEN, DISCORD_CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error(
    "❌ Missing env vars: DISCORD_TOKEN and DISCORD_CLIENT_ID are required.\nCopy .env.example to .env and fill in your values."
  );
  process.exit(1);
}

// ── Command Registry ────────────────────────────────────────────────────────
const commands = [
  { data: setupCmd.data, execute: setupCmd.execute },
  { data: reasonCmd.data, execute: reasonCmd.execute },
  { data: panelCmd.data, execute: panelCmd.execute },
  { data: pingCmd.data, execute: pingCmd.execute },
  { data: closeData, execute: executeClose },
  { data: reopenData, execute: executeReopen },
  { data: deleteData, execute: executeDelete },
  { data: addData, execute: executeAdd },
  { data: removeData, execute: executeRemove },
];

// ── Discord Client ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // GuildMembers & MessageContent are PRIVILEGED intents.
    // Enable them in Discord Developer Portal → Bot → Privileged Gateway Intents
    // then uncomment the lines below:
    // GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ── Ready Event ─────────────────────────────────────────────────────────────
// Commands di-deploy terpisah via: npm run deploy
client.once("ready", (c) => {
  console.log(`✅ Bot is online as ${c.user.tag}`);
  console.log(`📋 Loaded ${commands.length} commands | Serving ${c.guilds.cache.size} guild(s)`);
  console.log(`💡 Tip: Jalankan "npm run deploy" untuk mendeploy/update slash commands`);
});

// ── Message Event (for transcript saving) ───────────────────────────────────
client.on("messageCreate", async (message) => {
  try {
    await handleMessage(message);
  } catch (err) {
    console.error("[messageCreate] Error:", err);
  }
});

// ── Interaction Event ───────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction: Interaction) => {
  // Debug log SETIAP interaction yang masuk
  const interType = interaction.isChatInputCommand() ? `SlashCommand[${interaction.commandName}]`
    : interaction.isButton() ? `Button[${interaction.customId}]`
    : interaction.isStringSelectMenu() ? `SelectMenu[${interaction.customId}]`
    : `Unknown[${interaction.type}]`;
  console.log(`📨 Interaction received: ${interType} from ${interaction.user.tag}`);

  try {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
      const cmd = commands.find((c) => c.data.name === interaction.commandName);
      if (!cmd) {
        console.warn(`⚠️ No handler for command: ${interaction.commandName}`);
        return;
      }

      console.log(`▶️  Executing command: /${interaction.commandName}`);
      await cmd.execute(interaction as ChatInputCommandInteraction);
      console.log(`✅ Command done: /${interaction.commandName}`);
      return;
    }

    // Button Interactions
    if (interaction.isButton()) {
      const [namespace, action, ...rest] = interaction.customId.split(":");

      if (namespace === "panel" && action === "create_ticket") {
        return handlePanelCreateTicket(interaction as ButtonInteraction);
      }

      if (namespace === "ticket") {
        const ticketId = parseInt(rest[0], 10);
        if (isNaN(ticketId)) return;
        return handleTicketButton(interaction as ButtonInteraction, action, ticketId);
      }
    }

    // Select Menu Interactions
    if (interaction.isStringSelectMenu()) {
      const [namespace, action] = interaction.customId.split(":");

      if (namespace === "panel" && action === "select_reason") {
        return handleSelectReason(interaction as StringSelectMenuInteraction);
      }
    }
  } catch (err) {
    console.error(`❌ [interactionCreate] Error on ${interType}:`, err);

    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred) {
          await interaction.editReply({ content: "❌ Terjadi kesalahan internal." });
        } else if (!interaction.replied) {
          await interaction.reply({ content: "❌ Terjadi kesalahan. Coba lagi nanti.", ephemeral: true });
        }
      }
    } catch (replyErr) {
      console.error("❌ Failed to send error reply:", replyErr);
    }
  }
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────
async function shutdown() {
  console.log("🛑 Shutting down...");
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Start Bot ───────────────────────────────────────────────────────────────
client.login(DISCORD_TOKEN);
