// @vitest-environment jsdom
//
// 大纲面板：生成失败之后只留一句「生成失败：…」/「⚠️ 生成中断：…」，
// 用户没有下一步可点。这里通过完整挂载 OutlineChatPanel 验证
// 「重试 / 继续」真的出现在失败回复下方（并在保存 / 复制那一排里），
// 以及「继续」真的把失败续写提示词发了出去。
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-store")>()),
  saveAiOutlineModel: vi.fn(async () => {}),
  saveOutlineWorkflowMode: vi.fn(async () => {}),
}))

import { AgentRunner } from "@/lib/agent/runner"
import type { AgentRunRecord } from "@/lib/agent/types"
import { FAILED_GENERATION_CONTINUE_PROMPT } from "@/lib/novel/failed-generation"
import { useWikiStore } from "@/stores/wiki-store"
import { OutlineChatPanel } from "./outline-chat-panel"
import {
  useOutlineChatStore,
  type OutlineChatConversation,
  type OutlineChatMessage,
} from "@/stores/outline-chat-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FAILED_WITH_CONTENT =
  "## 主线\n主角踏上旅途。\n\n---\n\n⚠️ 生成中断：请求超时"
const FAILED_EMPTY = "生成失败：模型不存在"

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
  container.querySelector<HTMLElement>("[data-ui-failed-generation-actions]")
const button = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-ui-failed-generation-actions] button[aria-label="${label}"]`,
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

describe("大纲面板：生成失败后的「重试 / 继续」", () => {
  it("保留半截内容的中断回复下方出现重试与继续", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(FAILED_WITH_CONTENT),
    ])
    const container = await renderPanel()

    expect(actions(container), "失败的大纲回复必须给出下一步动作").not.toBeNull()
    expect(button(container, "重试")).not.toBeNull()
    expect(button(container, "继续")).not.toBeNull()
  })

  it("「重试 / 继续」长在保存、复制那一排里（同一行容器）", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(FAILED_WITH_CONTENT),
    ])
    const container = await renderPanel()

    const save = container.querySelector<HTMLElement>('button[aria-label="保存为大纲"]')
    const copy = container.querySelector<HTMLElement>('button[aria-label="复制"]')
    expect(save).not.toBeNull()
    expect(copy).not.toBeNull()
    const row = save!.parentElement!
    expect(row.contains(actions(container)!) || row.nextElementSibling !== null).toBe(true)
    expect(actions(container)!.querySelector("button svg")).not.toBeNull()
  })

  it("一个字都没产出就失败时「继续」禁用、「重试」可用", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(FAILED_EMPTY),
    ])
    const container = await renderPanel()
    expect(button(container, "重试")!.disabled).toBe(false)
    expect(button(container, "继续")!.disabled).toBe(true)
  })

  it("失败的消息不再重复渲染「重新生成」", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(FAILED_WITH_CONTENT),
    ])
    const container = await renderPanel()
    expect(container.querySelector('button[aria-label="重新生成"]')).toBeNull()
  })

  it("正常生成完的大纲回复不长出这两个按钮", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage("## 主线\n主角踏上旅途。"),
    ])
    const container = await renderPanel()
    expect(actions(container)).toBeNull()
  })

  it("流式生成中不显示", async () => {
    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(FAILED_WITH_CONTENT),
    ])
    useOutlineChatStore.setState({
      runStates: { "outline-active": { status: "running", runId: "run-1" } as never },
    })
    const container = await renderPanel()
    expect(actions(container)).toBeNull()
  })

  it("点「继续」会把失败续写提示词发出去", async () => {
    const sent: string[] = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      const userMessage = [...messages].reverse().find((message) => message.role === "user")
      const content = userMessage?.content
      sent.push(typeof content === "string" ? content : JSON.stringify(content))
      const generatedText = "接着写出来的大纲。"
      callbacks.onText(generatedText)
      const record: AgentRunRecord = { toolCalls: [], roundsUsed: 1, finalText: generatedText }
      return record
    })

    setOutlineConversations([
      { id: "user-1", role: "user", content: "写个主线大纲", timestamp: 1 } as OutlineChatMessage,
      assistantMessage(FAILED_WITH_CONTENT),
    ])
    const container = await renderPanel()

    await act(async () => {
      button(container, "继续")!.click()
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (sent.some((text) => text.includes(FAILED_GENERATION_CONTINUE_PROMPT))) break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(sent.join("\n"), "「继续」必须发出失败续写提示词").toContain(
      FAILED_GENERATION_CONTINUE_PROMPT,
    )
  })
})
