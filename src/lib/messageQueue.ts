import { Message } from "discord.js";
import { Prisma } from "@prisma/client";
import prisma from "./prisma.js";

/**
 * Pesan tiket ditampung lalu ditulis ke database secara batch
 * (bukan satu query per pesan) agar channel yang ramai tidak membebani DB.
 */
const FLUSH_INTERVAL_MS = 2_000;
const MAX_BUFFER = 200;

let buffer: Prisma.TicketMessageCreateManyInput[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing: Promise<void> = Promise.resolve();

/** channelId -> ticketId (tiket OPEN) atau null (bukan channel tiket). */
const openTicketByChannel = new Map<string, number | null>();

export function setOpenTicket(channelId: string, ticketId: number | null) {
  openTicketByChannel.set(channelId, ticketId);
}

async function resolveOpenTicket(channelId: string): Promise<number | null> {
  if (openTicketByChannel.has(channelId)) return openTicketByChannel.get(channelId)!;
  const ticket = await prisma.ticket.findFirst({
    where: { channelId, status: "OPEN" },
    select: { id: true },
  });
  openTicketByChannel.set(channelId, ticket?.id ?? null);
  return ticket?.id ?? null;
}

export async function isOpenTicketChannel(channelId: string): Promise<boolean> {
  return (await resolveOpenTicket(channelId)) !== null;
}

export async function enqueueTicketMessage(message: Message) {
  const ticketId = await resolveOpenTicket(message.channelId);
  if (!ticketId) return;

  const attachmentUrls = message.attachments.map((a) => a.url);
  const embedText = message.embeds
    .map((e) => [e.title, e.description].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");

  buffer.push({
    ticketId,
    authorId: message.author.id,
    authorTag: message.author.tag,
    authorBot: message.author.bot,
    content: message.content || embedText || "[Tanpa teks]",
    attachments: attachmentUrls.length > 0 ? JSON.stringify(attachmentUrls) : null,
    createdAt: message.createdAt,
  });

  if (buffer.length >= MAX_BUFFER) {
    void flushMessages();
  } else if (!timer) {
    timer = setTimeout(() => void flushMessages(), FLUSH_INTERVAL_MS);
  }
}

/** Tulis semua pesan yang tertunda. Aman dipanggil berkali-kali/bersamaan. */
export function flushMessages(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flushing = flushing.then(async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      await prisma.ticketMessage.createMany({ data: batch });
    } catch (err) {
      console.error(`[messageQueue] Gagal menyimpan ${batch.length} pesan:`, err);
    }
  });
  return flushing;
}
