// ═══════════════════════════════════════════════════════════════════════════
// Dashboard SPA — tanpa framework/build step. Semua data user di-escape (esc).
// ═══════════════════════════════════════════════════════════════════════════

const $app = document.getElementById("app");
const state = { me: null, guildId: null, meta: null, page: "overview", sidebarOpen: false };

// ── Utils ───────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, { method = "GET", body, noAuthRedirect = false } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "dashboard" },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401 && !noAuthRedirect) {
    state.me = null;
    renderLogin();
    throw new Error("Sesi berakhir, silakan login ulang");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const gapi = (path, opts) => api(`/guilds/${state.guildId}${path}`, opts);

function toast(msg, error = false) {
  const el = document.createElement("div");
  el.className = `toast${error ? " error" : ""}`;
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/** Jalankan aksi async pada tombol: disable selama proses + toast hasil. */
async function run(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
const fmtRel = (d) => {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} hari lalu`;
  return fmtDate(d);
};
const hex = (n) => `#${Number(n ?? 0x5865f2).toString(16).padStart(6, "0")}`;
const initial = (name) => esc((name || "?").trim().charAt(0).toUpperCase());

function avatarHtml(url, name, cls = "") {
  return url ? `<img class="avatar ${cls}" src="${esc(url)}" alt="">` : `<div class="avatar ${cls}">${initial(name)}</div>`;
}

const channelName = (id) => state.meta?.channels.find((c) => c.id === id)?.name ?? id;
const roleName = (id) => {
  const r = state.meta?.roles.find((r) => r.id === id);
  return r ? (r.everyone ? "@everyone" : r.name) : id;
};

function channelOptions(filter, selected, noneLabel) {
  const items = (state.meta?.channels ?? []).filter(filter);
  return (
    (noneLabel !== undefined ? `<option value="">${esc(noneLabel)}</option>` : "") +
    items
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${c.category ? "📁 " : "# "}${esc(c.name)}${c.parent ? ` — ${esc(c.parent)}` : ""}</option>`
      )
      .join("")
  );
}

function roleOptions(selected, noneLabel, { includeEveryone = false } = {}) {
  const items = (state.meta?.roles ?? []).filter((r) => !r.managed && (includeEveryone || !r.everyone));
  return (
    (noneLabel !== undefined ? `<option value="">${esc(noneLabel)}</option>` : "") +
    items.map((r) => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${esc(r.everyone ? "@everyone" : r.name)}</option>`).join("")
  );
}

/** Render subset markdown Discord untuk preview (input sudah di-escape lebih dulu). */
function md(text) {
  let s = esc(text);
  s = s.replace(/&lt;a?:(\w+):(\d+)&gt;/g, (_, n, id) => `<img src="https://cdn.discordapp.com/emojis/${id}.webp?size=48" alt=":${n}:" style="width:20px;height:20px;display:inline;vertical-align:-4px">`);
  s = s.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => `<span class="mention">@${esc(roleName(id))}</span>`);
  s = s.replace(/&lt;@!?(\d+)&gt;/g, () => `<span class="mention">@user</span>`);
  s = s.replace(/&lt;#(\d+)&gt;/g, (_, id) => `<span class="mention">#${esc(channelName(id))}</span>`);
  s = s.replace(/\{(\w+)\}/g, `<span class="mention">{$1}</span>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/__(.+?)__/g, "<u>$1</u>");
  s = s.replace(/\*(.+?)\*/g, "<i>$1</i>");
  s = s.replace(/~~(.+?)~~/g, "<s>$1</s>");
  s = s.replace(/^-# (.*)$/gm, '<span class="sub">$1</span>');
  s = s.replace(/^### (.*)$/gm, "<b>$1</b>").replace(/^## (.*)$/gm, '<b style="font-size:16px">$1</b>').replace(/^# (.*)$/gm, '<b style="font-size:18px">$1</b>');
  return s;
}

function embedPreview({ title, description, color, image, footer }) {
  return `<div class="preview"><div class="embed" style="border-left-color:${esc(color || "var(--accent)")}">
    ${title ? `<div class="e-title">${md(title)}</div>` : ""}
    <div class="e-desc">${md(description || "")}</div>
    ${image && /^https?:\/\//.test(image) ? `<img src="${esc(image)}" alt="">` : ""}
    ${footer ? `<div class="e-foot">${esc(footer)}</div>` : ""}
  </div></div>`;
}

// ── Modal ───────────────────────────────────────────────────────────────────
function openModal({ title, body, foot = "", wide = false, flush = false, onMount, onClose }) {
  const root = document.getElementById("modal-root");
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-sm" data-close aria-label="Tutup">✕</button></div>
    <div class="modal-body ${flush ? "flush" : ""}">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ""}
  </div>`;
  const close = () => {
    if (!el.isConnected) return;
    el.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  // Escape hanya menutup modal paling atas
  const onKey = (e) => e.key === "Escape" && root.lastElementChild === el && close();
  el.addEventListener("click", (e) => {
    if (e.target === el || e.target.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", onKey);
  root.appendChild(el);
  onMount?.(el.querySelector(".modal"), close);
  return close;
}

function confirmModal(title, message, danger = true) {
  return new Promise((resolve) => {
    let ok = false;
    openModal({
      title,
      body: `<p>${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Batal</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>Ya, lanjutkan</button>`,
      onMount: (m, close) => {
        m.querySelector("[data-ok]").onclick = () => {
          ok = true;
          close();
        };
      },
      onClose: () => resolve(ok),
    });
  });
}

// ── Routing ─────────────────────────────────────────────────────────────────
const PAGES = {
  overview: { label: "Ringkasan", ico: "📊", section: "Umum", render: renderOverview },
  tickets: { label: "Tiket", ico: "🎫", section: "Umum", render: renderTickets },
  cases: { label: "Moderasi", ico: "🔨", section: "Umum", render: renderCases },
  lockdown: { label: "Lockdown", ico: "🔒", section: "Channel", render: renderLockdown },
  automod: { label: "AutoMod", ico: "🛡️", section: "Channel", render: renderAutomod },
  sticky: { label: "Sticky Notes", ico: "📌", section: "Channel", render: renderSticky },
  reasons: { label: "Alasan & Panel", ico: "🏷️", section: "Konfigurasi", render: renderReasons },
  texts: { label: "Teks Bot", ico: "✏️", section: "Konfigurasi", render: renderTexts },
  emojis: { label: "Emoji", ico: "😀", section: "Konfigurasi", render: renderEmojis },
  settings: { label: "Pengaturan", ico: "⚙️", section: "Konfigurasi", render: renderSettings },
};

function parseHash() {
  const [, g, page] = location.hash.match(/^#\/g\/(\d+)\/?(\w+)?/) ?? [];
  return { guildId: g ?? null, page: PAGES[page] ? page : "overview" };
}

async function route() {
  if (!state.me) return;
  const { guildId, page } = parseHash();
  if (location.hash === "#/bot") return renderBotPage();
  if (!guildId) return renderPicker();
  if (guildId !== state.guildId || !state.meta) {
    state.guildId = guildId;
    state.meta = null;
    $app.innerHTML = `<div class="boot"><div class="spinner"></div></div>`;
    try {
      state.meta = await gapi("/meta");
    } catch (err) {
      toast(err.message, true);
      location.hash = "";
      return;
    }
  }
  state.page = page;
  state.sidebarOpen = false;
  renderShell();
  const main = document.getElementById("main");
  main.innerHTML = `<div class="boot" style="min-height:40vh"><div class="spinner"></div></div>`;
  try {
    await PAGES[page].render(main);
  } catch (err) {
    main.innerHTML = `<div class="card empty"><div class="big">⚠️</div>${esc(err.message)}</div>`;
  }
}
window.addEventListener("hashchange", route);

// ── Login / picker / shell ──────────────────────────────────────────────────
function renderLogin() {
  $app.innerHTML = `<div class="login"><div class="login-card">
    <div class="avatar lg round" style="margin:0 auto 16px;width:72px;height:72px;font-size:28px">🤖</div>
    <h1>Bot Dashboard</h1>
    <p>Kelola tiket, moderasi, lockdown, sticky notes, teks, dan emoji server kamu.</p>
    <a class="btn btn-primary btn-lg" href="/auth/login">Login dengan Discord</a>
  </div></div>`;
}

function renderPicker() {
  const { me } = state;
  $app.innerHTML = `<div class="picker">
    <h1>Pilih Server</h1>
    <p>Halo, <b>${esc(me.user.globalName || me.user.username)}</b>! Ini server yang bisa kamu kelola.</p>
    ${me.botStatus !== "online" ? `<div class="card card-pad" style="margin-bottom:16px;border-color:var(--orange)">⚠️ Bot sedang <b>${esc(me.botStatus)}</b>.${me.isAppOwner ? ' Periksa token di <a href="#/bot">Pengaturan Bot</a>.' : " Hubungi pemilik bot."}</div>` : ""}
    ${
      me.guilds.length
        ? `<div class="guilds">${me.guilds
            .map(
              (g) => `<a class="card guild-card" href="#/g/${g.id}/overview">
                ${avatarHtml(g.icon, g.name, "lg")}
                <div><b>${esc(g.name)}</b><div class="muted small">${g.members} member</div></div></a>`
            )
            .join("")}</div>`
        : `<div class="card empty"><div class="big">🔍</div>Belum ada server yang bisa kamu kelola.<br>Kamu perlu jadi owner, punya izin Manage Server, atau punya admin role bot.</div>`
    }
    <div style="text-align:center;margin-top:24px;display:flex;gap:10px;justify-content:center">
      <a class="btn" href="${esc(me.invite)}" target="_blank" rel="noopener">➕ Undang bot ke server</a>
      ${me.isAppOwner ? '<a class="btn" href="#/bot">🔑 Pengaturan Bot</a>' : ""}
      <button class="btn btn-ghost" id="logout">Keluar</button>
    </div>
  </div>`;
  document.getElementById("logout").onclick = logout;
}

async function logout() {
  await fetch("/auth/logout", { method: "POST" }).catch(() => null);
  state.me = null;
  renderLogin();
}

function renderShell() {
  const { me, meta } = state;
  const sections = {};
  for (const [key, p] of Object.entries(PAGES)) (sections[p.section] ??= []).push([key, p]);
  const userAvatar = me.user.avatar ? `https://cdn.discordapp.com/avatars/${me.user.id}/${me.user.avatar}.png?size=64` : null;

  $app.innerHTML = `
  <div class="topbar">
    <button class="btn btn-sm" id="menu-btn" aria-label="Menu">☰</button>
    ${avatarHtml(meta.guild.icon, meta.guild.name)}
    <b>${esc(meta.guild.name)}</b>
  </div>
  <div class="layout">
    <aside class="sidebar ${state.sidebarOpen ? "open" : ""}" id="sidebar">
      <a class="guild-switch" href="#">
        ${avatarHtml(meta.guild.icon, meta.guild.name)}
        <div class="name">${esc(meta.guild.name)}</div><span class="chev">⇅</span>
      </a>
      <nav class="nav">
        ${Object.entries(sections)
          .map(
            ([section, items]) =>
              `<div class="nav-section">${esc(section)}</div>` +
              items
                .map(([key, p]) => `<a href="#/g/${state.guildId}/${key}" class="${state.page === key ? "active" : ""}"><span class="ico">${p.ico}</span>${p.label}</a>`)
                .join("")
          )
          .join("")}
      </nav>
      <div class="user-box">
        ${avatarHtml(userAvatar, me.user.username, "round")}
        <div class="meta"><b>${esc(me.user.globalName || me.user.username)}</b><span>@${esc(me.user.username)}</span></div>
        <button class="btn btn-ghost btn-sm" id="theme-btn" title="Ganti tema">◐</button>
        <button class="btn btn-ghost btn-sm" id="logout" title="Keluar">⎋</button>
      </div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;

  document.getElementById("logout").onclick = logout;
  document.getElementById("menu-btn").onclick = () => document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("theme-btn").onclick = toggleTheme;
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("theme", root.dataset.theme);
  } catch {}
}

function pageHead(title, sub, actions = "") {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div><div style="display:flex;gap:8px">${actions}</div></div>`;
}

function pager(data, onPage) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const html = `<div class="pager"><span>${data.total} data • halaman ${data.page}/${pages}</span><div class="btns">
    <button class="btn btn-sm" data-pg="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>← Sebelumnya</button>
    <button class="btn btn-sm" data-pg="${data.page + 1}" ${data.page >= pages ? "disabled" : ""}>Berikutnya →</button></div></div>`;
  return { html, bind: (root) => root.querySelectorAll("[data-pg]").forEach((b) => (b.onclick = () => onPage(+b.dataset.pg))) };
}

const STATUS_BADGE = {
  OPEN: '<span class="badge green">● Terbuka</span>',
  CLOSED: '<span class="badge orange">● Ditutup</span>',
  DELETED: '<span class="badge">● Dihapus</span>',
};
const CASE_BADGE = {
  BAN: '<span class="badge red">🔨 Ban</span>',
  UNBAN: '<span class="badge green">🕊️ Unban</span>',
  KICK: '<span class="badge orange">👢 Kick</span>',
  TIMEOUT: '<span class="badge orange">🔇 Timeout</span>',
  UNTIMEOUT: '<span class="badge green">🔊 Untimeout</span>',
  WARN: '<span class="badge accent">⚠️ Warn</span>',
};
const fmtDuration = (ms) => {
  if (!ms) return "";
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return [d && `${d}h`, h && `${h}j`, m && `${m}m`].filter(Boolean).join(" ") || "<1m";
};

// ═══════════════════════════════════════════════════════════════════════════
// Pages
// ═══════════════════════════════════════════════════════════════════════════

async function renderOverview(main) {
  const d = await gapi("/overview");
  const s = d.stats;
  const max = Math.max(1, ...d.daily.map((x) => x.count));
  main.innerHTML = `
    ${pageHead("Ringkasan", `Aktivitas server ${state.meta.guild.name}`)}
    <div class="stats">
      ${[
        ["🎫", "Tiket terbuka", s.open, `${s.closed} ditutup • ${s.total} total`],
        ["🔨", "Kasus moderasi", s.cases, `${s.casesWeek} dalam 7 hari`],
        ["🔒", "Lockdown aktif", s.lockdowns, "channel/role"],
        ["📌", "Sticky notes", s.stickies, "channel"],
        ["👥", "Member", s.members.toLocaleString("id-ID"), "total"],
      ]
        .map(([ico, label, value, sub]) => `<div class="card stat"><div class="label">${ico} ${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`)
        .join("")}
    </div>
    <div class="card">
      <div class="card-head"><h2>Tiket dibuat • 14 hari terakhir</h2></div>
      <div class="bars">${d.daily
        .map(
          (x) => `<div class="bar" title="${x.date}: ${x.count} tiket"><i style="height:${(x.count / max) * 100}%"></i><span>${x.date.slice(8)}</span></div>`
        )
        .join("")}</div>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>Tiket terbaru</h2><a class="btn btn-sm" href="#/g/${state.guildId}/tickets">Lihat semua</a></div>
        ${
          d.recentTickets.length
            ? d.recentTickets
                .map(
                  (t) => `<div class="list-item"><div class="grow"><b>#${t.number ?? t.id}</b> ${esc(t.reasonLabel ?? "")}
                  <div class="muted small">${esc(t.creatorTag ?? t.creatorId)} • ${fmtRel(t.createdAt)}</div></div>${STATUS_BADGE[t.status] ?? ""}</div>`
                )
                .join("")
            : `<div class="empty">Belum ada tiket</div>`
        }
      </div>
      <div class="card">
        <div class="card-head"><h2>Moderasi terbaru</h2><a class="btn btn-sm" href="#/g/${state.guildId}/cases">Lihat semua</a></div>
        ${
          d.recentCases.length
            ? d.recentCases
                .map(
                  (c) => `<div class="list-item"><div class="grow"><b>${esc(c.targetTag ?? c.targetId)}</b>
                  <div class="muted small truncate">${esc(c.reason ?? "Tanpa alasan")} • ${fmtRel(c.createdAt)}</div></div>${CASE_BADGE[c.type] ?? ""}</div>`
                )
                .join("")
            : `<div class="empty">Belum ada kasus</div>`
        }
      </div>
    </div>`;
}

// ── Tickets ─────────────────────────────────────────────────────────────────
async function renderTickets(main, opts = { page: 1, status: "", q: "" }) {
  const qs = new URLSearchParams({ page: opts.page, status: opts.status, q: opts.q });
  const d = await gapi(`/tickets?${qs}`);
  const pg = pager(d, (page) => renderTickets(main, { ...opts, page }));
  main.innerHTML = `
    ${pageHead("Tiket", "Riwayat semua tiket beserta transkrip percakapan")}
    <div class="card">
      <div class="toolbar">
        <input class="input" id="q" placeholder="Cari nomor, user, atau alasan..." value="${esc(opts.q)}">
        <select class="select" id="status">
          ${[["", "Semua status"], ["OPEN", "Terbuka"], ["CLOSED", "Ditutup"], ["DELETED", "Dihapus"]]
            .map(([v, l]) => `<option value="${v}" ${opts.status === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
      </div>
      ${
        d.items.length
          ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Pembuat</th><th>Alasan</th><th>Status</th><th>Pesan</th><th>Dibuat</th></tr></thead><tbody>
          ${d.items
            .map(
              (t) => `<tr class="clickable" data-id="${t.id}">
              <td><b>#${t.number ?? t.id}</b></td>
              <td>${esc(t.creatorTag ?? t.creatorId)}</td>
              <td>${esc(t.reasonLabel ?? "-")}</td>
              <td>${STATUS_BADGE[t.status] ?? esc(t.status)}</td>
              <td class="muted">${t._count.messages}</td>
              <td class="muted small">${fmtDate(t.createdAt)}</td></tr>`
            )
            .join("")}</tbody></table></div>${pg.html}`
          : `<div class="empty"><div class="big">🎫</div>Tidak ada tiket</div>`
      }
    </div>`;
  pg.bind(main);
  let timer;
  main.querySelector("#q").oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => renderTickets(main, { ...opts, page: 1, q: e.target.value }).then(() => {
      const q = main.querySelector("#q");
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }), 350);
  };
  main.querySelector("#status").onchange = (e) => renderTickets(main, { ...opts, page: 1, status: e.target.value });
  main.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => openTicket(tr.dataset.id, () => renderTickets(main, opts))));
}

async function openTicket(id, refresh) {
  const { ticket: t, messages } = await gapi(`/tickets/${id}`);
  const body = messages.length
    ? `<div class="chat">${messages
        .map((m) => {
          const atts = m.attachments ? JSON.parse(m.attachments) : [];
          return `<div class="msg">
            <div class="avatar round" style="${m.authorBot ? "background:var(--green)" : ""}">${initial(m.authorTag ?? m.authorId)}</div>
            <div class="body">
              <div class="head"><b>${esc(m.authorTag ?? m.authorId)}</b>${m.authorBot ? '<span class="badge accent">BOT</span>' : ""}<span class="muted small">${fmtDate(m.createdAt)}</span></div>
              <div class="content">${md(m.content)}</div>
              ${atts.length ? `<div class="atts">${atts.map((u) => (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt=""></a>` : `<a href="${esc(u)}" target="_blank" rel="noopener">📎 Lampiran</a>`)).join("")}</div>` : ""}
            </div></div>`;
        })
        .join("")}</div>`
    : `<div class="empty"><div class="big">💬</div>Belum ada pesan tersimpan</div>`;

  openModal({
    title: `Tiket #${t.number ?? t.id} — ${t.reasonLabel ?? "Tanpa alasan"}`,
    wide: true,
    flush: true,
    body: `<div class="toolbar" style="justify-content:space-between;align-items:center">
        <div class="chips">${STATUS_BADGE[t.status] ?? ""}<span class="badge">👤 ${esc(t.creatorTag ?? t.creatorId)}</span><span class="badge">📅 ${fmtDate(t.createdAt)}</span>${t.closedAt ? `<span class="badge">🔒 ${fmtDate(t.closedAt)}</span>` : ""}${t.claimedById ? '<span class="badge accent">🙋 Diklaim</span>' : ""}</div>
      </div>${body}`,
    foot: `<a class="btn" href="/api/guilds/${state.guildId}/tickets/${t.id}/transcript">⬇ Unduh transkrip HTML</a>
      ${t.status === "OPEN" ? '<button class="btn" data-act="close">🔒 Tutup tiket</button>' : ""}
      ${t.status !== "DELETED" ? '<button class="btn btn-danger" data-act="delete">🗑️ Hapus channel</button>' : ""}`,
    onMount: (m, close) => {
      const chat = m.querySelector(".chat");
      if (chat) chat.scrollTop = chat.scrollHeight;
      m.querySelectorAll("[data-act]").forEach(
        (b) =>
          (b.onclick = async () => {
            const act = b.dataset.act;
            if (act === "delete" && !(await confirmModal("Hapus tiket?", "Channel tiket akan dihapus permanen dari Discord. Riwayat pesan tetap tersimpan di dashboard."))) return;
            const ok = await run(b, () => gapi(`/tickets/${t.id}/${act}`, { method: "POST" }), act === "close" ? "Tiket ditutup" : "Tiket dihapus");
            if (ok) {
              close();
              refresh?.();
            }
          })
      );
    },
  });
}

