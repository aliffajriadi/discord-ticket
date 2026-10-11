import {
  Guild,
  TextChannel,
  Colors,
  EmbedBuilder,
  AttachmentBuilder,
} from "discord.js";
import { Ticket } from "@prisma/client";
import prisma from "../lib/prisma.js";
import { sendLog } from "../lib/utils.js";
import { flushMessages } from "./messageQueue.js";
import { getConfig, fmt } from "./guildConfig.js";

interface TranscriptResult {
  success: boolean;
  reason?: string;
}

export interface TranscriptMessage {
  authorId: string;
  authorTag: string | null;
  authorBot: boolean;
  content: string;
  attachments: string | null;
  createdAt: Date;
}

type TicketForTranscript = Ticket & { reason: { label: string } | null };

export function ticketLabel(ticket: Pick<Ticket, "id" | "number">): string {
  return `#${ticket.number ?? ticket.id}`;
}

export function reasonLabel(ticket: TicketForTranscript): string {
  return ticket.reason?.label ?? ticket.reasonLabel ?? "Tanpa Alasan";
}

/**
 * Mengambil pesan tiket dari DB. Jika kosong (mis. tiket lama sebelum bot merekam),
 * ambil seluruh riwayat channel langsung dari Discord.
 */
async function collectMessages(ticket: Ticket, channel: TextChannel | null): Promise<TranscriptMessage[]> {
  await flushMessages();
  const messages: TranscriptMessage[] = await prisma.ticketMessage.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "asc" },
  });
  if (messages.length > 0 || !channel) return messages;

  const fetched: TranscriptMessage[] = [];
  let before: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!page || page.size === 0) break;
    for (const m of page.values()) {
      fetched.push({
        authorId: m.author.id,
        authorTag: m.author.tag,
        authorBot: m.author.bot,
        content: m.content || m.embeds.map((e) => e.description ?? e.title ?? "").join("\n") || "[Embed/Attachment]",
        attachments: m.attachments.size > 0 ? JSON.stringify(m.attachments.map((a) => a.url)) : null,
        createdAt: m.createdAt,
      });
    }
    before = page.last()?.id;
    if (page.size < 100) break;
  }
  return fetched.reverse();
}

export async function buildTranscriptFile(
  guild: Guild,
  ticket: TicketForTranscript,
  channel: TextChannel | null
): Promise<{ attachment: AttachmentBuilder; count: number }> {
  const messages = await collectMessages(ticket, channel);
  const html = buildHtmlTranscript(ticket, messages, guild.name);
  return {
    attachment: new AttachmentBuilder(Buffer.from(html, "utf-8"), {
      name: `transcript-ticket-${ticket.number ?? ticket.id}.html`,
    }),
    count: messages.length,
  };
}

/**
 * Generates an HTML transcript and sends it via DM to the ticket creator.
 * Fallback: jika DM gagal, transkrip dikirim ke channel log.
 */
export async function generateTranscript(
  guild: Guild,
  ticket: TicketForTranscript,
  channel: TextChannel | null
): Promise<TranscriptResult> {
  const cfg = await getConfig(guild);
  let file: { attachment: AttachmentBuilder; count: number };
  try {
    file = await buildTranscriptFile(guild, ticket, channel);
  } catch (err: any) {
    console.error("[transcript] Gagal membuat transkrip:", err);
    return { success: false, reason: `Error: ${err?.message ?? "Unknown"}` };
  }

  try {
    const creator = await guild.client.users.fetch(ticket.creatorId);
    const dmEmbed = new EmbedBuilder()
      .setColor(cfg.color)
      .setTitle(`${cfg.e.TICKET_SAVE} Transkrip Tiket ${ticketLabel(ticket)}`)
      .setDescription(
        `${fmt(cfg.t.transcriptDm, { server: guild.name })}\n\n**Alasan:** ${reasonLabel(ticket)}\n**Total Pesan:** ${file.count}`
      )
      .setTimestamp();

    await creator.send({ embeds: [dmEmbed], files: [file.attachment] });
    return { success: true };
  } catch (err: any) {
    const reason = err?.code === 50007 ? "User menonaktifkan DM." : `Error: ${err?.message ?? "Unknown"}`;

    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.Orange)
        .setTitle(`${cfg.e.WARNING} Transkrip Gagal Dikirim via DM`)
        .setDescription("File transkrip dilampirkan di sini sebagai cadangan.")
        .addFields(
          { name: "Tiket", value: ticketLabel(ticket), inline: true },
          { name: "Pembuat", value: `<@${ticket.creatorId}>`, inline: true },
          { name: "Penyebab", value: reason, inline: false }
        )
        .setTimestamp(),
      "ticket",
      [file.attachment]
    );

    return { success: false, reason };
  }
}

