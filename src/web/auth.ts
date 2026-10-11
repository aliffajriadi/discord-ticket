import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction, Router } from "express";
import express from "express";

/**
 * Login dashboard via Discord OAuth2 (scope "identify").
 * Session disimpan di memori — restart bot = semua user perlu login ulang.
 */
export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

interface Session {
  user: SessionUser;
  expires: number;
}

const SESSION_TTL_MS = 7 * 86_400_000;
const sessions = new Map<string, Session>();

/** Membuat session baru dan mengembalikan id-nya (dipakai callback OAuth). */
export function createSession(user: SessionUser): string {
  const sid = randomBytes(32).toString("hex");
  sessions.set(sid, { user, expires: Date.now() + SESSION_TTL_MS });
  return sid;
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSessionUser(req: Request): SessionUser | null {
  const sid = parseCookies(req).sid;
  const s = sid ? sessions.get(sid) : undefined;
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(sid!);
    return null;
  }
  return s.user;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Belum login" });
  res.locals.user = user;
  next();
}

export interface OAuthOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

/** getOpts dipanggil tiap request: token/secret bisa diubah lewat web tanpa restart. */
export function authRouter(getOpts: () => Promise<OAuthOptions | null>): Router {
  const router = express.Router();
  const flags = (o: OAuthOptions) =>
    `Path=/; HttpOnly; SameSite=Lax${o.baseUrl.startsWith("https://") ? "; Secure" : ""}`;

  const safe =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  router.get("/login", safe(async (_req, res) => {
    const opts = await getOpts();
    if (!opts) return res.redirect("/");
    const redirectUri = `${opts.baseUrl}/auth/callback`;
    const cookieFlags = flags(opts);
    const state = randomBytes(16).toString("hex");
    res.setHeader("Set-Cookie", `oauth_state=${state}; Max-Age=600; ${cookieFlags}`);
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", opts.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "none");
    res.redirect(url.toString());
  }));

  router.get("/callback", safe(async (req, res) => {
    const opts = await getOpts();
    if (!opts) return res.redirect("/");
    const redirectUri = `${opts.baseUrl}/auth/callback`;
    const cookieFlags = flags(opts);
    const { code, state } = req.query as Record<string, string | undefined>;
    if (!code || !state || state !== parseCookies(req).oauth_state) {
      return res.status(400).send("Login gagal: state tidak valid. Silakan coba lagi.");
    }
    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}: ${await tokenRes.text()}`);
      const token = (await tokenRes.json()) as { access_token: string; token_type: string };

      const meRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `${token.token_type} ${token.access_token}` },
      });
      if (!meRes.ok) throw new Error(`users/@me ${meRes.status}`);
      const me = (await meRes.json()) as { id: string; username: string; global_name: string | null; avatar: string | null };

      const sid = createSession({ id: me.id, username: me.username, globalName: me.global_name, avatar: me.avatar });
      res.setHeader("Set-Cookie", [
        `sid=${sid}; Max-Age=${SESSION_TTL_MS / 1000}; ${cookieFlags}`,
        `oauth_state=; Max-Age=0; ${cookieFlags}`,
      ]);
      res.redirect("/");
    } catch (err) {
      console.error("[dashboard] OAuth gagal:", err);
      res.status(500).send("Login gagal. Cek Client Secret (Pengaturan Bot) dan Redirect URI di Developer Portal.");
    }
  }));

  router.post("/logout", safe(async (req, res) => {
    const cookieFlags = flags((await getOpts()) ?? { clientId: "", clientSecret: "", baseUrl: "" });
    const sid = parseCookies(req).sid;
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", `sid=; Max-Age=0; ${cookieFlags}`);
    res.json({ ok: true });
  }));

  // Bersihkan session kadaluarsa tiap jam
  setInterval(() => {
    const now = Date.now();
    for (const [sid, s] of sessions) if (s.expires < now) sessions.delete(sid);
  }, 3_600_000).unref();

  return router;
}
