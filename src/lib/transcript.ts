import {
  Guild,
  TextChannel,
  Colors,
  EmbedBuilder,
  AttachmentBuilder,
} from "discord.js";
import { Ticket, TicketReason } from "@prisma/client";
import prisma from "../lib/prisma.js";
import { sendLog } from "../lib/utils.js";

interface TranscriptResult {
  success: boolean;
  reason?: string;
}

/**
 * Generates an HTML transcript of the ticket messages and sends it via DM.
 */
export async function generateTranscript(
  guild: Guild,
  ticket: Ticket & { reason: TicketReason },
  channel: TextChannel
): Promise<TranscriptResult> {
  try {
    // Fetch messages from DB
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "asc" },
    });

    if (messages.length === 0) {
      // Try fetching from Discord directly
      const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (fetched) {
        const sorted = [...fetched.values()].reverse();
        messages.push(
          ...sorted.map((m) => ({
            id: 0,
            ticketId: ticket.id,
            authorId: m.author.id,
            content: m.content || "[Embed/Attachment]",
            attachments: m.attachments.size > 0
              ? JSON.stringify(m.attachments.map((a) => a.url))
              : null,
            createdAt: m.createdAt,
          }))
        );
      }
    }

    const html = buildHtmlTranscript(ticket, messages, guild);
    const buffer = Buffer.from(html, "utf-8");
    const attachment = new AttachmentBuilder(buffer, {
      name: `transcript-ticket-${ticket.id}.html`,
    });

    // Try sending DM to the ticket creator
    const creator = await guild.members.fetch(ticket.creatorId).catch(() => null);
    if (!creator) {
      return { success: false, reason: "User tidak ditemukan di server." };
    }

    const dmEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📄 Transkrip Tiket #${ticket.id}`)
      .setDescription(
        `Berikut adalah transkrip tiket kamu di **${guild.name}**.\n\n**Alasan:** ${ticket.reason.label}\n**Status:** Ditutup\n**Total Pesan:** ${messages.length}`
      )
      .setTimestamp();

    await creator.send({ embeds: [dmEmbed], files: [attachment] });
    return { success: true };
  } catch (err: any) {
    const reason =
      err?.code === 50007
        ? "User menonaktifkan DM."
        : `Error: ${err?.message ?? "Unknown"}`;

    // Fallback: Send to log channel
    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.Orange)
        .setTitle("⚠️ Transkrip Gagal Dikirim via DM")
        .addFields(
          { name: "Tiket", value: `#${ticket.id}`, inline: true },
          { name: "Pembuat", value: `<@${ticket.creatorId}>`, inline: true },
          { name: "Alasan", value: reason, inline: false }
        )
        .setTimestamp()
    );

    return { success: false, reason };
  }
}

/**
 * Builds a styled HTML transcript string.
 */
function buildHtmlTranscript(
  ticket: Ticket & { reason: TicketReason },
  messages: Array<{
    authorId: string;
    content: string;
    attachments: string | null;
    createdAt: Date;
  }>,
  guild: Guild
): string {
  const msgRows = messages
    .map((m) => {
      const attachments = m.attachments ? JSON.parse(m.attachments) as string[] : [];
      const attachHtml = attachments
        .map((url) => `<a href="${url}" target="_blank">[Attachment]</a>`)
        .join(" ");

      return `
      <div class="message">
        <span class="author"><@${m.authorId}></span>
        <span class="timestamp">${new Date(m.createdAt).toLocaleString("id-ID")}</span>
        <div class="content">${escapeHtml(m.content)} ${attachHtml}</div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Transkrip Tiket #${ticket.id}</title>
  <style>
    :root {
      --bg: #1e1f22;
      --surface: #2b2d31;
      --border: #3f4147;
      --text: #dbdee1;
      --muted: #949ba4;
      --accent: #5865f2;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; padding: 24px; }
    header { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; }
    header h1 { font-size: 1.4rem; color: var(--accent); margin-bottom: 8px; }
    header .meta span { font-size: 0.85rem; color: var(--muted); margin-right: 16px; }
    .message { display: flex; flex-direction: column; padding: 10px 16px; border-bottom: 1px solid var(--border); }
    .message:hover { background: var(--surface); }
    .author { font-weight: 600; color: var(--accent); font-size: 0.85rem; }
    .timestamp { font-size: 0.75rem; color: var(--muted); margin-bottom: 4px; }
    .content { font-size: 0.9rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .messages-container { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    .empty { padding: 32px; text-align: center; color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>🎫 Transkrip Tiket #${ticket.id}</h1>
    <div class="meta">
      <span>📌 Server: ${escapeHtml(guild.name)}</span>
      <span>🏷️ Alasan: ${escapeHtml(ticket.reason.label)}</span>
      <span>👤 Pembuat: &lt;@${ticket.creatorId}&gt;</span>
      <span>💬 Total Pesan: ${messages.length}</span>
      <span>📅 Dibuat: ${new Date(ticket.createdAt).toLocaleString("id-ID")}</span>
    </div>
  </header>
  <div class="messages-container">
    ${messages.length > 0 ? msgRows : '<div class="empty">Tidak ada pesan.</div>'}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