// ── Cases ───────────────────────────────────────────────────────────────────
async function renderCases(main, opts = { page: 1, type: "", q: "" }) {
  const qs = new URLSearchParams({ page: opts.page, type: opts.type, q: opts.q });
  const d = await gapi(`/cases?${qs}`);
  const pg = pager(d, (page) => renderCases(main, { ...opts, page }));
  main.innerHTML = `
    ${pageHead("Moderasi", "Riwayat ban, kick, timeout, dan warn. Gunakan /ban, /kick, /timeout, /warn di Discord.")}
    <div class="card">
      <div class="toolbar">
        <input class="input" id="q" placeholder="Cari user, ID, moderator, alasan, atau nomor kasus..." value="${esc(opts.q)}">
        <select class="select" id="type">
          ${[["", "Semua tipe"], ...Object.keys(CASE_BADGE).map((k) => [k, k])]
            .map(([v, l]) => `<option value="${v}" ${opts.type === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
      </div>
      ${
        d.items.length
          ? `<div class="table-wrap"><table><thead><tr><th>Kasus</th><th>Tipe</th><th>User</th><th>Alasan</th><th>Moderator</th><th>Waktu</th><th></th></tr></thead><tbody>
          ${d.items
            .map(
              (c) => `<tr style="${c.active ? "" : "opacity:.5"}">
              <td><b>#${c.number}</b></td>
              <td>${CASE_BADGE[c.type] ?? esc(c.type)}${c.durationMs ? ` <span class="muted small">${fmtDuration(c.durationMs)}</span>` : ""}</td>
              <td>${esc(c.targetTag ?? "")}<div class="mono muted">${c.targetId}</div></td>
              <td class="truncate" title="${esc(c.reason ?? "")}">${esc(c.reason ?? "-")}</td>
              <td class="muted">${esc(c.moderatorTag ?? c.moderatorId)}</td>
              <td class="muted small">${fmtDate(c.createdAt)}</td>
              <td><button class="btn btn-sm ${c.active ? "btn-danger" : ""}" data-toggle="${c.id}" data-active="${c.active}">${c.active ? "Cabut" : "Pulihkan"}</button></td></tr>`
            )
            .join("")}</tbody></table></div>${pg.html}`
          : `<div class="empty"><div class="big">🕊️</div>Belum ada kasus moderasi</div>`
      }
    </div>`;
  pg.bind(main);
  let timer;
  main.querySelector("#q").oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => renderCases(main, { ...opts, page: 1, q: e.target.value }).then(() => {
      const q = main.querySelector("#q");
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }), 350);
  };
  main.querySelector("#type").onchange = (e) => renderCases(main, { ...opts, page: 1, type: e.target.value });
  main.querySelectorAll("[data-toggle]").forEach(
    (b) =>
      (b.onclick = async () => {
        const active = b.dataset.active !== "true";
        if (await run(b, () => gapi(`/cases/${b.dataset.toggle}`, { method: "PATCH", body: { active } }), active ? "Kasus dipulihkan" : "Kasus dicabut")) {
          renderCases(main, opts);
        }
      })
  );
}

// ── Lockdown ────────────────────────────────────────────────────────────────
async function renderLockdown(main) {
  const locks = await gapi("/lockdowns");
  const opts = state.meta.lockOptions;
  const defaults = ["send_messages", "create_threads", "send_in_threads", "add_reactions"];
  main.innerHTML = `
    ${pageHead("Lockdown", "Batasi izin tertentu untuk sebuah role di channel. Izin lama otomatis dipulihkan saat dibuka.")}
    <div class="card">
      <div class="card-head"><h2>Kunci channel</h2></div>
      <div class="card-pad stack">
        <div class="form-grid">
          <div class="field"><label>Channel</label><select class="select" id="l-channel">${channelOptions((c) => c.lockable)}</select></div>
          <div class="field"><label>Role yang dibatasi</label><select class="select" id="l-role">${roleOptions(state.guildId, undefined, { includeEveryone: true })}</select></div>
          <div class="field"><label>Buka otomatis (menit)</label><input class="input" id="l-dur" type="number" min="0" placeholder="Kosongkan = manual"></div>
        </div>
        <div class="field"><label>Izin yang dikunci</label>
          <div class="checks">${opts
            .map((o) => `<label class="check"><input type="checkbox" value="${o.key}" ${defaults.includes(o.key) ? "checked" : ""}> ${esc(o.label)}</label>`)
            .join("")}</div>
        </div>
        <div class="field"><label>Alasan</label><input class="input" id="l-reason" maxlength="300" placeholder="Opsional, tampil di pengumuman"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <label class="check" style="border:none;padding:0"><input type="checkbox" id="l-announce" checked> Kirim pengumuman di channel</label>
          <button class="btn btn-primary" id="l-go">🔒 Kunci sekarang</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Sedang dikunci</h2><span class="badge ${locks.length ? "red" : ""}">${locks.length}</span></div>
      ${
        locks.length
          ? locks
              .map((l) => {
                const prev = Object.keys(JSON.parse(l.previous));
                return `<div class="list-item"><div class="grow">
                  <b>#${esc(channelName(l.channelId))}</b> <span class="muted">•</span> ${esc(roleName(l.roleId))}
                  <div class="muted small">${esc(l.reason ?? "Tanpa alasan")} • ${fmtRel(l.createdAt)}${l.unlockAt ? ` • buka otomatis ${fmtDate(l.unlockAt)}` : ""}</div>
                  <div class="chips" style="margin-top:6px">${prev.map((p) => `<span class="badge">${esc(p)}</span>`).join("")}</div>
                </div><button class="btn btn-sm" data-unlock="${l.id}">🔓 Buka</button></div>`;
              })
              .join("")
          : `<div class="empty"><div class="big">🔓</div>Tidak ada channel yang dikunci</div>`
      }
    </div>`;

  main.querySelector("#l-go").onclick = async (e) => {
    const options = [...main.querySelectorAll(".checks input:checked")].map((i) => i.value);
    const ok = await run(
      e.currentTarget,
      () =>
        gapi("/lockdowns", {
          method: "POST",
          body: {
            channelId: main.querySelector("#l-channel").value,
            roleId: main.querySelector("#l-role").value,
            options,
            durationMinutes: Number(main.querySelector("#l-dur").value) || 0,
            reason: main.querySelector("#l-reason").value,
            announce: main.querySelector("#l-announce").checked,
          },
        }),
      "Channel dikunci"
    );
    if (ok) renderLockdown(main);
  };
  main.querySelectorAll("[data-unlock]").forEach(
    (b) => (b.onclick = async () => (await run(b, () => gapi(`/lockdowns/${b.dataset.unlock}`, { method: "DELETE" }), "Channel dibuka")) && renderLockdown(main))
  );
}

// ── AutoMod ─────────────────────────────────────────────────────────────────
async function renderAutomod(main) {
  const { settings: s, limits } = await gapi("/automod");
  const num = (id, label, key, hint) => `<div class="field"><label for="${id}">${label}</label>
    <input class="input" id="${id}" type="number" min="${limits[key].offAllowed ? 0 : limits[key].min}" max="${limits[key].max}" value="${s[key]}">
    <span class="hint">${hint}</span></div>`;
  main.innerHTML = `
    ${pageHead("AutoMod", "Hapus pesan spam otomatis, lalu hukum user yang mengulang")}
    <div class="card"><div class="card-pad stack">
      <label class="check"><input type="checkbox" id="a-on" ${s.enabled ? "checked" : ""}> <b>Aktifkan AutoMod</b></label>
      <div class="form-grid">
        ${num("a-chars", "Maks karakter per pesan", "maxChars", `0 = mati • ${limits.maxChars.min}–${limits.maxChars.max}`)}
        ${num("a-lines", "Maks baris per pesan", "maxLines", `0 = mati • ${limits.maxLines.min}–${limits.maxLines.max}`)}
        ${num("a-ment", "Maks mention per pesan", "maxMentions", `0 = mati • ${limits.maxMentions.min}–${limits.maxMentions.max}`)}
      </div>
    </div></div>
    <div class="card"><div class="card-head"><h2>Channel yang dijaga</h2><span class="badge accent" id="a-count"></span></div><div class="card-pad stack">
      <p class="muted small">AutoMod hanya berjalan di channel yang dicentang (termasuk thread di dalamnya). Jika tidak ada yang dicentang, AutoMod tidak berjalan di mana pun.</p>
      <input class="input" id="a-find" placeholder="Cari channel...">
      <div class="checks" id="a-chans" style="max-height:280px;overflow-y:auto">${state.meta.channels
        .filter((c) => c.text)
        .map((c) => `<label class="check" data-name="${esc(c.name.toLowerCase())}"><input type="checkbox" value="${c.id}" ${s.channelIds.includes(c.id) ? "checked" : ""}> # ${esc(c.name)}${c.parent ? `<span class="muted small"> — ${esc(c.parent)}</span>` : ""}</label>`)
        .join("")}</div>
      <div style="display:flex;gap:8px"><button class="btn btn-sm" id="a-all">Pilih semua</button><button class="btn btn-sm" id="a-none">Kosongkan</button></div>
    </div></div>
    <div class="card"><div class="card-head"><h2>Hukuman</h2></div><div class="card-pad stack">
      <div class="form-grid">
        <div class="field"><label for="a-action">Tindakan</label><select class="select" id="a-action">
          ${[["NONE", "Hanya hapus pesan"], ["TIMEOUT", "Timeout"], ["KICK", "Kick"], ["BAN", "Ban"]].map(([v, l]) => `<option value="${v}" ${s.action === v ? "selected" : ""}>${l}</option>`).join("")}
        </select></div>
        ${num("a-strikes", "Pelanggaran sebelum dihukum", "strikes", "Pelanggaran pertama dst hanya dihapus + diperingatkan")}
        ${num("a-window", "Rentang hitungan (detik)", "windowSec", "Pelanggaran dihitung dalam rentang ini")}
        ${num("a-timeout", "Durasi timeout (menit)", "timeoutMin", "Dipakai jika tindakan = Timeout")}
      </div>
      <p class="muted small">Dikecualikan: staff (izin kelola pesan / server / moderasi), admin role bot, dan bot lain. Role bot harus lebih tinggi dari role user yang dihukum. Ban juga menghapus pesan user 1 jam terakhir.</p>
    </div></div>
    <div class="save-bar"><button class="btn btn-primary" id="a-save">💾 Simpan</button></div>`;
  const $ = (id) => main.querySelector(id);
  const boxes = () => [...main.querySelectorAll("#a-chans input")];
  const count = () => ($("#a-count").textContent = `${boxes().filter((b) => b.checked).length} dipilih`);
  main.querySelector("#a-chans").onchange = count;
  $("#a-all").onclick = () => (boxes().forEach((b) => (b.checked = true)), count());
  $("#a-none").onclick = () => (boxes().forEach((b) => (b.checked = false)), count());
  $("#a-find").oninput = (e) =>
    main.querySelectorAll("#a-chans .check").forEach((el) => (el.style.display = el.dataset.name.includes(e.target.value.toLowerCase()) ? "" : "none"));
  count();
  $("#a-save").onclick = (e) =>
    run(
      e.currentTarget,
      () =>
        gapi("/automod", {
          method: "PUT",
          body: {
            enabled: $("#a-on").checked,
            maxChars: Number($("#a-chars").value),
            maxLines: Number($("#a-lines").value),
            maxMentions: Number($("#a-ment").value),
            strikes: Number($("#a-strikes").value),
            windowSec: Number($("#a-window").value),
            timeoutMin: Number($("#a-timeout").value),
            action: $("#a-action").value,
            channelIds: boxes().filter((b) => b.checked).map((b) => b.value),
          },
        }),
      "AutoMod disimpan"
    );
}

// ── Sticky ──────────────────────────────────────────────────────────────────
async function renderSticky(main) {
  const stickies = await gapi("/stickies");
  main.innerHTML = `
    ${pageHead("Sticky Notes", "Pesan yang selalu muncul di paling bawah channel publik", '<button class="btn btn-primary" id="new">➕ Sticky baru</button>')}
    ${
      stickies.length
        ? `<div class="grid-2">${stickies
            .map(
              (s) => `<div class="card">
              <div class="card-head"><h2># ${esc(channelName(s.channelId))}</h2>${s.enabled ? '<span class="badge green">● Aktif</span>' : '<span class="badge">⏸ Dijeda</span>'}</div>
              <div class="card-pad">${embedPreview({ title: s.title ? `📌 ${s.title}` : "", description: s.content, color: s.color != null ? hex(s.color) : null, image: s.imageUrl, footer: "📌 Pesan tersemat" })}</div>
              <div class="modal-foot" style="border-top:1px solid var(--border)">
                <button class="btn btn-sm btn-danger" data-del="${s.channelId}">Hapus</button>
                <button class="btn btn-sm" data-toggle="${s.channelId}">${s.enabled ? "Jeda" : "Aktifkan"}</button>
                <button class="btn btn-sm btn-primary" data-edit="${s.channelId}">Edit</button>
              </div></div>`
            )
            .join("")}</div>`
        : `<div class="card empty"><div class="big">📌</div>Belum ada sticky note.<br>Buat di sini atau dengan <code>/sticky set</code> di Discord.</div>`
    }`;
  const byId = Object.fromEntries(stickies.map((s) => [s.channelId, s]));
  main.querySelector("#new").onclick = () => stickyForm(null, () => renderSticky(main));
  main.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => stickyForm(byId[b.dataset.edit], () => renderSticky(main))));
  main.querySelectorAll("[data-toggle]").forEach(
    (b) =>
      (b.onclick = async () => {
        const s = byId[b.dataset.toggle];
        const ok = await run(b, () => gapi(`/stickies/${s.channelId}`, { method: "PUT", body: { ...s, color: s.color, enabled: !s.enabled } }), s.enabled ? "Sticky dijeda" : "Sticky diaktifkan");
        if (ok) renderSticky(main);
      })
  );
  main.querySelectorAll("[data-del]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!(await confirmModal("Hapus sticky?", "Pesan sticky akan dihapus dari channel."))) return;
        if (await run(b, () => gapi(`/stickies/${b.dataset.del}`, { method: "DELETE" }), "Sticky dihapus")) renderSticky(main);
      })
  );
}

function stickyForm(s, done) {
  openModal({
    title: s ? "Edit sticky note" : "Sticky note baru",
    wide: true,
    body: `<div class="grid-2">
      <div class="stack">
        <div class="field"><label>Channel</label><select class="select" id="s-ch" ${s ? "disabled" : ""}>${channelOptions((c) => c.text, s?.channelId)}</select></div>
        <div class="field"><label>Judul</label><input class="input" id="s-title" maxlength="200" value="${esc(s?.title ?? "")}" placeholder="Opsional"></div>
        <div class="field"><label>Isi pesan</label><textarea class="textarea" id="s-content" rows="7" maxlength="4000" placeholder="Mendukung **tebal**, *miring*, \`kode\`, -# teks kecil">${esc(s?.content ?? "")}</textarea></div>
        <div class="form-grid">
          <div class="field"><label>Warna</label><div class="color-input"><input type="color" id="s-color" value="${s?.color != null ? hex(s.color) : "#5865f2"}"><input class="input" id="s-color-t" value="${s?.color != null ? hex(s.color) : "#5865f2"}"></div></div>
          <div class="field"><label>URL gambar</label><input class="input" id="s-img" value="${esc(s?.imageUrl ?? "")}" placeholder="https://..."></div>
        </div>
      </div>
      <div class="field"><label>Preview</label><div id="s-prev"></div></div>
    </div>`,
    foot: `<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="s-save">Simpan & kirim</button>`,
    onMount: (m, close) => {
      const $ = (id) => m.querySelector(id);
      const update = () =>
        ($("#s-prev").innerHTML = embedPreview({
          title: $("#s-title").value ? `📌 ${$("#s-title").value}` : "",
          description: $("#s-content").value || "*Isi pesan...*",
          color: $("#s-color").value,
          image: $("#s-img").value,
          footer: "📌 Pesan tersemat",
        }));
      $("#s-color").oninput = () => (($("#s-color-t").value = $("#s-color").value), update());
      $("#s-color-t").oninput = () => /^#[0-9a-f]{6}$/i.test($("#s-color-t").value) && (($("#s-color").value = $("#s-color-t").value), update());
      ["#s-title", "#s-content", "#s-img"].forEach((id) => ($(id).oninput = update));
      update();
      $("#s-save").onclick = async (e) => {
        const ok = await run(
          e.currentTarget,
          () =>
            gapi(`/stickies/${$("#s-ch").value}`, {
              method: "PUT",
              body: { title: $("#s-title").value, content: $("#s-content").value, color: $("#s-color").value, imageUrl: $("#s-img").value, enabled: s?.enabled ?? true },
            }),
          "Sticky disimpan"
        );
        if (ok) {
          close();
          done();
        }
      };
    },
  });
}

// ── Reasons & panel ─────────────────────────────────────────────────────────
async function renderReasons(main) {
  const reasons = await gapi("/reasons");
  main.innerHTML = `
    ${pageHead("Alasan & Panel", "Kategori tiket dan panel pembuatan tiket", '<button class="btn" id="panel">📨 Kirim panel</button><button class="btn btn-primary" id="new">➕ Alasan baru</button>')}
    <div class="card">
      ${
        reasons.length
          ? `<div class="table-wrap"><table><thead><tr><th>Label</th><th>Value</th><th>Kategori</th><th>Role staff</th><th></th></tr></thead><tbody>
          ${reasons
            .map(
              (r) => `<tr><td><b>${esc(r.label)}</b>${r.description ? `<div class="muted small">${esc(r.description)}</div>` : ""}</td>
              <td class="mono">${esc(r.value)}</td>
              <td>📁 ${esc(channelName(r.categoryId))}</td>
              <td><span class="badge accent">@${esc(roleName(r.supportRoleId))}</span></td>
              <td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-edit="${r.id}">Edit</button> <button class="btn btn-sm btn-danger" data-del="${r.id}">Hapus</button></td></tr>`
            )
            .join("")}</tbody></table></div>`
          : `<div class="empty"><div class="big">🏷️</div>Belum ada alasan tiket. Tambahkan minimal satu sebelum membuat panel.</div>`
      }
    </div>`;
  const byId = Object.fromEntries(reasons.map((r) => [r.id, r]));
  main.querySelector("#new").onclick = () => reasonForm(null, () => renderReasons(main));
  main.querySelector("#panel").onclick = () => panelForm();
  main.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => reasonForm(byId[b.dataset.edit], () => renderReasons(main))));
  main.querySelectorAll("[data-del]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!(await confirmModal("Hapus alasan?", `Alasan "${byId[b.dataset.del].label}" akan dihapus. Panel lama perlu dikirim ulang.`))) return;
        if (await run(b, () => gapi(`/reasons/${b.dataset.del}`, { method: "DELETE" }), "Alasan dihapus")) renderReasons(main);
      })
  );
}

function reasonForm(r, done) {
  openModal({
    title: r ? "Edit alasan" : "Alasan baru",
    body: `<div class="stack">
      <div class="form-grid">
        <div class="field"><label>Label</label><input class="input" id="r-label" maxlength="100" value="${esc(r?.label ?? "")}" placeholder="Bantuan Teknis"></div>
        <div class="field"><label>Value (ID unik)</label><input class="input mono" id="r-value" maxlength="100" value="${esc(r?.value ?? "")}" placeholder="tech_support"></div>
      </div>
      <div class="field"><label>Deskripsi</label><input class="input" id="r-desc" maxlength="100" value="${esc(r?.description ?? "")}" placeholder="Opsional, tampil di dropdown"></div>
      <div class="form-grid">
        <div class="field"><label>Kategori channel</label><select class="select" id="r-cat">${channelOptions((c) => c.category, r?.categoryId)}</select></div>
        <div class="field"><label>Role staff</label><select class="select" id="r-role">${roleOptions(r?.supportRoleId)}</select></div>
      </div></div>`,
    foot: `<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="r-save">Simpan</button>`,
    onMount: (m, close) => {
      const $ = (id) => m.querySelector(id);
      if (!r) $("#r-label").oninput = () => ($("#r-value").value = $("#r-label").value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
      $("#r-save").onclick = async (e) => {
        const body = { label: $("#r-label").value, value: $("#r-value").value, description: $("#r-desc").value, categoryId: $("#r-cat").value, supportRoleId: $("#r-role").value };
        const ok = await run(e.currentTarget, () => gapi(r ? `/reasons/${r.id}` : "/reasons", { method: r ? "PUT" : "POST", body }), "Alasan disimpan");
        if (ok) {
          close();
          done();
        }
      };
    },
  });
}

function panelForm() {
  openModal({
    title: "Kirim panel tiket",
    body: `<div class="stack">
      <div class="form-grid">
        <div class="field"><label>Channel</label><select class="select" id="p-ch">${channelOptions((c) => c.type === 0)}</select></div>
        <div class="field"><label>Tipe</label><select class="select" id="p-type"><option value="button">Tombol</option><option value="dropdown">Dropdown</option></select></div>
      </div>
      <div class="field"><label>Judul</label><input class="input" id="p-title" placeholder="Kosongkan = pakai teks default"></div>
      <div class="field"><label>Deskripsi</label><textarea class="textarea" id="p-desc" placeholder="Kosongkan = pakai teks default"></textarea></div>
      <p class="muted small">Teks default bisa diubah di menu <b>Teks Bot</b>.</p></div>`,
    foot: `<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="p-send">Kirim</button>`,
    onMount: (m, close) => {
      const $ = (id) => m.querySelector(id);
      $("#p-send").onclick = async (e) => {
        const ok = await run(
          e.currentTarget,
          () => gapi("/panel", { method: "POST", body: { channelId: $("#p-ch").value, type: $("#p-type").value, title: $("#p-title").value, description: $("#p-desc").value } }),
          "Panel terkirim"
        );
        if (ok) close();
      };
    },
  });
}

// ── Texts ───────────────────────────────────────────────────────────────────
async function renderTexts(main) {
  const d = await gapi("/texts");
  const keys = Object.keys(d.defaults);
  const PLACEHOLDERS = ["{user}", "{server}", "{reason}", "{number}", "{staff}", "{action}"];
  main.innerHTML = `
    ${pageHead("Teks Bot", "Ubah semua pesan yang dikirim bot. Kosongkan untuk memakai teks default.")}
    <div class="card" style="margin-bottom:16px"><div class="card-pad">
      <div class="field"><label>Placeholder tersedia</label><div class="chips">${PLACEHOLDERS.map((p) => `<span class="chip" data-ph="${p}">${p}</span>`).join("")}</div>
      <span class="hint">Klik placeholder untuk menyisipkan ke kolom yang sedang aktif. Markdown Discord didukung.</span></div>
    </div></div>
    <div class="card">${keys
      .map((k) => {
        const val = d.values[k] ?? "";
        const long = d.defaults[k].length > 60 || d.defaults[k].includes("\n");
        return `<div class="text-row">
          <div class="top"><label for="t-${k}"><b>${esc(d.labels[k])}</b></label><code>${k}</code></div>
          ${
            long
              ? `<textarea class="textarea" id="t-${k}" data-key="${k}" rows="3" placeholder="${esc(d.defaults[k])}">${esc(val)}</textarea>`
              : `<input class="input" id="t-${k}" data-key="${k}" value="${esc(val)}" placeholder="${esc(d.defaults[k])}">`
          }
        </div>`;
      })
      .join("")}</div>
    <div class="save-bar"><button class="btn" id="reset">Reset semua ke default</button><button class="btn btn-primary" id="save">💾 Simpan perubahan</button></div>`;

  let last = null;
  main.querySelectorAll("[data-key]").forEach((el) => el.addEventListener("focus", () => (last = el)));
  main.querySelectorAll("[data-ph]").forEach(
    (chip) =>
      (chip.onmousedown = (e) => {
        e.preventDefault();
        if (!last) return toast("Klik dulu kolom teks yang ingin diisi", true);
        const { selectionStart: a, selectionEnd: b, value } = last;
        last.value = value.slice(0, a) + chip.dataset.ph + value.slice(b);
        last.setSelectionRange(a + chip.dataset.ph.length, a + chip.dataset.ph.length);
      })
  );
  const collect = () => Object.fromEntries([...main.querySelectorAll("[data-key]")].map((el) => [el.dataset.key, el.value]));
  main.querySelector("#save").onclick = (e) => run(e.currentTarget, () => gapi("/texts", { method: "PUT", body: collect() }), "Teks disimpan");
  main.querySelector("#reset").onclick = async (e) => {
    if (!(await confirmModal("Reset teks?", "Semua teks akan kembali ke default."))) return;
    if (await run(e.currentTarget, () => gapi("/texts", { method: "PUT", body: {} }), "Teks direset")) renderTexts(main);
  };
}

// ── Emojis ──────────────────────────────────────────────────────────────────
function emojiPreviewHtml(value) {
  const m = /^<(a)?:(\w+):(\d+)>$/.exec(value ?? "");
  return m ? `<img src="https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? "gif" : "webp"}?size=48" alt="">` : esc(value);
}

async function renderEmojis(main) {
  const d = await gapi("/emojis");
  const keys = Object.keys(d.defaults);
  const options = (key) => {
    const current = d.values[key] ?? "";
    return `<option value="">Default (${esc(d.defaults[key])})</option>` +
      d.guildEmojis.map((e) => `<option value="${esc(e.str)}" ${current === e.str ? "selected" : ""}>:${esc(e.name)}:</option>`).join("") +
      (current && !d.guildEmojis.some((e) => e.str === current) ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : "");
  };

  main.innerHTML = `
    ${pageHead("Emoji", "Upload emoji custom ke server, lalu pakai untuk tombol dan pesan bot")}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Upload emoji</h2></div>
        <div class="card-pad stack">
          <label class="dropzone" id="drop"><input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
            <div id="drop-inner">📁 <b>Klik atau seret gambar ke sini</b><br><span class="small">PNG, JPG, GIF, WEBP • maks 256 KB • ideal 128×128</span></div>
          </label>
          <div class="field"><label>Nama emoji</label><input class="input mono" id="ename" maxlength="32" placeholder="contoh: tiket_buka"></div>
          <div class="field"><label>Langsung pakai untuk</label><select class="select" id="eassign"><option value="">— Jangan dipasang —</option>${keys.map((k) => `<option value="${k}">${esc(d.labels[k])}</option>`).join("")}</select></div>
          <button class="btn btn-primary" id="upload" disabled>⬆ Upload ke server</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Emoji server</h2><span class="badge">${d.guildEmojis.length}</span></div>
        ${
          d.guildEmojis.length
            ? `<div class="emoji-grid">${d.guildEmojis
                .map((e) => `<div class="emoji-tile"><img src="${esc(e.url)}" alt=""><span title=":${esc(e.name)}:">:${esc(e.name)}:</span><button class="btn btn-sm btn-danger del" data-del="${e.id}" title="Hapus">✕</button></div>`)
                .join("")}</div>`
            : `<div class="empty">Server belum punya emoji custom</div>`
        }
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Emoji yang dipakai bot</h2><span class="muted small">Pilih emoji server, atau ketik emoji unicode</span></div>
      ${keys
        .map(
          (k) => `<div class="emoji-row">
          <div class="emoji-preview" id="pv-${k}">${emojiPreviewHtml(d.values[k] ?? d.defaults[k])}</div>
          <div><b>${esc(d.labels[k])}</b><div class="mono muted">${k}</div></div>
          <div style="display:flex;gap:6px"><select class="select" data-emoji="${k}">${options(k)}</select><input class="input" data-uni="${k}" style="width:64px;text-align:center" maxlength="8" placeholder="✏️" title="Atau ketik emoji unicode"></div>
        </div>`
        )
        .join("")}
    </div>
    <div class="save-bar"><button class="btn btn-primary" id="save">💾 Simpan emoji</button></div>`;

  // Upload
  let dataUrl = null;
  const $ = (id) => main.querySelector(id);
  const drop = $("#drop");
  const readFile = (file) => {
    if (!file) return;
    if (file.size > 256 * 1024) return toast("Ukuran maksimal 256 KB", true);
    const reader = new FileReader();
    reader.onload = () => {
      dataUrl = reader.result;
      $("#drop-inner").innerHTML = `<img src="${esc(dataUrl)}" alt=""><span class="small">${esc(file.name)} • ${Math.round(file.size / 1024)} KB</span>`;
      if (!$("#ename").value) $("#ename").value = file.name.replace(/\.\w+$/, "").replace(/[^\w]/g, "_").slice(0, 32);
      $("#upload").disabled = false;
    };
    reader.readAsDataURL(file);
  };
  $("#file").onchange = (e) => readFile(e.target.files[0]);
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add("drag"));
  drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = (e) => (e.preventDefault(), drop.classList.remove("drag"), readFile(e.dataTransfer.files[0]));
  $("#upload").onclick = async (e) => {
    const emoji = await run(e.currentTarget, () => gapi("/emojis/upload", { method: "POST", body: { name: $("#ename").value, image: dataUrl } }), "Emoji berhasil diupload");
    if (!emoji) return;
    const assign = $("#eassign").value;
    if (assign) await run(null, () => gapi("/emojis", { method: "PUT", body: { ...d.values, [assign]: emoji.str } }), "Emoji dipasang");
    renderEmojis(main);
  };

  // Mapping
  main.querySelectorAll("[data-emoji]").forEach(
    (sel) => (sel.onchange = () => (main.querySelector(`#pv-${sel.dataset.emoji}`).innerHTML = emojiPreviewHtml(sel.value || d.defaults[sel.dataset.emoji])))
  );
  main.querySelectorAll("[data-uni]").forEach(
    (inp) => (inp.oninput = () => (main.querySelector(`#pv-${inp.dataset.uni}`).innerHTML = emojiPreviewHtml(inp.value || main.querySelector(`[data-emoji="${inp.dataset.uni}"]`).value || d.defaults[inp.dataset.uni])))
  );
  $("#save").onclick = (e) => {
    const body = {};
    for (const k of keys) body[k] = main.querySelector(`[data-uni="${k}"]`).value.trim() || main.querySelector(`[data-emoji="${k}"]`).value;
    run(e.currentTarget, () => gapi("/emojis", { method: "PUT", body }), "Emoji disimpan").then((ok) => ok && renderEmojis(main));
  };
  main.querySelectorAll("[data-del]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!(await confirmModal("Hapus emoji?", "Emoji akan dihapus dari server Discord."))) return;
        if (await run(b, () => gapi(`/emojis/guild/${b.dataset.del}`, { method: "DELETE" }), "Emoji dihapus")) renderEmojis(main);
      })
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
async function renderSettings(main) {
  const s = await gapi("/settings");
  const isOwner = state.meta.isOwner;
  main.innerHTML = `
    ${pageHead("Pengaturan", "Konfigurasi dasar bot untuk server ini")}
    <div class="card"><div class="card-head"><h2>Logging</h2></div><div class="card-pad">
      <div class="form-grid">
        <div class="field"><label>Log tiket</label><select class="select" id="log">${channelOptions((c) => c.text, s.logChannelId, "— Nonaktif —")}</select><span class="hint">Tiket dibuat, ditutup, dihapus, transkrip gagal</span></div>
        <div class="field"><label>Log moderasi</label><select class="select" id="modlog">${channelOptions((c) => c.text, s.modLogChannelId, "— Pakai log tiket —")}</select><span class="hint">Ban, kick, timeout, warn, lockdown</span></div>
      </div></div></div>
    <div class="card"><div class="card-head"><h2>Akses</h2></div><div class="card-pad">
      <div class="field"><label>Admin role bot</label><select class="select" id="role" ${isOwner ? "" : "disabled"}>${roleOptions(s.setupRoleId, "— Tidak ada —")}</select>
      <span class="hint">${isOwner ? "Role ini bisa mengatur bot & mengakses dashboard." : "Hanya Server Owner yang dapat mengubah admin role."}</span></div>
    </div></div>
    <div class="card"><div class="card-head"><h2>Tampilan</h2></div><div class="card-pad stack">
      <div class="field" style="max-width:280px"><label>Warna utama embed</label><div class="color-input"><input type="color" id="color" value="${hex(s.accentColor)}"><input class="input mono" id="color-t" value="${hex(s.accentColor)}"></div></div>
      <div id="color-prev"></div>
    </div></div>
    <div class="save-bar"><button class="btn btn-primary" id="save">💾 Simpan pengaturan</button></div>`;

  const $ = (id) => main.querySelector(id);
  const prev = () => ($("#color-prev").innerHTML = embedPreview({ title: "🎫 Contoh embed", description: "Begini tampilan warna embed bot di server kamu.", color: $("#color").value }));
  $("#color").oninput = () => (($("#color-t").value = $("#color").value), prev());
  $("#color-t").oninput = () => /^#[0-9a-f]{6}$/i.test($("#color-t").value) && (($("#color").value = $("#color-t").value), prev());
  prev();
  $("#save").onclick = (e) => {
    const body = { logChannelId: $("#log").value || null, modLogChannelId: $("#modlog").value || null, accentColor: $("#color").value };
    if (isOwner) body.setupRoleId = $("#role").value || null;
    run(e.currentTarget, () => gapi("/settings", { method: "PUT", body }), "Pengaturan disimpan");
  };
}

