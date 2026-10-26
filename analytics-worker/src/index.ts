/**
 * 青幕AI写作 - 用户统计 Cloudflare Worker
 *
 * 端点：
 * - POST /open      : 用户启动软件（注册 + 标记在线）
 * - POST /heartbeat : 在线心跳（仅刷新会话活跃时间）
 * - POST /close     : 用户关闭软件（标记离线）
 * - GET  /stats     : 统计数据 JSON（需要密钥）
 * - GET  /dashboard : HTML 仪表盘（需要密钥）
 *
 * Cron trigger（每 5 分钟）：清理超时会话 + 更新每日统计快照
 *
 * 免费版配额约束（本文件的心跳频率与写入次数按此设计）：
 * - D1 免费版每天 10 万行写入，是本方案最紧的瓶颈，因此：
 *   1) 心跳间隔 5 分钟（而非 1 分钟），在线窗口 15 分钟；
 *   2) 心跳只写 sessions 表 1 次，用户注册只在 /open 做；
 *   3) /open 用 UPSERT 合并"关旧会话 + 建新会话"，从 3 写降到 2 写。
 *   100 并发在线 ≈ 2.9 万行/天，稳在免费额度内。
 */

export interface Env {
  DB: D1Database
  STATS_SECRET: string // 在 Cloudflare Dashboard 设置的密钥，用于查看统计
}

/**
 * 在线判定窗口。必须大于客户端心跳间隔（5 分钟），
 * 否则两次心跳之间用户会被判成离线。
 */
const ACTIVE_ONLINE_WINDOW_MS = 15 * 60 * 1000

/**
 * 会话被判定"早已失效"的宽松阈值，仅用于 cron 清理僵尸会话：
 * 比在线窗口再宽一些，避免与在线判定抢同一个边界。
 */
const STALE_SESSION_MS = 60 * 60 * 1000

interface OpenBody {
  uuid?: string
  version?: string
  platform?: string
}

/**
 * 把 IP 哈希化后再入库，隐私保护：只存 SHA-256 摘要，不落明文 IP。
 * 固定 salt 保证同一 IP 在其生命周期内哈希值稳定，可稳定去重。
 */
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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function activeCutoff(now = new Date()): string {
  return new Date(now.getTime() - ACTIVE_ONLINE_WINDOW_MS).toISOString()
}

function utcDateKey(d: Date): string {
  return d.toISOString().split("T")[0]
}

/**
 * 注册/更新用户（下载用户数统计）。
 *
 * 只在 /open 调用：心跳不再回写 users 表，否则每分钟每用户一次写入
 * 会迅速打爆免费版 D1 的 10 万行/天写入额度。
 *
 * ip_hash 存的是 SHA-256 哈希（加固定 salt），不落明文 IP。
 * 「独立 IP 数」用它去重：同一个 IP 下载/使用 10 次只算 1 个，
 * 因此它是比「累计下载次数」更接近真实用户规模的指标。
 */
async function upsertUserSeen(
  request: Request,
  env: Env,
  uuid: string,
  now: string,
  version: string,
  platform: string,
): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown"
  const ipHash = await hashIP(ip)

  await env.DB.prepare(
    `INSERT INTO users (uuid, ip_hash, first_seen, last_seen, last_version, last_platform)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5)
     ON CONFLICT(uuid) DO UPDATE SET
       last_seen = ?3,
       ip_hash = ?2,
       last_version = COALESCE(NULLIF(?4, ''), users.last_version),
       last_platform = COALESCE(NULLIF(?5, ''), users.last_platform)`
  ).bind(uuid, ipHash, now, version, platform).run()
}

