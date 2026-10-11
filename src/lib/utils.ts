import {
  Colors,
  EmbedBuilder,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import prisma from "../lib/prisma.js";
import { E } from "../config/emoji.js";
import { DEFAULT_COLOR } from "./guildConfig.js";

/**
 * Sends a log embed to the guild's configured log channel.
 * kind "mod" prefers the moderation log channel and falls back to the ticket log channel.
 */
export async function sendLog(
  guild: Guild,
  embed: EmbedBuilder,
  kind: "ticket" | "mod" = "ticket",
  files?: import("discord.js").AttachmentBuilder[]
): Promise<void> {
  try {
    const guildData = await prisma.guild.findUnique({ where: { id: guild.id } });
    const channelId =
      kind === "mod" ? guildData?.modLogChannelId ?? guildData?.logChannelId : guildData?.logChannelId;
    if (!channelId) return;

    const logChannel = guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (!logChannel?.isTextBased()) return;

    await logChannel.send({ embeds: [embed], files });
  } catch (err) {
    console.error("[Logger] Failed to send log:", err);
  }
}

/**
 * Ensures a Guild record exists in the database.
 */
export async function ensureGuild(guildId: string): Promise<void> {
  await prisma.guild.upsert({
    where: { id: guildId },
    update: {},
    create: { id: guildId },
  });
}

/**
 * Bot admin = server owner, member dengan izin Administrator, atau pemilik setup role.
 */
export async function hasSetupPermission(guild: Guild, member: GuildMember): Promise<boolean> {
  if (guild.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const guildData = await prisma.guild.findUnique({ where: { id: guild.id } });
  return guildData?.setupRoleId ? member.roles.cache.has(guildData.setupRoleId) : false;
}

/** Role staff sebuah tiket: salinan di tiket lebih diutamakan (alasan bisa sudah dihapus). */
export function ticketSupportRole(ticket: {
  supportRoleId?: string | null;
  reason?: { supportRoleId: string } | null;
}): string | null {
  return ticket.supportRoleId ?? ticket.reason?.supportRoleId ?? null;
}

/**
 * Staff tiket = bot admin, atau pemilik support role dari alasan tiket tersebut.
 */
export async function isTicketStaff(
  guild: Guild,
  member: GuildMember,
  supportRoleId: string | null | undefined
): Promise<boolean> {
  if (supportRoleId && member.roles.cache.has(supportRoleId)) return true;
  return hasSetupPermission(guild, member);
}

export function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(Colors.Red).setDescription(`${E.ERROR} ${description}`);
}

export function successEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(Colors.Green).setDescription(`${E.SUCCESS} ${description}`);
}

export function infoEmbed(title: string, description: string, color = DEFAULT_COLOR): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}

/** Discord membatasi teks field/description; potong dengan aman. */
export function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}
