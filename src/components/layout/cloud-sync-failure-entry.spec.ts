// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { DEFAULT_CLOUD_SYNC_CONFIG } from "@/lib/cloud-sync/types"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

/*
 * 云图标点开「同步失败」的契约测试。
 *
 * 用源码结构断言（该组件依赖 Tooltip/事件订阅，mount 成本高、且我们断的是
 * "点击走哪个分支"这种结构事实）。真正跑起来的路径由 cloud-sync-indicator.spec 覆盖。
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "cloud-sync-indicator.tsx"), "utf8")

describe("云图标的同步失败入口", () => {
  it("失败列表只从历史条目算，不用运行态残留计数", () => {
    expect(source).toContain("entries.filter((entry) => !entry.ok)")
    // 运行态的 failureCount 曾经会永久挂着（假警报），这里不该再出现
    expect(source).not.toContain("runtime.failureCount")
  })

  it("有失败时点图标先弹失败列表，没失败才开详情", () => {
    expect(source).toContain("if (failedEntries.length > 0) {")
    // 点图标是**开关**：已打开时要能关掉，所以用取反而不是直接 true。
    expect(source).toContain("setFailuresOpen((previous) => !previous)")
    const clickBlock = source.slice(source.indexOf("const handleClick"))
    expect(clickBlock.indexOf("setFailuresOpen((previous) => !previous)")).toBeLessThan(
      clickBlock.indexOf("openDetail()"),
    )
  })

  it("点下拉外面或按 Esc 也要能关掉（不能只靠里面的按钮）", () => {
    // 用户投诉过：下拉打开后点页面别处不消失，一直挡着内容。
    expect(source).toContain('document.addEventListener("mousedown", onPointerDown, true)')
    expect(source).toContain('document.addEventListener("keydown", onKeyDown)')
    expect(source).toContain('event.key === "Escape"')
    // 点锚点内部不算"点外面"，否则点图标会先被判定为外部点击又被 onClick 打开
    expect(source).toContain("anchorRef.current?.contains(target)")
  })

  it("失败列表展示路径与原因，并能跳到完整详情", () => {
    expect(source).toContain('data-ui="cloud-sync-failure-list"')
    expect(source).toContain("data-failure-path={entry.path}")
    expect(source).toContain("resolveNotice(entry.errorCode)")
    expect(source).toContain("查看全部")
  })
})

describe("同步失败数不能靠运行态残留", () => {
  it("历史里没有失败条目时，失败数为 0", () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, connected: true },
      entries: [],
      runtime: { running: false, failureCount: 0 },
    })
    expect(useCloudSyncStore.getState().entries.filter((entry) => !entry.ok)).toHaveLength(0)
  })
})
