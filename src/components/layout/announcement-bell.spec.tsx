// @vitest-environment jsdom
/**
 * 铃铛的观察点只有两个：**未读数**和**点了会怎样**。
 * 数字画错（已读还算未读、9 条以上不封顶）用户会当成在骗他；
 * 没有可访问名称则读屏软件只会念"按钮"。
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { messages } = vi.hoisted(() => ({
  messages: {
    "announcements.bell": "公告",
    "announcements.bellWithUnread": "公告，{{count}} 条未读",
  } as Record<string, string>,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      (messages[key] ?? key).replace("{{count}}", String(options?.count ?? "")),
  }),
}))

import { useAnnouncementStore } from "@/stores/announcement-store"
import { AnnouncementBell } from "./announcement-bell"

let host: HTMLDivElement
let root: Root

function announcement(id: string) {
  return { id, title: id, body: "正文", publishedAt: Date.now(), pinned: false }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  useAnnouncementStore.setState({
    items: [],
    readIds: new Set<string>(),
    dialogOpen: false,
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("AnnouncementBell", () => {
  it("未读时显示数字角标与带数量的可访问名称", async () => {
    useAnnouncementStore.setState({
      items: [announcement("a1"), announcement("a2")],
      readIds: new Set(["a1"]),
    })

    await act(async () => root.render(<AnnouncementBell />))

    const button = document.querySelector("button")
    expect(button?.getAttribute("aria-label")).toBe("公告，1 条未读")
    // 角标只是一个「有新公告」的小红点，不再画数字。
    // 未读数量仍然通过 aria-label / title 完整播报（上一行断言的就是它）。
    const badge = host.querySelector("[data-announcement-badge]")
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe("")
  })

  it("未读数量只在无障碍属性里给，角标不画数字", async () => {
    useAnnouncementStore.setState({
      items: Array.from({ length: 12 }, (_, i) => announcement(`a${i}`)),
      readIds: new Set<string>(),
    })

    await act(async () => root.render(<AnnouncementBell />))

    expect(host.querySelector("[data-announcement-badge]")?.textContent).toBe("")
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("公告，12 条未读")
  })

  it("全部已读时不渲染角标", async () => {
    useAnnouncementStore.setState({
      items: [announcement("a1")],
      readIds: new Set(["a1"]),
    })

    await act(async () => root.render(<AnnouncementBell />))

    expect(host.querySelector("[data-announcement-badge]")).toBeNull()
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("公告")
  })

  it("点击打开弹窗", async () => {
    await act(async () => root.render(<AnnouncementBell />))

    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(useAnnouncementStore.getState().dialogOpen).toBe(true)
  })
})
