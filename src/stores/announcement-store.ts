/**
 * 公告的客户端状态：拿到什么、读过什么、弹窗开没开。
 *
 * 三条硬规则：
 * 1. 拉取失败**不清空**已有列表 —— 断网时用户仍应看到上次的公告。
 * 2. 已读只增不减（只按当前列表修剪），收起或重开弹窗不会退回未读。
 * 3. 持久化失败只 warn，不影响界面 —— 公告不是关键数据，不能因为它写盘失败
 *    就把写作流程卡住。
 *
 * 读状态存在 app-state.json（跨窗口共享、原子写、有 .bak 恢复），
 * 刻意不放 localStorage：那里既不同步独立窗口，也不进备份迁移。
 */

import { create } from "zustand"

import { fetchAnnouncements, normalizeAnnouncements, type Announcement } from "@/lib/announcements"
import { getStore } from "@/lib/web-store"

export const ANNOUNCEMENTS_CACHE_KEY = "announcementsCache"
export const ANNOUNCEMENT_READ_IDS_KEY = "announcementReadIds"

const MAX_READ_IDS = 200

interface CachedAnnouncements {
  items: Announcement[]
  fetchedAt: number
}

export interface AnnouncementStoreState {
  items: Announcement[]
  readIds: Set<string>
  lastFetchedAt: number | null
  status: "idle" | "loading" | "ready" | "error"
  dialogOpen: boolean

  /** 启动时读回缓存与已读；脏数据按空处理，绝不抛。 */
  hydrate: () => Promise<void>
  /** 拉一次公告；并发调用共用同一个请求。失败保留旧数据。 */
  refresh: () => Promise<void>
  openDialog: () => void
  closeDialog: () => void
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

/** 未读数放在模块级：selector 引用稳定，组件不会因为每次 render 新建函数而重算。 */
export const selectUnreadCount = (state: AnnouncementStoreState): number =>
  state.items.reduce((count, item) => (state.readIds.has(item.id) ? count : count + 1), 0)

function readIdsFrom(value: unknown, items: Announcement[]): Set<string> {
  if (!Array.isArray(value)) return new Set()
  const known = new Set(items.map((item) => item.id))
  const kept = value.filter((id): id is string => typeof id === "string" && known.has(id))
  return new Set(kept.slice(-MAX_READ_IDS))
}

async function persist(
  items: Announcement[],
  readIds: Set<string>,
  fetchedAt: number | null,
): Promise<void> {
  try {
    const store = await getStore()
    await store.set(ANNOUNCEMENTS_CACHE_KEY, { items, fetchedAt: fetchedAt ?? Date.now() })
    await store.set(ANNOUNCEMENT_READ_IDS_KEY, [...readIds].slice(-MAX_READ_IDS))
  } catch (error) {
    console.warn("[announcements] 保存公告状态失败：", error)
  }
}

/** 单飞：启动拉取与点铃铛拉取撞在一起时，只发一次请求。 */
let inflight: Promise<void> | null = null

export const useAnnouncementStore = create<AnnouncementStoreState>((set, get) => ({
  items: [],
  readIds: new Set(),
  lastFetchedAt: null,
  status: "idle",
  dialogOpen: false,

  hydrate: async () => {
    try {
      const store = await getStore()
      const cache = await store.get<CachedAnnouncements>(ANNOUNCEMENTS_CACHE_KEY)
      const items = normalizeAnnouncements(cache?.items)
      const readIds = readIdsFrom(await store.get<unknown>(ANNOUNCEMENT_READ_IDS_KEY), items)
      const fetchedAt = typeof cache?.fetchedAt === "number" ? cache.fetchedAt : null
      set({
        items,
        readIds,
        lastFetchedAt: fetchedAt,
        status: items.length > 0 ? "ready" : "idle",
      })
    } catch (error) {
      console.warn("[announcements] 读取公告缓存失败：", error)
    }
  },

  refresh: async () => {
    if (inflight) return inflight
    inflight = (async () => {
      set({ status: "loading" })
      const result = await fetchAnnouncements()
      if (!result) {
        set({ status: "error" })
        return
      }
      const readIds = readIdsFrom([...get().readIds], result.items)
      set({ items: result.items, readIds, lastFetchedAt: result.fetchedAt, status: "ready" })
      await persist(result.items, readIds, result.fetchedAt)
    })()
    try {
      await inflight
    } finally {
      inflight = null
    }
  },

  openDialog: () => {
    set({ dialogOpen: true })
    // 打开时先显示缓存，同时补拉一次：公告是低频内容，不做轮询。
    void get().refresh()
  },

  closeDialog: () => set({ dialogOpen: false }),

  markRead: async (id) => {
    const { readIds, items, lastFetchedAt } = get()
    if (readIds.has(id)) return
    const next = new Set(readIds)
    next.add(id)
    set({ readIds: next })
    await persist(items, next, lastFetchedAt)
  },

  markAllRead: async () => {
    const { items, readIds, lastFetchedAt } = get()
    if (items.every((item) => readIds.has(item.id))) return
    const next = new Set(readIds)
    for (const item of items) next.add(item.id)
    set({ readIds: next })
    await persist(items, next, lastFetchedAt)
  },
}))