// ── Setup & pengaturan bot ──────────────────────────────────────────────────
const copyBtn = (text) => `<button class="btn btn-sm" data-copy="${esc(text)}">Salin</button>`;
function bindCopy(root) {
  root.querySelectorAll("[data-copy]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy);
          toast("Disalin");
        } catch {
          toast("Gagal menyalin", true);
        }
      })
  );
}

function configForm(st, { first }) {
  return `
    ${first && st.needsSetupCode ? `<div class="field"><label>Kode setup</label><input class="input mono" id="c-code" inputmode="numeric" autocomplete="off" placeholder="6 digit dari console"><span class="hint">Kode tampil di terminal tempat bot dijalankan. Ini mencegah orang lain mengambil alih setup.</span></div>` : ""}
    <div class="field"><label>Bot Token</label><input class="input mono" id="c-token" type="password" autocomplete="off" placeholder="${st.hasToken ? "Tersimpan — kosongkan jika tidak diganti" : "Salin dari Developer Portal → Bot → Reset Token"}"></div>
    <div class="field"><label>Client Secret</label><input class="input mono" id="c-secret" type="password" autocomplete="off" placeholder="${st.hasSecret ? "Tersimpan — kosongkan jika tidak diganti" : "Developer Portal → OAuth2 → Client Secret"}"><span class="hint">Dipakai untuk login dashboard dengan Discord.</span></div>
    <div class="field"><label>URL Dashboard</label><input class="input" id="c-url" value="${esc(first ? location.origin : st.dashboardUrl)}" placeholder="https://bot.domain.com"><span class="hint">Alamat yang kamu pakai untuk membuka halaman ini. Client ID otomatis dibaca dari token.</span></div>`;
}

