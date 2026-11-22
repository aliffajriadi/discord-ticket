import { Message } from "discord.js";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { AiSkill } from "@prisma/client";
import prisma from "./prisma.js";
import { loadAppConfig } from "./appConfig.js";
import { isOpenTicketChannel } from "./messageQueue.js";
import { isTicketStaff, ticketSupportRole } from "./utils.js";

const DEBOUNCE_MS = 4_000; // tunggu user selesai mengetik beberapa pesan beruntun
const HISTORY_LIMIT = 30;
const HANDOFF = "[STAFF]";
const MAX_TOOL_ROUNDS = 3;

const BASE_RULES = `Kamu adalah asisten customer service yang menjawab tiket Discord.
- Jawab singkat, ramah, dan dalam bahasa yang dipakai user.
- Hanya gunakan informasi dari skill di bawah dan isi percakapan. Jangan mengarang harga, stok, atau kebijakan.
- Kamu tidak bisa melihat gambar atau file. Jika user mengirim [gambar] atau [file], katakan kamu tidak bisa membuka gambar/file dan tanyakan itu gambar/file apa. Jika ternyata bukti pembayaran, screenshot error, atau hal lain yang perlu dicek langsung, serahkan ke staff.
- Jika kamu tidak tahu jawabannya, user minta bicara dengan manusia, atau butuh tindakan staff (pembayaran, refund, akses akun), tulis ${HANDOFF} di akhir jawaban.`;

/** Pilih skill yang relevan: semua GLOBAL, REASON yang cocok, PRODUCT yang keyword-nya muncul di chat. */
export function pickSkills(skills: AiSkill[], reasonId: number | null, chatText: string): AiSkill[] {
  const text = chatText.toLowerCase();
  return skills.filter((s) => {
    if (!s.enabled) return false;
    if (s.scope === "GLOBAL") return true;
    if (s.scope === "REASON") return s.reasonId !== null && s.reasonId === reasonId;
    if (s.scope === "PRODUCT") {
      return (s.keywords ?? "")
        .split(",")
        .map((k) => k.trim().toLowerCase())
        // Cocokkan kata utuh, supaya keyword "nf" tidak cocok dengan "info"
        .some((k) => k && new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text));
    }
    return false;
  });
}

const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();

/** Dipanggil untuk setiap pesan; balasan AI dikirim setelah jeda singkat. */
export async function handleAiMessage(message: Message) {
  if (message.author.bot || !message.inGuild()) return;
  if (!(await isOpenTicketChannel(message.channelId))) return;

  const ticket = await prisma.ticket.findUnique({
    where: { channelId: message.channelId },
    include: { guild: true, reason: true },
  });
  if (!ticket || ticket.status !== "OPEN" || !ticket.aiActive || !ticket.guild.aiEnabled) return;

  if (message.author.id !== ticket.creatorId) {
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (member && (await isTicketStaff(message.guild, member, ticketSupportRole(ticket)))) {
      await prisma.ticket.update({ where: { id: ticket.id }, data: { aiActive: false } });
      clearTimeout(timers.get(message.channelId));
      timers.delete(message.channelId);
    }
    return;
  }

  clearTimeout(timers.get(message.channelId));
  timers.set(
    message.channelId,
    setTimeout(() => {
      timers.delete(message.channelId);
      void reply(message).catch((err) => console.error("[ai] Gagal membalas tiket:", err));
    }, DEBOUNCE_MS)
  );
}

