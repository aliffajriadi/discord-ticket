/**
 * Deploy slash commands + hapus global commands lama jika ada konflik.
 * Jalankan: npm run deploy
 */

import "dotenv/config";
import { REST, Routes } from "discord.js";

import * as setupCmd from "./commands/setup.js";
import * as reasonCmd from "./commands/reason.js";
import * as panelCmd from "./commands/panel.js";
import * as pingCmd from "./commands/ping.js";
import {
  closeData,
  reopenData,
  deleteData,
  addData,
  removeData,
} from "./commands/ticket.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN dan DISCORD_CLIENT_ID wajib diisi di .env");
  process.exit(1);
}

const commands = [
  setupCmd.data,
  reasonCmd.data,
  panelCmd.data,
  pingCmd.data,
  closeData,
  reopenData,
  deleteData,
  addData,
  removeData,
].map((cmd) => cmd.toJSON());

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    // Selalu hapus global commands untuk menghindari konflik
    console.log("🧹 Menghapus global commands (untuk menghindari konflik)...");
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: [] });
    console.log("✅ Global commands bersih.");

    if (DEV_GUILD_ID) {
      console.log(`\n🔄 Deploying ${commands.length} commands ke guild ${DEV_GUILD_ID}...`);
      await rest.put(
        Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DEV_GUILD_ID),
        { body: commands }
      );
      console.log("✅ Guild commands berhasil! Coba di Discord sekarang.");
    } else {
      console.log(`\n🌐 Deploying ${commands.length} global commands...`);
      await rest.put(
        Routes.applicationCommands(DISCORD_CLIENT_ID),
        { body: commands }
      );
      console.log("✅ Global commands berhasil (mungkin butuh hingga 1 jam).");
    }
  } catch (err) {
    console.error("❌ Deploy gagal:", err);
    process.exit(1);
  }
})();
