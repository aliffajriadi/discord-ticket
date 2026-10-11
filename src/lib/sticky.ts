import { EmbedBuilder, Guild, Message, TextBasedChannel } from "discord.js";
import { StickyNote } from "@prisma/client";
import prisma from "./prisma.js";
import { getConfig } from "./guildConfig.js";

/**
 * Sticky note: pesan embed yang selalu dikirim ulang ke posisi paling bawah channel.
 * Repost di-debounce agar channel ramai tidak memicu spam kirim/hapus.
 */
const REPOST_DELAY_MS = 4_000;

const cache = new Map<string, StickyNote | null>();
const timers = new Map<string, NodeJS.Timeout>();
const posting = new Set<string>();

export function invalidateSticky(channelId: string) {
  cache.delete(channelId);
}

async function getSticky(channelId: string): Promise<StickyNote | null> {
  if (cache.has(channelId)) return cache.get(channelId)!;
  const sticky = await prisma.stickyNote.findUnique({ where: { channelId } });
  cache.set(channelId, sticky);
  return sticky;
}

export async function buildStickyEmbed(guild: Guild, sticky: Pick<StickyNote, "title" | "content" | "color" | "imageUrl">) {
  const cfg = await getConfig(guild);
  const embed = new EmbedBuilder()
    .setColor(sticky.color ?? cfg.color)
    .setDescription(sticky.content)
    .setFooter({ text: `📌 ${cfg.t.stickyFooter}` });
  if (sticky.title) embed.setTitle(`${cfg.e.STICKY} ${sticky.title}`);
  if (sticky.imageUrl) embed.setImage(sticky.imageUrl);
  return embed;
}

/**
 * Hapus sticky lama (jika ada) lalu kirim yang baru di paling bawah.
 */
export async function repostSticky(guild: Guild, channelId: string): Promise<void> {
  const sticky = await getSticky(channelId);
  const channel = guild.channels.cache.get(channelId);
  if (!sticky || !sticky.enabled || !channel?.isTextBased() || !("send" in channel)) return;

  posting.add(channelId);
  try {
    if (sticky.lastMessageId) {
      await (channel as TextBasedChannel).messages.delete(sticky.lastMessageId).catch(() => null);
    }
    const sent = await channel.send({ embeds: [await buildStickyEmbed(guild, sticky)] });
    const updated = await prisma.stickyNote.update({
      where: { id: sticky.id },
      data: { lastMessageId: sent.id },
    });
    cache.set(channelId, updated);
  } catch (err) {
    console.error(`[sticky] Gagal repost di ${channelId}:`, err);
  } finally {
    posting.delete(channelId);
  }
}

/** Hapus pesan sticky yang sedang tampil (saat sticky dihapus/dinonaktifkan). */
export async function removeStickyMessage(guild: Guild, sticky: StickyNote) {
  const channel = guild.channels.cache.get(sticky.channelId);
  if (sticky.lastMessageId && channel?.isTextBased()) {
    await channel.messages.delete(sticky.lastMessageId).catch(() => null);
  }
  invalidateSticky(sticky.channelId);
}

export async function handleStickyMessage(message: Message) {
  if (!message.guild) return;
  const channelId = message.channelId;
  // Abaikan pesan sticky milik bot sendiri
  if (message.author.id === message.client.user.id && posting.has(channelId)) return;

  const sticky = await getSticky(channelId);
  if (!sticky || !sticky.enabled || sticky.lastMessageId === message.id) return;

  clearTimeout(timers.get(channelId));
  timers.set(
    channelId,
    setTimeout(() => {
      timers.delete(channelId);
      void repostSticky(message.guild!, channelId);
    }, REPOST_DELAY_MS)
  );
}
