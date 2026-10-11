// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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

/**
 * 去掉注释后的源码副本（同仓内其余 `stripComments` 的写法）。
 * 凡是「文件里有没有这个标识符」这类断言，都必须先去掉注释再查 ——
 * 否则一句**讨论**该标识符的注释就能让断言变绿（本仓已栽过多次）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
}

async function renderWithView(
  activeView:
    | "writingStyleLibrary"
    | "writingSkillLibrary"
    | "characterSoulLibrary"
    | "personaSkillLibrary"
    | "skillFavorites"
    | "skillLibrary",
) {
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

  it("renders the unified skill library for the 人物 Skill view", async () => {
    const { container, root } = await renderWithView("personaSkillLibrary")

    expect(container.querySelector('[data-testid="stub-unified-skill-library"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stub-ai-chat-tab"]')).toBeNull()

    cleanup(root, container)
  })

  it("renders the unified skill library for the 收藏 view", async () => {
    const { container, root } = await renderWithView("skillFavorites")

    expect(container.querySelector('[data-testid="stub-unified-skill-library"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stub-ai-chat-tab"]')).toBeNull()

    cleanup(root, container)
  })

  /*
   * ⚠️ 这条守卫来自一次真实的**静默死代码**事故，不是预防性洁癖。
   *
   * `feature/character-skill` 的 `a5b5edd3` 在给技能库加「人物 Skill」时，
   * 除了加 `case "personaSkillLibrary":` 标签，还**多贴了一整份**
   * `content = (<Suspense>…<UnifiedSkillLibraryView />…</Suspense>); break;`。
   * 由于它落在**前一个 `break;` 之后**，那是一段**不可达代码**：
   *   - `tsc` 默认不报不可达代码 ⇒ `npm run typecheck` exit 0；
   *   - 行为与只有一份时**完全相同** ⇒ 全套 764 文件 / 7877 用例照绿；
   *   - 于是它一路合并进了 `main`，没人发现。
   *
   * 它今天仍然只是「冗余」，但这类形状再多几轮就会变成「改了一个渲染点、
   * 另一个还在生效」那种真正难查的问题。所以钉住**渲染点恰好一个**：
   * 源码里 `<UnifiedSkillLibraryView />` 出现 2 次以上就直接红。
   * ⚠️ 先 `stripComments` —— 本文件上下文中「讨论」该组件的注释不算命中。
   */
  it("技能库在内容区只有一个渲染点（防不可达的重复块）", () => {
    const source = stripComments(readFileSync(resolve(__dirname, "content-area.tsx"), "utf8"))
    const renderPoints = source.match(/<UnifiedSkillLibraryView\s*\/>/g) ?? []
    expect(renderPoints).toHaveLength(1)

    // 六个视图名必须都挂在同一个 switch 分组里（漏一个就掉进 default → AI 会话）
    for (const view of [
      "skillLibrary",
      "writingSkillLibrary",
      "writingStyleLibrary",
      "characterSoulLibrary",
      "personaSkillLibrary",
      "skillFavorites",
    ]) {
      expect(source).toContain(`case "${view}":`)
    }
  })
})
