// @vitest-environment jsdom
/**
 * 「插件」视图在**真实内容区**里的路由冒烟测试。
 *
 * 为什么不能只靠 `content-area.tsx` 的源码文本断言：视图若漏了 `case`，
 * 它会掉进 `default:` —— 而 default 渲染的是 **AIChatTabContainer**（不是白屏），
 * `tsc` 不会有任何意见，用户在「插件」位置上看到的是 AI 会话。
 * 所以这里挂真实的 `ContentArea` + 真实的懒加载，只把邻居模块换成桩。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/layout/writing-workspace", () => ({
  WritingWorkspace: () => <div data-testid="stub-writing-workspace" />,
}))
vi.mock("@/components/chat/ai-chat-tab-container", () => ({
  AIChatTabContainer: () => <div data-testid="stub-ai-chat-tab" />,
}))
// 「已安装」tab 用的设置页组件：本用例只验路由，换成桩避免它自己的 Tauri 依赖。
vi.mock("@/components/settings/sections/plugin-section", () => ({
  PluginSection: () => <div data-testid="stub-plugin-section" />,
}))
// 市场命令在 jsdom 里没有宿主，直接给一个空索引；渲染路径与真实命令一致。
// 启停/卸载也要给桩：新版页面自己渲染「已安装」列表并调这些命令（不再委托 PluginSection）。
vi.mock("@/lib/plugins/api", () => ({
  pluginsApi: {
    marketIndex: vi.fn().mockResolvedValue({
      plugins: [],
      fromCache: false,
      fetchedAt: null,
      sourceUrl: "",
    }),
    marketInstall: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    install: vi.fn(),
    installLocal: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    uninstall: vi.fn(),
  },
}))

import { ContentArea } from "@/components/layout/content-area"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

describe("ContentArea → 插件页面", () => {
  it("activeView === 'plugins' 时渲染插件页，而不是掉进 default 的 AI 会话", async () => {
    await act(async () => {
      useWikiStore.getState().setActiveView("plugins")
      root.render(<ContentArea />)
    })
    /*
     * lazy() 的 dynamic import 要跨真实的模块加载；用 `setTimeout(0)` 空转 120 次只是
     * 让出 120 次事件循环，实际耗时可能不到 1ms —— 页面依赖变多后（插件页现在要加载
     * 模型卡片、provider 同步、覆盖表等），冷启动时会在「加载中…」上停住。
     *
     * 所以改成**按时间**等：最多 10 秒，每 50ms 看一次。真实 import 完成就会立刻跳出，
     * 不会白等满 10 秒；超时仍然让断言如实失败，而不是挂住。
     */
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (host.querySelector('[data-ui-page="plugins"]')) break
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      })
    }
    expect(host.querySelector('[data-ui-page="plugins"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-ai-chat-tab"]')).toBeNull()
    // 空索引下会走到诚实空状态（这条同时证明市场 tab 默认打开）
    expect(host.textContent).toContain("市场里还没有插件")
  })
})