function collectConfig(root) {
  const v = (id) => root.querySelector(id)?.value.trim() ?? "";
  return { setupCode: v("#c-code"), token: v("#c-token"), clientSecret: v("#c-secret"), dashboardUrl: v("#c-url") };
}

function setupDone(st) {
  $app.innerHTML = `<div class="login"><div class="login-card" style="max-width:520px;text-align:left">
    <h1 style="text-align:center">✅ Tersimpan</h1>
    <p style="text-align:center">${st.bot.status === "online" ? `Bot <b>${esc(st.bot.tag ?? "")}</b> sudah online.` : `Bot sedang menyala (${esc(st.bot.status)})${st.botError ? `: ${esc(st.botError)}` : ""}.`}</p>
    <div class="stack">
      <div class="field"><label>Satu langkah lagi — daftarkan Redirect URI</label>
        <span class="hint">Developer Portal → OAuth2 → Redirects → Add Redirect, tempel URL ini lalu Save:</span>
        <div style="display:flex;gap:8px"><input class="input mono" readonly value="${esc(st.redirectUri)}">${copyBtn(st.redirectUri)}</div></div>
      <div class="field"><label>Aktifkan Message Content Intent</label><span class="hint">Developer Portal → Bot → Privileged Gateway Intents → Message Content Intent. Tanpa ini transkrip tiket kosong.</span></div>
    </div>
    <a class="btn btn-primary btn-lg" style="margin-top:20px" href="/auth/login">Login dengan Discord</a>
  </div></div>`;
  bindCopy($app);
}