/**
 * Builds a styled HTML transcript string.
 */
export function buildHtmlTranscript(
  ticket: TicketForTranscript,
  messages: TranscriptMessage[],
  guildName: string
): string {
  const msgRows = messages
    .map((m) => {
      const attachments = m.attachments ? (JSON.parse(m.attachments) as string[]) : [];
      const attachHtml = attachments
        .map((url) =>
          /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url)
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="attachment" loading="lazy"/></a>`
            : `<a class="file" href="${escapeHtml(url)}" target="_blank" rel="noopener">📎 ${escapeHtml(url.split("/").pop()?.split("?")[0] ?? "file")}</a>`
        )
        .join("");
      const name = m.authorTag ?? m.authorId;
      const initial = escapeHtml(name.charAt(0).toUpperCase());

      return `
      <div class="message">
        <div class="avatar${m.authorBot ? " bot" : ""}">${initial}</div>
        <div class="body">
          <div class="head">
            <span class="author">${escapeHtml(name)}</span>${m.authorBot ? '<span class="badge">BOT</span>' : ""}
            <span class="timestamp">${new Date(m.createdAt).toLocaleString("id-ID")}</span>
          </div>
          <div class="content">${escapeHtml(m.content)}</div>
          ${attachHtml ? `<div class="attachments">${attachHtml}</div>` : ""}
        </div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Transkrip Tiket ${ticketLabel(ticket)}</title>
  <style>
    :root { --bg:#1e1f22; --surface:#2b2d31; --border:#3f4147; --text:#dbdee1; --muted:#949ba4; --accent:#5865f2; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:'Segoe UI',system-ui,sans-serif; padding:24px; max-width:960px; margin:0 auto; }
    header { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px 24px; margin-bottom:20px; }
    header h1 { font-size:1.4rem; color:#fff; margin-bottom:10px; }
    .meta { display:flex; flex-wrap:wrap; gap:8px; }
    .meta span { font-size:.8rem; color:var(--muted); background:var(--bg); border:1px solid var(--border); border-radius:999px; padding:4px 10px; }
    .messages { background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
    .message { display:flex; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); }
    .message:last-child { border-bottom:none; }
    .message:hover { background:#313338; }
    .avatar { flex:none; width:36px; height:36px; border-radius:50%; background:var(--accent); color:#fff; display:grid; place-items:center; font-weight:700; }
    .avatar.bot { background:#3ba55c; }
    .body { min-width:0; flex:1; }
    .head { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }
    .author { font-weight:600; color:#fff; font-size:.9rem; }
    .badge { font-size:.6rem; background:var(--accent); color:#fff; padding:1px 5px; border-radius:4px; font-weight:700; }
    .timestamp { font-size:.72rem; color:var(--muted); }
    .content { font-size:.9rem; line-height:1.5; white-space:pre-wrap; word-break:break-word; }
    .attachments { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
    .attachments img { max-width:320px; max-height:240px; border-radius:8px; border:1px solid var(--border); }
    .file { color:#00a8fc; font-size:.85rem; text-decoration:none; background:var(--bg); padding:6px 10px; border-radius:6px; border:1px solid var(--border); }
    .empty { padding:32px; text-align:center; color:var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>🎫 Transkrip Tiket ${ticketLabel(ticket)}</h1>
    <div class="meta">
      <span>📌 ${escapeHtml(guildName)}</span>
      <span>🏷️ ${escapeHtml(reasonLabel(ticket))}</span>
      <span>👤 ${escapeHtml(ticket.creatorTag ?? ticket.creatorId)}</span>
      <span>💬 ${messages.length} pesan</span>
      <span>📅 ${new Date(ticket.createdAt).toLocaleString("id-ID")}</span>
    </div>
  </header>
  <div class="messages">
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