async function countActiveUsers(env: Env, cutoff: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT uuid) as count FROM sessions
     WHERE is_online = 1 AND last_active >= ?1`
  ).bind(cutoff).first<{ count: number }>()
  return row?.count ?? 0
}

/** POST /open - 用户启动软件 */
async function handleOpen(request: Request, env: Env): Promise<Response> {
  const body = await request.json<OpenBody>().catch(() => null)
  const uuid = body?.uuid
  if (!uuid) return jsonResponse({ error: "missing uuid" }, 400)

  const version = cleanText(body?.version, 40)
  const platform = cleanText(body?.platform, 20)
  const now = new Date().toISOString()

  // 写 1：注册/更新用户（版本与平台分布的数据来源）
  await upsertUserSeen(request, env, uuid, now, version, platform)

  // 写 2：关闭该 uuid 的所有旧会话并开启新会话，合并成一条语句。
  // 先 UPDATE 再 INSERT 是 2 次写，用 UPSERT 不好表达"关旧开新"，
  // 因此这里保留两条语句但合并进同一个 batch，一次往返完成。
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions SET is_online = 0, close_time = ?1
       WHERE uuid = ?2 AND is_online = 1`
    ).bind(now, uuid),
    env.DB.prepare(
      `INSERT INTO sessions (uuid, open_time, last_active, is_online)
       VALUES (?1, ?2, ?2, 1)`
    ).bind(uuid, now),
  ])

  return jsonResponse({ ok: true })
}

/** POST /heartbeat - 在线心跳：只刷新会话活跃时间 */
async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ uuid?: string }>().catch(() => null)
  const uuid = body?.uuid
  if (!uuid) return jsonResponse({ error: "missing uuid" }, 400)

  const now = new Date().toISOString()

  // 单条 UPSERT 完成"有活跃会话就刷新，没有就补一条"。
  // 原实现是 SELECT + (UPDATE | INSERT) 两次往返，且每次都回写 users 表。
  await env.DB.prepare(
    `UPDATE sessions SET last_active = ?1, is_online = 1
     WHERE id = (
       SELECT id FROM sessions
       WHERE uuid = ?2 AND is_online = 1
       ORDER BY last_active DESC LIMIT 1
     )`
  ).bind(now, uuid).run()

  // 没有活跃会话（软件开太久跨过了 cron 清理，或刚被 /open 之外的方式启动）：
  // 补一条新会话。用 NOT EXISTS 保证只在确实没有活跃会话时写。
  await env.DB.prepare(
    `INSERT INTO sessions (uuid, open_time, last_active, is_online)
     SELECT ?1, ?2, ?2, 1
     WHERE NOT EXISTS (
       SELECT 1 FROM sessions WHERE uuid = ?1 AND is_online = 1
     )`
  ).bind(uuid, now).run()

  return jsonResponse({ ok: true })
}

/** POST /close - 用户关闭软件 */
async function handleClose(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ uuid?: string }>().catch(() => null)
  const uuid = body?.uuid
  if (!uuid) return jsonResponse({ error: "missing uuid" }, 400)

  const now = new Date().toISOString()

  await env.DB.prepare(
    `UPDATE sessions SET is_online = 0, close_time = ?1, last_active = ?1
     WHERE uuid = ?2 AND is_online = 1`
  ).bind(now, uuid).run()

  return jsonResponse({ ok: true })
}

/** 汇总四个核心指标 + 今日新增/在线，供 /stats 与 /dashboard 共用 */
async function collectMetrics(env: Env) {
  const cutoff = activeCutoff()

  const totalUsers = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users`
  ).first<{ count: number }>()

  const today = utcDateKey(new Date())
  const todayNew = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users WHERE first_seen >= ?1`
  ).bind(today).first<{ count: number }>()

  const onlineCount = await countActiveUsers(env, cutoff)

  return {
    totalUsers: totalUsers?.count ?? 0,
    todayNew: todayNew?.count ?? 0,
    onlineCount,
    cutoff,
  }
}

/**
 * DAU / WAU：按"当天出现过活跃会话的去重设备数"计算。
 *
 * 口径说明：以 sessions.last_active 为准，而不是 users.last_seen ——
 * 后者只在启动时写，反映的是"打开过"而非"用过"。
 */
