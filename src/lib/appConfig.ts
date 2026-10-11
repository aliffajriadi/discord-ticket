import prisma from "./prisma.js";

/** Key konfigurasi global → env var cadangan (kompatibel dengan setup lama via .env). */
const KEYS = {
  token: "DISCORD_TOKEN",
  clientId: "DISCORD_CLIENT_ID",
  clientSecret: "DISCORD_CLIENT_SECRET",
  dashboardUrl: "DASHBOARD_URL",
} as const;

export type ConfigKey = keyof typeof KEYS;
export type AppConfigValues = Partial<Record<ConfigKey, string>>;

let cache: AppConfigValues | null = null;

export async function loadAppConfig(): Promise<AppConfigValues> {
  if (cache) return cache;
  const rows = await prisma.appConfig.findMany();
  const db = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out: AppConfigValues = {};
  for (const [key, envName] of Object.entries(KEYS) as [ConfigKey, string][]) {
    const v = db[key] || process.env[envName];
    if (v) out[key] = v;
  }
  cache = out;
  return out;
}

export async function saveAppConfig(values: AppConfigValues): Promise<void> {
  for (const [key, value] of Object.entries(values) as [ConfigKey, string | undefined][]) {
    if (!(key in KEYS)) continue;
    if (value) {
      await prisma.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
    } else {
      await prisma.appConfig.deleteMany({ where: { key } });
    }
  }
  cache = null;
}

export function isConfigured(c: AppConfigValues): boolean {
  return !!(c.token && c.clientId && c.clientSecret);
}
