import { Message } from "discord.js";
import prisma from "../lib/prisma.js";

/**
 * Saves a message to the database if it belongs to an active ticket.
 * This is called on every messageCreate event.
 */
export async function handleMessage(message: Message) {
  // Ignore bots and DMs
  if (message.author.bot || !message.guild) return;

  const ticket = await prisma.ticket.findFirst({
    where: {
      channelId: message.channel.id,
      guildId: message.guild.id,
      status: "OPEN",
    },
  });

  if (!ticket) return;

  const attachmentUrls = message.attachments.map((a) => a.url);

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      authorId: message.author.id,
      content: message.content || "[No text content]",
      attachments: attachmentUrls.length > 0 ? JSON.stringify(attachmentUrls) : null,
    },
  });
}
