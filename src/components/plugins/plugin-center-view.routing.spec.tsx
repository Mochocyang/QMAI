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
     * lazy() 的 dynamic import 要跨若干段微任务/宏任务才落地；这里轮询到页面出现为止
     * （最多 32 个宏任务，超时就让下面的断言如实失败，而不是挂住）。
     */
    for (let index = 0; index < 32; index += 1) {
      if (host.querySelector('[data-ui-page="plugins"]')) break
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      })
    }

    expect(host.querySelector('[data-ui-page="plugins"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-ai-chat-tab"]')).toBeNull()
    // 空索引下会走到诚实空状态（这条同时证明市场 tab 默认打开）
    expect(host.textContent).toContain("市场里还没有插件")
  })
})
