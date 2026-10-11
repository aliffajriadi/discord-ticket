import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandSubcommandBuilder,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { errorEmbed, successEmbed, truncate } from "../lib/utils.js";
import { getConfig } from "../lib/guildConfig.js";
import { parseDuration, formatDuration } from "../lib/moderation.js";
import {
  LOCK_OPTIONS,
  LockOption,
  DEFAULT_LOCK,
  LockableChannel,
  lockChannel,
  unlockChannel,
  serverLockTargets,
  isLockable,
  logLock,
} from "../lib/lockdown.js";
import prisma from "../lib/prisma.js";
import { Command } from "../types.js";

const CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
] as const;

/** Tambahkan opsi kustom lockdown: role, durasi, alasan, dan toggle tiap izin. */
function lockOptions(sub: SlashCommandSubcommandBuilder) {
  sub
    .addRoleOption((o) => o.setName("role").setDescription("Role yang dikunci (default: @everyone)"))
    .addStringOption((o) => o.setName("duration").setDescription("Buka otomatis setelah, contoh: 30m, 2h"))
    .addStringOption((o) => o.setName("reason").setDescription("Alasan lockdown").setMaxLength(300))
    .addBooleanOption((o) => o.setName("announce").setDescription("Kirim pengumuman di channel (default: ya)"));
  for (const [key, { label }] of Object.entries(LOCK_OPTIONS)) {
    sub.addBooleanOption((o) => o.setName(key).setDescription(`Kunci: ${label}`));
  }
  return sub;
}

/** Baca toggle izin. Jika tidak ada satu pun yang diisi, pakai preset default. */
function readLockOptions(i: ChatInputCommandInteraction): LockOption[] {
  const keys = Object.keys(LOCK_OPTIONS) as LockOption[];
  const anySet = keys.some((k) => i.options.getBoolean(k) !== null);
  if (!anySet) return DEFAULT_LOCK;
  return keys.filter((k) => i.options.getBoolean(k) ?? false);
}

const lockData = new SlashCommandBuilder()
  .setName("lockdown")
  .setDescription("Kunci channel / server dengan izin yang bisa diatur")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addSubcommand((s) =>
    lockOptions(
      s
        .setName("channel")
        .setDescription("Kunci satu channel")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel (default: channel ini)").addChannelTypes(...CHANNEL_TYPES)
        )
    )
  )
  .addSubcommand((s) => lockOptions(s.setName("server").setDescription("Kunci semua channel publik sekaligus")))
  .addSubcommand((s) => s.setName("list").setDescription("Lihat channel yang sedang dikunci"));

const unlockData = new SlashCommandBuilder()
  .setName("unlock")
  .setDescription("Buka channel / server yang dikunci")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addSubcommand((s) =>
    s
      .setName("channel")
      .setDescription("Buka satu channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel (default: channel ini)").addChannelTypes(...CHANNEL_TYPES)
      )
      .addRoleOption((o) => o.setName("role").setDescription("Role (default: @everyone)"))
  )
  .addSubcommand((s) =>
    s
      .setName("server")
      .setDescription("Buka semua channel yang dikunci")
      .addRoleOption((o) => o.setName("role").setDescription("Hanya untuk role ini (default: semua)"))
  );

