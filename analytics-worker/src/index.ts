/**
 * 青幕AI写作 - 用户统计 Cloudflare Worker
 *
 * 功能：
 * - POST /open   : 用户启动软件时调用（注册 + 标记在线）
 * - POST /close  : 用户关闭软件时调用（标记离线）
 * - GET  /stats  : 查看统计数据（需要密钥）
 * - Cron trigger : 每小时清理超时会话
 */

export interface Env {
  DB: D1Database
  STATS_SECRET: string // 在 Cloudflare Dashboard 设置的密钥，用于查看统计
}

const ACTIVE_ONLINE_WINDOW_MS = 3 * 60 * 1000

type FeedbackType = "bug" | "suggestion" | "other"

interface FeedbackBody {
  type?: FeedbackType
  message?: string
  contact?: string
  appVersion?: string
  userAgent?: string
}

interface FeedbackRow {
  id: number
  type: string
  message: string
  contact: string | null
  app_version: string | null
  created_at: string
}

// 将 IP 地址哈希化（隐私保护）
async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(ip + "qmai-salt-2026")
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

// CORS 响应头
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  })
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function typeLabel(type: string): string {
  if (type === "bug") return "问题反馈"
  if (type === "suggestion") return "功能建议"
  return "其他"
}

function activeCutoff(now = new Date()): string {
  return new Date(now.getTime() - ACTIVE_ONLINE_WINDOW_MS).toISOString()
}

async function upsertUserSeen(request: Request, env: Env, uuid: string, now: string): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown"
  const ipHash = await hashIP(ip)

  await env.DB.prepare(
    `INSERT INTO users (uuid, ip_hash, first_seen, last_seen)
     VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(uuid) DO UPDATE SET last_seen = ?3`
  ).bind(uuid, ipHash, now).run()
}

async function countActiveUsers(env: Env, cutoff: string): Promise<number> {
  const onlineCount = await env.DB.prepare(
    `SELECT COUNT(DISTINCT uuid) as count FROM sessions
     WHERE is_online = 1 AND last_active >= ?1`
  ).bind(cutoff).first<{ count: number }>()
  return onlineCount?.count ?? 0
}

// POST /feedback - 设置页用户反馈
async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const body = await request.json<FeedbackBody>()
  const type: FeedbackType = body?.type === "bug" || body?.type === "other" ? body.type : "suggestion"
  const message = cleanText(body?.message, 3000)
  const contact = cleanText(body?.contact, 200)
  const appVersion = cleanText(body?.appVersion, 40)
  const userAgent = cleanText(body?.userAgent, 300)

  if (!message) return jsonResponse({ error: "请输入反馈内容" }, 400)

  const ip = request.headers.get("CF-Connecting-IP") || "unknown"
  const ipHash = await hashIP(ip)
  const now = new Date().toISOString()

  await env.DB.prepare(
    `INSERT INTO feedback (type, message, contact, app_version, user_agent, ip_hash, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(type, message, contact || null, appVersion || null, userAgent || null, ipHash, now).run()

  return jsonResponse({ ok: true })
}

async function handleDeleteFeedback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const key = url.searchParams.get("key") ?? ""
  if (key !== env.STATS_SECRET) {
    return new Response("需要密钥", { status: 401 })
  }

  const body = new URLSearchParams(await request.text())
  const id = Number(body.get("id"))
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("反馈 ID 无效", { status: 400 })
  }

  await env.DB.prepare(
    `DELETE FROM feedback WHERE id = ?1`
  ).bind(id).run()

  return Response.redirect(`${url.origin}/dashboard?key=${encodeURIComponent(key)}`, 303)
}

// POST /open - 用户启动软件
async function handleOpen(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ uuid: string }>()
  const uuid = body?.uuid
  if (!uuid) return jsonResponse({ error: "missing uuid" }, 400)

  const now = new Date().toISOString()

  // 注册/更新用户（下载人数统计）
  await upsertUserSeen(request, env, uuid, now)

  // 关闭该 uuid 所有旧的在线会话（防止累积）
  await env.DB.prepare(
    `UPDATE sessions SET is_online = 0, close_time = ?1 WHERE uuid = ?2 AND is_online = 1`
  ).bind(now, uuid).run()

  // 创建新会话
  await env.DB.prepare(
    `INSERT INTO sessions (uuid, open_time, last_active, is_online) VALUES (?1, ?2, ?2, 1)`
  ).bind(uuid, now).run()

  return jsonResponse({ ok: true })
}

// POST /heartbeat - 用户在线心跳
async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ uuid: string }>()
  const uuid = body?.uuid
  if (!uuid) return jsonResponse({ error: "missing uuid" }, 400)

  const now = new Date().toISOString()
  await upsertUserSeen(request, env, uuid, now)

  const current = await env.DB.prepare(
    `SELECT id FROM sessions WHERE uuid = ?1 AND is_online = 1
     ORDER BY last_active DESC LIMIT 1`
  ).bind(uuid).first<{ id: number }>()

  if (current?.id) {
    await env.DB.prepare(
      `UPDATE sessions SET last_active = ?1, is_online = 1 WHERE id = ?2`
    ).bind(now, current.id).run()
  } else {
    await env.DB.prepare(
      `INSERT INTO sessions (uuid, open_time, last_active, is_online) VALUES (?1, ?2, ?2, 1)`
    ).bind(uuid, now).run()
  }

  return jsonResponse({ ok: true })
}

// POST /close - 用户关闭软件
async function handleClose(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ uuid: string }>()
  const uuid = body?.uuid
  if (!uuid) return jsonResponse({ error: "missing uuid" }, 400)

  const now = new Date().toISOString()

  await env.DB.prepare(
    `UPDATE sessions SET is_online = 0, close_time = ?1, last_active = ?1
     WHERE uuid = ?2 AND is_online = 1`
  ).bind(now, uuid).run()

  return jsonResponse({ ok: true })
}

// GET /stats - 查看统计（需要密钥）
async function handleStats(request: Request, env: Env): Promise<Response> {
  // 验证密钥
  const auth = request.headers.get("Authorization")
  if (auth !== `Bearer ${env.STATS_SECRET}`) {
    return jsonResponse({ error: "unauthorized" }, 401)
  }

  // 总下载用户数（按 uuid 去重）
  const totalUsers = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users`
  ).first<{ count: number }>()

  // 独立 IP 数
  const uniqueIPs = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ip_hash) as count FROM users`
  ).first<{ count: number }>()

  // 当前在线人数：最近有心跳的去重用户数
  const cutoff = activeCutoff()
  const onlineCount = await countActiveUsers(env, cutoff)

  // 今日新增用户
  const today = new Date().toISOString().split("T")[0]
  const todayNew = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users WHERE first_seen >= ?1`
  ).bind(today).first<{ count: number }>()

  // 最近7天每日统计
  const dailyStats = await env.DB.prepare(
    `SELECT date, new_users, total_users, peak_online FROM daily_stats
     ORDER BY date DESC LIMIT 7`
  ).all()

  // 最近在线的用户列表（最近 20 个）
  const recentOnline = await env.DB.prepare(
    `SELECT uuid, MAX(last_active) as last_active FROM sessions
     WHERE is_online = 1 AND last_active >= ?1
     GROUP BY uuid ORDER BY last_active DESC LIMIT 20`
  ).bind(cutoff).all()

  return jsonResponse({
    total_users: totalUsers?.count ?? 0,
    unique_ips: uniqueIPs?.count ?? 0,
    online_now: onlineCount,
    today_new_users: todayNew?.count ?? 0,
    daily_stats: dailyStats.results,
    recent_online: recentOnline.results,
    server_time: new Date().toISOString(),
  })
}