async function collectActivity(env: Env) {
  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const dau = await env.DB.prepare(
    `SELECT COUNT(DISTINCT uuid) as count FROM sessions WHERE last_active >= ?1`
  ).bind(dayAgo).first<{ count: number }>()

  const wau = await env.DB.prepare(
    `SELECT COUNT(DISTINCT uuid) as count FROM sessions WHERE last_active >= ?1`
  ).bind(weekAgo).first<{ count: number }>()

  return {
    dau: dau?.count ?? 0,
    wau: wau?.count ?? 0,
  }
}

/** 版本分布：按启动上报的版本号聚合，判断老版本还剩多少人 */
async function collectVersionDistribution(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(last_version, ''), '未知') as version,
            COUNT(*) as count
     FROM users
     GROUP BY version
     ORDER BY count DESC`
  ).all<{ version: string; count: number }>()

  return rows.results ?? []
}

/** 平台分布：Windows / macOS / 其他 */
async function collectPlatformDistribution(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(last_platform, ''), '未知') as platform,
            COUNT(*) as count
     FROM users
     GROUP BY platform
     ORDER BY count DESC`
  ).all<{ platform: string; count: number }>()

  return rows.results ?? []
}

/**
 * 留存率：按「注册日」分群，看这批人在第 N 天是否还有活跃会话。
 *
 * 口径：以 sessions.last_active 判定"活跃"（真实使用过的时刻），
 * 而不是 users.last_seen（只在启动时写）。分群基准取 users.first_seen 的日期。
 *
 * 只统计**已经过完整观察窗**的群体，避免新注册的人必然拉低留存：
 * - 次日留存：只看注册日 ≤ 昨天的群体（否则今天的用户还没机会进入次日）
 * - 7 日留存：只看注册日 ≤ 7 天前的群体
 *
 * 纯查询，不增加任何写入。
 */
async function collectRetention(env: Env) {
  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const today = utcDateKey(now)
  const yesterday = utcDateKey(new Date(now.getTime() - dayMs))
  const weekAgo = utcDateKey(new Date(now.getTime() - 7 * dayMs))

  // 次日留存：注册日 = D 的用户，在 D+1 当天有活跃会话
  const d1 = await env.DB.prepare(
    `SELECT
       COUNT(*) as cohort,
       SUM(CASE WHEN EXISTS (
         SELECT 1 FROM sessions s
         WHERE s.uuid = u.uuid
           AND date(s.last_active, '+8 hours') = date(u.first_seen, '+8 hours', '+1 day')
       ) THEN 1 ELSE 0 END) as retained
     FROM users u
     WHERE date(u.first_seen, '+8 hours') <= ?1`
  ).bind(yesterday).first<{ cohort: number; retained: number }>()

  // 7 日留存：注册日 = D 的用户，在 D+7 当天有活跃会话
  const d7 = await env.DB.prepare(
    `SELECT
       COUNT(*) as cohort,
       SUM(CASE WHEN EXISTS (
         SELECT 1 FROM sessions s
         WHERE s.uuid = u.uuid
           AND date(s.last_active, '+8 hours') = date(u.first_seen, '+8 hours', '+7 day')
       ) THEN 1 ELSE 0 END) as retained
     FROM users u
     WHERE date(u.first_seen, '+8 hours') <= ?1`
  ).bind(weekAgo).first<{ cohort: number; retained: number }>()

  const pct = (part: number | null, whole: number | null) => {
    const w = whole ?? 0
    return w > 0 ? Math.round(((part ?? 0) / w) * 1000) / 10 : null
  }

  return {
    d1_cohort: d1?.cohort ?? 0,
    d1_rate: pct(d1?.retained ?? 0, d1?.cohort ?? 0),
    d7_cohort: d7?.cohort ?? 0,
    d7_rate: pct(d7?.retained ?? 0, d7?.cohort ?? 0),
  }
}

