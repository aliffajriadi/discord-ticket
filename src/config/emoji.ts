/**
 * ============================================================
 * EMOJI CONFIG — Ganti semua emoji bot di sini
 * ============================================================
 * Mendukung:
 *  - Unicode emoji  : "🎫"
 *  - Custom Discord : "<:nama:ID>" atau "<a:nama:ID>" (animated)
 * ============================================================
 */

export const E = {
  // ── Tiket ──────────────────────────────────────────────────
  TICKET:       "🎫",   // Ikon tiket (panel, judul, option)
  TICKET_OPEN:  "🎫",   // Status tiket terbuka
  TICKET_CLOSE: "🔒",   // Status tiket ditutup / tombol tutup
  TICKET_REOPEN:"🔓",   // Tombol buka kembali tiket
  TICKET_DELETE:"🗑️",   // Tombol hapus tiket
  TICKET_SAVE:  "📄",   // Tombol simpan / kirim transkrip

  // ── Status & Feedback ──────────────────────────────────────
  SUCCESS:  "✅",   // Sukses
  ERROR:    "❌",   // Error / gagal
  WARNING:  "⚠️",   // Peringatan
  INFO:     "💡",   // Informasi / tips
  LOADING:  "🔄",   // Loading / proses
  CLOCK:    "⏳",   // Tunggu / cooldown

  // ── UI & Log ───────────────────────────────────────────────
  LOG:        "📨",   // Incoming interaction / event log
  LIST:       "📋",   // Daftar / list
  PING:       "🏓",   // Ping pong test
  STOP:       "🛑",   // Bot shutdown
  CLEAN:      "🧹",   // Hapus / bersihkan
  GLOBAL:     "🌐",   // Global / production

  // ── Transkrip ──────────────────────────────────────────────
  TRANSCRIPT: "📄",   // File transkrip
  LOCATION:   "📌",   // Server / lokasi
  TAG:        "🏷️",   // Label / alasan
  USER:       "👤",   // User / pembuat
  CHAT:       "💬",   // Total pesan
  DATE:       "📅",   // Tanggal

  // ── Navigasi & Aksi ────────────────────────────────────────
  ARROW_RIGHT: "▶️",   // Mulai / execute
  CHECK:       "✅",   // Berhasil selesai
} as const;

export type EmojiKey = keyof typeof E;
