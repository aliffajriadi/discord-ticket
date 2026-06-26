📄 Product Requirements Document (PRD)
Project Name: Discord Advanced Ticket Bot (AI Agent / Support System)
Version: 1.0.0
Date: 26 Juni 2026
Tech Stack: Node.js / TypeScript, Discord.js, Prisma ORM, SQLite
1. Ringkasan Proyek (Overview)
Membuat sistem tiket Discord yang fleksibel dan dapat dikustomisasi oleh admin server. Sistem ini memungkinkan pengguna membuat tiket berdasarkan "Alasan (Reason)" yang telah ditentukan. Setiap alasan dapat diarahkan ke kategori channel dan role petugas (staff) yang berbeda. Sistem ini juga mencakup manajemen siklus hidup tiket, transkrip otomatis via DM, dan logging yang terpusat.
2. Target Pengguna (User Roles)
Server Member (User): Pengguna biasa yang membuat tiket, berinteraksi, dan menutup tiket.
Support Staff (Petugas): Role yang ditugaskan untuk membalas tiket berdasarkan alasan yang dipilih.
Ticket Admin / Owner: Pengguna yang memiliki izin untuk mengonfigurasi bot (menambah alasan, mengatur log, membuat panel tiket).
3. Fitur Utama (Core Features)
3.1. Manajemen Alasan Tiket (Ticket Reasons)
Admin dapat menambahkan, mengedit, dan menghapus alasan tiket menggunakan command (misal: /reason add).
Setiap alasan memiliki properti:
Label & Value: Tampilan di dropdown dan nilai unik.
Category ID: Kategori channel Discord tempat tiket akan dibuat.
Support Role ID: Role petugas yang otomatis mendapat akses ke tiket tersebut.
3.2. Pembuatan Tiket (Ticket Creation)
Admin membuat panel tiket (menggunakan Button atau Select Menu).
Saat user mengklik panel, muncul Dropdown (Select Menu) berisi daftar alasan yang telah di-setting admin.
Setelah user memilih alasan, bot akan:
Membuat channel baru di dalam Category yang sesuai dengan alasan yang dipilih.
Memberikan izin akses hanya kepada User pembuat, Support Role yang sesuai, dan Admin.
Mengirim pesan sambutan (embed) di dalam channel.
3.3. Siklus Hidup Tiket (Ticket Lifecycle)
Close Ticket:
User: Bisa menutup tiket. Channel akan di-lock (user tidak bisa chat), nama channel diubah (misal: closed-ticket-123).
Admin/Staff: Bisa menutup tiket kapan saja.
Reopen Ticket: Hanya Admin/Staff yang bisa membuka kembali tiket yang sudah di-close.
Delete Ticket: Hanya Admin/Owner yang bisa menghapus channel tiket secara permanen.
3.4. Transkrip Otomatis (Auto Transcript)
Saat tiket di-close, bot akan mengumpulkan semua pesan di channel tersebut.
Bot membuat file transkrip (format .txt atau .html) dan mengirimkannya via Direct Message (DM) kepada pembuat tiket.
Fallback: Jika user memblokir DM, transkrip disimpan di database dan bisa diakses admin, atau dikirim ke channel log.
3.5. Logging & Konfigurasi (Settings)
Log Channel: Admin dapat mengatur channel khusus untuk menerima log aktivitas tiket (Tiket dibuat, ditutup, dihapus, error DM).
Setup Permission: Hanya user dengan role tertentu (atau Server Owner) yang bisa menjalankan command konfigurasi bot (/setup, /reason, /panel).

4. Database Schema (Prisma + SQLite)
Berikut adalah skema database yang dioptimalkan untuk SQLite menggunakan Prisma:
// schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model Guild {
  id          String   @id // Discord Guild ID
  logChannelId String?  // Channel ID untuk log tiket
  setupRoleId  String?  // Role ID yang diizinkan setup bot
  createdAt   DateTime @default(now())
  
  reasons     TicketReason[]
  tickets     Ticket[]
}

