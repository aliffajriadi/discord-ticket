/**
 * ============================================================
 * EMOJI DEFAULT — dipakai jika server belum mengatur emoji
 * sendiri lewat dashboard (menu "Emoji").
 * ============================================================
 * Mendukung:
 *  - Unicode emoji  : "🎫"
 *  - Custom Discord : "<:nama:ID>" atau "<a:nama:ID>" (animated)
 * ============================================================
 */

export const E = {
  // ── Tiket ──────────────────────────────────────────────────
  TICKET:        "🎫",
  TICKET_CLOSE:  "🔒",
  TICKET_REOPEN: "🔓",
  TICKET_DELETE: "🗑️",
  TICKET_SAVE:   "📄",
  TICKET_CLAIM:  "🙋",

  // ── Status & Feedback ──────────────────────────────────────
  SUCCESS: "✅",
  ERROR:   "❌",
  WARNING: "⚠️",
  INFO:    "💡",
  CLOCK:   "⏳",

  // ── Moderasi ───────────────────────────────────────────────
  BAN:     "🔨",
  KICK:    "👢",
  TIMEOUT: "🔇",
  WARN:    "⚠️",
  UNBAN:   "🕊️",
  PURGE:   "🧹",

  // ── Lockdown & Sticky ──────────────────────────────────────
  LOCK:    "🔒",
  UNLOCK:  "🔓",
  STICKY:  "📌",

  // ── Umum ───────────────────────────────────────────────────
  LIST:  "📋",
  PING:  "🏓",
  USER:  "👤",
  CHAT:  "💬",
  DATE:  "📅",
  TAG:   "🏷️",
} as const;

export type EmojiKey = keyof typeof E;

/** Deskripsi tiap emoji, ditampilkan di dashboard. */
export const EMOJI_LABELS: Record<EmojiKey, string> = {
  TICKET: "Ikon tiket (panel, judul, opsi dropdown)",
  TICKET_CLOSE: "Tombol tutup tiket",
  TICKET_REOPEN: "Tombol buka kembali tiket",
  TICKET_DELETE: "Tombol hapus tiket",
  TICKET_SAVE: "Tombol kirim ulang transkrip",
  TICKET_CLAIM: "Tombol klaim tiket",
  SUCCESS: "Pesan sukses",
  ERROR: "Pesan error",
  WARNING: "Peringatan",
  INFO: "Informasi",
  CLOCK: "Cooldown / tunggu",
  BAN: "Ban",
  KICK: "Kick",
  TIMEOUT: "Timeout / mute",
  WARN: "Warn",
  UNBAN: "Unban",
  PURGE: "Hapus pesan massal",
  LOCK: "Lockdown",
  UNLOCK: "Unlock",
  STICKY: "Sticky note",
  LIST: "Daftar",
  PING: "Ping",
  USER: "User",
  CHAT: "Pesan",
  DATE: "Tanggal",
  TAG: "Label / alasan",
};
