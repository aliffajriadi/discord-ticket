import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Request, Response, NextFunction } from "express";
import { ChannelType, Client, Guild, PermissionFlagsBits, TextChannel } from "discord.js";
import prisma from "../lib/prisma.js";
import { authRouter, requireAuth, getSessionUser, SessionUser } from "./auth.js";
import { BotRuntime } from "../bot.js";
import { loadAppConfig, saveAppConfig, isConfigured } from "../lib/appConfig.js";
import { deployCommands } from "../lib/deployCommands.js";
import { REST, Routes } from "discord.js";
import { randomInt } from "node:crypto";
import { ensureGuild } from "../lib/utils.js";
import {
  DEFAULT_TEXTS,
  TEXT_LABELS,
  DEFAULT_COLOR,
  TextKey,
  invalidateConfig,
} from "../lib/guildConfig.js";
import { E, EMOJI_LABELS, EmojiKey } from "../config/emoji.js";
import { buildHtmlTranscript } from "../lib/transcript.js";
import { buildPanelMessage, closeTicket, deleteTicket } from "../lib/ticket.js";
import { flushMessages } from "../lib/messageQueue.js";
import { getAutoMod, saveAutoMod, checkLimit, AUTOMOD_LIMITS } from "../lib/automod.js";
import { invalidateSticky, removeStickyMessage, repostSticky } from "../lib/sticky.js";
import { LOCK_OPTIONS, LockOption, LockableChannel, isLockable, lockChannel, unlockChannel } from "../lib/lockdown.js";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
const PAGE_SIZE = 25;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

// ── Hak akses dashboard ─────────────────────────────────────────────────────
const accessCache = new Map<string, { ok: boolean; at: number }>();

async function canManage(guild: Guild, userId: string): Promise<boolean> {
  const key = `${guild.id}:${userId}`;
  const cached = accessCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.ok;

  let ok = guild.ownerId === userId;
  if (!ok) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      const g = await prisma.guild.findUnique({ where: { id: guild.id } });
      ok =
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        (!!g?.setupRoleId && member.roles.cache.has(g.setupRoleId));
    }
  }
  accessCache.set(key, { ok, at: Date.now() });
  return ok;
}

function str(v: unknown, max = 4000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function snowflake(v: unknown): string | null {
  return typeof v === "string" && /^\d{17,20}$/.test(v) ? v : null;
}

function parseColor(v: unknown): number | null {
  if (typeof v === "number" && v >= 0 && v <= 0xffffff) return v;
  if (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v)) return parseInt(v.replace("#", ""), 16);
  return null;
}

const INVITE_PERMISSIONS = "10189004991574";

/**
 * Menjalankan dashboard. Berjalan walau bot belum punya token: saat itu halaman
 * setup tampil dan dilindungi kode sekali pakai yang dicetak di console.
 */
export interface DashboardHandle {
  baseUrl: string;
  /** Terbitkan kode setup baru (dipakai saat bot gagal menyala agar token bisa diperbaiki lewat web). */
  issueSetupCode: () => string;
}