function renderDashboard(input: {
  totalUsers: number
  uniqueIPs: number
  onlineCount: number
  todayNew: number
  feedbackRows: FeedbackRow[]
  serverTime: string
  dashboardKey: string
}): string {
  const feedbackRows = input.feedbackRows.length > 0
    ? input.feedbackRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.created_at)}</td>
        <td><span class="tag">${escapeHtml(typeLabel(row.type))}</span></td>
        <td class="message">${escapeHtml(row.message)}</td>
        <td>${escapeHtml(row.contact || "-")}</td>
        <td>${escapeHtml(row.app_version || "-")}</td>
        <td>
          <form method="POST" action="/feedback/delete?key=${encodeURIComponent(input.dashboardKey)}" onsubmit="return confirm('确定删除这条反馈吗？删除后不可恢复。')">
            <input type="hidden" name="id" value="${row.id}">
            <button class="danger" type="submit">删除</button>
          </form>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">暂无反馈</td></tr>`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>青幕AI写作 - 用户统计与反馈</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; min-height: 100vh; }
    main { max-width: 1100px; margin: 0 auto; }
    h1 { margin-bottom: 0.35rem; color: #f8fafc; }
    h2 { margin: 2rem 0 1rem; color: #cbd5e1; font-size: 1.1rem; }
    .subtle { color: #94a3b8; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1rem; margin-top: 1.25rem; }
    .card { background: #111827; border-radius: 8px; padding: 1.25rem; border: 1px solid #334155; }
    .card .number { font-size: 2.2rem; font-weight: 700; color: #38bdf8; }
    .card .label { margin-top: 0.35rem; color: #94a3b8; font-size: 0.9rem; }
    .online .number { color: #4ade80; }
    .panel { overflow: hidden; border: 1px solid #334155; border-radius: 8px; background: #111827; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.85rem; border-bottom: 1px solid #1f2937; text-align: left; vertical-align: top; font-size: 0.9rem; }
    th { color: #94a3b8; background: #0f172a; font-weight: 600; }
    .message { max-width: 460px; white-space: pre-wrap; line-height: 1.55; }
    .tag { display: inline-flex; border: 1px solid #475569; border-radius: 999px; padding: 0.15rem 0.55rem; color: #cbd5e1; font-size: 0.8rem; }
    .danger { border: 1px solid #7f1d1d; border-radius: 6px; background: #450a0a; color: #fecaca; padding: 0.3rem 0.55rem; cursor: pointer; }
    .danger:hover { background: #7f1d1d; }
    .empty { color: #64748b; text-align: center; }
    .footer { margin-top: 1.5rem; color: #64748b; font-size: 0.8rem; }
  </style>
</head>
<body>
  <main>
    <h1>青幕AI写作后台</h1>
    <p class="subtle">用户统计与设置页反馈都在这里查看。</p>

    <h2>用户统计</h2>
    <div class="grid">
      <div class="card">
        <div class="number">${input.totalUsers}</div>
        <div class="label">总下载用户数</div>
      </div>
      <div class="card">
        <div class="number">${input.uniqueIPs}</div>
        <div class="label">独立 IP 数</div>
      </div>
      <div class="card online">
        <div class="number">${input.onlineCount}</div>
        <div class="label">当前在线人数</div>
      </div>
      <div class="card">
        <div class="number">${input.todayNew}</div>
        <div class="label">今日新增用户</div>
      </div>
    </div>

    <h2>最新反馈</h2>
    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>提交时间</th>
            <th>类型</th>
            <th>内容</th>
            <th>联系方式</th>
            <th>版本</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${feedbackRows}</tbody>
      </table>
    </div>

    <div class="footer">
      <p>数据更新时间：${escapeHtml(input.serverTime)}</p>
      <p>在线人数按最近 3 分钟内有心跳的去重设备计算。</p>
    </div>
  </main>
</body>
</html>`
}

// GET /dashboard - 简易 HTML 仪表盘
async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const auth = new URL(request.url).searchParams.get("key")
  if (auth !== env.STATS_SECRET) {
    return new Response("需要密钥: ?key=你的密钥", { status: 401 })
  }

  const totalUsers = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users`
  ).first<{ count: number }>()

  const uniqueIPs = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ip_hash) as count FROM users`
  ).first<{ count: number }>()

  const cutoff = activeCutoff()
  const onlineCount = await countActiveUsers(env, cutoff)

  const today = new Date().toISOString().split("T")[0]
  const todayNew = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users WHERE first_seen >= ?1`
  ).bind(today).first<{ count: number }>()

  const feedback = await env.DB.prepare(
    `SELECT id, type, message, contact, app_version, created_at
     FROM feedback ORDER BY created_at DESC LIMIT 50`
  ).all<FeedbackRow>()

  const html = renderDashboard({
    totalUsers: totalUsers?.count ?? 0,
    uniqueIPs: uniqueIPs?.count ?? 0,
    onlineCount,
    todayNew: todayNew?.count ?? 0,
    feedbackRows: feedback.results,
    serverTime: new Date().toISOString(),
    dashboardKey: auth,
  })

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  })
}

// 定时任务：清理超时会话 + 更新每日统计
async function handleScheduled(env: Env): Promise<void> {
  const now = new Date()
  const cutoff = activeCutoff(now)

  // 超过心跳窗口没有活动的会话标记为离线
  await env.DB.prepare(
    `UPDATE sessions SET is_online = 0, close_time = ?1
     WHERE is_online = 1 AND last_active < ?2`
  ).bind(now.toISOString(), cutoff).run()

  // 更新今日统计快照
  const today = now.toISOString().split("T")[0]
  const totalUsers = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users`
  ).first<{ count: number }>()
  const todayNew = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users WHERE first_seen >= ?1`
  ).bind(today).first<{ count: number }>()
  const currentOnline = await countActiveUsers(env, cutoff)

  // 更新 peak_online（取最大值）
  const existingPeak = await env.DB.prepare(
    `SELECT peak_online FROM daily_stats WHERE date = ?1`
  ).bind(today).first<{ peak_online: number }>()

  const peak = Math.max(existingPeak?.peak_online ?? 0, currentOnline)

  await env.DB.prepare(
    `INSERT INTO daily_stats (date, new_users, total_users, peak_online)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(date) DO UPDATE SET
       new_users = ?2, total_users = ?3, peak_online = MAX(daily_stats.peak_online, ?4)`
  ).bind(today, todayNew?.count ?? 0, totalUsers?.count ?? 0, peak).run()
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 处理 CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      if (request.method === "POST" && path === "/open") {
        return await handleOpen(request, env)
      }
      if (request.method === "POST" && path === "/heartbeat") {
        return await handleHeartbeat(request, env)
      }
      if (request.method === "POST" && path === "/close") {
        return await handleClose(request, env)
      }
      if (request.method === "POST" && path === "/feedback") {
        return await handleFeedback(request, env)
      }
      if (request.method === "POST" && path === "/feedback/delete") {
        return await handleDeleteFeedback(request, env)
      }
      if (request.method === "GET" && path === "/stats") {
        return await handleStats(request, env)
      }
      if (request.method === "GET" && path === "/dashboard") {
        return await handleDashboard(request, env)
      }

      return jsonResponse({ error: "not found" }, 404)
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500)
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env)
  },
}
