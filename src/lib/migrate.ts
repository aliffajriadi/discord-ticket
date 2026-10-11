import "../env.js";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Menyamakan struktur database dengan prisma/schema.prisma saat bot start,
 * supaya tidak perlu menjalankan `db:push` manual. Matikan dengan AUTO_DB_PUSH=0.
 */
export function syncDatabase() {
  if (process.env.AUTO_DB_PUSH === "0") return;
  try {
    const require = createRequire(import.meta.url);
    const cli = require.resolve("prisma/build/index.js");
    const res = spawnSync(process.execPath, [cli, "db", "push", "--skip-generate"], {
      encoding: "utf-8",
      env: process.env,
    });
    if (res.status !== 0) {
      console.warn("⚠️  Sinkronisasi database gagal:\n" + (res.stderr || res.stdout));
    }
  } catch (err) {
    console.warn("⚠️  Tidak bisa menjalankan prisma db push:", err);
  }
}