export async function startDashboard(bot: BotRuntime, opts: { setupCode: string | null }): Promise<DashboardHandle> {
  let setupCode = opts.setupCode;
  let codeFailures = 0;
  const newCode = () => String(randomInt(100000, 999999));
  const issueSetupCode = () => {
    setupCode = newCode();
    codeFailures = 0;
    return setupCode;
  };
  const port = parseInt(process.env.DASHBOARD_PORT ?? "3000", 10);
  const defaultUrl = `http://localhost:${port}`;
  const baseUrlOf = async () => ((await loadAppConfig()).dashboardUrl ?? defaultUrl).replace(/\/$/, "");

  const getClient = () => {
    if (!bot.client) throw new HttpError(503, "Bot belum online. Cek token di menu Pengaturan Bot.");
    return bot.client;
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  app.use(
    "/auth",
    authRouter(async () => {
      const c = await loadAppConfig();
      return c.clientId && c.clientSecret
        ? { clientId: c.clientId, clientSecret: c.clientSecret, baseUrl: await baseUrlOf() }
        : null;
    })
  );

  // ── Setup & konfigurasi bot (token dll) ────────────────────────────────────
  const setup = express.Router();
  setup.use((req, res, next) => {
    if (req.method !== "GET" && req.get("X-Requested-With") !== "dashboard") {
      return res.status(403).json({ error: "Header X-Requested-With tidak valid" });
    }
    next();
  });

  const statusOf = async () => {
    const c = await loadAppConfig();
    const baseUrl = await baseUrlOf();
    return {
      // Saat kode setup aktif (setup awal / pemulihan), frontend menampilkan form setup
      configured: isConfigured(c) && setupCode === null,
      needsSetupCode: setupCode !== null,
      hasToken: !!c.token,
      hasSecret: !!c.clientSecret,
      clientId: c.clientId ?? null,
      dashboardUrl: baseUrl,
      redirectUri: `${baseUrl}/auth/callback`,
      bot: { status: bot.status, error: bot.error, tag: bot.client?.user.tag ?? null },
    };
  };

  setup.get("/status", h(async (_req, res) => res.json(await statusOf())));

  /** Boleh mengubah konfigurasi: (a) belum ada setup + kode benar, atau (b) pemilik aplikasi bot. */
  const authorize = (req: Request): void => {
    if (setupCode !== null) {
      if (String(req.body?.setupCode ?? req.query.setupCode ?? "") !== setupCode) {
        // Anti tebak-tebakan: setelah 5 salah, kode diganti dan hanya tampil di console
        if (++codeFailures >= 5) {
          console.warn(`\n⚠️  Terlalu banyak kode setup salah. Kode BARU: ${issueSetupCode()}\n`);
          throw new HttpError(429, "Terlalu banyak percobaan salah. Kode setup sudah diganti, lihat kode baru di console.");
        }
        throw new HttpError(403, "Kode setup salah. Lihat kode di console tempat bot dijalankan.");
      }
      codeFailures = 0;
      return;
    }
    const user = getSessionUser(req);
    if (!user) throw new HttpError(401, "Belum login");
    if (!bot.ownerIds.has(user.id)) throw new HttpError(403, "Hanya pemilik aplikasi bot yang bisa mengubah ini");
  };

  setup.put(
    "/config",
    h(async (req, res) => {
      authorize(req);
      const current = await loadAppConfig();
      const token = str(req.body.token, 200) ?? current.token;
      const clientSecret = str(req.body.clientSecret, 200) ?? current.clientSecret;
      let dashboardUrl = str(req.body.dashboardUrl, 200) ?? current.dashboardUrl;
      if (!token) throw new HttpError(400, "Token bot wajib diisi");
      if (!clientSecret) throw new HttpError(400, "Client Secret wajib diisi");
      if (dashboardUrl) {
        if (!/^https?:\/\/[^\s/]+/i.test(dashboardUrl)) throw new HttpError(400, "URL dashboard harus diawali http:// atau https://");
        dashboardUrl = dashboardUrl.replace(/\/$/, "");
      }

      // Validasi token ke Discord sebelum disimpan; Client ID diambil dari sini
      let clientId: string;
      try {
        const me = (await new REST().setToken(token).get(Routes.user())) as { id: string };
        clientId = me.id;
      } catch (err: any) {
        if (err?.status === 401) {
          throw new HttpError(400, "Token ditolak Discord. Pastikan itu Bot Token (bukan Client Secret) dan belum di-reset.");
        }
        throw new HttpError(502, `Tidak bisa menghubungi Discord: ${err?.message ?? "unknown"}`);
      }

      // Validasi Client Secret: Discord menjawab invalid_client jika pasangan ID/secret salah
      const check = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "identify" }),
      }).catch((err: Error) => {
        throw new HttpError(502, `Tidak bisa menghubungi Discord: ${err.message}`);
      });
      if (check.status === 401) {
        throw new HttpError(
          400,
          "Client Secret salah. Ambil dari Developer Portal → OAuth2 → Client Secret (klik Reset Secret jika belum pernah melihatnya). Jangan tertukar dengan Token atau Public Key."
        );
      }

      await saveAppConfig({ token, clientId, clientSecret, dashboardUrl: dashboardUrl ?? "" });

      let botError: string | null = null;
      await bot.start(token, clientId).catch((err: Error) => (botError = err.message));
      // Kode hanya dicabut jika bot berhasil menyala; kalau gagal user bisa langsung memperbaiki
      if (!botError) setupCode = null;
      res.json({ ...(await statusOf()), botError });
    })
  );

  setup.post(
    "/redeploy",
    h(async (req, res) => {
      authorize(req);
      const c = await loadAppConfig();
      const client = getClient();
      res.json(await deployCommands(c.token!, c.clientId!, [...client.guilds.cache.keys()], true));
    })
  );

  app.use("/api/setup", setup);

  const api = express.Router();
  api.use(requireAuth);
  // Proteksi CSRF: request yang mengubah data wajib membawa header custom
  // (browser tidak bisa mengirimnya lintas-origin tanpa izin CORS).
  api.use((req, res, next) => {
    if (req.method !== "GET" && req.get("X-Requested-With") !== "dashboard") {
      return res.status(403).json({ error: "Header X-Requested-With tidak valid" });
    }
    next();
  });

  const userOf = (res: Response) => res.locals.user as SessionUser;
  const guildOf = (res: Response) => res.locals.guild as Guild;

  api.get(
    "/me",
    h(async (_req, res) => {
      const user = userOf(res);
      const guilds = [];
      const client = bot.client;
      for (const guild of client?.guilds.cache.values() ?? []) {
        if (await canManage(guild, user.id)) {
          guilds.push({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), members: guild.memberCount });
        }
      }
      const clientId = (await loadAppConfig()).clientId;
      const invite = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`;
      res.json({
        user,
        guilds,
        invite,
        isAppOwner: bot.ownerIds.has(user.id),
        botStatus: bot.status,
        bot: client ? { name: client.user.username, avatar: client.user.displayAvatarURL() } : null,
      });
    })
  );

  // ── Semua route /guilds/:guildId/* butuh akses admin ke server tsb ────────
  const g = express.Router({ mergeParams: true });
  g.use((req, res, next) => {
    (async () => {
      const guild = getClient().guilds.cache.get(req.params.guildId);
      if (!guild) throw new HttpError(404, "Server tidak ditemukan atau bot belum bergabung");
      if (!(await canManage(guild, userOf(res).id))) throw new HttpError(403, "Kamu tidak punya akses ke server ini");
      await ensureGuild(guild.id);
      res.locals.guild = guild;
    })().then(() => next(), next);
  });

  // ── Meta: channel & role untuk dropdown ───────────────────────────────────
  g.get(
    "/meta",
    h(async (_req, res) => {
      const guild = guildOf(res);
      const channels = [...guild.channels.cache.values()]
        .filter((c) => !c.isThread())
        .sort((a, b) => ("rawPosition" in a && "rawPosition" in b ? a.rawPosition - b.rawPosition : 0))
        .map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          parent: c.parent?.name ?? null,
          text: c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement,
          category: c.type === ChannelType.GuildCategory,
          lockable: isLockable(c),
        }));
      const roles = [...guild.roles.cache.values()]
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, managed: r.managed, everyone: r.id === guild.id }));
      res.json({
        guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), ownerId: guild.ownerId },
        channels,
        roles,
        lockOptions: Object.entries(LOCK_OPTIONS).map(([key, v]) => ({ key, label: v.label })),
        isOwner: guild.ownerId === userOf(res).id,
      });
    })
  );

  // ── Overview ──────────────────────────────────────────────────────────────
  g.get(
    "/overview",
    h(async (_req, res) => {
      const guild = guildOf(res);
      const where = { guildId: guild.id };
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      const [open, closed, total, cases, casesWeek, stickies, lockdowns, recentTickets, recentCases] = await Promise.all([
        prisma.ticket.count({ where: { ...where, status: "OPEN" } }),
        prisma.ticket.count({ where: { ...where, status: "CLOSED" } }),
        prisma.ticket.count({ where }),
        prisma.modCase.count({ where }),
        prisma.modCase.count({ where: { ...where, createdAt: { gte: weekAgo } } }),
        prisma.stickyNote.count({ where }),
        prisma.lockdown.count({ where }),
        prisma.ticket.findMany({ where, orderBy: { createdAt: "desc" }, take: 6 }),
        prisma.modCase.findMany({ where, orderBy: { createdAt: "desc" }, take: 6 }),
      ]);
      // Tiket per hari, 14 hari terakhir
      const since = new Date(Date.now() - 13 * 86_400_000);
      since.setHours(0, 0, 0, 0);
      const ticketsRecent = await prisma.ticket.findMany({
        where: { ...where, createdAt: { gte: since } },
        select: { createdAt: true },
      });
      const daily: { date: string; count: number }[] = [];
      for (let d = 0; d < 14; d++) {
        const day = new Date(since.getTime() + d * 86_400_000);
        daily.push({ date: day.toISOString().slice(0, 10), count: 0 });
      }
      for (const t of ticketsRecent) {
        const idx = Math.floor((t.createdAt.getTime() - since.getTime()) / 86_400_000);
        if (daily[idx]) daily[idx].count++;
      }
      res.json({
        stats: { open, closed, total, cases, casesWeek, stickies, lockdowns, members: guild.memberCount },
        daily,
        recentTickets,
        recentCases,
      });
    })
  );

  // ── Tiket ─────────────────────────────────────────────────────────────────
  g.get(
    "/tickets",
    h(async (req, res) => {
      const guild = guildOf(res);
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const status = str(req.query.status);
      const q = str(req.query.q, 100);
      const where = {
        guildId: guild.id,
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { creatorTag: { contains: q } },
                { creatorId: q },
                { reasonLabel: { contains: q } },
                ...(/^\d+$/.test(q) ? [{ number: parseInt(q, 10) }] : []),
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.ticket.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          include: { _count: { select: { messages: true } } },
        }),
        prisma.ticket.count({ where }),
      ]);
      res.json({ items, total, page, pageSize: PAGE_SIZE });
    })
  );

  async function findTicket(guild: Guild, idRaw: string) {
    const ticket = await prisma.ticket.findUnique({ where: { id: parseInt(idRaw, 10) || 0 }, include: { reason: true } });
    if (!ticket || ticket.guildId !== guild.id) throw new HttpError(404, "Tiket tidak ditemukan");
    return ticket;
  }

  g.get(
    "/tickets/:id",
    h(async (req, res) => {
      const ticket = await findTicket(guildOf(res), req.params.id);
      await flushMessages();
      const messages = await prisma.ticketMessage.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: "asc" } });
      res.json({ ticket, messages });
    })
  );

  g.get(
    "/tickets/:id/transcript",
    h(async (req, res) => {
      const guild = guildOf(res);
      const ticket = await findTicket(guild, req.params.id);
      await flushMessages();
      const messages = await prisma.ticketMessage.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: "asc" } });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="transcript-ticket-${ticket.number ?? ticket.id}.html"`);
      res.send(buildHtmlTranscript(ticket, messages, guild.name));
    })
  );

  g.post(
    "/tickets/:id/:action(close|delete)",
    h(async (req, res) => {
      const guild = guildOf(res);
      const ticket = await findTicket(guild, req.params.id);
      const member = await guild.members.fetch(userOf(res).id).catch(() => null);
      if (!member) throw new HttpError(403, "Kamu harus menjadi member server ini");
      const result =
        req.params.action === "close" ? await closeTicket(guild, member, ticket.id) : await deleteTicket(guild, member, ticket.id);
      if (!result.success) throw new HttpError(400, result.message);
      res.json(result);
    })
  );

  // ── Kasus moderasi ────────────────────────────────────────────────────────
  g.get(
    "/cases",
    h(async (req, res) => {
      const guild = guildOf(res);
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const type = str(req.query.type);
      const q = str(req.query.q, 100);
      const where = {
        guildId: guild.id,
        ...(type ? { type } : {}),
        ...(q
          ? {
              OR: [
                { targetTag: { contains: q } },
                { targetId: q },
                { moderatorTag: { contains: q } },
                { reason: { contains: q } },
                ...(/^\d+$/.test(q) ? [{ number: parseInt(q, 10) }] : []),
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.modCase.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
        prisma.modCase.count({ where }),
      ]);
      res.json({ items, total, page, pageSize: PAGE_SIZE });
    })
  );

  g.patch(
    "/cases/:id",
    h(async (req, res) => {
      const guild = guildOf(res);
      const c = await prisma.modCase.findUnique({ where: { id: parseInt(req.params.id, 10) || 0 } });
      if (!c || c.guildId !== guild.id) throw new HttpError(404, "Kasus tidak ditemukan");
      const data: { active?: boolean; reason?: string | null } = {};
      if (typeof req.body.active === "boolean") data.active = req.body.active;
      if ("reason" in req.body) data.reason = str(req.body.reason, 500);
      res.json(await prisma.modCase.update({ where: { id: c.id }, data }));
    })
  );

  // ── Sticky notes ──────────────────────────────────────────────────────────
  g.get(
    "/stickies",
    h(async (_req, res) => {
      res.json(await prisma.stickyNote.findMany({ where: { guildId: guildOf(res).id }, orderBy: { createdAt: "asc" } }));
    })
  );

  g.put(
    "/stickies/:channelId",
    h(async (req, res) => {
      const guild = guildOf(res);
      const channel = guild.channels.cache.get(req.params.channelId);
      if (!channel?.isTextBased() || channel.isThread()) throw new HttpError(400, "Channel tidak valid");
      const content = str(req.body.content);
      if (!content) throw new HttpError(400, "Isi sticky wajib diisi");
      const imageUrl = str(req.body.imageUrl, 500);
      if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) throw new HttpError(400, "URL gambar tidak valid");

      const old = await prisma.stickyNote.findUnique({ where: { channelId: channel.id } });
      if (old) await removeStickyMessage(guild, old);
      const data = {
        title: str(req.body.title, 200),
        content,
        color: parseColor(req.body.color),
        imageUrl,
        enabled: req.body.enabled !== false,
        lastMessageId: null,
      };
      const sticky = await prisma.stickyNote.upsert({
        where: { channelId: channel.id },
        create: { ...data, guildId: guild.id, channelId: channel.id, createdById: userOf(res).id },
        update: data,
      });
      invalidateSticky(channel.id);
      if (sticky.enabled) await repostSticky(guild, channel.id);
      res.json(sticky);
    })
  );

  g.delete(
    "/stickies/:channelId",
    h(async (req, res) => {
      const guild = guildOf(res);
      const sticky = await prisma.stickyNote.findUnique({ where: { channelId: req.params.channelId } });
      if (!sticky || sticky.guildId !== guild.id) throw new HttpError(404, "Sticky tidak ditemukan");
      await removeStickyMessage(guild, sticky);
      await prisma.stickyNote.delete({ where: { id: sticky.id } });
      res.json({ ok: true });
    })
  );

  // ── Lockdown ──────────────────────────────────────────────────────────────
  g.get(
    "/lockdowns",
    h(async (_req, res) => {
      res.json(await prisma.lockdown.findMany({ where: { guildId: guildOf(res).id }, orderBy: { createdAt: "desc" } }));
    })
  );

  g.post(
    "/lockdowns",
    h(async (req, res) => {
      const guild = guildOf(res);
      const channel = guild.channels.cache.get(String(req.body.channelId)) as LockableChannel | undefined;
      if (!channel || !isLockable(channel)) throw new HttpError(400, "Channel tidak bisa dikunci");
      const roleId = snowflake(req.body.roleId) ?? guild.id;
      if (!guild.roles.cache.has(roleId)) throw new HttpError(400, "Role tidak ditemukan");
      const options = (Array.isArray(req.body.options) ? req.body.options : []).filter(
        (o: unknown): o is LockOption => typeof o === "string" && o in LOCK_OPTIONS
      );
      if (options.length === 0) throw new HttpError(400, "Pilih minimal satu izin");
      const minutes = Number(req.body.durationMinutes) || 0;
      await lockChannel(channel, {
        roleId,
        options,
        by: await getClient().users.fetch(userOf(res).id),
        reason: str(req.body.reason, 300),
        durationMs: minutes > 0 ? Math.min(minutes, 60 * 24 * 30) * 60_000 : null,
        announce: req.body.announce !== false,
      });
      res.json({ ok: true });
    })
  );

  g.delete(
    "/lockdowns/:id",
    h(async (req, res) => {
      const guild = guildOf(res);
      const lock = await prisma.lockdown.findUnique({ where: { id: parseInt(req.params.id, 10) || 0 } });
      if (!lock || lock.guildId !== guild.id) throw new HttpError(404, "Lockdown tidak ditemukan");
      await unlockChannel(guild, lock.channelId, lock.roleId, await getClient().users.fetch(userOf(res).id));
      res.json({ ok: true });
    })
  );

  // ── AutoMod ───────────────────────────────────────────────────────────────
  g.get(
    "/automod",
    h(async (_req, res) => res.json({ settings: await getAutoMod(guildOf(res).id), limits: AUTOMOD_LIMITS }))
  );

  g.put(
    "/automod",
    h(async (req, res) => {
      const patch: Parameters<typeof saveAutoMod>[1] = {};
      if (typeof req.body.enabled === "boolean") patch.enabled = req.body.enabled;
      for (const key of ["maxChars", "maxLines", "maxMentions", "strikes", "windowSec", "timeoutMin"] as const) {
        if (!(key in req.body)) continue;
        const v = Number(req.body[key]);
        const err = checkLimit(key, v);
        if (err) throw new HttpError(400, err);
        patch[key] = v;
      }
      if (["NONE", "TIMEOUT", "KICK", "BAN"].includes(req.body.action)) patch.action = req.body.action;
      if (Array.isArray(req.body.channelIds)) {
        const guild = guildOf(res);
        patch.channelIds = req.body.channelIds.filter((id: unknown): id is string => {
          const c = typeof id === "string" ? guild.channels.cache.get(id) : null;
          return !!c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
        });
      }
      await saveAutoMod(guildOf(res).id, patch);
      res.json(await getAutoMod(guildOf(res).id));
    })
  );

  // ── Pengaturan ────────────────────────────────────────────────────────────
  g.get(
    "/settings",
    h(async (_req, res) => {
      const row = await prisma.guild.findUnique({ where: { id: guildOf(res).id } });
      res.json({
        logChannelId: row?.logChannelId ?? null,
        modLogChannelId: row?.modLogChannelId ?? null,
        setupRoleId: row?.setupRoleId ?? null,
        accentColor: row?.accentColor ?? DEFAULT_COLOR,
      });
    })
  );

  g.put(
    "/settings",
    h(async (req, res) => {
      const guild = guildOf(res);
      const data: Record<string, string | number | null> = {};
      for (const key of ["logChannelId", "modLogChannelId"] as const) {
        if (key in req.body) data[key] = snowflake(req.body[key]);
      }
      if ("setupRoleId" in req.body) {
        const current = await prisma.guild.findUnique({ where: { id: guild.id } });
        const next = snowflake(req.body.setupRoleId);
        if (next !== (current?.setupRoleId ?? null) && guild.ownerId !== userOf(res).id) {
          throw new HttpError(403, "Hanya Server Owner yang dapat mengubah admin role");
        }
        data.setupRoleId = next;
      }
      if ("accentColor" in req.body) data.accentColor = parseColor(req.body.accentColor);
      await prisma.guild.update({ where: { id: guild.id }, data });
      invalidateConfig(guild.id);
      accessCache.clear();
      res.json({ ok: true });
    })
  );

  // ── Teks ──────────────────────────────────────────────────────────────────
  g.get(
    "/texts",
    h(async (_req, res) => {
      const row = await prisma.guild.findUnique({ where: { id: guildOf(res).id } });
      res.json({ defaults: DEFAULT_TEXTS, labels: TEXT_LABELS, values: row?.texts ? JSON.parse(row.texts) : {} });
    })
  );

  g.put(
    "/texts",
    h(async (req, res) => {
      const guild = guildOf(res);
      const values: Partial<Record<TextKey, string>> = {};
      for (const key of Object.keys(DEFAULT_TEXTS) as TextKey[]) {
        const v = str(req.body?.[key], 4000);
        if (v && v !== DEFAULT_TEXTS[key]) values[key] = v;
      }
      await prisma.guild.update({ where: { id: guild.id }, data: { texts: JSON.stringify(values) } });
      invalidateConfig(guild.id);
      res.json({ ok: true });
    })
  );

  // ── Emoji ─────────────────────────────────────────────────────────────────
  const emojiList = (guild: Guild) =>
    [...guild.emojis.cache.values()].map((e) => ({
      id: e.id,
      name: e.name,
      animated: e.animated,
      url: e.imageURL({ size: 64 }),
      str: e.toString(),
    }));

  g.get(
    "/emojis",
    h(async (_req, res) => {
      const guild = guildOf(res);
      const row = await prisma.guild.findUnique({ where: { id: guild.id } });
      res.json({
        defaults: E,
        labels: EMOJI_LABELS,
        values: row?.emojis ? JSON.parse(row.emojis) : {},
        guildEmojis: emojiList(guild),
      });
    })
  );

  g.put(
    "/emojis",
    h(async (req, res) => {
      const guild = guildOf(res);
      const values: Partial<Record<EmojiKey, string>> = {};
      for (const key of Object.keys(E) as EmojiKey[]) {
        const v = str(req.body?.[key], 100);
        if (v && v !== E[key]) values[key] = v;
      }
      await prisma.guild.update({ where: { id: guild.id }, data: { emojis: JSON.stringify(values) } });
      invalidateConfig(guild.id);
      res.json({ ok: true });
    })
  );

  g.post(
    "/emojis/upload",
    h(async (req, res) => {
      const guild = guildOf(res);
      const name = String(req.body.name ?? "").trim();
      if (!/^\w{2,32}$/.test(name)) throw new HttpError(400, "Nama emoji 2-32 karakter (huruf, angka, underscore)");
      const match = /^data:image\/(png|jpeg|gif|webp);base64,(.+)$/.exec(String(req.body.image ?? ""));
      if (!match) throw new HttpError(400, "File harus PNG, JPG, GIF, atau WEBP");
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > 256 * 1024) throw new HttpError(400, "Ukuran emoji maksimal 256 KB");
      try {
        const emoji = await guild.emojis.create({ attachment: buffer, name, reason: `Upload dashboard oleh ${userOf(res).username}` });
        res.json({ id: emoji.id, name: emoji.name, str: emoji.toString(), url: emoji.imageURL({ size: 64 }) });
      } catch (err: any) {
        throw new HttpError(400, `Discord menolak: ${err?.message ?? "unknown"} (cek slot emoji & izin "Manage Expressions" bot)`);
      }
    })
  );

  g.delete(
    "/emojis/guild/:emojiId",
    h(async (req, res) => {
      const guild = guildOf(res);
      const emoji = guild.emojis.cache.get(req.params.emojiId);
      if (!emoji) throw new HttpError(404, "Emoji tidak ditemukan");
      await emoji.delete(`Dihapus dari dashboard oleh ${userOf(res).username}`);
      invalidateConfig(guild.id);
      res.json({ ok: true });
    })
  );

  // ── Alasan tiket ──────────────────────────────────────────────────────────
  g.get(
    "/reasons",
    h(async (_req, res) => {
      res.json(await prisma.ticketReason.findMany({ where: { guildId: guildOf(res).id }, orderBy: { id: "asc" } }));
    })
  );

  function reasonData(guild: Guild, body: any) {
    const label = str(body.label, 100);
    const value = str(body.value, 100)?.toLowerCase().replace(/\s+/g, "_");
    const categoryId = snowflake(body.categoryId);
    const supportRoleId = snowflake(body.supportRoleId);
    if (!label || !value || !categoryId || !supportRoleId) throw new HttpError(400, "Label, value, kategori, dan role wajib diisi");
    if (!/^[a-z0-9_]+$/.test(value)) throw new HttpError(400, "Value hanya huruf kecil, angka, dan underscore");
    if (guild.channels.cache.get(categoryId)?.type !== ChannelType.GuildCategory) throw new HttpError(400, "Kategori tidak valid");
    if (!guild.roles.cache.has(supportRoleId)) throw new HttpError(400, "Role tidak valid");
    return { label, value, description: str(body.description, 100), categoryId, supportRoleId };
  }

  g.post(
    "/reasons",
    h(async (req, res) => {
      const guild = guildOf(res);
      const data = reasonData(guild, req.body);
      const exists = await prisma.ticketReason.findUnique({ where: { guildId_value: { guildId: guild.id, value: data.value } } });
      if (exists) throw new HttpError(400, `Value "${data.value}" sudah dipakai`);
      res.json(await prisma.ticketReason.create({ data: { ...data, guildId: guild.id } }));
    })
  );

  g.put(
    "/reasons/:id",
    h(async (req, res) => {
      const guild = guildOf(res);
      const reason = await prisma.ticketReason.findUnique({ where: { id: parseInt(req.params.id, 10) || 0 } });
      if (!reason || reason.guildId !== guild.id) throw new HttpError(404, "Alasan tidak ditemukan");
      const data = reasonData(guild, req.body);
      if (data.value !== reason.value) {
        const exists = await prisma.ticketReason.findUnique({ where: { guildId_value: { guildId: guild.id, value: data.value } } });
        if (exists) throw new HttpError(400, `Value "${data.value}" sudah dipakai`);
      }
      res.json(await prisma.ticketReason.update({ where: { id: reason.id }, data }));
    })
  );

  g.delete(
    "/reasons/:id",
    h(async (req, res) => {
      const guild = guildOf(res);
      const reason = await prisma.ticketReason.findUnique({ where: { id: parseInt(req.params.id, 10) || 0 } });
      if (!reason || reason.guildId !== guild.id) throw new HttpError(404, "Alasan tidak ditemukan");
      const open = await prisma.ticket.count({ where: { reasonId: reason.id, status: "OPEN" } });
      if (open > 0) throw new HttpError(400, `Masih ada ${open} tiket OPEN dengan alasan ini`);
      await prisma.ticketReason.delete({ where: { id: reason.id } });
      res.json({ ok: true });
    })
  );

  g.post(
    "/panel",
    h(async (req, res) => {
      const guild = guildOf(res);
      const channel = guild.channels.cache.get(String(req.body.channelId));
      if (!channel || channel.type !== ChannelType.GuildText) throw new HttpError(400, "Pilih channel teks");
      const type = req.body.type === "dropdown" ? "dropdown" : "button";
      const panel = await buildPanelMessage(guild, type, { title: str(req.body.title, 200), description: str(req.body.description) });
      if (!panel) throw new HttpError(400, "Belum ada alasan tiket");
      await (channel as TextChannel).send(panel);
      res.json({ ok: true });
    })
  );

  api.use("/guilds/:guildId", g);
  app.use("/api", api);

  // ── Frontend statis ───────────────────────────────────────────────────────
  app.use(express.static(WEB_DIR));
  app.get("*", (_req, res) => res.sendFile(path.join(WEB_DIR, "index.html")));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error("[dashboard] Error:", err);
    res.status(500).json({ error: (err as Error)?.message ?? "Kesalahan internal" });
  });

  const baseUrl = await baseUrlOf();
  const host = process.env.DASHBOARD_HOST ?? "0.0.0.0";
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => resolve());
    server.on("error", reject);
  });
  console.log(`🌐 Dashboard berjalan di ${baseUrl} (port ${port})`);
  return { baseUrl, issueSetupCode };
}
