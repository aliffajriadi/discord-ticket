import { createHash } from "node:crypto";
import { REST, Routes } from "discord.js";
import { commands } from "../commands/index.js";
import prisma from "./prisma.js";

const getKey = (key: string) => prisma.appConfig.findUnique({ where: { key } }).then((r) => r?.value);
const setKey = (key: string, value: string) =>
  prisma.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });

/**
 * Mendaftarkan slash command ke setiap server tempat bot berada (aktif seketika).
 * Server yang command-nya sudah sama dilewati, supaya restart berulang (PM2) tidak
 * membombardir API Discord. force = daftarkan ulang semuanya.
 */
export async function deployCommands(token: string, clientId: string, guildIds: string[], force = false) {
  const rest = new REST().setToken(token);
  const body = commands.map((c) => c.data.toJSON());
  const hash = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);

  // Bersihkan command global lama (agar tidak dobel) cukup sekali per aplikasi
  const clearedKey = `cmds-global-cleared:${clientId}`;
  if (force || !(await getKey(clearedKey))) {
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    await setKey(clearedKey, "1");
  }

  let deployed = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const guildId of guildIds) {
    const key = `cmds:${clientId}:${guildId}`;
    try {
      if (!force && (await getKey(key)) === hash) {
        skipped++;
        continue;
      }
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      await setKey(key, hash);
      deployed++;
    } catch (err) {
      console.error(`[deploy] Gagal di server ${guildId}:`, err);
      failed.push(guildId);
    }
  }
  return { total: body.length, guilds: deployed + skipped, deployed, skipped, failed };
}