function renderSetup(st) {
  $app.innerHTML = `<div class="login"><div class="login-card" style="max-width:520px;text-align:left">
    <div class="avatar lg round" style="margin:0 auto 12px;width:64px;height:64px;font-size:26px">🤖</div>
    <h1 style="text-align:center">Setup Bot</h1>
    <p style="text-align:center">${st.bot.error ? `⚠️ Bot gagal menyala: ${esc(st.bot.error)}. Perbaiki di bawah.` : "Isi sekali saja — semua tersimpan di database, tidak perlu edit file."}</p>
    <div class="stack" id="form">${configForm(st, { first: true })}</div>
    <button class="btn btn-primary btn-lg" id="save" style="margin-top:20px">Simpan & nyalakan bot</button>
    <p class="muted small" style="margin-top:14px;text-align:center">Belum punya bot? Buat di <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">Developer Portal</a> → New Application → Bot.</p>
  </div></div>`;
  $app.querySelector("#save").onclick = async (e) => {
    const body = collectConfig($app);
    if ((!body.token && !st.hasToken) || (!body.clientSecret && !st.hasSecret)) return toast("Token dan Client Secret wajib diisi", true);
    const out = await run(e.currentTarget, () => api("/setup/config", { method: "PUT", body, noAuthRedirect: true }));
    if (out) setupDone(out);
  };
}