/**
 * 版本升级率：有多少设备在用最新版本，多少还停在旧版。
 *
 * 取全库出现过的最高版本号作为"最新"，避免依赖某个硬编码常量。
 * 纯查询，不增加任何写入。
 *
 * ⚠️ 分母只算「已知版本」的设备。last_version 是 2026-10-25 新增的列，
 * 此前所有老用户从未上报过版本，一律落在「未知」里。若把「未知」计入
 * 分母，占比会被稀释到接近 0% 而毫无参考价值 —— 那个数字只反映
 * "有多少人装了新版本"，不反映"新版本用户里有多少人升级"。
 * 因此这里同时返回 known（已知版本设备数），让仪表盘能说明分母。
 */
async function collectVersionAdoption(env: Env, versions: Array<{ version: string; count: number }>) {
  // 「未知」不是真实版本（早期用户或读取失败），不参与最新版判定与占比分母
  const real = versions.filter((v) => v.version !== "未知")
  const known = real.reduce((sum, v) => sum + v.count, 0)

  if (real.length === 0) {
    return {
      latestVersion: "",
      latestCount: 0,
      known: 0,
      latestRate: null as number | null,
    }
  }

  // 版本号按数字分段比较，处理 4.3.10 > 4.3.9 这类情况
  const compareVer = (a: string, b: string) => {
    const pa = a.split(".").map((n) => Number(n) || 0)
    const pb = b.split(".").map((n) => Number(n) || 0)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
      if (diff !== 0) return diff
    }
    return 0
  }

  const latestVersion = real.map((v) => v.version).sort(compareVer).at(-1) ?? ""
  const latestCount = real.find((v) => v.version === latestVersion)?.count ?? 0

  return {
    latestVersion,
    latestCount,
    known,
    latestRate: known > 0 ? Math.round((latestCount / known) * 1000) / 10 : null,
  }
}

