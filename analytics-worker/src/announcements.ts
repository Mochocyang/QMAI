/**
 * 「公告发布」后台页 + 接口。
 *
 * 数据存在 KV（键 `announcements-doc`），官网 Pages Function 的
 * `/announcements.json` 读的是同一份文档，所以后台发完最多 1 分钟客户端可见。
 *
 * 页面样式与统计页共用 `theme.ts`：日/夜模式、顶栏、表单控件都是同一套变量。
 */

import { BASE_CSS, THEME_SCRIPT, THEME_TOGGLE } from "./theme"

export interface AnnouncementEnv {
  ANNOUNCEMENTS?: KVNamespace
}

export interface StoredAnnouncement {
  id: string
  title: string
  body: string
  publishedAt: string
  pinned: boolean
  url?: string
}

export interface AnnouncementDoc {
  version: 1
  updatedAt: string
  announcements: StoredAnnouncement[]
}

interface AnnouncementInput {
  title?: unknown
  body?: unknown
  url?: unknown
  id?: unknown
  pinned?: unknown
}

const ANNOUNCEMENTS_KEY = "announcements-doc"
const ANNOUNCEMENTS_MAX = 50
const TITLE_LIMIT = 60
const BODY_LIMIT = 2000

/** 北京时间 ISO 串，保证 publishedAt 排序稳定、显示符合习惯。 */
function beijingIso(date = new Date()): string {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
  return `${formatted.replace(" ", "T")}+08:00`
}

function announcementSlug(title: string): string {
  const ascii = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!ascii) return "announcement"
  return /[a-z0-9]/.test(ascii) ? ascii.slice(0, 32) : `announcement-${Date.now().toString(36)}`
}

export function sortAnnouncements(items: StoredAnnouncement[]): StoredAnnouncement[] {
  return [...items].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  })
}

function isStoredAnnouncement(item: unknown): item is StoredAnnouncement {
  if (!item || typeof item !== "object") return false
  const record = item as Record<string, unknown>
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.body === "string" &&
    typeof record.publishedAt === "string"
  )
}

export async function readAnnouncementDoc(env: AnnouncementEnv): Promise<AnnouncementDoc> {
  const empty: AnnouncementDoc = { version: 1, updatedAt: new Date().toISOString(), announcements: [] }
  if (!env.ANNOUNCEMENTS) return empty
  try {
    const raw = await env.ANNOUNCEMENTS.get(ANNOUNCEMENTS_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<AnnouncementDoc> | null
    if (!parsed || !Array.isArray(parsed.announcements)) return empty
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      announcements: parsed.announcements.filter(isStoredAnnouncement).map((item) => ({
        ...item,
        pinned: Boolean(item.pinned),
      })),
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "announcements_read_error", message: String(error) }))
    return empty
  }
}

async function writeAnnouncementDoc(
  env: AnnouncementEnv,
  items: StoredAnnouncement[],
): Promise<AnnouncementDoc> {
  const next: AnnouncementDoc = {
    version: 1,
    updatedAt: new Date().toISOString(),
    announcements: items.slice(0, ANNOUNCEMENTS_MAX),
  }
  if (!env.ANNOUNCEMENTS) throw new Error("ANNOUNCEMENTS KV 未绑定")
  await env.ANNOUNCEMENTS.put(ANNOUNCEMENTS_KEY, JSON.stringify(next))
  return next
}

