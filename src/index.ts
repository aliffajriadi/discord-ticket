import "./env.js";
import { randomInt } from "node:crypto";
import prisma from "./lib/prisma.js";
import { syncDatabase } from "./lib/migrate.js";
import { loadAppConfig, isConfigured } from "./lib/appConfig.js";
import { flushMessages } from "./lib/messageQueue.js";
import { BotRuntime } from "./bot.js";
import { startDashboard } from "./web/server.js";

syncDatabase();

const bot = new BotRuntime();
const config = await loadAppConfig();

// Kode sekali pakai untuk membuka halaman setup (token belum ada → belum ada login)
const setupCode = isConfigured(config) ? null : String(randomInt(100000, 999999));

const dashboard = await startDashboard(bot, { setupCode });

function printCode(title: string, code: string) {
  console.log("\n──────────────────────────────────────────────");
  console.log(` 🔧 ${title}`);
  console.log(` Buka  : ${dashboard.baseUrl}`);
  console.log(` Kode  : ${code}`);
  console.log("──────────────────────────────────────────────\n");
}

if (setupCode) printCode("SETUP PERTAMA", setupCode);

if (config.token && config.clientId) {
  bot.start(config.token, config.clientId).catch((err) => {
    console.error("❌ Gagal menyalakan bot:", err.message);
    // Token mati / intent belum aktif: beri jalan memperbaikinya lewat web
    printCode("PERBAIKI KONFIGURASI BOT", dashboard.issueSetupCode());
  });
}

// ── Graceful Shutdown ───────────────────────────────────────────────────────
async function shutdown() {
  console.log("🛑 Shutting down...");
  await flushMessages();
  await bot.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (err) => console.error("❌ Unhandled rejection:", err));
