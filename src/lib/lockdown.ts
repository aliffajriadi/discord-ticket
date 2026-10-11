import {
  ChannelType,
  Client,
  Colors,
  EmbedBuilder,
  Guild,
  NonThreadGuildBasedChannel,
  PermissionFlagsBits,
  PermissionOverwriteOptions,
  PermissionsString,
  User,
} from "discord.js";
import prisma from "./prisma.js";
import { ensureGuild, sendLog } from "./utils.js";
import { getConfig } from "./guildConfig.js";
import { formatDuration } from "./moderation.js";

/** Izin yang bisa dikunci. Key dipakai sebagai nama opsi slash command & di dashboard. */
export const LOCK_OPTIONS = {
  send_messages: { label: "Kirim pesan", perms: ["SendMessages"] },
  create_threads: { label: "Buat thread", perms: ["CreatePublicThreads", "CreatePrivateThreads"] },
  send_in_threads: { label: "Kirim pesan di thread", perms: ["SendMessagesInThreads"] },
  add_reactions: { label: "Tambah reaksi", perms: ["AddReactions"] },
  attach_files: { label: "Kirim file/gambar", perms: ["AttachFiles"] },
  embed_links: { label: "Embed link", perms: ["EmbedLinks"] },
  use_commands: { label: "Pakai slash command app lain", perms: ["UseApplicationCommands"] },
  voice: { label: "Masuk & bicara di voice", perms: ["Connect", "Speak"] },
  view: { label: "Lihat channel (sembunyikan)", perms: ["ViewChannel"] },
} as const satisfies Record<string, { label: string; perms: PermissionsString[] }>;

export type LockOption = keyof typeof LOCK_OPTIONS;
export const DEFAULT_LOCK: LockOption[] = ["send_messages", "create_threads", "send_in_threads", "add_reactions"];

export type LockableChannel = Exclude<NonThreadGuildBasedChannel, { type: ChannelType.GuildCategory }>;

type Previous = Partial<Record<PermissionsString, boolean | null>>;

const LOCKABLE_TYPES = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

export function isLockable(channel: { type: ChannelType }): boolean {
  return LOCKABLE_TYPES.has(channel.type);
}

function currentValue(channel: LockableChannel, roleId: string, perm: PermissionsString): boolean | null {
  const ow = channel.permissionOverwrites.cache.get(roleId);
  if (!ow) return null;
  const bit = PermissionFlagsBits[perm];
  if (ow.allow.has(bit)) return true;
  if (ow.deny.has(bit)) return false;
  return null;
}

async function announce(channel: LockableChannel, embed: EmbedBuilder) {
  if (!channel.isTextBased() || channel.isThread()) return;
  await channel.send({ embeds: [embed] }).catch(() => null);
}

/**
 * Mengunci izin tertentu untuk sebuah role di channel. Nilai overwrite lama
 * disimpan agar unlock mengembalikan kondisi persis seperti sebelumnya.
 */
export async function lockChannel(
  channel: LockableChannel,
  opts: {
    roleId: string;
    options: LockOption[];
    by: User;
    reason?: string | null;
    durationMs?: number | null;
    announce?: boolean;
  }
): Promise<void> {
  const guild = channel.guild;
  await ensureGuild(guild.id);
  const perms = [...new Set(opts.options.flatMap((o) => LOCK_OPTIONS[o].perms))] as PermissionsString[];

  const existing = await prisma.lockdown.findUnique({
    where: { channelId_roleId: { channelId: channel.id, roleId: opts.roleId } },
  });
  const previous: Previous = existing ? JSON.parse(existing.previous) : {};
  for (const perm of perms) {
    if (!(perm in previous)) previous[perm] = currentValue(channel, opts.roleId, perm);
  }

  const edit: PermissionOverwriteOptions = {};
  for (const perm of perms) edit[perm] = false;
  await channel.permissionOverwrites.edit(opts.roleId, edit, {
    reason: `Lockdown oleh ${opts.by.tag}${opts.reason ? `: ${opts.reason}` : ""}`,
  });

  const unlockAt = opts.durationMs ? new Date(Date.now() + opts.durationMs) : null;
  await prisma.lockdown.upsert({
    where: { channelId_roleId: { channelId: channel.id, roleId: opts.roleId } },
    create: {
      guildId: guild.id,
      channelId: channel.id,
      roleId: opts.roleId,
      previous: JSON.stringify(previous),
      lockedById: opts.by.id,
      reason: opts.reason ?? null,
      unlockAt,
    },
    update: {
      previous: JSON.stringify(previous),
      lockedById: opts.by.id,
      reason: opts.reason ?? null,
      unlockAt,
    },
  });

  if (opts.announce !== false) {
    const cfg = await getConfig(guild);
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(`${cfg.e.LOCK} ${cfg.t.lockdownTitle}`)
      .setDescription(cfg.t.lockdownMessage)
      .addFields({
        name: "Dibatasi",
        value: opts.options.map((o) => `\`${LOCK_OPTIONS[o].label}\``).join(" • "),
      })
      .setTimestamp();
    if (opts.reason) embed.addFields({ name: "Alasan", value: opts.reason });
    if (unlockAt) {
      embed.addFields({
        name: "Dibuka otomatis",
        value: `<t:${Math.floor(unlockAt.getTime() / 1000)}:R> (${formatDuration(opts.durationMs!)})`,
      });
    }
    await announce(channel, embed);
  }
}

