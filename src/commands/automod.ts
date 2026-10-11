import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder, ChannelType } from "discord.js";
import { errorEmbed, successEmbed, hasSetupPermission } from "../lib/utils.js";
import { getConfig } from "../lib/guildConfig.js";
import { parseDuration, formatDuration } from "../lib/moderation.js";
import { getAutoMod, saveAutoMod, checkLimit, AUTOMOD_LIMITS, AutoModAction } from "../lib/automod.js";
import { Command } from "../types.js";

const ACTION_LABEL: Record<AutoModAction, string> = {
  NONE: "Hanya hapus pesan",
  TIMEOUT: "Timeout",
  KICK: "Kick",
  BAN: "Ban",
};

const off = (n: number) => (n === 0 ? "`mati`" : `\`${n}\``);

const data = new SlashCommandBuilder()
  .setName("automod")
  .setDescription("Anti-spam otomatis: hapus pesan terlalu panjang dan hukum yang mengulang")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName("status").setDescription("Lihat pengaturan AutoMod"))
  .addSubcommand((s) =>
    s
      .setName("add-channel")
      .setDescription("Jaga channel ini dengan AutoMod")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel yang dijaga").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("remove-channel")
      .setDescription("Berhenti menjaga channel ini")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)
      )
  )
  .addSubcommand((s) => s.setName("clear-channels").setDescription("Hapus semua channel dari daftar (AutoMod berhenti)"))
  .addSubcommand((s) =>
    s
      .setName("set")
      .setDescription("Ubah pengaturan AutoMod (isi hanya yang ingin diubah)")
      .addBooleanOption((o) => o.setName("enabled").setDescription("Aktifkan / matikan AutoMod"))
      .addIntegerOption((o) =>
        o.setName("max_chars").setDescription(`Maks karakter per pesan (0 = mati, ${AUTOMOD_LIMITS.maxChars.min}-${AUTOMOD_LIMITS.maxChars.max})`).setMinValue(0).setMaxValue(AUTOMOD_LIMITS.maxChars.max)
      )
      .addIntegerOption((o) =>
        o.setName("max_lines").setDescription(`Maks baris per pesan (0 = mati, ${AUTOMOD_LIMITS.maxLines.min}-${AUTOMOD_LIMITS.maxLines.max})`).setMinValue(0).setMaxValue(AUTOMOD_LIMITS.maxLines.max)
      )
      .addIntegerOption((o) =>
        o.setName("max_mentions").setDescription(`Maks mention per pesan (0 = mati, ${AUTOMOD_LIMITS.maxMentions.min}-${AUTOMOD_LIMITS.maxMentions.max})`).setMinValue(0).setMaxValue(AUTOMOD_LIMITS.maxMentions.max)
      )
      .addIntegerOption((o) =>
        o.setName("strikes").setDescription("Berapa kali melanggar sebelum dihukum").setMinValue(1).setMaxValue(AUTOMOD_LIMITS.strikes.max)
      )
      .addStringOption((o) => o.setName("window").setDescription("Rentang waktu hitungan pelanggaran, contoh: 1m, 5m"))
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("Hukuman setelah melewati batas pelanggaran")
          .addChoices(
            { name: "Hanya hapus pesan", value: "NONE" },
            { name: "Timeout", value: "TIMEOUT" },
            { name: "Kick", value: "KICK" },
            { name: "Ban", value: "BAN" }
          )
      )
      .addStringOption((o) => o.setName("timeout").setDescription("Durasi timeout jika action = Timeout, contoh: 30m, 1h"))
  );

