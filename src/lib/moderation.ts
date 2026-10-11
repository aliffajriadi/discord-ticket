import { Colors, EmbedBuilder, Guild, GuildMember, User } from "discord.js";
import { ModCase } from "@prisma/client";
import prisma from "./prisma.js";
import { ensureGuild, sendLog } from "./utils.js";
import { getConfig, fmt } from "./guildConfig.js";
import { EmojiKey } from "../config/emoji.js";

export type CaseType = "BAN" | "UNBAN" | "KICK" | "TIMEOUT" | "UNTIMEOUT" | "WARN";

export const CASE_META: Record<CaseType, { label: string; color: number; emoji: EmojiKey }> = {
  BAN: { label: "Ban", color: Colors.DarkRed, emoji: "BAN" },
  UNBAN: { label: "Unban", color: Colors.Green, emoji: "UNBAN" },
  KICK: { label: "Kick", color: Colors.Orange, emoji: "KICK" },
  TIMEOUT: { label: "Timeout", color: Colors.Yellow, emoji: "TIMEOUT" },
  UNTIMEOUT: { label: "Hapus Timeout", color: Colors.Green, emoji: "UNLOCK" },
  WARN: { label: "Warn", color: Colors.Gold, emoji: "WARN" },
};

const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** "10m", "1h30m", "2d" -> milidetik. null jika format salah. */
export function parseDuration(input: string): number | null {
  const parts = input.trim().toLowerCase().match(/(\d+)\s*([smhdw])/g);
  if (!parts || parts.join("").replace(/\s/g, "") !== input.trim().toLowerCase().replace(/\s/g, "")) return null;
  let total = 0;
  for (const part of parts) {
    const [, n, unit] = /(\d+)\s*([smhdw])/.exec(part)!;
    total += parseInt(n, 10) * UNITS[unit];
  }
  return total > 0 ? total : null;
}

export function formatDuration(ms: number): string {
  const out: string[] = [];
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (d) out.push(`${d} hari`);
  if (h) out.push(`${h} jam`);
  if (m) out.push(`${m} menit`);
  if (s && !d && !h) out.push(`${s} detik`);
  return out.join(" ") || "0 detik";
}

/**
 * Validasi hierarki role. Mengembalikan pesan error, atau null jika boleh.
 */
export function checkHierarchy(guild: Guild, moderator: GuildMember, target: GuildMember): string | null {
  if (target.id === moderator.id) return "Kamu tidak bisa melakukan ini pada dirimu sendiri.";
  if (target.id === guild.ownerId) return "Tidak bisa menindak **Server Owner**.";
  if (target.id === guild.client.user.id) return "Aku tidak bisa menindak diriku sendiri 😅";
  if (moderator.id !== guild.ownerId && target.roles.highest.position >= moderator.roles.highest.position) {
    return "Role target sama atau lebih tinggi dari role kamu.";
  }
  const me = guild.members.me;
  if (me && target.roles.highest.position >= me.roles.highest.position) {
    return "Role target sama atau lebih tinggi dari role bot. Naikkan posisi role bot di pengaturan server.";
  }
  return null;
}

/** DM ke user sebelum/selesai ditindak. Gagal diam-diam jika DM tertutup. */
export async function notifyUser(
  guild: Guild,
  user: User,
  type: CaseType,
  reason: string | null,
  durationMs?: number | null
): Promise<boolean> {
  const cfg = await getConfig(guild);
  const meta = CASE_META[type];
  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setDescription(`${cfg.e[meta.emoji]} ${fmt(cfg.t.modDm, { action: meta.label, server: guild.name })}`)
    .addFields({ name: "Alasan", value: reason ?? "Tidak ada alasan" })
    .setTimestamp();
  if (durationMs) embed.addFields({ name: "Durasi", value: formatDuration(durationMs) });
  return user
    .send({ embeds: [embed] })
    .then(() => true)
    .catch(() => false);
}

/**
 * Mencatat kasus moderasi (nomor kasus per-server) dan mengirim ke mod log.
 */
export async function createCase(
  guild: Guild,
  data: {
    type: CaseType;
    target: User;
    moderator: User;
    reason: string | null;
    durationMs?: number | null;
  }
): Promise<ModCase> {
  await ensureGuild(guild.id);
  const g = await prisma.guild.update({
    where: { id: guild.id },
    data: { caseCounter: { increment: 1 } },
  });

  const modCase = await prisma.modCase.create({
    data: {
      guildId: guild.id,
      number: g.caseCounter,
      type: data.type,
      targetId: data.target.id,
      targetTag: data.target.tag,
      moderatorId: data.moderator.id,
      moderatorTag: data.moderator.tag,
      reason: data.reason,
      durationMs: data.durationMs ?? null,
    },
  });

  await sendLog(guild, await caseEmbed(guild, modCase, data.target), "mod");
  return modCase;
}

export async function caseEmbed(guild: Guild, c: ModCase, target?: User): Promise<EmbedBuilder> {
  const cfg = await getConfig(guild);
  const meta = CASE_META[c.type as CaseType] ?? CASE_META.WARN;
  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${cfg.e[meta.emoji]} ${meta.label} • Kasus #${c.number}`)
    .addFields(
      { name: "User", value: `<@${c.targetId}>\n\`${c.targetTag ?? c.targetId}\``, inline: true },
      { name: "Moderator", value: `<@${c.moderatorId}>`, inline: true },
      { name: "Alasan", value: c.reason ?? "Tidak ada alasan" }
    )
    .setFooter({ text: `User ID: ${c.targetId}` })
    .setTimestamp(c.createdAt);
  if (c.durationMs) embed.addFields({ name: "Durasi", value: formatDuration(c.durationMs), inline: true });
  if (target) embed.setThumbnail(target.displayAvatarURL());
  return embed;
}