/**
 * Membuka lockdown: mengembalikan nilai overwrite seperti sebelum dikunci.
 * Mengembalikan false jika channel tidak sedang dikunci untuk role itu.
 */
export async function unlockChannel(
  guild: Guild,
  channelId: string,
  roleId: string,
  by: User | null,
  announceIt = true
): Promise<boolean> {
  const lock = await prisma.lockdown.findUnique({
    where: { channelId_roleId: { channelId, roleId } },
  });
  if (!lock) return false;
  await prisma.lockdown.delete({ where: { id: lock.id } });

  const channel = guild.channels.cache.get(channelId) as LockableChannel | undefined;
  if (!channel || !isLockable(channel)) return true;

  const previous: Previous = JSON.parse(lock.previous);
  const auditReason = by ? `Unlock oleh ${by.tag}` : "Lockdown berakhir otomatis";
  await channel.permissionOverwrites.edit(roleId, previous as PermissionOverwriteOptions, { reason: auditReason });

  // Hapus overwrite yang jadi kosong agar daftar izin channel tetap bersih
  const ow = channel.permissionOverwrites.cache.get(roleId);
  if (ow && ow.allow.bitfield === 0n && ow.deny.bitfield === 0n) {
    await channel.permissionOverwrites.delete(roleId, auditReason).catch(() => null);
  }

  if (announceIt) {
    const cfg = await getConfig(guild);
    await announce(
      channel,
      new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(`${cfg.e.UNLOCK} ${cfg.t.unlockTitle}`)
        .setDescription(cfg.t.unlockMessage)
        .setFooter(by ? { text: `Dibuka oleh ${by.tag}` } : { text: "Lockdown berakhir otomatis" })
        .setTimestamp()
    );
  }
  return true;
}

/** Channel publik (bisa dilihat role) yang bukan channel tiket — target lockdown server. */
export async function serverLockTargets(guild: Guild, roleId: string): Promise<LockableChannel[]> {
  const role = guild.roles.cache.get(roleId);
  if (!role) return [];
  const ticketChannels = new Set(
    (await prisma.ticket.findMany({ where: { guildId: guild.id, status: { not: "DELETED" } }, select: { channelId: true } }))
      .map((t) => t.channelId)
  );
  return [...guild.channels.cache.values()].filter(
    (c): c is LockableChannel =>
      isLockable(c) &&
      !ticketChannels.has(c.id) &&
      (c as LockableChannel).permissionsFor(role).has(PermissionFlagsBits.ViewChannel)
  );
}

export async function logLock(guild: Guild, title: string, fields: { name: string; value: string; inline?: boolean }[]) {
  const cfg = await getConfig(guild);
  await sendLog(
    guild,
    new EmbedBuilder().setColor(Colors.DarkRed).setTitle(`${cfg.e.LOCK} ${title}`).addFields(fields).setTimestamp(),
    "mod"
  );
}

/** Mengecek lockdown berdurasi yang sudah lewat waktunya setiap 30 detik. */
let schedulerTimer: NodeJS.Timeout | null = null;

export function startLockdownScheduler(client: Client) {
  if (schedulerTimer) clearInterval(schedulerTimer);
  const tick = async () => {
    const due = await prisma.lockdown.findMany({ where: { unlockAt: { lte: new Date() } } });
    for (const lock of due) {
      const guild = client.guilds.cache.get(lock.guildId);
      if (!guild) continue;
      try {
        await unlockChannel(guild, lock.channelId, lock.roleId, null);
      } catch (err) {
        console.error(`[lockdown] Gagal auto-unlock ${lock.channelId}:`, err);
      }
    }
  };
  schedulerTimer = setInterval(() => void tick().catch(console.error), 30_000);
  void tick().catch(console.error);
}