/** GET /stats - 统计数据 JSON（需要密钥） */
async function handleStats(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization")
  if (auth !== `Bearer ${env.STATS_SECRET}`) {
    return jsonResponse({ error: "unauthorized" }, 401)
  }

  const metrics = await collectMetrics(env)
  const activity = await collectActivity(env)
  const versions = await collectVersionDistribution(env)
  const platforms = await collectPlatformDistribution(env)

  // 独立 IP 数：按 users.ip_hash 去重，代表"真实独立设备/用户"的粗略规模。
  // 为什么仍保留：累计下载用户数会被"同一台机器删除重装/多设备下载"放大，
  // 而独立 IP 去重后更接近真实用户量，两者对比能看出异常增长。
  // 空串只存在于 2026-10-25~26 短暂停止采集期间的用户，过滤掉避免把
  // "无 IP 记录"整体算作 1 个独立 IP。
  const uniqueIPs = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ip_hash) as count FROM users WHERE ip_hash <> ''`
  ).first<{ count: number }>()

  const dailyStats = await env.DB.prepare(
    `SELECT date, new_users, total_users, peak_online FROM daily_stats
     ORDER BY date DESC LIMIT 7`
  ).all()

  const retention = await collectRetention(env)
  const adoption = await collectVersionAdoption(env, versions)

  return jsonResponse({
    total_users: metrics.totalUsers,
    unique_ips: uniqueIPs?.count ?? 0,
    online_now: metrics.onlineCount,
    today_new_users: metrics.todayNew,
    dau: activity.dau,
    wau: activity.wau,
    retention,
    version_adoption: adoption,
    versions,
    platforms,
    daily_stats: dailyStats.results,
    server_time: new Date().toISOString(),
  })
}

function renderBarRows(
  rows: Array<{ label: string; count: number }>,
  total: number,
): string {
  if (rows.length === 0) {
    return `<p class="empty">暂无数据</p>`
  }
  return rows.map((row) => {
    const pct = total > 0 ? Math.round((row.count / total) * 100) : 0
    return `<div class="bar-row">
      <span class="bar-label">${escapeHtml(row.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
      <span class="bar-value">${row.count} (${pct}%)</span>
    </div>`
  }).join("")
}

function renderDashboard(input: {
  totalUsers: number
  uniqueIPs: number
  onlineCount: number
  todayNew: number
  dau: number
  wau: number
  retention: {
    d1_cohort: number
    d1_rate: number | null
    d7_cohort: number
    d7_rate: number | null
  }
  adoption: {
    latestVersion: string
    latestCount: number
    known: number
    latestRate: number | null
  }
  versions: Array<{ version: string; count: number }>
  platforms: Array<{ platform: string; count: number }>
  dailyRows: Array<{ date: string; new_users: number; total_users: number; peak_online: number }>
  serverTime: string
  dashboardKey: string
}): string {
  const versionRows = input.versions.map((v) => ({ label: v.version, count: v.count }))
  const platformRows = input.platforms.map((p) => ({ label: p.platform, count: p.count }))

  // 样本不足时显示「样本不足」而不是 0%，避免误读成留存为零
  const rateText = (rate: number | null, cohort: number) =>
    cohort <= 0 || rate === null ? `<span class="na">样本不足</span>` : `${rate}%`

  const dailyRows = input.dailyRows.length > 0
    ? input.dailyRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${row.new_users}</td>
        <td>${row.total_users}</td>
        <td>${row.peak_online}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="empty">暂无数据（cron 每 5 分钟生成快照）</td></tr>`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>青幕AI写作 - 用户统计</title>
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
    .activity .number { color: #c084fc; }
    .retention .number { color: #fbbf24; }
    .adopt .number { color: #2dd4bf; }
    .na { font-size: 1.1rem; color: #64748b; font-weight: 500; }
    .panel { overflow: hidden; border: 1px solid #334155; border-radius: 8px; background: #111827; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.85rem; border-bottom: 1px solid #1f2937; text-align: left; vertical-align: top; font-size: 0.9rem; }
    th { color: #94a3b8; background: #0f172a; font-weight: 600; }
    .empty { color: #64748b; text-align: center; padding: 0.75rem; }
    .bar-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.55rem 0.85rem; border-bottom: 1px solid #1f2937; font-size: 0.9rem; }
    .bar-row:last-child { border-bottom: none; }
    .bar-label { width: 130px; flex: none; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { flex: 1; height: 8px; background: #1f2937; border-radius: 999px; overflow: hidden; }
    .bar-fill { display: block; height: 100%; background: #38bdf8; border-radius: 999px; }
    .bar-value { width: 110px; flex: none; text-align: right; color: #94a3b8; font-variant-numeric: tabular-nums; }
    .footer { margin-top: 1.5rem; color: #64748b; font-size: 0.8rem; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <h1>青幕AI写作后台</h1>
    <p class="subtle">用户统计概览。反馈请到设置页提交（走 Sentry）。</p>

    <h2>核心指标</h2>
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

    <h2>活跃度</h2>
    <div class="grid">
      <div class="card activity">
        <div class="number">${input.dau}</div>
        <div class="label">近 24 小时活跃设备 (DAU)</div>
      </div>
      <div class="card activity">
        <div class="number">${input.wau}</div>
        <div class="label">近 7 天活跃设备 (WAU)</div>
      </div>
    </div>

    <h2>版本分布</h2>
    <div class="grid">
      <div class="card adopt">
        <div class="number">${input.adoption.latestRate === null ? "—" : `${input.adoption.latestRate}%`}</div>
        <div class="label">最新版本占比（v${escapeHtml(input.adoption.latestVersion || "—")}：${input.adoption.latestCount} / ${input.adoption.known} 台已知版本设备）</div>
      </div>
    </div>
    <div class="panel">${renderBarRows(versionRows, input.totalUsers)}</div>

    <h2>留存率</h2>
    <div class="grid">
      <div class="card retention">
        <div class="number">${rateText(input.retention.d1_rate, input.retention.d1_cohort)}</div>
        <div class="label">次日留存（样本 ${input.retention.d1_cohort} 台）</div>
      </div>
      <div class="card retention">
        <div class="number">${rateText(input.retention.d7_rate, input.retention.d7_cohort)}</div>
        <div class="label">7 日留存（样本 ${input.retention.d7_cohort} 台）</div>
      </div>
    </div>

    <h2>平台分布</h2>
    <div class="panel">${renderBarRows(platformRows, input.totalUsers)}</div>

    <h2>最近 7 天</h2>
    <div class="panel">
      <table>
        <thead>
          <tr><th>日期</th><th>新增</th><th>累计</th><th>峰值在线</th></tr>
        </thead>
        <tbody>${dailyRows}</tbody>
      </table>
    </div>

    <div class="footer">
      <p>数据更新时间：${escapeHtml(input.serverTime)}</p>
      <p>在线人数按最近 15 分钟内有心跳的去重设备计算；客户端心跳间隔 5 分钟。</p>
      <p>DAU/WAU 按最近一次活跃时间统计，口径与"打开过"不同，反映真实使用。</p>
      <p>独立 IP 数按 IP 的 SHA-256 哈希去重，只存哈希不存明文；同一 IP 多次下载只计 1。</p>
      <p>留存率按注册日分群，仅统计已过完整观察窗的样本；「样本不足」表示该窗口还没有足够用户。</p>
      <p>最新版本占比的分母只算「已知版本」设备：版本号自 v4.3.9 起才上报，此前的老用户显示为「未知」不计入。</p>
    </div>
  </main>
</body>
</html>`
}

/** GET /dashboard - HTML 仪表盘（需要密钥） */
async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const auth = new URL(request.url).searchParams.get("key")
  if (auth !== env.STATS_SECRET) {
    return new Response("需要密钥: ?key=你的密钥", { status: 401 })
  }

  const metrics = await collectMetrics(env)
  const activity = await collectActivity(env)
  const versions = await collectVersionDistribution(env)
  const platforms = await collectPlatformDistribution(env)

  const uniqueIPs = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ip_hash) as count FROM users WHERE ip_hash <> ''`
  ).first<{ count: number }>()

  const daily = await env.DB.prepare(
    `SELECT date, new_users, total_users, peak_online FROM daily_stats
     ORDER BY date DESC LIMIT 7`
  ).all<{ date: string; new_users: number; total_users: number; peak_online: number }>()

  const retention = await collectRetention(env)
  const adoption = await collectVersionAdoption(env, versions)

  const html = renderDashboard({
    totalUsers: metrics.totalUsers,
    uniqueIPs: uniqueIPs?.count ?? 0,
    onlineCount: metrics.onlineCount,
    todayNew: metrics.todayNew,
    dau: activity.dau,
    wau: activity.wau,
    retention,
    adoption,
    versions,
    platforms,
    dailyRows: daily.results ?? [],
    serverTime: new Date().toISOString(),
    dashboardKey: auth,
  })

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  })
}

/** 定时任务：清理超时会话 + 更新每日统计快照 */
async function handleScheduled(env: Env): Promise<void> {
  const now = new Date()
  const staleCutoff = new Date(now.getTime() - STALE_SESSION_MS).toISOString()

  // 超过宽松阈值仍无活动的会话标记离线（僵尸会话兜底清理）。
  // 在线人数的实时判定以 last_active + 15 分钟窗口为准，不依赖本步骤。
  await env.DB.prepare(
    `UPDATE sessions SET is_online = 0, close_time = ?1
     WHERE is_online = 1 AND last_active < ?2`
  ).bind(now.toISOString(), staleCutoff).run()

  const today = utcDateKey(now)
  const totalUsers = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users`
  ).first<{ count: number }>()
  const todayNew = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM users WHERE first_seen >= ?1`
  ).bind(today).first<{ count: number }>()
  const currentOnline = await countActiveUsers(env, activeCutoff(now))

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