model TicketReason {
  id             Int      @id @default(autoincrement())
  guildId        String
  label          String   // Nama alasan (misal: "Bantuan Teknis")
  value          String   // Unique identifier (misal: "tech_support")
  description    String?  // Deskripsi di dropdown
  categoryId     String   // Category ID Discord
  supportRoleId  String   // Role ID petugas
  
  guild          Guild    @relation(fields: [guildId], references: [id], onDelete: Cascade)
  tickets        Ticket[]

  @@unique([guildId, value])
}

model Ticket {
  id             Int      @id @default(autoincrement())
  guildId        String
  channelId      String   @unique // Discord Channel ID
  creatorId      String   // Discord User ID pembuat
  reasonId       Int
  
  status         String   @default("OPEN") // OPEN, CLOSED, DELETED
  createdAt      DateTime @default(now())
  closedAt       DateTime?
  closedById     String?  // User ID yang menutup
  
  guild          Guild    @relation(fields: [guildId], references: [id], onDelete: Cascade)
  reason         TicketReason @relation(fields: [reasonId], references: [id])
  messages       TicketMessage[]
}

model TicketMessage {
  id          Int      @id @default(autoincrement())
  ticketId    Int
  authorId    String   // Discord User ID
  content     String   // Isi pesan
  attachments String?  // JSON string array of URLs
  createdAt   DateTime @default(now())
  
  ticket      Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
}

5. Daftar Command & Interaksi (Slash Commands)
Konfigurasi (Hanya untuk Setup Role / Owner)
/setup log-channel <channel> -> Mengatur channel untuk logging.
/setup admin-role <role> -> Mengatur role yang boleh setup bot.
/reason add <label> <value> <category> <support_role> -> Menambah alasan tiket.
/reason list -> Melihat daftar alasan.
/reason delete <value> -> Menghapus alasan.
/panel create <type: button/dropdown> -> Membuat panel tiket di channel saat ini.
Manajemen Tiket (Untuk User & Staff)
/close -> Menutup tiket (Bisa User & Staff).
/reopen -> Membuka kembali tiket yang sudah ditutup (Hanya Staff).
/delete -> Menghapus tiket permanen (Hanya Staff/Owner).
/add <user> -> Menambahkan user ke dalam tiket (Hanya Staff).
/remove <user> -> Mengeluarkan user dari tiket (Hanya Staff).
Interaksi UI (Buttons & Select Menus)
Button "Create Ticket": Memunculkan Dropdown alasan.
Dropdown "Select Reason": User memilih alasan -> Bot membuat channel.
Button "Close Ticket" (di dalam channel tiket): Menutup tiket.
Button "Reopen Ticket" (di dalam channel closed): Membuka kembali.
Button "Delete Ticket" (di dalam channel closed): Menghapus channel.
Button "Save Transcript": (Opsional) Mengirim ulang transkrip ke DM user jika gagal sebelumnya.
6. Alur Pengguna (User Flow)
Persiapan: Owner menjalankan /setup admin-role @Admin. Admin menjalankan /reason add dan /panel create.
Pembuatan: User klik button "Buat Tiket" -> Pilih alasan "Masalah Pembayaran" -> Bot membuat channel di Category Finance dan memberikan akses ke Role Finance Staff.
Interaksi: User dan Staff mengobrol. Setiap pesan di-save ke tabel TicketMessage.
Penutupan: User klik button "Close". Bot mengubah nama channel, mengunci akses user, dan mengirim transkrip ke DM User.
Logging: Bot mengirim embed ke Log Channel: "Tiket #123 ditutup oleh UserX. Alasan: Masalah Pembayaran."
Penghapusan: Staff melihat tiket sudah selesai, klik button "Delete". Channel dihapus dari Discord, status di DB berubah jadi DELETED.
7. Persyaratan Non-Fungsional (Non-Functional Requirements)
Rate Limiting: Bot harus mematuhi Discord API Rate Limits, terutama saat menyimpan pesan ke database (gunakan batching atau queue jika channel sangat aktif).
Error Handling (DM Closed): Jika user mematikan DM, bot harus menangani error gracefully (jangan crash) dan mengirim notifikasi ke channel log bahwa transkrip gagal dikirim via DM.
Concurrency: Mencegah user spam klik button "Create Ticket" yang bisa membuat channel ganda (gunakan cooldown atau defer reply).
Data Privacy: Transkrip hanya boleh dikirim ke DM pembuat tiket asli atau Admin yang berwenang.
