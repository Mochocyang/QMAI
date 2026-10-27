// @vitest-environment jsdom
/**
 * 公告 store 的回归点：缓存能不能读回、已读会不会回退、失败会不会把列表清空。
 *
 * 这三条都属于「错了用户立刻能感觉到」：缓存读不回等于每次重启公告重新变未读；
 * 失败清空等于断网后弹窗一片空白，看起来像功能坏了。
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { memory, fetchAnnouncements } = vi.hoisted(() => ({
  memory: new Map<string, unknown>(),
  fetchAnnouncements: vi.fn(),
}))

vi.mock("@/lib/web-store", () => ({
  getStore: async () => ({
    get: async (key: string) => memory.get(key),
    set: async (key: string, value: unknown) => {
      memory.set(key, value)
    },
    delete: async (key: string) => memory.delete(key),
    save: async () => {},
  }),
}))

vi.mock("@/lib/announcements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/announcements")>()
  return {
    ...actual,
    fetchAnnouncements: (...args: unknown[]) => fetchAnnouncements(...args),
  }
})

import { useAnnouncementStore } from "./announcement-store"

function remote(id: string, publishedAt = Date.parse("2026-10-27T09:00:00+08:00")) {
  return { id, title: id, body: "正文", publishedAt, pinned: false }
}

beforeEach(() => {
  memory.clear()
  fetchAnnouncements.mockReset()
  useAnnouncementStore.setState({
    items: [],
    readIds: new Set<string>(),
    lastFetchedAt: null,
    status: "idle",
    dialogOpen: false,
  })
})

describe("announcement-store", () => {
  it("hydrate 读回缓存与已读；脏数据按空处理", async () => {
    memory.set("announcementsCache", { items: [remote("a1")], fetchedAt: 111 })
    memory.set("announcementReadIds", "不是数组")

    await useAnnouncementStore.getState().hydrate()

    const state = useAnnouncementStore.getState()
    expect(state.items.map((a) => a.id)).toEqual(["a1"])
    expect(state.lastFetchedAt).toBe(111)
    expect(state.readIds.size).toBe(0)
  })

  it("hydrate 读回已读 id", async () => {
    memory.set("announcementsCache", { items: [remote("a1"), remote("a2")], fetchedAt: 111 })
    memory.set("announcementReadIds", ["a2"])

    await useAnnouncementStore.getState().hydrate()

    expect([...useAnnouncementStore.getState().readIds]).toEqual(["a2"])
  })

  it("markRead 幂等且写盘", async () => {
    fetchAnnouncements.mockResolvedValue({ items: [remote("a1"), remote("a2")], fetchedAt: 5 })
    await useAnnouncementStore.getState().refresh()

    await useAnnouncementStore.getState().markRead("a1")
    await useAnnouncementStore.getState().markRead("a1")

    expect(useAnnouncementStore.getState().readIds.size).toBe(1)
    expect(memory.get("announcementReadIds")).toEqual(["a1"])
  })

  it("markAllRead 清掉全部未读", async () => {
    fetchAnnouncements.mockResolvedValue({ items: [remote("a1"), remote("a2")], fetchedAt: 5 })
    await useAnnouncementStore.getState().refresh()

    await useAnnouncementStore.getState().markAllRead()

    expect(useAnnouncementStore.getState().readIds.size).toBe(2)
    expect(useAnnouncementStore.getState().items).toHaveLength(2)
  })

  it("refresh 失败保留旧数据并置 error", async () => {
    fetchAnnouncements.mockResolvedValueOnce({ items: [remote("a1")], fetchedAt: 5 })
    await useAnnouncementStore.getState().refresh()

    fetchAnnouncements.mockResolvedValueOnce(null)
    await useAnnouncementStore.getState().refresh()

    const state = useAnnouncementStore.getState()
    expect(state.items.map((a) => a.id)).toEqual(["a1"])
    expect(state.status).toBe("error")
  })

  it("并发 refresh 只发一次请求", async () => {
    fetchAnnouncements.mockResolvedValue({ items: [remote("a1")], fetchedAt: 5 })

    await Promise.all([
      useAnnouncementStore.getState().refresh(),
      useAnnouncementStore.getState().refresh(),
    ])

    expect(fetchAnnouncements).toHaveBeenCalledTimes(1)
  })

  it("已读 id 只保留当前列表里存在的", async () => {
    fetchAnnouncements.mockResolvedValue({ items: [remote("a1")], fetchedAt: 5 })
    useAnnouncementStore.setState({ readIds: new Set(["old-1", "old-2", "a1"]) })

    await useAnnouncementStore.getState().refresh()

    expect([...useAnnouncementStore.getState().readIds]).toEqual(["a1"])
  })

  it("openDialog 打开并触发一次刷新", async () => {
    fetchAnnouncements.mockResolvedValue({ items: [], fetchedAt: 5 })

    useAnnouncementStore.getState().openDialog()

    expect(useAnnouncementStore.getState().dialogOpen).toBe(true)
    await vi.waitFor(() => expect(fetchAnnouncements).toHaveBeenCalledTimes(1))
  })

  it("closeDialog 只关弹窗，不动列表", async () => {
    fetchAnnouncements.mockResolvedValue({ items: [remote("a1")], fetchedAt: 5 })
    await useAnnouncementStore.getState().refresh()

    useAnnouncementStore.getState().openDialog()
    useAnnouncementStore.getState().closeDialog()

    expect(useAnnouncementStore.getState().dialogOpen).toBe(false)
    expect(useAnnouncementStore.getState().items).toHaveLength(1)
  })
})
