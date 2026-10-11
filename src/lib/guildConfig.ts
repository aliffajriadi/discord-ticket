import { Guild } from "discord.js";
import prisma from "./prisma.js";
import { E, EmojiKey } from "../config/emoji.js";

/**
 * Teks default bot. Semua bisa diubah per-server dari dashboard (menu "Teks").
 * Placeholder yang didukung: {user} {server} {reason} {number} {staff} {channel} {action} {duration}
 */
export const DEFAULT_TEXTS = {
  panelTitle: "Pusat Bantuan",
  panelDescription:
    "Butuh bantuan? Buat tiket di sini dan tim kami akan segera membantu kamu!\n\n**Pilih alasan yang sesuai dengan kebutuhanmu.**",
  panelButton: "Buat Tiket",
  panelFooter: "Klik tombol atau pilih alasan di bawah untuk membuat tiket.",
  ticketWelcomeTitle: "Tiket #{number} — {reason}",
  ticketWelcome:
    "Halo {user}! Tiket kamu telah dibuat.\n\nTim support kami akan segera membantu kamu. Jelaskan kebutuhanmu sedetail mungkin ya.",
  ticketClosed:
    "Tiket ini telah ditutup oleh {staff}.\nHanya staff yang dapat membuka kembali atau menghapus tiket ini.",
  ticketClaimed: "{staff} akan menangani tiket ini.",
  transcriptDm: "Berikut adalah transkrip tiket kamu di **{server}**.",
  lockdownTitle: "Channel Dikunci",
  lockdownMessage: "Channel ini sedang dikunci sementara oleh moderator.",
  unlockTitle: "Channel Dibuka",
  unlockMessage: "Channel ini telah dibuka kembali. Silakan lanjutkan obrolan dengan tertib!",
  modDm: "Kamu menerima tindakan **{action}** di **{server}**.",
  stickyFooter: "Pesan tersemat",
} as const;

export type TextKey = keyof typeof DEFAULT_TEXTS;

export const TEXT_LABELS: Record<TextKey, string> = {
  panelTitle: "Judul panel tiket",
  panelDescription: "Deskripsi panel tiket",
  panelButton: "Label tombol panel",
  panelFooter: "Footer panel",
  ticketWelcomeTitle: "Judul sambutan tiket",
  ticketWelcome: "Pesan sambutan tiket",
  ticketClosed: "Pesan saat tiket ditutup",
  ticketClaimed: "Pesan saat tiket diklaim",
  transcriptDm: "Pesan DM transkrip",
  lockdownTitle: "Judul pengumuman lockdown",
  lockdownMessage: "Pesan pengumuman lockdown",
  unlockTitle: "Judul pengumuman unlock",
  unlockMessage: "Pesan pengumuman unlock",
  modDm: "DM ke user yang terkena tindakan moderasi",
  stickyFooter: "Footer sticky note",
};

export const DEFAULT_COLOR = 0x5865f2;

export interface GuildConfig {
  color: number;
  e: Record<EmojiKey, string>;
  t: Record<TextKey, string>;
}

const cache = new Map<string, GuildConfig>();

function safeParse<T>(json: string | null | undefined): Partial<T> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Partial<T>;
  } catch {
    return {};
  }
}

const CUSTOM_EMOJI_RE = /^<a?:\w{2,32}:(\d{17,20})>$/;

/**
 * Mengembalikan konfigurasi (warna, emoji, teks) server.
 * Emoji custom yang sudah tidak ada di Discord otomatis jatuh ke default,
 * karena Discord menolak seluruh pesan jika ada emoji tidak valid di komponen.
 */
export async function getConfig(guild: Guild): Promise<GuildConfig> {
  let cfg = cache.get(guild.id);
  if (!cfg) {
    const row = await prisma.guild.findUnique({ where: { id: guild.id } });
    cfg = {
      color: row?.accentColor ?? DEFAULT_COLOR,
      e: { ...E, ...safeParse<Record<EmojiKey, string>>(row?.emojis) },
      t: { ...DEFAULT_TEXTS, ...safeParse<Record<TextKey, string>>(row?.texts) },
    };
    cache.set(guild.id, cfg);
  }

  const e = { ...cfg.e };
  for (const key of Object.keys(e) as EmojiKey[]) {
    const match = CUSTOM_EMOJI_RE.exec(e[key]);
    if (match && !guild.client.emojis.cache.has(match[1])) e[key] = E[key];
    if (!e[key]) e[key] = E[key];
  }
  return { ...cfg, e };
}

export function invalidateConfig(guildId: string) {
  cache.delete(guildId);
}

/** Mengganti placeholder {nama} dengan nilai di vars. Placeholder tak dikenal dibiarkan. */
export function fmt(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : whole
  );
}
