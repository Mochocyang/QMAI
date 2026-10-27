/**
 * 官网公告（announcements.json）的读取与归一化。
 *
 * 为什么所有校验都收在这个文件里：那份 JSON 由人手工维护，字段写错、id 重复、
 * 发布时间写成"2026年10月27日"都是常态。客户端的原则是**坏数据只丢那一条**，
 * 绝不能因为一条公告写错就让整个列表消失 —— 那会表现为"公告功能坏了"。
 *
 * 另一条硬规则：拉取失败返回 null，绝不抛异常。公告是弱依赖，
 * 断网时软件必须照常能用，界面显示上一次的缓存即可。
 */

import { getHttpFetch } from "@/lib/tauri-fetch"

export interface Announcement {
  id: string
  title: string
  body: string
  /** epoch ms */
  publishedAt: number
  pinned: boolean
  url?: string
}

export interface AnnouncementsResult {
  items: Announcement[]
  fetchedAt: number
}

const MAX_TITLE_LENGTH = 60
const MAX_BODY_LENGTH = 2000
const MAX_ITEMS = 50
const FETCH_TIMEOUT_MS = 8_000

/**
 * 主域名优先，备用域名是应对 CDN/域名单点故障 —— 不是同一地址重试。
 * www 与裸域由同一次 Pages 部署同时覆盖（见官网部署记录）。
 */
export const ANNOUNCEMENTS_URLS = [
  "https://www.qmai.pro/announcements.json",
  "https://qmai.pro/announcements.json",
]

function asTrimmedString(value: unknown, limit: number): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, limit)
}

/**
 * 结构合法（裸数组，或带 `announcements` 数组的对象）才返回数组，否则 null。
 *
 * 空数组是**合法**结果：官网确实可以一条公告都没有，那不叫失败。
 * 只有连形状都不对（HTML 错误页、字段类型错）才算失败。
 */
export function readAnnouncementList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object") {
    const list = (payload as { announcements?: unknown }).announcements
    if (Array.isArray(list)) return list
  }
  return null
}

/**
 * 发布时间既接受 ISO 字符串（官网 JSON），也接受 epoch ms（本地缓存里的形态）。
 * 缓存直接复用同一个归一化函数，避免"写进去能读回来却全被丢掉"这种哑巴亏。
 */
function toEpochMs(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function normalizeAnnouncements(payload: unknown): Announcement[] {
  const list = readAnnouncementList(payload)
  if (!list) return []

  const seen = new Set<string>()
  const items: Announcement[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue
    const record = raw as Record<string, unknown>
    const id = asTrimmedString(record.id, 64)
    const title = asTrimmedString(record.title, MAX_TITLE_LENGTH)
    const body = asTrimmedString(record.body, MAX_BODY_LENGTH)
    const publishedAt = toEpochMs(record.publishedAt)
    if (!id || !title || !body || publishedAt === null) continue
    // 重复 id 保留第一条：手写 JSON 复制粘贴出错时，后一条会悄悄覆盖已读状态。
    if (seen.has(id)) continue
    seen.add(id)

    const rawUrl = asTrimmedString(record.url, 2048)
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined

    items.push({ id, title, body, publishedAt, pinned: record.pinned === true, url })
  }

  // 排序不依赖文件顺序：置顶优先，其次按发布时间倒序。
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.publishedAt - a.publishedAt
  })
  return items.slice(0, MAX_ITEMS)
}

/** 列表里的日期：同年 "10-27"，跨年 "2025-12-31"。 */
export function formatAnnouncementDate(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, "0")
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (date.getFullYear() === new Date(now).getFullYear()) return monthDay
  return `${date.getFullYear()}-${monthDay}`
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 日期。 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return ""
  const diff = now - timestamp
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return formatAnnouncementDate(timestamp, now)
}

/**
 * 拉一次公告。**永远不抛**：失败返回 null，调用方保留本地缓存。
 *
 * 两个域名都试完才算失败；单个域名内部不重试 —— 客户端只有"启动"和"点铃铛"
 * 两个触发点，重试交给下一次触发更省事，也不会在后台堆请求。
 */
export async function fetchAnnouncements(
  options: { urls?: string[]; timeoutMs?: number } = {},
): Promise<AnnouncementsResult | null> {
  const urls = options.urls ?? ANNOUNCEMENTS_URLS
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const httpFetch = await getHttpFetch()

  for (const url of urls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await httpFetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
      if (!response.ok) continue
      const payload: unknown = await response.json()
      const list = readAnnouncementList(payload)
      if (!list) continue
      return { items: normalizeAnnouncements(list), fetchedAt: Date.now() }
    } catch (error) {
      console.warn(`[announcements] 拉取失败：${url}`, error)
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}
