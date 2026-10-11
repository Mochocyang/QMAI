// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"

vi.mock("./writing-workspace", () => ({ WritingWorkspace: () => <div data-testid="stub-writing-workspace" /> }))
vi.mock("@/components/chat/ai-chat-tab-container", () => ({
  AIChatTabContainer: () => <div data-testid="stub-ai-chat-tab" />,
}))
vi.mock("@/components/skill-library/unified-skill-library-view", () => ({
  UnifiedSkillLibraryView: () => <div data-testid="stub-unified-skill-library" />,
}))

import { ContentArea } from "./content-area"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function renderWithView(activeView: "writingStyleLibrary" | "writingSkillLibrary" | "characterSoulLibrary" | "skillLibrary") {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    useWikiStore.getState().setActiveView(activeView)
    root.render(<ContentArea />)
  })
  // lazy() 的 dynamic import 需要多轮微任务才能落地
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  return { container, root }
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  document.body.removeChild(container)
}

describe("ContentArea 技能库视图路由", () => {
  beforeEach(() => {
    useWikiStore.getState().setActiveView("skillLibrary")
  })

  /*
   * 行为测试，不是源码文本断言：内容区的 switch 若漏掉新视图，
   * 它会掉进 `default:` —— 而 default 渲染的是 **AIChatTabContainer**（不是白屏），
   * 于是「技能库」位置上出现 AI 会话，`tsc` 不会有任何意见。
   */
  it("renders the unified skill library for the 文风 view", async () => {
    const { container, root } = await renderWithView("writingStyleLibrary")

    expect(container.querySelector('[data-testid="stub-unified-skill-library"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stub-ai-chat-tab"]')).toBeNull()

    cleanup(root, container)
  })

  it("renders the unified skill library for the existing writing-skill view", async () => {
    const { container, root } = await renderWithView("writingSkillLibrary")

    expect(container.querySelector('[data-testid="stub-unified-skill-library"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stub-ai-chat-tab"]')).toBeNull()

    cleanup(root, container)
  })

  it("renders the unified skill library for the 角色灵魂 view", async () => {
    const { container, root } = await renderWithView("characterSoulLibrary")

    expect(container.querySelector('[data-testid="stub-unified-skill-library"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stub-ai-chat-tab"]')).toBeNull()

    cleanup(root, container)
  })
})
