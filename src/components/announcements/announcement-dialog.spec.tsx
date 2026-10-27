// @vitest-environment jsdom
/**
 * 弹窗的观察点都是需求原文：展开即已读、一键全部已读、没有清空、
 * 以及断网时不能只剩一片空白。
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { messages, openExternalUrl } = vi.hoisted(() => ({
  messages: {
    "announcements.title": "公告",
    "announcements.unreadSummary": "{{count}} 条未读",
    "announcements.allReadHint": "已全部读完",
    "announcements.markAllRead": "全部已读",
    "announcements.empty": "暂无公告",
    "announcements.loading": "正在获取公告…",
    "announcements.loadFailed": "暂时无法获取公告，请检查网络后重试。",
    "announcements.retry": "重试",
    "announcements.refresh": "刷新",
    "announcements.lastUpdated": "上次更新：{{time}}",
    "announcements.neverUpdated": "尚未获取到公告",
    "announcements.openLink": "查看详情",
    "announcements.pinned": "置顶",
  } as Record<string, string>,
  openExternalUrl: vi.fn(async () => {}),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; time?: string }) => {
      const template = messages[key] ?? key
      return template
        .replace("{{count}}", String(options?.count ?? ""))
        .replace("{{time}}", String(options?.time ?? ""))
    },
  }),
}))

vi.mock("@/lib/open-external-url", () => ({ openExternalUrl }))
vi.mock("@/lib/web-store", () => ({
  getStore: async () => ({
    get: async () => undefined,
    set: async () => {},
    delete: async () => false,
    save: async () => {},
  }),
}))

import { useAnnouncementStore } from "@/stores/announcement-store"
import { AnnouncementDialog } from "./announcement-dialog"

let host: HTMLDivElement
let root: Root

function announcement(id: string, title: string) {
  return { id, title, body: "正文内容", publishedAt: Date.now(), pinned: false }
}

function findButton(text: string) {
  return Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  )
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  useAnnouncementStore.setState({
    items: [],
    readIds: new Set<string>(),
    lastFetchedAt: Date.now(),
    status: "ready",
    dialogOpen: false,
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

describe("AnnouncementDialog", () => {
  it("关闭状态不渲染内容", async () => {
    useAnnouncementStore.setState({ items: [announcement("a1", "唯一公告")], dialogOpen: false })

    await act(async () => root.render(<AnnouncementDialog />))

    expect(document.body.textContent).not.toContain("唯一公告")
  })

  it("列表展示标题；展开后渲染正文并标记已读", async () => {
    useAnnouncementStore.setState({
      items: [announcement("a1", "第一条")],
      dialogOpen: true,
    })

    await act(async () => root.render(<AnnouncementDialog />))
    expect(document.body.textContent).toContain("第一条")
    expect(document.body.textContent).not.toContain("正文内容")

    await act(async () => findButton("第一条")?.click())

    expect(document.body.textContent).toContain("正文内容")
    expect([...useAnnouncementStore.getState().readIds]).toEqual(["a1"])
  })

  it("再点一次收起，但已读不回退", async () => {
    useAnnouncementStore.setState({ items: [announcement("a1", "第一条")], dialogOpen: true })
    await act(async () => root.render(<AnnouncementDialog />))

    await act(async () => findButton("第一条")?.click())
    await act(async () => findButton("第一条")?.click())

    expect(document.body.textContent).not.toContain("正文内容")
    expect(useAnnouncementStore.getState().readIds.has("a1")).toBe(true)
  })

  it("全部已读清空未读，列表仍然保留（没有清空功能）", async () => {
    useAnnouncementStore.setState({
      items: [announcement("a1", "第一条"), announcement("a2", "第二条")],
      dialogOpen: true,
    })

    await act(async () => root.render(<AnnouncementDialog />))
    await act(async () => findButton("全部已读")?.click())

    expect(useAnnouncementStore.getState().readIds.size).toBe(2)
    expect(document.body.textContent).toContain("第一条")
    expect(document.body.textContent).toContain("第二条")
    expect(findButton("清空")).toBeUndefined()
  })

  it("无缓存且拉取失败时显示错误与重试", async () => {
    useAnnouncementStore.setState({ items: [], dialogOpen: true, status: "error" })

    await act(async () => root.render(<AnnouncementDialog />))

    expect(document.body.textContent).toContain("暂时无法获取公告")
    expect(findButton("重试")).toBeTruthy()
  })

  it("空列表显示暂无公告", async () => {
    useAnnouncementStore.setState({ items: [], dialogOpen: true, status: "ready" })

    await act(async () => root.render(<AnnouncementDialog />))

    expect(document.body.textContent).toContain("暂无公告")
  })

  it("顶部显示未读数，全部读完后换成已读完提示", async () => {
    useAnnouncementStore.setState({
      items: [announcement("a1", "第一条")],
      dialogOpen: true,
    })
    await act(async () => root.render(<AnnouncementDialog />))
    expect(document.body.textContent).toContain("1 条未读")

    await act(async () => findButton("全部已读")?.click())
    expect(document.body.textContent).toContain("已全部读完")
  })
})
