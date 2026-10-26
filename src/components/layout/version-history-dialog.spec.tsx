// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { VersionHistoryDialog, formatVersionTime } from "./version-history-dialog"
import type { VersionEntry } from "@/lib/novel/version-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const versions: VersionEntry[] = [
  {
    fileName: "20261026-090000-bbbb.md",
    path: "/v/b",
    at: new Date(2026, 9, 26, 9, 0, 0),
    hash: "bbbb",
    content: "新的一句",
  },
  {
    fileName: "20261024-213000-aaaa.md",
    path: "/v/a",
    at: new Date(2026, 9, 24, 21, 30, 0),
    hash: "aaaa",
    content: "旧的一句",
  },
]

describe("formatVersionTime", () => {
  const at = new Date(2026, 9, 26, 9, 0, 0)
  it("按本地时间显示到分钟", () => {
    expect(formatVersionTime(at, new Date(2026, 9, 26, 9, 30, 0))).toContain("2026-10-26 09:00")
  })
  it("一分钟内说刚刚", () => {
    expect(formatVersionTime(at, new Date(2026, 9, 26, 9, 0, 30))).toContain("刚刚")
  })
  it("分钟 / 小时 / 天三种相对说法", () => {
    expect(formatVersionTime(at, new Date(2026, 9, 26, 9, 5, 0))).toContain("5 分钟前")
    expect(formatVersionTime(at, new Date(2026, 9, 26, 12, 0, 0))).toContain("3 小时前")
    expect(formatVersionTime(at, new Date(2026, 9, 28, 9, 0, 0))).toContain("2 天前")
  })
})

describe("历史版本弹窗", () => {
  let host: HTMLDivElement
  let root: Root

  function render(props: Partial<Parameters<typeof VersionHistoryDialog>[0]> = {}) {
    act(() => {
      root.render(
        <VersionHistoryDialog
          title="第 1 章"
          currentContent="新的一句"
          versions={versions}
          onClose={() => {}}
          onRestore={() => {}}
          {...props}
        />,
      )
    })
  }

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  it("列出所有版本并显示版本时间", () => {
    render()
    expect(host.textContent).toContain("2026-10-26 09:00")
    expect(host.textContent).toContain("2026-10-24 21:30")
  })

  it("绝不出现「查看历史版本」字样", () => {
    render()
    expect(host.textContent).not.toContain("查看历史版本")
    expect(host.textContent).toContain("历史版本")
  })

  it("默认选中最新版本；与当前一致时没有恢复按钮", () => {
    render()
    expect(host.textContent).toContain("与当前版本一致")
    expect(host.textContent).not.toContain("恢复这个版本")
  })

  it("点旧版本后显示差异与恢复按钮，回调带该版本", () => {
    const onRestore = vi.fn()
    render({ currentContent: "当前的内容", onRestore })

    const older = [...host.querySelectorAll<HTMLButtonElement>("[data-version-item]")].find((button) =>
      button.textContent?.includes("2026-10-24 21:30"),
    )!
    act(() => older.click())

    // 「旧的一句」→「当前的内容」应产生删除行 + 新增行
    expect(host.querySelectorAll('[data-kind="removed"]').length).toBeGreaterThan(0)
    expect(host.querySelectorAll('[data-kind="added"]').length).toBeGreaterThan(0)

    const restore = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "恢复这个版本",
    )!
    act(() => restore.click())
    expect(onRestore).toHaveBeenCalledWith(versions[1])
  })

  it("没有历史版本时给一句人话", () => {
    render({ versions: [] })
    expect(host.textContent).toContain("还没有历史版本")
    expect(host.querySelectorAll("[data-version-item]").length).toBe(0)
  })

  it("点关闭会回调 onClose", () => {
    const onClose = vi.fn()
    render({ onClose })
    const close = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "关闭",
    )!
    act(() => close.click())
    expect(onClose).toHaveBeenCalled()
  })
})
