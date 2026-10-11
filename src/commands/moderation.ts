import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  GuildTextBasedChannel,
} from "discord.js";
import { errorEmbed, successEmbed, truncate } from "../lib/utils.js";
import { getConfig } from "../lib/guildConfig.js";
import prisma from "../lib/prisma.js";
import {
  CASE_META,
  CaseType,
  caseEmbed,
  checkHierarchy,
  createCase,
  formatDuration,
  notifyUser,
  parseDuration,
} from "../lib/moderation.js";
import { Command } from "../types.js";

const MAX_TIMEOUT_MS = 28 * 86_400_000;

type Cached = ChatInputCommandInteraction<"cached">;

/** Pembungkus: hanya di server, dan balasan sudah di-defer. */
function modCommand(data: Command["data"], run: (i: Cached) => Promise<unknown>, ephemeral = false): Command {
  return {
    data,
    async execute(interaction) {
      if (!interaction.inCachedGuild()) {
        return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral });
      return run(interaction);
    },
  };
}

async function actionReply(i: Cached, type: CaseType, targetTag: string, caseNumber: number, dmSent: boolean | null, extra = "") {
  const cfg = await getConfig(i.guild);
  const meta = CASE_META[type];
  return i.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(meta.color)
        .setDescription(
          `${cfg.e[meta.emoji]} **${targetTag}** berhasil di-${meta.label.toLowerCase()}.${extra}` +
            `\n-# Kasus #${caseNumber}${dmSent === null ? "" : dmSent ? " • DM terkirim" : " • DM gagal (tertutup)"}`
        ),
    ],
  });
}

const reasonOpt = (desc = "Alasan") => (opt: import("discord.js").SlashCommandStringOption) =>
  opt.setName("reason").setDescription(desc).setMaxLength(500);