async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }
  const i = interaction;
  if (!(await hasSetupPermission(i.guild, i.member))) {
    return i.reply({ embeds: [errorEmbed("Kamu tidak memiliki izin untuk menjalankan command ini.")], ephemeral: true });
  }

  const sub = i.options.getSubcommand();
  let notice: string | null = null;

  if (sub === "add-channel" || sub === "remove-channel" || sub === "clear-channels") {
    const current = (await getAutoMod(i.guild.id)).channelIds;
    const channel = sub === "clear-channels" ? null : i.options.getChannel("channel", true);
    const next =
      sub === "clear-channels" ? [] : sub === "add-channel" ? [...current, channel!.id] : current.filter((id) => id !== channel!.id);
    await saveAutoMod(i.guild.id, { channelIds: next });
    notice =
      sub === "clear-channels"
        ? "Semua channel dihapus dari daftar."
        : sub === "add-channel"
          ? `${channel} sekarang dijaga AutoMod.`
          : `${channel} tidak lagi dijaga AutoMod.`;
  }

  if (sub === "set") {
    const patch: Parameters<typeof saveAutoMod>[1] = {};
    const enabled = i.options.getBoolean("enabled");
    if (enabled !== null) patch.enabled = enabled;

    for (const [opt, key] of [
      ["max_chars", "maxChars"],
      ["max_lines", "maxLines"],
      ["max_mentions", "maxMentions"],
      ["strikes", "strikes"],
    ] as const) {
      const v = i.options.getInteger(opt);
      if (v === null) continue;
      const err = checkLimit(key, v);
      if (err) return i.reply({ embeds: [errorEmbed(`${opt}: ${err}`)], ephemeral: true });
      patch[key] = v;
    }

    const windowRaw = i.options.getString("window");
    if (windowRaw) {
      const ms = parseDuration(windowRaw);
      const sec = ms ? Math.round(ms / 1000) : NaN;
      const err = checkLimit("windowSec", sec);
      if (!ms || err) return i.reply({ embeds: [errorEmbed("window tidak valid (10 detik – 1 jam). Contoh: `30s`, `1m`.")], ephemeral: true });
      patch.windowSec = sec;
    }

    const timeoutRaw = i.options.getString("timeout");
    if (timeoutRaw) {
      const ms = parseDuration(timeoutRaw);
      const min = ms ? Math.round(ms / 60_000) : NaN;
      const err = checkLimit("timeoutMin", min);
      if (!ms || err) return i.reply({ embeds: [errorEmbed("timeout tidak valid (1 menit – 28 hari). Contoh: `30m`, `1d`.")], ephemeral: true });
      patch.timeoutMin = min;
    }

    const action = i.options.getString("action");
    if (action) patch.action = action;

    if (Object.keys(patch).length === 0) {
      return i.reply({ embeds: [errorEmbed("Isi minimal satu opsi yang ingin diubah.")], ephemeral: true });
    }
    await saveAutoMod(i.guild.id, patch);
    notice = "Pengaturan AutoMod disimpan.";
  }

  const s = await getAutoMod(i.guild.id);
  const cfg = await getConfig(i.guild);
  const embed = new EmbedBuilder()
    .setColor(s.enabled ? cfg.color : 0x6b7080)
    .setTitle(`🛡️ AutoMod — ${s.enabled ? "Aktif" : "Nonaktif"}`)
    .addFields(
      {
        name: "Channel yang dijaga",
        value: s.channelIds.length
          ? s.channelIds.map((id) => `<#${id}>`).join(" ")
          : "⚠️ Belum ada — AutoMod tidak berjalan. Tambah dengan `/automod add-channel`.",
      },
      { name: "Maks karakter", value: off(s.maxChars), inline: true },
      { name: "Maks baris", value: off(s.maxLines), inline: true },
      { name: "Maks mention", value: off(s.maxMentions), inline: true },
      {
        name: "Hukuman",
        value:
          s.action === "NONE"
            ? "Pesan hanya dihapus"
            : `**${ACTION_LABEL[s.action as AutoModAction]}** setelah **${s.strikes}x** melanggar dalam ${formatDuration(s.windowSec * 1000)}` +
              (s.action === "TIMEOUT" ? `\nDurasi timeout: ${formatDuration(s.timeoutMin * 60_000)}` : ""),
      }
    )
    .setFooter({ text: "Dikecualikan: staff (kelola pesan/server), admin role bot, dan bot" });

  return i.reply({
    embeds: notice ? [successEmbed(notice), embed] : [embed],
    ephemeral: true,
  });
}

export const commands: Command[] = [{ data, execute }];
