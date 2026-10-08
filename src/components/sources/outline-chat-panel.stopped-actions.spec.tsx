// @vitest-environment jsdom
//
// 问题一（大纲侧）：停止生成之后只留一句「已停止生成。」，用户没有下一步可点。
// 用户停止往往是想换个模型再试，所以必须当场给出「重试」和「继续」。
// 这里通过完整挂载 OutlineChatPanel 验证按钮真的出现在已停止的那条回复下方，
// 并且「继续」真的把续写提示词发了出去。
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-store")>()),
  saveAiOutlineModel: vi.fn(async () => {}),
  saveOutlineWorkflowMode: vi.fn(async () => {}),
}))

import { AgentRunner } from "@/lib/agent/runner"
import { CONTINUE_STOPPED_GENERATION_PROMPT } from "@/lib/novel/stopped-generation"
import { useWikiStore } from "@/stores/wiki-store"
import { OutlineChatPanel } from "./outline-chat-panel"
import {
  useOutlineChatStore,
  type OutlineChatConversation,
  type OutlineChatMessage,
} from "@/stores/outline-chat-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STOPPED_WITH_CONTENT =
  "## 主线\n主角踏上旅途。\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。"
const STOPPED_EMPTY = "已停止生成。"

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

function conversation(messages: OutlineChatMessage[]): OutlineChatConversation {
  return { id: "outline-active", title: "测试大纲会话", createdAt: 100, updatedAt: 100, messages }
}

function assistantMessage(content: string, id = "assistant-1"): OutlineChatMessage {
  return { id, role: "assistant", content, timestamp: 2 } as OutlineChatMessage
}

function setOutlineConversations(messages: OutlineChatMessage[]) {
  useOutlineChatStore.setState({
    conversations: [conversation(messages)],
    activeConversationId: "outline-active",
    streamingContents: {},
    runStates: {},
    loaded: true,
    pendingReferenceTokens: [],
    dismissedIntentPromptIds: {},
  })
}

async function renderPanel() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ container, root })
  await act(async () => {
    root.render(<OutlineChatPanel onClose={() => {}} />)
  })
  return container
}

const actions = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-ui-stopped-generation-actions]")
const button = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-ui-stopped-generation-actions] button[aria-label^="${label}"]`,
  )

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() })
  useWikiStore.setState({
    project: { id: "project-1", name: "测试项目", path: "C:/Book" },
    llmConfig: { ...useWikiStore.getState().llmConfig, provider: "openai", apiKey: "test-key", model: "gpt-4o" },
    providerConfigs: { openai: { apiKey: "test-key", enabled: true, savedModels: [{ id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 }] } },
    aiChatModel: "gpt-4o",
    aiOutlineModel: "",
    outlineWorkflowMode: "standard",
  })
})

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => { mounted.root.unmount() })
    mounted.container.remove()
  }
  vi.restoreAllMocks()
})

describe("大纲面板：停止生成后的「重试 / 继续」", () => {
  it("带内容停止的回复下方出现重试与继续", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(STOPPED_WITH_CONTENT),
    ])
    const container = await renderPanel()

    expect(actions(container), "停止过的大纲回复必须给出下一步动作").not.toBeNull()
    expect(button(container, "重试")).not.toBeNull()
    expect(button(container, "继续")).not.toBeNull()
  })

  it("一个字都没生成就停止时同样出现", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(STOPPED_EMPTY),
    ])
    const container = await renderPanel()
    expect(button(container, "重试")).not.toBeNull()
    expect(button(container, "继续")).not.toBeNull()
  })

  it("正常生成完的大纲回复不长出这两个按钮", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage("## 主线\n主角踏上旅途。"),
    ])
    const container = await renderPanel()
    expect(actions(container)).toBeNull()
  })

  it("流式生成中不显示（这时正文里也还没有收尾提示）", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(STOPPED_WITH_CONTENT),
    ])
    useOutlineChatStore.setState({
      runStates: { "outline-active": { status: "running", runId: "run-1" } as never },
    })
    const container = await renderPanel()
    expect(actions(container)).toBeNull()
  })

  /**
   * 「重试」在章节侧接到的是重新生成；大纲侧同样接到 handleRegenerate。
   * 这里只验证按钮存在且可点（整条重发要跑完整的 intent/generation 链路，
   * 已有 outline-chat-panel.spec.tsx 覆盖），重点是「继续」真的发出续写提示词。
   */
  it("点「继续」会把续写提示词发出去", async () => {
    const sent: string[] = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      const userMessage = [...messages].reverse().find((message) => message.role === "user")
      const content = userMessage?.content
      sent.push(typeof content === "string" ? content : JSON.stringify(content))
      callbacks.onText("继续写出来的大纲。")
    })

    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(STOPPED_WITH_CONTENT),
    ])
    const container = await renderPanel()

    await act(async () => {
      button(container, "继续")!.click()
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (sent.some((text) => text.includes(CONTINUE_STOPPED_GENERATION_PROMPT))) break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(sent.join("\n"), "「继续」必须发出共用的续写提示词").toContain(
      CONTINUE_STOPPED_GENERATION_PROMPT,
    )
  })
})