function buildAnnouncementEntry(
  input: AnnouncementInput | undefined,
  existingIds: string[],
): { entry: StoredAnnouncement } | { error: string } {
  const title = String(input?.title ?? "").trim().slice(0, TITLE_LIMIT)
  if (!title) return { error: "标题不能为空。" }
  const body = String(input?.body ?? "").trim().slice(0, BODY_LIMIT)
  if (!body) return { error: "正文不能为空。" }

  const rawUrl = String(input?.url ?? "").trim()
  if (rawUrl && !/^https?:\/\//i.test(rawUrl)) return { error: "链接必须是 http/https 地址。" }

  const today = beijingIso().slice(0, 10)
  const id = (String(input?.id ?? "").trim() || `${today}-${announcementSlug(title)}`).slice(0, 64)
  if (existingIds.includes(id)) {
    return { error: `id 已存在：${id}。想再提醒用户一次，请换一个 id（例如结尾加 -v2）。` }
  }

  return {
    entry: {
      id,
      title,
      body,
      publishedAt: beijingIso(),
      pinned: Boolean(input?.pinned),
      ...(rawUrl ? { url: rawUrl } : {}),
    },
  }
}

export interface AnnouncementCallbacks {
  basePath: string
  hasSession: () => Promise<boolean>
  loginResponse: () => Response
  secureHtml: (html: string) => Response
  secureJson: (data: unknown, status?: number) => Response
}

/** GET <后台路径>/announcements —— 页面本体 */
export async function handleAnnouncementsPage(
  request: Request,
  env: AnnouncementEnv,
  ctx: AnnouncementCallbacks,
): Promise<Response> {
  if (!(await ctx.hasSession())) return ctx.loginResponse()
  return ctx.secureHtml(renderAnnouncementsPage(ctx.basePath))
}

/** GET/POST <后台路径>/announcements —— 读列表 / publish·delete·pin */
export async function handleAnnouncementsApi(
  request: Request,
  env: AnnouncementEnv,
  ctx: AnnouncementCallbacks,
): Promise<Response> {
  if (!(await ctx.hasSession())) {
    return ctx.secureJson({ error: "未登录或会话已过期" }, 401)
  }

  if (request.method === "GET") {
    const current = await readAnnouncementDoc(env)
    return ctx.secureJson({
      doc: { ...current, announcements: sortAnnouncements(current.announcements) },
    })
  }

  let payload: Record<string, unknown> | null = null
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return ctx.secureJson({ error: "请求体不是合法 JSON" }, 400)
  }

  const doc = await readAnnouncementDoc(env)
  const action = String(payload?.action ?? "")

  if (action === "publish") {
    const built = buildAnnouncementEntry(payload?.entry as AnnouncementInput | undefined, doc.announcements.map((item) => item.id))
    if ("error" in built) return ctx.secureJson({ error: built.error }, 400)
    const next = await writeAnnouncementDoc(
      env,
      sortAnnouncements([built.entry, ...doc.announcements]),
    )
    return ctx.secureJson({ ok: true, doc: next, entry: built.entry })
  }

  if (action === "delete") {
    const id = String(payload?.id ?? "")
    const remaining = doc.announcements.filter((item) => item.id !== id)
    if (remaining.length === doc.announcements.length) {
      return ctx.secureJson({ error: "找不到这条公告" }, 404)
    }
    return ctx.secureJson({ ok: true, doc: await writeAnnouncementDoc(env, remaining) })
  }

  if (action === "pin") {
    const id = String(payload?.id ?? "")
    if (!doc.announcements.some((item) => item.id === id)) {
      return ctx.secureJson({ error: "找不到这条公告" }, 404)
    }
    const updated = doc.announcements.map((item) =>
      item.id === id ? { ...item, pinned: Boolean(payload?.pinned) } : item,
    )
    return ctx.secureJson({ ok: true, doc: await writeAnnouncementDoc(env, sortAnnouncements(updated)) })
  }

  return ctx.secureJson({ error: `不认识的动作：${action}` }, 400)
}

