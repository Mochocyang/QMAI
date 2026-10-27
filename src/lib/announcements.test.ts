import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fetchAnnouncements,
  formatAnnouncementDate,
  formatRelativeTime,
  normalizeAnnouncements,
  readAnnouncementList,
} from "./announcements"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: async () => fetchMock,
}))

afterEach(() => {
  fetchMock.mockReset()
})

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    title: "标题",
    body: "正文",
    publishedAt: "2026-10-27T09:00:00+08:00",
    ...overrides,
  }
}

describe("normalizeAnnouncements", () => {
  it("接受整体 payload 与裸数组两种形状", () => {
    expect(normalizeAnnouncements({ announcements: [item()] })).toHaveLength(1)
    expect(normalizeAnnouncements([item()])).toHaveLength(1)
  })

  it("丢弃缺字段与时间不可解析的条目，其余照常保留", () => {
    const result = normalizeAnnouncements({
      announcements: [
        item({ id: "" }),
        item({ title: "" }),
        item({ body: "" }),
        item({ publishedAt: "2026年10月27日" }),
        item({ publishedAt: undefined }),
        item({ id: "ok" }),
      ],
    })
    expect(result.map((a) => a.id)).toEqual(["ok"])
  })

  it("重复 id 保留第一条", () => {
    const result = normalizeAnnouncements([item({ title: "先" }), item({ title: "后" })])
    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe("先")
  })

  it("置顶优先，其次按发布时间倒序", () => {
    const result = normalizeAnnouncements([
      item({ id: "old", publishedAt: "2026-10-01T00:00:00+08:00" }),
      item({ id: "new", publishedAt: "2026-10-20T00:00:00+08:00" }),
      item({ id: "pin", publishedAt: "2026-09-01T00:00:00+08:00", pinned: true }),
    ])
    expect(result.map((a) => a.id)).toEqual(["pin", "new", "old"])
  })

  it("正文截断到 2000 字、标题截断到 60 字", () => {
    const result = normalizeAnnouncements([
      item({ body: "字".repeat(3000), title: "标".repeat(100) }),
    ])
    expect(result[0]?.body).toHaveLength(2000)
    expect(result[0]?.title).toHaveLength(60)
  })

  it("最多保留 50 条", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      item({ id: `a${i}`, publishedAt: new Date(2026, 0, 1, 0, i).toISOString() }),
    )
    expect(normalizeAnnouncements(many)).toHaveLength(50)
  })

  it("缓存里的 epoch ms 时间戳也能读回（与写入形态一致）", () => {
    const cached = { id: "c1", title: "缓存", body: "正文", publishedAt: 1_793_000_000_000, pinned: true }
    const result = normalizeAnnouncements([cached])
    expect(result).toHaveLength(1)
    expect(result[0]?.publishedAt).toBe(1_793_000_000_000)
  })

  it("非法 url 置空、pinned 缺省为 false", () => {
    const [withBadUrl] = normalizeAnnouncements([item({ url: "javascript:alert(1)" })])
    expect(withBadUrl?.url).toBeUndefined()
    expect(withBadUrl?.pinned).toBe(false)
  })
})

describe("readAnnouncementList", () => {
  it("结构合法返回数组，结构非法返回 null", () => {
    expect(readAnnouncementList({ announcements: [] })).toEqual([])
    expect(readAnnouncementList({})).toBeNull()
    expect(readAnnouncementList("x")).toBeNull()
    expect(readAnnouncementList(null)).toBeNull()
  })
})

describe("时间格式化", () => {
  const now = new Date("2026-10-27T12:00:00+08:00").getTime()

  it("按距离给相对时间", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("刚刚")
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前")
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前")
  })

  it("超过一天显示日期，跨年带年份", () => {
    expect(formatRelativeTime(new Date("2026-10-20T09:00:00+08:00").getTime(), now)).toBe("10-20")
    expect(formatAnnouncementDate(new Date("2025-12-31T09:00:00+08:00").getTime(), now)).toBe(
      "2025-12-31",
    )
  })
})

describe("fetchAnnouncements", () => {
  const urls = ["https://primary.test/announcements.json", "https://backup.test/announcements.json"]

  it("主域名成功时直接返回并带上 fetchedAt", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ announcements: [item()] }), { status: 200 }),
    )
    const result = await fetchAnnouncements({ urls })
    expect(result?.items.map((a) => a.id)).toEqual(["a1"])
    expect(result?.fetchedAt).toBeTypeOf("number")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("主域名抛错时换备用域名", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Failed to fetch"))
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ announcements: [item()] }), { status: 200 }),
    )
    const result = await fetchAnnouncements({ urls })
    expect(result?.items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("全部失败或 JSON 损坏返回 null（不抛异常）", async () => {
    fetchMock.mockRejectedValue(new Error("Failed to fetch"))
    await expect(fetchAnnouncements({ urls })).resolves.toBeNull()

    fetchMock.mockReset()
    // 每次调用都要给一个新的 Response：同一个实例的 body 只能读一次。
    fetchMock.mockImplementation(async () => new Response("<html>404</html>", { status: 200 }))
    await expect(fetchAnnouncements({ urls })).resolves.toBeNull()
  })

  it("空列表是合法结果（没有公告不等于失败）", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ announcements: [] }), { status: 200 }),
    )
    const result = await fetchAnnouncements({ urls })
    expect(result?.items).toEqual([])
  })

  it("非 200 响应会被跳过并继续试下一个域名", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }))
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ announcements: [item()] }), { status: 200 }),
    )
    const result = await fetchAnnouncements({ urls })
    expect(result?.items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
