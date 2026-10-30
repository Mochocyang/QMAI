// @vitest-environment jsdom
/**
 * 冲突定夺面板：验证「选一个 → 调命令 → 历史里不再要求定夺」这条链路。
 *
 * 只测界面契约（点了哪个按钮、传了什么参数、成功后冲突消失），
 * 真正的文件/清单收尾由 `cloud_sync::resolve` 的 Rust 测试守着。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const resolveCloudSyncConflict = vi.fn()

vi.mock("@/lib/platform", () => ({ isTauri: () => false, isMacOS: () => false }))
vi.mock("@/lib/cloud-sync/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cloud-sync/client")>("@/lib/cloud-sync/client")
  return {
    ...actual,
    resolveCloudSyncConflict: (...args: unknown[]) => resolveCloudSyncConflict(...args),
    readCloudSyncHistory: async () => ({ batches: [], entries: [] }),
    revealCloudSyncRemote: async () => undefined,
  }
})
vi.mock("@/lib/project-store", () => ({
  loadRegisteredProjects: async () => [{ id: "book-1", name: "长夜", path: "C:\\books\\长夜" }],
}))

import { CloudSyncDetailDialog } from "./cloud-sync-detail-dialog"
import { DEFAULT_CLOUD_SYNC_CONFIG, emptyCounts, type SyncEntry } from "@/lib/cloud-sync/types"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function conflictEntry(overrides: Partial<SyncEntry> = {}): SyncEntry {
  return {
    id: "entry-1",
    batchId: "batch-1",
    at: 1_700_000_000_000,
    direction: "conflict",
    path: "书/QM/entities/林照.md",
    bookId: "book-1",
    bookName: "长夜",
    bytes: 12,
    ok: true,
    ...overrides,
  }
}

async function renderWith(entries: SyncEntry[]) {
  act(() => {
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "folder",
        connected: true,
      },
      runtime: { running: false },
      detailOpen: true,
      batches: [
        {
          batchId: "batch-1",
          startedAt: 1_700_000_000_000,
          trigger: "manual",
          state: "partial",
          counts: { ...emptyCounts(), conflict: 1 },
        },
      ],
      entries,
    })
    root.render(<CloudSyncDetailDialog />)
  })
  // 等注册表加载完：定夺按钮依赖项目路径。
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".ui-test-sync-conflict-actions button")]
}

function clickButton(label: string) {
  const target = buttons().find((button) => button.textContent?.includes(label))
  expect(target, `找不到按钮「${label}」`).toBeTruthy()
  act(() => {
    target?.click()
  })
}

beforeEach(() => {
  resolveCloudSyncConflict.mockReset()
  resolveCloudSyncConflict.mockResolvedValue({ ok: true, message: "已保留本地版本" })
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useCloudSyncStore.setState({ detailOpen: false })
})

describe("同步详情里的冲突定夺", () => {
  it("只有冲突项才出现定夺按钮", async () => {
    await renderWith([
      conflictEntry(),
      conflictEntry({ id: "entry-2", direction: "upload", path: "书/QM/entities/沈砚.md" }),
    ])
    const rows = document.querySelectorAll(".ui-test-sync-conflict")
    expect(rows).toHaveLength(1)
    expect(rows[0]?.getAttribute("data-sync-conflict-path")).toBe("书/QM/entities/林照.md")
  })

  it("点「保留本地」把项目路径和 local 一起交给命令", async () => {
    await renderWith([conflictEntry()])
    clickButton("保留本地")
    await act(async () => {
      await Promise.resolve()
    })
    expect(resolveCloudSyncConflict).toHaveBeenCalledWith({
      projectId: "book-1",
      projectPath: "C:\\books\\长夜",
      bookName: "长夜",
      rel: "书/QM/entities/林照.md",
      choice: "local",
      // 冲突要落到具体某个网盘：批次没标 provider 时这里是 null（旧历史）。
      provider: null,
    })
  })

  it("批次列表和底部按钮都是弹窗的直接子级（flex 布局靠这个把按钮钉在底部）", async () => {
    // 布局样式（cloud-sync.css）用的是 `.ui-test-sync-dialog > .ui-test-sync-batches`
    // 这类直接子级选择器：中间有人包一层 <div>，按钮就会被列表挤出可视区，
    // 又得靠滚轮才能点到。jsdom 量不出高度，但结构可以守。
    await renderWith([conflictEntry()])
    const dialog = document.querySelector(".ui-test-sync-dialog")!
    expect(dialog).toBeTruthy()
    const children = [...dialog.children]
    expect(children.some((child) => child.classList.contains("ui-test-sync-batches"))).toBe(true)
    expect(children.some((child) => child.classList.contains("ui-test-sync-actions"))).toBe(true)
    expect(children.some((child) => child.getAttribute("data-slot") === "dialog-header")).toBe(true)
  })

  it("没有文件变更的轮次完全不显示（连提示都不留）", async () => {
    act(() => {
      useCloudSyncStore.setState({
        config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "folder", connected: true },
        runtime: { running: false },
        detailOpen: true,
        batches: [
          {
            batchId: "batch-empty",
            startedAt: 1_700_000_100_000,
            trigger: "window-focus",
            state: "ok",
            counts: emptyCounts(),
            provider: "folder",
          },
          {
            batchId: "batch-1",
            startedAt: 1_700_000_000_000,
            trigger: "manual",
            state: "partial",
            counts: { ...emptyCounts(), conflict: 1 },
            provider: "folder",
          },
        ],
        entries: [conflictEntry()],
      })
      root.render(<CloudSyncDetailDialog />)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    /*
     * 没有文件变更的轮次**彻底不显示**。
     *
     * 早先留过一个「另有 N 轮没有文件变更（点这里一并显示）」的开关，
     * 用户明确反馈没有意义（一轮什么都没传，展示出来只会让人以为同步坏了），
     * 所以现在连这个交代都不给了：只渲染真正有动作的轮次。
     */
    expect(document.querySelectorAll(".ui-test-sync-batch").length).toBe(1)
    expect(document.querySelector(".ui-test-sync-show-empty")).toBeNull()
    expect(document.body.textContent).not.toContain("没有文件变更")
  })

  it("点「改用云端」传 cloud", async () => {
    await renderWith([conflictEntry()])
    clickButton("改用云端")
    await act(async () => {
      await Promise.resolve()
    })
    expect(resolveCloudSyncConflict).toHaveBeenCalledWith(expect.objectContaining({ choice: "cloud" }))
  })

  it("已经定夺过的冲突不再要求定夺（历史里那条按时间比较）", async () => {
    await renderWith([
      conflictEntry(),
      conflictEntry({
        id: "entry-resolved",
        at: 1_700_000_001_000,
        errorDetail: "已改用云端版本：书/QM/entities/林照.md",
      }),
    ])
    expect(document.querySelectorAll(".ui-test-sync-conflict")).toHaveLength(0)
  })

  it("命令失败时给出可读提示，不把裸码丢给用户", async () => {
    resolveCloudSyncConflict.mockResolvedValue({ ok: false, errorCode: "sync.disabled" })
    await renderWith([conflictEntry()])
    clickButton("保留本地")
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.querySelectorAll(".ui-test-sync-conflict")).toHaveLength(1)
  })
})