export function renderAnnouncementsPage(basePath: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="referrer" content="no-referrer">
  <title>青幕AI写作 - 公告发布</title>
  <style>${BASE_CSS}</style>
  ${THEME_SCRIPT}
</head>
<body>
<main>
  <div class="topbar">
    <h1>公告发布</h1>
    <div class="topbar-actions">
      ${THEME_TOGGLE}
      <a href="${basePath}">返回统计</a>
      <a href="${basePath}/password">修改密码</a>
      <a href="${basePath}/logout">退出登录</a>
    </div>
  </div>
  <p class="subtle">写一条公告 → 点发布 → 最多 1 分钟客户端就能看到（CDN 缓存 60 秒）。数据在 KV，与官网 <code>/announcements.json</code> 是同一份。</p>

  <fieldset style="margin-top:1.25rem">
    <legend>新公告</legend>
    <label for="title">标题（必填，≤60 字）</label>
    <input id="title" type="text" maxlength="60" placeholder="云同步重复上传已修复">
    <label for="body">正文（必填，Markdown，≤2000 字）</label>
    <textarea id="body" placeholder="## 修复内容&#10;- 同一文件不再被反复上传"></textarea>
    <label for="url">详情链接（可选，http/https）</label>
    <input id="url" type="text" placeholder="https://www.qmai.pro/">
    <label for="id">自定义 id（可选，留空自动生成；改内容沿用旧 id，想重新提醒就换新 id）</label>
    <input id="id" type="text" placeholder="2026-10-27-sync-fix">
    <div class="row">
      <label class="check"><input id="pinned" type="checkbox"> 置顶</label>
      <button class="primary" id="publish">发布</button>
      <span id="status"></span>
    </div>
  </fieldset>

  <h2>已有公告</h2>
  <ul id="list"><li class="empty">加载中…</li></ul>
</main>
<script>
const API = "${basePath}/announcements";
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
function setStatus(text, kind) { statusEl.textContent = text || ""; statusEl.className = kind || ""; }

function renderList(items) {
  const list = $("list");
  if (!items.length) { list.innerHTML = '<li class="empty">还没有公告。</li>'; return; }
  list.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    const title = document.createElement("div");
    title.className = "title";
    const strong = document.createElement("strong");
    strong.textContent = item.title;
    title.appendChild(strong);
    if (item.pinned) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "置顶";
      title.appendChild(tag);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = item.publishedAt + " · " + item.id + (item.url ? " · " + item.url : "");
    const row = document.createElement("div");
    row.className = "row";
    const pinBtn = document.createElement("button");
    pinBtn.className = "link";
    pinBtn.textContent = item.pinned ? "取消置顶" : "置顶";
    pinBtn.onclick = () => mutate({ action: "pin", id: item.id, pinned: !item.pinned }, "已更新置顶");
    const delBtn = document.createElement("button");
    delBtn.className = "link danger";
    delBtn.textContent = "删除";
    delBtn.onclick = () => {
      if (!confirm("删除「" + item.title + "」？客户端下次拉取后这条会消失。")) return;
      mutate({ action: "delete", id: item.id }, "已删除");
    };
    row.append(pinBtn, delBtn);
    li.append(title, meta, row);
    list.appendChild(li);
  }
}

async function call(method, body) {
  const response = await fetch(method === "GET" ? API + "?format=json" : API, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
  return data;
}

async function load() {
  try {
    const data = await call("GET");
    renderList(data.doc.announcements || []);
  } catch (error) {
    $("list").innerHTML = '<li class="empty">加载失败：' + String(error.message) + "</li>";
  }
}

async function mutate(body, okText) {
  try {
    const data = await call("POST", body);
    renderList(data.doc.announcements || []);
    setStatus(okText, "ok");
  } catch (error) {
    setStatus("失败：" + String(error.message), "err");
  }
}

$("publish").onclick = async () => {
  const entry = { title: $("title").value, body: $("body").value, url: $("url").value, id: $("id").value, pinned: $("pinned").checked };
  setStatus("发布中…");
  try {
    await call("POST", { action: "publish", entry });
  } catch (error) {
    setStatus("失败：" + String(error.message), "err");
    return;
  }
  $("title").value = ""; $("body").value = ""; $("url").value = ""; $("id").value = ""; $("pinned").checked = false;
  setStatus("已发布，最多 1 分钟后客户端可见", "ok");
  load();
};

load();
</script>
</body>
</html>`
}