async function renderBotPage() {
  const st = await api("/setup/status");
  const badge = { online: "green", starting: "orange", error: "red", offline: "" }[st.bot.status] ?? "";
  $app.innerHTML = `<div class="picker" style="max-width:640px">
    <a class="btn btn-sm btn-ghost" href="#">← Kembali</a>
    <h1 style="margin-top:12px">Pengaturan Bot</h1>
    <p>Token dan kredensial aplikasi. Hanya pemilik aplikasi bot yang bisa mengubahnya.</p>
    <div class="card" style="margin-bottom:16px"><div class="list-item"><div class="grow"><b>Status</b><div class="muted small">${esc(st.bot.tag ?? "—")}${st.bot.error ? ` • ${esc(st.bot.error)}` : ""}</div></div><span class="badge ${badge}">● ${esc(st.bot.status)}</span></div></div>
    <div class="card card-pad stack">
      ${configForm(st, { first: false })}
      <div class="field"><label>Redirect URI (daftarkan di Developer Portal)</label><div style="display:flex;gap:8px"><input class="input mono" readonly value="${esc(st.redirectUri)}">${copyBtn(st.redirectUri)}</div></div>
      <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap">
        <button class="btn" id="redeploy">🔄 Daftarkan ulang command</button>
        <button class="btn btn-primary" id="save">Simpan & restart bot</button>
      </div>
    </div>
  </div>`;
  bindCopy($app);
  $app.querySelector("#save").onclick = async (e) => {
    const out = await run(e.currentTarget, () => api("/setup/config", { method: "PUT", body: collectConfig($app) }));
    if (!out) return;
    toast(out.botError ? `Tersimpan, tapi bot gagal menyala: ${out.botError}` : "Tersimpan, bot dimulai ulang", !!out.botError);
    state.me = await api("/me").catch(() => state.me);
    renderBotPage();
  };
  $app.querySelector("#redeploy").onclick = async (e) => {
    const r = await run(e.currentTarget, () => api("/setup/redeploy", { method: "POST" }));
    if (r) toast(`${r.total} command didaftarkan ke ${r.guilds} server`);
  };
}

// ── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  try {
    const saved = localStorage.getItem("theme");
    if (saved) document.documentElement.dataset.theme = saved;
  } catch {}
  try {
    const st = await fetch("/api/setup/status").then((r) => r.json());
    if (!st.configured) return renderSetup(st);
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (res.status === 401) return renderLogin();
    state.me = await res.json();
    route();
  } catch {
    renderLogin();
  }
})();