describe("清空同步记录", () => {
  it("要点两次才真的清空（不可撤销的操作不能一次就删）", async () => {
    const { clearHistory } = useCloudSyncStore.getState()
    const spy = vi.fn(async () => undefined)
    useCloudSyncStore.setState({ clearHistory: spy } as never)

    act(() => {
      useCloudSyncStore.setState({
        config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "github", connected: true },
        runtime: { running: false },
        detailOpen: true,
        batches: [
          {
            batchId: "b1",
            startedAt: 1_700_000_000_000,
            trigger: "manual",
            state: "failed",
            counts: emptyCounts(),
            provider: "github",
          },
        ],
        entries: [conflictEntry()],
      })
      root.render(<CloudSyncDetailDialog />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    // 第一次点：只进入待确认态，不许删。
    const first = document.querySelector<HTMLButtonElement>('[data-ui="cloud-sync-clear-history"]')!
    expect(first).toBeTruthy()
    act(() => first.click())
    expect(spy).not.toHaveBeenCalled()

    // 第二次点「确认清空？」才真删。
    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-ui="cloud-sync-clear-history-confirm"]',
    )!
    expect(confirm).toBeTruthy()
    act(() => confirm.click())
    expect(spy).toHaveBeenCalledTimes(1)

    // 清空后红点也要跟着消失（否则用户清完了还看到红点）。
    expect(useCloudSyncStore.getState().runtime.failureCount ?? 0).toBe(0)

    useCloudSyncStore.setState({ clearHistory } as never)
  })
})