async function executeLock(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }
  const i = interaction;
  const sub = i.options.getSubcommand();
  await i.deferReply({ ephemeral: true });
  const cfg = await getConfig(i.guild);

  if (sub === "list") {
    const locks = await prisma.lockdown.findMany({ where: { guildId: i.guild.id }, orderBy: { createdAt: "desc" } });
    return i.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(cfg.color)
          .setTitle(`${cfg.e.LOCK} Lockdown Aktif`)
          .setDescription(
            locks.length === 0
              ? "Tidak ada channel yang sedang dikunci."
              : truncate(
                  locks
                    .map(
                      (l) =>
                        `<#${l.channelId}> • <@&${l.roleId}>${l.unlockAt ? ` • buka <t:${Math.floor(l.unlockAt.getTime() / 1000)}:R>` : ""}\n-# ${l.reason ?? "Tanpa alasan"} — oleh <@${l.lockedById}>`
                    )
                    .join("\n"),
                  4000
                )
          ),
      ],
    });
  }

  const role = i.options.getRole("role") ?? i.guild.roles.everyone;
  const options = readLockOptions(i);
  if (options.length === 0) return i.editReply({ embeds: [errorEmbed("Pilih minimal satu izin untuk dikunci.")] });

  const durationRaw = i.options.getString("duration");
  const durationMs = durationRaw ? parseDuration(durationRaw) : null;
  if (durationRaw && !durationMs) return i.editReply({ embeds: [errorEmbed("Durasi tidak valid. Contoh: `30m`, `2h`.")] });

  const reason = i.options.getString("reason");
  const announce = i.options.getBoolean("announce") ?? true;
  const lockOpts = { roleId: role.id, options, by: i.user, reason, durationMs, announce };
  const lockedList = options.map((o) => LOCK_OPTIONS[o].label).join(", ");

  if (sub === "channel") {
    const channel = (i.options.getChannel("channel") ?? i.channel) as LockableChannel | null;
    if (!channel || !isLockable(channel)) return i.editReply({ embeds: [errorEmbed("Channel ini tidak bisa dikunci.")] });
    await lockChannel(channel, lockOpts);
    await logLock(i.guild, "Channel Dikunci", [
      { name: "Channel", value: channel.toString(), inline: true },
      { name: "Role", value: role.toString(), inline: true },
      { name: "Oleh", value: i.user.toString(), inline: true },
      { name: "Izin", value: lockedList },
      { name: "Alasan", value: reason ?? "-" },
    ]);
    return i.editReply({
      embeds: [
        successEmbed(
          `${channel} dikunci untuk ${role}.\n**Izin:** ${lockedList}${durationMs ? `\n**Buka otomatis:** ${formatDuration(durationMs)}` : ""}`
        ),
      ],
    });
  }

  // sub === "server"
  const targets = await serverLockTargets(i.guild, role.id);
  await i.editReply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription(`${cfg.e.CLOCK} Mengunci ${targets.length} channel...`)] });
  let ok = 0;
  const failed: string[] = [];
  for (const channel of targets) {
    try {
      await lockChannel(channel, lockOpts);
      ok++;
    } catch {
      failed.push(channel.toString());
    }
  }
  await logLock(i.guild, "Server Lockdown", [
    { name: "Channel", value: `${ok} dikunci${failed.length ? `, ${failed.length} gagal` : ""}`, inline: true },
    { name: "Role", value: role.toString(), inline: true },
    { name: "Oleh", value: i.user.toString(), inline: true },
    { name: "Izin", value: lockedList },
    { name: "Alasan", value: reason ?? "-" },
  ]);
  return i.editReply({
    embeds: [
      successEmbed(
        `${cfg.e.LOCK} **Server lockdown aktif.** ${ok} channel dikunci untuk ${role}.\n**Izin:** ${lockedList}` +
          (failed.length ? `\n${cfg.e.WARNING} Gagal: ${truncate(failed.join(" "), 1000)}` : "")
      ),
    ],
  });
}

async function executeUnlock(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }
  const i = interaction;
  await i.deferReply({ ephemeral: true });

  if (i.options.getSubcommand() === "channel") {
    const channel = i.options.getChannel("channel") ?? i.channel;
    const role = i.options.getRole("role") ?? i.guild.roles.everyone;
    if (!channel) return i.editReply({ embeds: [errorEmbed("Channel tidak ditemukan.")] });
    const done = await unlockChannel(i.guild, channel.id, role.id, i.user);
    if (!done) return i.editReply({ embeds: [errorEmbed(`${channel} tidak sedang dikunci untuk ${role}.`)] });
    await logLock(i.guild, "Channel Dibuka", [
      { name: "Channel", value: channel.toString(), inline: true },
      { name: "Role", value: role.toString(), inline: true },
      { name: "Oleh", value: i.user.toString(), inline: true },
    ]);
    return i.editReply({ embeds: [successEmbed(`${channel} dibuka kembali untuk ${role}.`)] });
  }

  const role = i.options.getRole("role");
  const locks = await prisma.lockdown.findMany({
    where: { guildId: i.guild.id, ...(role ? { roleId: role.id } : {}) },
  });
  if (locks.length === 0) return i.editReply({ embeds: [errorEmbed("Tidak ada channel yang sedang dikunci.")] });
  let ok = 0;
  for (const lock of locks) {
    if (await unlockChannel(i.guild, lock.channelId, lock.roleId, i.user).catch(() => false)) ok++;
  }
  await logLock(i.guild, "Server Lockdown Dibuka", [
    { name: "Channel", value: `${ok} dibuka`, inline: true },
    { name: "Oleh", value: i.user.toString(), inline: true },
  ]);
  return i.editReply({ embeds: [successEmbed(`${ok} channel dibuka kembali.`)] });
}

export const commands: Command[] = [
  { data: lockData, execute: executeLock },
  { data: unlockData, execute: executeUnlock },
];
