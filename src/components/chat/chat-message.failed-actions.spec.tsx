// @vitest-environment jsdom
//
// 章节面板：生成失败之后，气泡下面只剩一句「出错：…」，用户没有下一步可点。
// 失败这一刻最需要的是「重试」（换模型整条重来）和「继续」（保留半截接着写），
// 所以它们必须和「保存 / 复制」长在同一排图标里。这里验证真的长出来了、
// 只在"刚刚失败的那一条"上出现，并且点了各自接对回调。
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/novel/agent-parser", () => ({
  parseAgentResponse: (content: string) => ({ textContent: content, hasEdits: false, edits: [] }),
}))

import { ChatMessage } from "./chat-message"
import type { DisplayMessage } from "@/stores/chat-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FAILED_WITH_CONTENT = "他推开门，风雪灌了进来。\n\n出错：API 500 Internal Server Error"
const FAILED_EMPTY = "出错：401 Unauthorized"

let container: HTMLDivElement
let root: Root

function assistantMessage(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: FAILED_WITH_CONTENT,
    timestamp: 1,
    conversationId: "conv-1",
    ...overrides,
  } as DisplayMessage
}

function mount(props: Partial<Parameters<typeof ChatMessage>[0]> = {}) {
  act(() => {
    root.render(<ChatMessage message={assistantMessage()} isLastAssistant {...props} />)
  })
}

const actions = () => container.querySelector<HTMLElement>("[data-ui-failed-generation-actions]")
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`[data-ui-failed-generation-actions] button[aria-label="${label}"]`)
const regenerateButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="重新生成"]')

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.removeChild(container)
})

describe("章节面板：生成失败后的「重试 / 继续」", () => {
  it("失败的回复下方同时出现重试与继续", () => {
    mount({ onRegenerate: () => {}, onContinueFailed: () => {} })
    expect(actions(), "失败的回复必须给出下一步动作").not.toBeNull()
    expect(button("重试")).not.toBeNull()
    expect(button("继续")).not.toBeNull()
  })

  it("两枚按钮都是图标（与旁边保存 / 复制同款），不是文字胶囊", () => {
    mount({ onRegenerate: () => {}, onContinueFailed: () => {} })
    for (const item of actions()!.querySelectorAll("button")) {
      expect(item.textContent?.trim()).toBe("")
      expect(item.querySelector("svg")).not.toBeNull()
    }
  })

  it("重试接到重新生成上，继续接到继续回调上", () => {
    const onRegenerate = vi.fn()
    const onContinueFailed = vi.fn()
    mount({ onRegenerate, onContinueFailed })

    act(() => { button("重试")!.click() })
    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onContinueFailed).not.toHaveBeenCalled()

    act(() => { button("继续")!.click() })
    expect(onContinueFailed).toHaveBeenCalledTimes(1)
  })

  /**
   * 并排出现一枚「重新生成」和一枚「重试」会让人猜哪个才是"换模型重来"，
   * 所以失败消息只保留那对补救按钮（与停止生成的处理一致）。
   */
  it("失败的消息不再重复渲染「重新生成」", () => {
    mount({ onRegenerate: () => {}, onContinueFailed: () => {} })
    expect(regenerateButton()).toBeNull()
    expect(button("重试")).not.toBeNull()
  })

  it("一个字都没生成就失败时「继续」是禁用态，「重试」可用", () => {
    mount({
      message: assistantMessage({ content: FAILED_EMPTY }),
      onRegenerate: () => {},
      onContinueFailed: () => {},
    })
    expect(button("重试")!.disabled).toBe(false)
    expect(button("继续")!.disabled).toBe(true)
  })

  it("正常生成完的回复不长出这两个按钮", () => {
    mount({
      message: assistantMessage({ content: "他推开门，风雪灌了进来。" }),
      onRegenerate: () => {},
      onContinueFailed: () => {},
    })
    expect(actions()).toBeNull()
  })

  it("流式生成中（isAgentRunning）不显示", () => {
    mount({
      message: assistantMessage({ isAgentRunning: true }),
      onRegenerate: () => {},
      onContinueFailed: () => {},
    })
    expect(actions()).toBeNull()
  })

  it("不是最后一条助手消息时不显示（历史里的失败不该再长出按钮）", () => {
    mount({ isLastAssistant: false, onRegenerate: () => {}, onContinueFailed: () => {} })
    expect(actions()).toBeNull()
  })

  it("已废弃的消息不显示", () => {
    mount({
      message: assistantMessage({ discarded: true }),
      onRegenerate: () => {},
      onContinueFailed: () => {},
    })
    expect(actions()).toBeNull()
  })

  it("用户消息不显示", () => {
    mount({
      message: assistantMessage({ role: "user", content: FAILED_WITH_CONTENT }),
      onRegenerate: () => {},
      onContinueFailed: () => {},
    })
    expect(actions()).toBeNull()
  })

  it("停止生成的消息仍走停止那一对按钮，不会两套并存", () => {
    mount({
      message: assistantMessage({ content: "写到一半。\n\n已停止生成。" }),
      onRegenerate: () => {},
      onContinueStopped: () => {},
      onContinueFailed: () => {},
    })
    expect(actions()).toBeNull()
    expect(container.querySelector("[data-ui-stopped-generation-actions]")).not.toBeNull()
  })

  it("两个回调都没接时不渲染空壳", () => {
    mount({})
    expect(actions()).toBeNull()
  })
})
