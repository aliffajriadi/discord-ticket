# 🤖 Discord All-in-One Bot

Bot Discord serba guna untuk komunitas: **tiket**, **moderasi**, **lockdown custom**, **sticky notes**, plus **web dashboard** untuk melihat riwayat, mengatur teks, dan upload emoji.

Dibangun dengan Node.js, TypeScript, discord.js v14, Prisma + SQLite, dan Express.

## ✨ Fitur

| Modul | Isi |
|---|---|
| 🎫 **Tiket** | Multi-alasan (kategori & role staff berbeda), panel tombol/dropdown, klaim tiket, close → reopen → delete, transkrip HTML via DM (cadangan ke channel log), anti-spam |
| 🔨 **Moderasi** | `/ban` `/unban` `/kick` `/timeout` `/untimeout` `/warn`, riwayat per user, nomor kasus per server, DM ke user, cek hierarki role, `/purge`, `/slowmode`, `/userinfo` |
| 🔒 **Lockdown** | Pilih izin yang dikunci: kirim pesan, buat thread, chat di thread, reaksi, file, embed, voice, dll. Bisa per channel atau seluruh server, dengan durasi buka otomatis. Izin lama dipulihkan persis seperti semula |
| 📌 **Sticky Notes** | Embed yang selalu muncul di paling bawah channel, dengan judul, warna, dan gambar |
| 🎨 **Kustomisasi** | Warna embed, semua teks bot (dengan placeholder), dan emoji per server |
| 🌐 **Dashboard** | Login Discord, ringkasan statistik, riwayat tiket + baca transkrip, riwayat moderasi, kelola lockdown/sticky/alasan, kirim panel, editor teks, upload & pasang emoji |

## 🚀 Setup

```bash
pnpm install
cp .env.example .env     # hanya berisi lokasi database
pnpm dev                 # production: pnpm build && pnpm start
```

Saat pertama dijalankan, terminal menampilkan **alamat dan kode setup**:

```
 🔧 SETUP PERTAMA
 Buka  : http://localhost:3000
 Kode  : 481920
```

Buka alamat itu, masukkan kode, lalu isi **Bot Token**, **Client Secret**, dan **URL Dashboard**. Selesai: bot menyala, Client ID dibaca otomatis dari token, slash command didaftarkan otomatis ke semua server, dan tabel database dibuat otomatis. Tidak ada file yang perlu diedit.

Yang masih harus dilakukan di [Developer Portal](https://discord.com/developers/applications) (halaman setup menampilkan petunjuknya):
1. **Bot** → aktifkan **Message Content Intent**.
2. **OAuth2 → Redirects** → tambahkan `<URL Dashboard>/auth/callback`.
3. Undang bot lewat tombol **"Undang bot ke server"** di dashboard (sudah berisi semua izin yang dibutuhkan).
4. Di pengaturan server, letakkan **role bot di atas** role member yang ingin dimoderasi.

### Mengganti token / kredensial
Dashboard → pilih server → **🔑 Pengaturan Bot** (tampil untuk pemilik aplikasi bot). Simpan, dan bot restart sendiri tanpa menghentikan proses. Tombol **Daftarkan ulang command** tersedia di halaman yang sama.

> Token disimpan di database lokal (`prisma/dev.db`) tanpa enkripsi, jadi jangan bagikan file itu dan jangan commit ke git (sudah ada di `.gitignore`). Kalau token pernah bocor, reset di Developer Portal lalu masukkan yang baru.

### Dashboard
Login dengan Discord. Yang bisa masuk hanya Server Owner, member dengan izin *Administrator/Manage Server*, atau pemilik admin role bot. Session disimpan di memori, jadi setelah bot di-restart kamu perlu login ulang.

> Untuk production, jalankan dashboard di belakang HTTPS (Nginx/Caddy/Cloudflare Tunnel), isi URL Dashboard dengan `https://domain-kamu`, dan sesuaikan Redirect URI di Developer Portal agar cookie memakai `Secure`.

## 📋 Command

**Konfigurasi**: `/setup log-channel|mod-log|admin-role|view`, `/reason add|list|delete`, `/panel create`

**Tiket**: `/close` `/reopen` `/claim` `/delete` `/add` `/remove`

**Moderasi**: `/ban` `/unban` `/kick` `/timeout` `/untimeout` `/warn` `/history` `/case view|revoke` `/purge` `/slowmode` `/userinfo`

**Lockdown**: `/lockdown channel|server|list`, `/unlock channel|server`
Contoh: `/lockdown channel send_messages:False create_threads:True duration:30m`. Hanya pembuatan thread yang dikunci selama 30 menit, chat tetap boleh. Kalau tidak ada toggle yang diisi, bot memakai preset: kirim pesan, buat thread, chat di thread, dan reaksi.

**Sticky**: `/sticky set` (muncul form), `/sticky remove|toggle|list`

## 🗂 Struktur

```
src/
├── commands/      # slash command (index.ts = satu-satunya registry)
├── handlers/      # interaksi tombol/menu/modal & pesan
├── lib/           # ticket, moderation, lockdown, sticky, transcript, guildConfig, messageQueue
├── web/           # server Express + OAuth dashboard
└── config/emoji.ts  # emoji default
web/               # frontend dashboard (HTML/CSS/JS statis)
prisma/schema.prisma
```

## 🖥 Deploy ke VPS

```bash
git clone <repo> && cd <repo>
cp .env.example .env
pnpm install            # otomatis generate Prisma client
pnpm build
pm2 start ecosystem.config.cjs && pm2 save
pm2 logs dc-ticket-bot  # kode setup tampil di sini saat pertama jalan
```

Catatan penting:
- **Pasang HTTPS** (Caddy/Nginx + Let's Encrypt) di depan dashboard. Token dan Client Secret dikirim lewat halaman setup, jadi jangan lewat HTTP polos di internet. Set `DASHBOARD_HOST=127.0.0.1` agar port 3000 hanya bisa diakses lewat proxy, lalu isi URL Dashboard dengan `https://domain-kamu`.
- Contoh Caddy: `bot.domain.com { reverse_proxy 127.0.0.1:3000 }`
- Tambahkan `https://domain-kamu/auth/callback` ke Redirect di Developer Portal.
- Backup `prisma/dev.db` secara berkala (berisi data tiket, kasus moderasi, dan token bot).
- Update: `git pull && pnpm install && pnpm build && pm2 restart dc-ticket-bot`. Struktur database ikut diperbarui otomatis.
- Jika bot gagal menyala (token di-reset / intent belum aktif), terminal mencetak kode setup baru agar kamu bisa memperbaikinya lewat web.