export const commands: Command[] = [
  // ── /ban ──────────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban user dari server")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((o) => o.setName("user").setDescription("User yang di-ban").setRequired(true))
      .addStringOption(reasonOpt())
      .addIntegerOption((o) =>
        o
          .setName("delete_messages")
          .setDescription("Hapus riwayat pesan user")
          .addChoices(
            { name: "Jangan hapus", value: 0 },
            { name: "1 jam terakhir", value: 3600 },
            { name: "24 jam terakhir", value: 86400 },
            { name: "7 hari terakhir", value: 604800 }
          )
      ),
    async (i) => {
      const user = i.options.getUser("user", true);
      const reason = i.options.getString("reason");
      const member = i.options.getMember("user");
      if (member) {
        const err = checkHierarchy(i.guild, i.member, member);
        if (err) return i.editReply({ embeds: [errorEmbed(err)] });
      }
      if (await i.guild.bans.fetch(user.id).catch(() => null)) {
        return i.editReply({ embeds: [errorEmbed(`**${user.tag}** sudah di-ban.`)] });
      }
      // DM dulu karena setelah ban bot tidak bisa DM lagi (tidak satu server)
      const dmSent = member ? await notifyUser(i.guild, user, "BAN", reason) : null;
      await i.guild.bans.create(user.id, {
        reason: `${i.user.tag}: ${reason ?? "Tidak ada alasan"}`,
        deleteMessageSeconds: i.options.getInteger("delete_messages") ?? 0,
      });
      const c = await createCase(i.guild, { type: "BAN", target: user, moderator: i.user, reason });
      return actionReply(i, "BAN", user.tag, c.number, dmSent);
    }
  ),

  // ── /unban ────────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Cabut ban user")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addStringOption((o) => o.setName("user_id").setDescription("ID user yang di-unban").setRequired(true))
      .addStringOption(reasonOpt()),
    async (i) => {
      const userId = i.options.getString("user_id", true).replace(/\D/g, "");
      const reason = i.options.getString("reason");
      const ban = await i.guild.bans.fetch(userId).catch(() => null);
      if (!ban) return i.editReply({ embeds: [errorEmbed("User tersebut tidak sedang di-ban.")] });
      await i.guild.bans.remove(userId, `${i.user.tag}: ${reason ?? "Tidak ada alasan"}`);
      const c = await createCase(i.guild, { type: "UNBAN", target: ban.user, moderator: i.user, reason });
      return actionReply(i, "UNBAN", ban.user.tag, c.number, null);
    }
  ),

  // ── /kick ─────────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick member dari server")
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((o) => o.setName("user").setDescription("Member yang di-kick").setRequired(true))
      .addStringOption(reasonOpt()),
    async (i) => {
      const member = i.options.getMember("user");
      const reason = i.options.getString("reason");
      if (!member) return i.editReply({ embeds: [errorEmbed("User tersebut bukan member server ini.")] });
      const err = checkHierarchy(i.guild, i.member, member);
      if (err) return i.editReply({ embeds: [errorEmbed(err)] });
      const dmSent = await notifyUser(i.guild, member.user, "KICK", reason);
      await member.kick(`${i.user.tag}: ${reason ?? "Tidak ada alasan"}`);
      const c = await createCase(i.guild, { type: "KICK", target: member.user, moderator: i.user, reason });
      return actionReply(i, "KICK", member.user.tag, c.number, dmSent);
    }
  ),

  // ── /timeout ──────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Timeout (mute) member untuk sementara")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName("user").setDescription("Member yang di-timeout").setRequired(true))
      .addStringOption((o) =>
        o.setName("duration").setDescription("Durasi, contoh: 10m, 1h, 1d, 1h30m (maks 28d)").setRequired(true)
      )
      .addStringOption(reasonOpt()),
    async (i) => {
      const member = i.options.getMember("user");
      const reason = i.options.getString("reason");
      const durationMs = parseDuration(i.options.getString("duration", true));
      if (!member) return i.editReply({ embeds: [errorEmbed("User tersebut bukan member server ini.")] });
      if (!durationMs || durationMs > MAX_TIMEOUT_MS) {
        return i.editReply({ embeds: [errorEmbed("Durasi tidak valid. Contoh: `10m`, `2h`, `1d` (maks `28d`).")] });
      }
      const err = checkHierarchy(i.guild, i.member, member);
      if (err) return i.editReply({ embeds: [errorEmbed(err)] });
      await member.timeout(durationMs, `${i.user.tag}: ${reason ?? "Tidak ada alasan"}`);
      const dmSent = await notifyUser(i.guild, member.user, "TIMEOUT", reason, durationMs);
      const c = await createCase(i.guild, { type: "TIMEOUT", target: member.user, moderator: i.user, reason, durationMs });
      return actionReply(i, "TIMEOUT", member.user.tag, c.number, dmSent, ` Durasi: **${formatDuration(durationMs)}**`);
    }
  ),

  // ── /untimeout ────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("untimeout")
      .setDescription("Cabut timeout member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption(reasonOpt()),
    async (i) => {
      const member = i.options.getMember("user");
      const reason = i.options.getString("reason");
      if (!member) return i.editReply({ embeds: [errorEmbed("User tersebut bukan member server ini.")] });
      if (!member.isCommunicationDisabled()) return i.editReply({ embeds: [errorEmbed("Member ini tidak sedang di-timeout.")] });
      await member.timeout(null, `${i.user.tag}: ${reason ?? "Tidak ada alasan"}`);
      const c = await createCase(i.guild, { type: "UNTIMEOUT", target: member.user, moderator: i.user, reason });
      return actionReply(i, "UNTIMEOUT", member.user.tag, c.number, null);
    }
  ),

  // ── /warn ─────────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Beri peringatan ke member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => reasonOpt()(o).setRequired(true)),
    async (i) => {
      const member = i.options.getMember("user");
      const reason = i.options.getString("reason", true);
      if (!member) return i.editReply({ embeds: [errorEmbed("User tersebut bukan member server ini.")] });
      const err = checkHierarchy(i.guild, i.member, member);
      if (err) return i.editReply({ embeds: [errorEmbed(err)] });
      const dmSent = await notifyUser(i.guild, member.user, "WARN", reason);
      const c = await createCase(i.guild, { type: "WARN", target: member.user, moderator: i.user, reason });
      const total = await prisma.modCase.count({
        where: { guildId: i.guild.id, targetId: member.id, type: "WARN", active: true },
      });
      return actionReply(i, "WARN", member.user.tag, c.number, dmSent, ` Total warn aktif: **${total}**`);
    }
  ),

  // ── /history ──────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("history")
      .setDescription("Lihat riwayat moderasi user")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
    async (i) => {
      const user = i.options.getUser("user", true);
      const cfg = await getConfig(i.guild);
      const cases = await prisma.modCase.findMany({
        where: { guildId: i.guild.id, targetId: user.id },
        orderBy: { createdAt: "desc" },
        take: 15,
      });
      const total = await prisma.modCase.count({ where: { guildId: i.guild.id, targetId: user.id } });
      const counts = await prisma.modCase.groupBy({
        by: ["type"],
        where: { guildId: i.guild.id, targetId: user.id },
        _count: true,
      });

      const embed = new EmbedBuilder()
        .setColor(cfg.color)
        .setAuthor({ name: `Riwayat ${user.tag}`, iconURL: user.displayAvatarURL() })
        .setDescription(
          cases.length === 0
            ? `${cfg.e.SUCCESS} User ini bersih, belum pernah ditindak.`
            : truncate(
                cases
                  .map((c) => {
                    const meta = CASE_META[c.type as CaseType];
                    return `${cfg.e[meta.emoji]} **#${c.number} ${meta.label}**${c.active ? "" : " ~~(dicabut)~~"} • <t:${Math.floor(c.createdAt.getTime() / 1000)}:R>\n-# ${c.reason ?? "Tidak ada alasan"} — oleh <@${c.moderatorId}>`;
                  })
                  .join("\n"),
                4000
              )
        )
        .setFooter({ text: `Total ${total} kasus${total > 15 ? " • menampilkan 15 terbaru" : ""}` });
      if (counts.length) {
        embed.addFields({
          name: "Ringkasan",
          value: counts.map((c) => `${CASE_META[c.type as CaseType]?.label ?? c.type}: **${c._count}**`).join(" • "),
        });
      }
      return i.editReply({ embeds: [embed] });
    },
    true
  ),

  // ── /case ─────────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("case")
      .setDescription("Kelola kasus moderasi")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addSubcommand((s) =>
        s
          .setName("view")
          .setDescription("Lihat detail kasus")
          .addIntegerOption((o) => o.setName("number").setDescription("Nomor kasus").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) =>
        s
          .setName("revoke")
          .setDescription("Cabut kasus (mis. warn yang salah)")
          .addIntegerOption((o) => o.setName("number").setDescription("Nomor kasus").setRequired(true).setMinValue(1))
      ),
    async (i) => {
      const number = i.options.getInteger("number", true);
      const c = await prisma.modCase.findUnique({ where: { guildId_number: { guildId: i.guild.id, number } } });
      if (!c) return i.editReply({ embeds: [errorEmbed(`Kasus #${number} tidak ditemukan.`)] });
      if (i.options.getSubcommand() === "view") {
        const embed = await caseEmbed(i.guild, c);
        if (!c.active) embed.setDescription("~~Kasus ini sudah dicabut.~~");
        return i.editReply({ embeds: [embed] });
      }
      await prisma.modCase.update({ where: { id: c.id }, data: { active: false } });
      return i.editReply({ embeds: [successEmbed(`Kasus #${number} dicabut.`)] });
    },
    true
  ),

  // ── /purge ────────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("purge")
      .setDescription("Hapus banyak pesan sekaligus (maks 14 hari terakhir)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) =>
        o.setName("amount").setDescription("Jumlah pesan (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)
      )
      .addUserOption((o) => o.setName("user").setDescription("Hanya hapus pesan dari user ini"))
      .addBooleanOption((o) => o.setName("bots").setDescription("Hanya hapus pesan bot")),
    async (i) => {
      const channel = i.channel as GuildTextBasedChannel | null;
      if (!channel || !("bulkDelete" in channel)) {
        return i.editReply({ embeds: [errorEmbed("Channel ini tidak mendukung hapus massal.")] });
      }
      const amount = i.options.getInteger("amount", true);
      const user = i.options.getUser("user");
      const botsOnly = i.options.getBoolean("bots") ?? false;

      const fetched = await channel.messages.fetch({ limit: 100 });
      const twoWeeks = Date.now() - 14 * 86_400_000 + 60_000;
      const targets = [...fetched.values()]
        .filter((m) => m.createdTimestamp > twoWeeks && !m.pinned)
        .filter((m) => (user ? m.author.id === user.id : true))
        .filter((m) => (botsOnly ? m.author.bot : true))
        .slice(0, amount);

      const deleted = await channel.bulkDelete(targets, true);
      const cfg = await getConfig(i.guild);
      return i.editReply({ embeds: [successEmbed(`${cfg.e.PURGE} ${deleted.size} pesan dihapus.`)] });
    },
    true
  ),

  // ── /slowmode ─────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("slowmode")
      .setDescription("Atur slowmode channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption((o) => o.setName("duration").setDescription("Contoh: 5s, 1m, 1h — 0 untuk mematikan").setRequired(true))
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel (default: channel ini)").addChannelTypes(ChannelType.GuildText)
      ),
    async (i) => {
      const raw = i.options.getString("duration", true);
      const ms = raw === "0" ? 0 : parseDuration(raw);
      if (ms === null || ms > 6 * 3_600_000) {
        return i.editReply({ embeds: [errorEmbed("Durasi tidak valid (maks 6 jam). Contoh: `10s`, `1m`, `0`.")] });
      }
      const channel = i.options.getChannel("channel", false, [ChannelType.GuildText]) ?? (i.channel as import("discord.js").TextChannel);
      await channel.setRateLimitPerUser(Math.floor(ms / 1000), `Oleh ${i.user.tag}`);
      return i.editReply({
        embeds: [successEmbed(ms === 0 ? `Slowmode ${channel} dimatikan.` : `Slowmode ${channel} diatur ke **${formatDuration(ms)}**.`)],
      });
    },
    true
  ),

  // ── /userinfo ─────────────────────────────────────────────────────────────
  modCommand(
    new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Lihat info user")
      .addUserOption((o) => o.setName("user").setDescription("User (default: kamu)")),
    async (i) => {
      const user = await (i.options.getUser("user") ?? i.user).fetch();
      const member = i.options.getMember("user") ?? (i.options.getUser("user") ? null : i.member);
      const cfg = await getConfig(i.guild);
      const ts = (d: Date | null | undefined) => (d ? `<t:${Math.floor(d.getTime() / 1000)}:D> (<t:${Math.floor(d.getTime() / 1000)}:R>)` : "-");
      const caseCount = await prisma.modCase.count({ where: { guildId: i.guild.id, targetId: user.id, active: true } });

      const embed = new EmbedBuilder()
        .setColor(user.accentColor ?? cfg.color)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: `${cfg.e.USER} User`, value: `${user}\n\`${user.id}\``, inline: true },
          { name: `${cfg.e.DATE} Akun dibuat`, value: ts(user.createdAt), inline: true }
        );
      if (member) {
        const roles = member.roles.cache
          .filter((r) => r.id !== i.guild.id)
          .sort((a, b) => b.position - a.position)
          .map((r) => r.toString());
        embed.addFields(
          { name: `${cfg.e.DATE} Bergabung`, value: ts(member.joinedAt), inline: true },
          { name: `Role (${roles.length})`, value: truncate(roles.join(" ") || "-", 1024) }
        );
        if (member.isCommunicationDisabled()) {
          embed.addFields({ name: `${cfg.e.TIMEOUT} Timeout sampai`, value: ts(member.communicationDisabledUntil) });
        }
      }
      embed.addFields({ name: `${cfg.e.WARN} Kasus aktif`, value: String(caseCount), inline: true });
      if (user.banner) embed.setImage(user.bannerURL({ size: 512 })!);
      return i.editReply({ embeds: [embed] });
    },
    true
  ),
];
