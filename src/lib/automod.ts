import { Message, PermissionFlagsBits } from "discord.js";
import { AutoMod } from "@prisma/client";
import prisma from "./prisma.js";
import { ensureGuild, hasSetupPermission } from "./utils.js";
import { checkHierarchy, createCase, notifyUser, CaseType } from "./moderation.js";

export type AutoModAction = "NONE" | "TIMEOUT" | "KICK" | "BAN";

export const AUTOMOD_DEFAULTS = {
  enabled: false,
  maxChars: 1800,
  maxLines: 25,
  maxMentions: 6,
  strikes: 3,
  windowSec: 60,
  action: "TIMEOUT",
  timeoutMin: 60,
} as const;

export type AutoModSettings = Omit<AutoMod, "guildId" | "channelIds"> & { channelIds: string[] };
type Settings = AutoModSettings;
type Patch = Partial<Settings>;

const cache = new Map<string, Settings>();
/** guildId:userId → waktu (ms) pelanggaran dalam jendela waktu */
const strikesLog = new Map<string, number[]>();

export function invalidateAutoMod(guildId: string) {
  cache.delete(guildId);
}

function parseChannels(json: string | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getAutoMod(guildId: string): Promise<Settings> {
  let s = cache.get(guildId);
  if (!s) {
    const row = await prisma.autoMod.findUnique({ where: { guildId } });
    s = row
      ? { ...row, channelIds: parseChannels(row.channelIds) }
      : { ...AUTOMOD_DEFAULTS, channelIds: [] };
    cache.set(guildId, s);
  }
  return s;
}

/** Simpan sebagian pengaturan (nilai sudah divalidasi pemanggil). */
export async function saveAutoMod(guildId: string, patch: Patch) {
  await ensureGuild(guildId);
  const { channelIds, ...rest } = patch;
  const data = { ...rest, ...(channelIds ? { channelIds: JSON.stringify([...new Set(channelIds)]) } : {}) };
  await prisma.autoMod.upsert({
    where: { guildId },
    create: { guildId, ...data },
    update: data,
  });
  invalidateAutoMod(guildId);
}

/** Batas yang diizinkan; dipakai command dan dashboard agar konsisten. */
export const AUTOMOD_LIMITS = {
  maxChars: { min: 50, max: 4000, offAllowed: true },
  maxLines: { min: 3, max: 200, offAllowed: true },
  maxMentions: { min: 2, max: 50, offAllowed: true },
  strikes: { min: 1, max: 20, offAllowed: false },
  windowSec: { min: 10, max: 3600, offAllowed: false },
  timeoutMin: { min: 1, max: 40320, offAllowed: false },
} as const;

export function checkLimit(key: keyof typeof AUTOMOD_LIMITS, value: number): string | null {
  const l = AUTOMOD_LIMITS[key];
  if (l.offAllowed && value === 0) return null;
  if (!Number.isInteger(value) || value < l.min || value > l.max) {
    return `${key} harus ${l.offAllowed ? "0 (mati) atau " : ""}${l.min}–${l.max}`;
  }
  return null;
}

function findViolation(message: Message, s: Settings): string | null {
  const text = message.content;
  if (s.maxChars > 0 && text.length > s.maxChars) {
    return `pesan terlalu panjang (${text.length} karakter, maks ${s.maxChars})`;
  }
  if (s.maxLines > 0) {
    const lines = text.split("\n").length;
    if (lines > s.maxLines) return `terlalu banyak baris (${lines}, maks ${s.maxLines})`;
  }
  if (s.maxMentions > 0) {
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    if (mentions > s.maxMentions) return `terlalu banyak mention (${mentions}, maks ${s.maxMentions})`;
  }
  return null;
}

/**
 * Mengembalikan true jika pesan dihapus oleh AutoMod.
 * Hanya berjalan di channel yang dipilih. Staff (izin kelola pesan/server/moderasi), admin role bot, dan bot dikecualikan.
 */
export async function handleAutomod(message: Message): Promise<boolean> {
  const { guild, member } = message;
  if (!guild || !member || message.author.bot || message.webhookId) return false;

  const s = await getAutoMod(guild.id);
  if (!s.enabled) return false;

  // Hanya channel terpilih; thread di dalam channel terpilih ikut dijaga
  const channelId = message.channel.isThread() ? (message.channel.parentId ?? message.channelId) : message.channelId;
  if (!s.channelIds.includes(channelId)) return false;

  const reason = findViolation(message, s);
  if (!reason) return false;

  const staffPerms =
    PermissionFlagsBits.Administrator |
    PermissionFlagsBits.ManageGuild |
    PermissionFlagsBits.ManageMessages |
    PermissionFlagsBits.ModerateMembers;
  if (member.permissions.bitfield & staffPerms) return false;
  if (await hasSetupPermission(guild, member)) return false;

  await message.delete().catch(() => null);

  const key = `${guild.id}:${member.id}`;
  const now = Date.now();
  if (strikesLog.size > 2000) {
    for (const [k, times] of strikesLog) if (now - times[times.length - 1] > 3_600_000) strikesLog.delete(k);
  }
  const recent = (strikesLog.get(key) ?? []).filter((t) => now - t < s.windowSec * 1000);
  recent.push(now);

  if (s.action === "NONE" || recent.length < s.strikes) {
    strikesLog.set(key, recent);
    const left = s.action === "NONE" ? null : s.strikes - recent.length;
    const warn = await (message.channel.isSendable() ? message.channel : null)
      ?.send(
        `${member}, pesanmu dihapus: ${reason}.` +
          (left !== null ? ` Peringatan ${recent.length}/${s.strikes}.` : "")
      )
      .catch(() => null);
    if (warn) setTimeout(() => warn.delete().catch(() => null), 8_000);
    return true;
  }

  strikesLog.delete(key);
  const why = `AutoMod: ${reason} (${s.strikes}x dalam ${s.windowSec} detik)`;
  const me = guild.members.me;
  const hierarchyError = me ? checkHierarchy(guild, me, member) : "Bot belum siap";
  if (hierarchyError) {
    console.warn(`[automod] Tidak bisa menghukum ${member.user.tag}: ${hierarchyError}`);
    return true;
  }

  const type: CaseType = s.action === "BAN" ? "BAN" : s.action === "KICK" ? "KICK" : "TIMEOUT";
  const durationMs = type === "TIMEOUT" ? s.timeoutMin * 60_000 : null;
  try {
    // DM lebih dulu: setelah ban/kick bot tidak lagi satu server dengan user
    await notifyUser(guild, member.user, type, why, durationMs);
    if (type === "BAN") await guild.bans.create(member.id, { reason: why, deleteMessageSeconds: 3600 });
    else if (type === "KICK") await member.kick(why);
    else await member.timeout(durationMs!, why);
    await createCase(guild, { type, target: member.user, moderator: guild.client.user, reason: why, durationMs });
  } catch (err) {
    console.error(`[automod] Gagal menjalankan ${type} pada ${member.user.tag}:`, err);
  }
  return true;
}