async function reply(trigger: Message<true>) {
  const channelId = trigger.channelId;
  if (running.has(channelId)) return void handleAiMessage(trigger); // tunda sampai balasan sebelumnya selesai
  running.add(channelId);
  try {
    const { deepseekKey, deepseekModel } = await loadAppConfig();
    if (!deepseekKey) return;
    // Cek ulang: staff bisa saja masuk selama jeda
    const ticket = await prisma.ticket.findUnique({ where: { channelId }, include: { reason: true } });
    if (!ticket || ticket.status !== "OPEN" || !ticket.aiActive) return;

    const channel = trigger.channel;
    await channel.sendTyping().catch(() => {});
    const botId = trigger.client.user.id;
    const history = [...(await channel.messages.fetch({ limit: HISTORY_LIMIT })).values()]
      .reverse()
      .map((m) => ({
        bot: m.author.id === botId,
        text: [
          m.content || m.embeds.map((e) => [e.title, e.description].filter(Boolean).join("\n")).join("\n"),
          // AI tidak bisa melihat lampiran, cukup tahu ada lampiran
          ...m.attachments.map((a) => (a.contentType?.startsWith("image/") ? "[gambar]" : `[file: ${a.name}]`)),
        ]
          .filter(Boolean)
          .join("\n"),
        tag: m.author.username,
      }))
      .filter((m) => m.text);

    const skills = await prisma.aiSkill.findMany({ where: { guildId: ticket.guildId }, orderBy: { id: "asc" } });
    const userText = history.filter((m) => !m.bot).map((m) => m.text).join("\n");
    const picked = pickSkills(skills, ticket.reasonId, userText);

    const topics = skills.filter((s) => s.enabled && s.scope === "TOPIC");

    const system = [
      BASE_RULES,
      `Alasan tiket: ${ticket.reasonLabel ?? "-"}${ticket.reason?.description ? ` (${ticket.reason.description})` : ""}`,
      ...picked.map((s) => `## Skill: ${s.name}\n${s.content}`),
      topics.length
        ? `## Skill topik (muat dengan load_skill hanya jika relevan dengan pertanyaan user)\n${topics
            .map((s) => `- id ${s.id}: ${s.name} — ${s.description ?? ""}`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const tools: ChatCompletionTool[] | undefined = topics.length
      ? [
          {
            type: "function",
            function: {
              name: "load_skill",
              description: "Muat isi lengkap skill topik berdasarkan id-nya.",
              parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
            },
          },
        ]
      : undefined;

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...history.map((m) =>
        m.bot ? { role: "assistant" as const, content: m.text } : { role: "user" as const, content: `${m.tag}: ${m.text}` }
      ),
    ];

    const ai = new OpenAI({ apiKey: deepseekKey, baseURL: "https://api.deepseek.com" });
    let answer = "";
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await ai.chat.completions.create({
        model: deepseekModel || "deepseek-v4-flash",
        messages,
        tools,
        // Ronde terakhir wajib menjawab, tidak boleh memuat skill lagi
        tool_choice: tools ? (round < MAX_TOOL_ROUNDS ? "auto" : "none") : undefined,
      });
      const msg = res.choices[0]?.message;
      if (!msg?.tool_calls?.length) {
        answer = msg?.content?.trim() ?? "";
        break;
      }
      messages.push(msg);
      for (const call of msg.tool_calls) {
        let id = NaN;
        if (call.type === "function") {
          try {
            id = Number(JSON.parse(call.function.arguments).id);
          } catch {}
        }
        const skill = topics.find((s) => s.id === id);
        messages.push({ role: "tool", tool_call_id: call.id, content: skill ? `# ${skill.name}\n${skill.content}` : "Skill tidak ditemukan." });
      }
    }

    const handoff = answer.includes(HANDOFF);
    answer = answer.replaceAll(HANDOFF, "").trim();

    // Staff masuk saat AI sedang berpikir: jangan kirim
    const fresh = await prisma.ticket.findUnique({ where: { id: ticket.id }, select: { aiActive: true, status: true } });
    if (!fresh?.aiActive || fresh.status !== "OPEN") return;

    for (let i = 0; i < answer.length; i += 1900) await channel.send(answer.slice(i, i + 1900));
    if (handoff) {
      await prisma.ticket.update({ where: { id: ticket.id }, data: { aiActive: false } });
      const role = ticketSupportRole(ticket);
      await channel.send(`${role ? `<@&${role}> ` : ""}Tiket ini butuh bantuan staff.`);
    }
  } finally {
    running.delete(channelId);
  }
}
