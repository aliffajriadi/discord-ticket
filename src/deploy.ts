/**
 * Daftarkan ulang slash command secara manual: pnpm run deploy
 * (bot juga melakukannya otomatis saat start dan saat masuk server baru)
 */
import "./env.js";
import { REST, Routes } from "discord.js";
import { loadAppConfig } from "./lib/appConfig.js";
import { deployCommands } from "./lib/deployCommands.js";
import prisma from "./lib/prisma.js";

const { token, clientId } = await loadAppConfig();
if (!token || !clientId) {
  console.error("❌ Token belum diatur. Jalankan bot lalu buka dashboard untuk setup.");
  process.exit(1);
}

const rest = new REST().setToken(token);
const guilds = (await rest.get(Routes.userGuilds())) as { id: string }[];
const result = await deployCommands(token, clientId, guilds.map((g) => g.id), true);
console.log(`✅ ${result.total} command didaftarkan ke ${result.guilds} server.`);
await prisma.$disconnect();
