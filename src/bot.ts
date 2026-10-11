import { Client, GatewayIntentBits, Partials, Interaction } from "discord.js";
import { handleMessage } from "./handlers/message.js";
import {
  handlePanelCreateTicket,
  handleSelectReason,
  handleTicketButton,
  handleStickyModal,
} from "./handlers/interaction.js";
import { commands } from "./commands/index.js";
import { flushMessages } from "./lib/messageQueue.js";
import { startLockdownScheduler } from "./lib/lockdown.js";
import { deployCommands } from "./lib/deployCommands.js";
import prisma from "./lib/prisma.js";

export type BotStatus = "offline" | "starting" | "online" | "error";

/**
 * Siklus hidup bot. Dashboard memakai ini untuk menyalakan / mengganti token
 * tanpa restart proses.
 */
export class BotRuntime {
  client: Client<true> | null = null;
  status: BotStatus = "offline";
  error: string | null = null;
  /** ID pemilik aplikasi bot (atau semua anggota team) — boleh mengubah token. */
  ownerIds = new Set<string>();

  private pending: Client | null = null;

  async start(token: string, clientId: string): Promise<void> {
    await this.stop();
    this.status = "starting";
    this.error = null;

    const client = createClient();
    this.pending = client;

    client.once("clientReady", async (c) => {
      this.client = c;
      this.status = "online";
      console.log(`✅ Bot is online as ${c.user.tag}`);
      console.log(`📋 ${commands.length} commands | ${c.guilds.cache.size} server`);
      // Pemanasan koneksi database supaya klik pertama user tidak lambat
      await prisma.guild.count().catch(() => null);
      startLockdownScheduler(c);
      await this.loadOwners(c);
      deployCommands(token, clientId, [...c.guilds.cache.keys()]).catch((err) =>
        console.error("[deploy] Gagal mendaftarkan command:", err)
      );
    });

    // Server baru → langsung daftarkan command di sana
    client.on("guildCreate", (guild) => {
      deployCommands(token, clientId, [guild.id], true).catch((err) => console.error("[deploy] guildCreate:", err));
    });

    try {
      await client.login(token);
    } catch (err: any) {
      this.pending = null;
      this.status = "error";
      this.error =
        err?.code === "TokenInvalid"
          ? "Token tidak valid"
          : err?.code === "DisallowedIntents"
            ? "Message Content Intent belum aktif (Developer Portal → Bot → Privileged Gateway Intents)"
            : (err?.message ?? "Gagal login");
      client.destroy();
      throw new Error(this.error!);
    }
  }

  async stop(): Promise<void> {
    await flushMessages();
    this.pending?.destroy();
    this.pending = null;
    this.client = null;
    this.ownerIds.clear();
    this.status = "offline";
  }

  private async loadOwners(c: Client<true>) {
    try {
      const app = await c.application.fetch();
      const owner = app.owner;
      if (!owner) return;
      if ("members" in owner) {
        for (const id of owner.members.keys()) this.ownerIds.add(id);
        this.ownerIds.add(owner.ownerId ?? "");
      } else {
        this.ownerIds.add(owner.id);
      }
      this.ownerIds.delete("");
    } catch (err) {
      console.error("[bot] Gagal membaca pemilik aplikasi:", err);
    }
  }
}

function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // Privileged: aktifkan "Message Content Intent" di Developer Portal → Bot
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildEmojisAndStickers,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.on("messageCreate", async (message) => {
    try {
      await handleMessage(message);
    } catch (err) {
      console.error("[messageCreate] Error:", err);
    }
  });

  client.on("interactionCreate", async (interaction: Interaction) => {
    const label = interaction.isChatInputCommand()
      ? `/${interaction.commandName}`
      : "customId" in interaction
        ? `${interaction.type}[${interaction.customId}]`
        : `Unknown[${interaction.type}]`;
    console.log(`📨 ${label} from ${interaction.user.tag}`);

    try {
      if (interaction.isChatInputCommand()) {
        const cmd = commands.find((c) => c.data.name === interaction.commandName);
        if (!cmd) return void console.warn(`⚠️ No handler for command: ${interaction.commandName}`);
        await cmd.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        const [namespace, action, ...rest] = interaction.customId.split(":");
        if (namespace === "panel" && action === "create_ticket") return void (await handlePanelCreateTicket(interaction));
        if (namespace === "ticket") {
          const ticketId = parseInt(rest[0], 10);
          if (!isNaN(ticketId)) await handleTicketButton(interaction, action, ticketId);
          return;
        }
      }

      if (interaction.isStringSelectMenu() && interaction.customId === "panel:select_reason") {
        return void (await handleSelectReason(interaction));
      }

      if (interaction.isModalSubmit()) {
        const [namespace, action, channelId] = interaction.customId.split(":");
        if (namespace === "sticky" && action === "set" && channelId) {
          return void (await handleStickyModal(interaction, channelId));
        }
      }
    } catch (err) {
      // 10062 = batas 3 detik terlewat, interaksi sudah tidak bisa dibalas sama sekali
      if ((err as { code?: number })?.code === 10062) {
        return void console.warn(`⚠️ ${label}: terlambat membalas (Unknown interaction)`);
      }
      console.error(`❌ [interactionCreate] Error on ${label}:`, err);
      try {
        if (interaction.isRepliable()) {
          if (interaction.deferred) {
            await interaction.editReply({ content: "❌ Terjadi kesalahan internal.", embeds: [], components: [] });
          } else if (!interaction.replied) {
            await interaction.reply({ content: "❌ Terjadi kesalahan. Coba lagi nanti.", ephemeral: true });
          }
        }
      } catch (replyErr) {
        console.error("❌ Failed to send error reply:", replyErr);
      }
    }
  });

  return client;
}
