# 🎫 Discord Advanced Ticket Bot

Bot tiket Discord yang fleksibel dan dapat dikustomisasi, dibangun dengan Node.js, TypeScript, Discord.js v14, dan Prisma ORM + SQLite.

## ✨ Fitur

- **Multi-reason tickets** — Admin bisa menambahkan alasan tiket dengan kategori channel & role staff berbeda
- **Panel tiket** — Button atau Select Menu (dropdown) untuk membuat tiket
- **Siklus hidup tiket** — Open → Close → Reopen → Delete
- **Transkrip otomatis** — HTML transcript dikirim via DM saat tiket ditutup
- **Logging terpusat** — Semua aktivitas di-log ke channel yang dikonfigurasi
- **Anti-spam** — Cooldown system untuk mencegah pembuatan tiket berulang
- **Permission system** — Admin role, support role, dan server owner

## 🛠 Tech Stack

- **Runtime:** Node.js + TypeScript
- **Discord:** discord.js v14
- **Database:** Prisma ORM + SQLite
- **Dev:** `tsx watch` untuk hot reload

## 🚀 Setup

### 1. Clone & Install

```bash
git clone <repo>
cd dc-ticket-bot
npm install
```

### 2. Konfigurasi Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DATABASE_URL="file:./dev.db"
```

**Cara mendapatkan token:**
1. Buka [Discord Developer Portal](https://discord.com/developers/applications)
2. Buat aplikasi baru → Bot → Reset Token
3. Enable intents: **Server Members Intent** + **Message Content Intent**

### 3. Setup Database

```bash
npm run db:push
```

### 4. Jalankan Bot

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

## 📋 Slash Commands

### ⚙️ Konfigurasi (Admin/Owner Only)

| Command | Deskripsi |
|---------|-----------|
| `/setup log-channel <channel>` | Atur channel logging tiket |
| `/setup admin-role <role>` | Atur role yang boleh konfigurasi bot (hanya server owner) |
| `/reason add <label> <value> <category> <support_role>` | Tambah alasan tiket baru |
| `/reason list` | Lihat semua alasan tiket |
| `/reason delete <value>` | Hapus alasan tiket |
| `/panel create <button/dropdown>` | Buat panel tiket di channel ini |

### 🎫 Manajemen Tiket (User & Staff)

| Command | Deskripsi | Siapa |
|---------|-----------|-------|
| `/close` | Tutup tiket | User & Staff |
| `/reopen` | Buka kembali tiket tertutup | Staff & Admin |
| `/delete` | Hapus tiket permanen | Staff & Admin |
| `/add <user>` | Tambah user ke tiket | Staff |
| `/remove <user>` | Keluarkan user dari tiket | Staff |

## 🔄 Alur Penggunaan

1. **Setup:** `/setup admin-role @Admin` → `/setup log-channel #log-tiket`
2. **Tambah alasan:** `/reason add label:"Bantuan Teknis" value:tech_support category:... support_role:...`
3. **Buat panel:** `/panel create type:dropdown` di channel publik
4. **User membuat tiket:** Klik dropdown → pilih alasan → channel tiket otomatis dibuat
5. **Staff merespon** di channel tiket
6. **Tutup tiket:** `/close` atau klik button → transkrip HTML dikirim ke DM pembuat
7. **Staff menghapus:** Klik "🗑️ Hapus Tiket" di channel tertutup

## 📁 Struktur Project

```
dc-ticket-bot/
├── prisma/
│   └── schema.prisma       # Database schema
├── src/
│   ├── commands/
│   │   ├── setup.ts        # /setup commands
│   │   ├── reason.ts       # /reason commands
│   │   ├── panel.ts        # /panel create
│   │   └── ticket.ts       # /close /reopen /delete /add /remove
│   ├── handlers/
│   │   ├── interaction.ts  # Button & select menu handlers
│   │   └── message.ts      # Message saver for transcripts
│   ├── lib/
│   │   ├── prisma.ts       # Prisma client singleton
│   │   ├── ticket.ts       # Core ticket operations
│   │   ├── transcript.ts   # HTML transcript generator
│   │   └── utils.ts        # Helpers: logs, embeds, permissions
│   └── index.ts            # Main entry point
├── .env.example
├── tsconfig.json
└── package.json
```

## 🔐 Permissions Bot

Bot membutuhkan permissions berikut di server Discord:
- `Manage Channels` — Untuk membuat/menghapus channel tiket
- `Manage Roles` / `Manage Permissions` — Untuk set permission channel
- `Send Messages` — Untuk mengirim pesan di channel tiket
- `Read Message History` — Untuk membaca pesan untuk transkrip
- `Attach Files` — Untuk mengirim file transkrip
- `Use Application Commands` — Untuk slash commands
