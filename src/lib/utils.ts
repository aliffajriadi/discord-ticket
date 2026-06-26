import {
  Colors,
  EmbedBuilder,
  Guild,
  TextChannel,
} from "discord.js";
import prisma from "../lib/prisma.js";
import { E } from "../config/emoji.js";

/**
 * Sends a log embed to the guild's configured log channel.
 */
export async function sendLog(
  guild: Guild,
  embed: EmbedBuilder
): Promise<void> {
  try {
    const guildData = await prisma.guild.findUnique({
      where: { id: guild.id },
    });

    if (!guildData?.logChannelId) return;

    const logChannel = guild.channels.cache.get(guildData.logChannelId) as
      | TextChannel
      | undefined;

    if (!logChannel) return;

    await logChannel.send({ embeds: [embed] });
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
 * Checks if a user has the setup role or is the server owner.
 */
export async function hasSetupPermission(
  guild: Guild,
  userId: string
): Promise<boolean> {
  if (guild.ownerId === userId) return true;

  const guildData = await prisma.guild.findUnique({
    where: { id: guild.id },
  });

  if (!guildData?.setupRoleId) return false;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;

  return member.roles.cache.has(guildData.setupRoleId);
}

export function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Red)
    .setDescription(`${E.ERROR} ${description}`);
}

export function successEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Green)
    .setDescription(`${E.SUCCESS} ${description}`);
}

export function infoEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}
