// @vitest-environment jsdom
//
// 问题一：停止生成之后，面板上只留一句「已停止生成。」，用户没有下一步可点。
// 停止按钮是这个应用里唯一「先停下 → 换个模型 → 再来一次」的入口，
// 所以停下来之后必须当场给出「重试」和「继续」。这里验证章节侧真的长出了这两个按钮、
// 且只在"刚刚被停止的那一条"上出现。
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/novel/agent-parser", () => ({
  parseAgentResponse: (content: string) => ({ textContent: content, hasEdits: false, edits: [] }),
}))

import { ChatMessage } from "./chat-message"
import type { DisplayMessage } from "@/stores/chat-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STOPPED_CONTENT = "他推开门，风雪灌了进来。\n\n已停止生成。"

let container: HTMLDivElement
let root: Root

function assistantMessage(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: STOPPED_CONTENT,
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

const actions = () => container.querySelector<HTMLElement>("[data-ui-stopped-generation-actions]")
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`[data-ui-stopped-generation-actions] button[aria-label^="${label}"]`)
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

describe("章节面板：停止生成后的「重试 / 继续」", () => {
  it("「已停止生成」的回复下方同时出现重试与继续", () => {
    mount({ onRegenerate: () => {}, onContinueStopped: () => {} })
    expect(actions(), "停止过的回复必须给出下一步动作").not.toBeNull()
    expect(button("重试")).not.toBeNull()
    expect(button("继续")).not.toBeNull()
  })

  it("重试接到重新生成上，继续接到继续回调上", () => {
    const onRegenerate = vi.fn()
    const onContinueStopped = vi.fn()
    mount({ onRegenerate, onContinueStopped })

    act(() => { button("重试")!.click() })
    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onContinueStopped).not.toHaveBeenCalled()

    act(() => { button("继续")!.click() })
    expect(onContinueStopped).toHaveBeenCalledTimes(1)
  })

  /**
   * 并排出现一枚"重新生成"和一枚"重试"会让人猜哪个才是"换模型重来"，
   * 所以停止过的消息只保留那对补救按钮。
   */
  it("停止过的消息不再重复渲染「重新生成」", () => {
    mount({ onRegenerate: () => {}, onContinueStopped: () => {} })
    expect(regenerateButton()).toBeNull()
    expect(button("重试")).not.toBeNull()
  })

  it("正常生成完的回复不长出这两个按钮", () => {
    mount({
      message: assistantMessage({ content: "他推开门，风雪灌了进来。" }),
      onRegenerate: () => {},
      onContinueStopped: () => {},
    })
    expect(actions()).toBeNull()
  })

  it("流式生成中（isAgentRunning）不显示", () => {
    mount({
      message: assistantMessage({ isAgentRunning: true }),
      onRegenerate: () => {},
      onContinueStopped: () => {},
    })
    expect(actions()).toBeNull()
  })

  it("不是最后一条助手消息时不显示（历史里的停止提示不该再长出按钮）", () => {
    mount({ isLastAssistant: false, onRegenerate: () => {}, onContinueStopped: () => {} })
    expect(actions()).toBeNull()
  })

  it("已废弃的消息不显示", () => {
    mount({
      message: assistantMessage({ discarded: true }),
      onRegenerate: () => {},
      onContinueStopped: () => {},
    })
    expect(actions()).toBeNull()
  })

  it("用户消息不显示", () => {
    mount({
      message: assistantMessage({ role: "user", content: STOPPED_CONTENT }),
      onRegenerate: () => {},
      onContinueStopped: () => {},
    })
    expect(actions()).toBeNull()
  })

  /*
   * 停止是用户亲手按的，跟项目是不是小说模式无关；少了回调时也只是少一个按钮，
   * 不该整块消失（否则"重试"会跟着"继续"一起没）。
   */
  it("只接了重试回调时，仍然显示重试", () => {
    mount({ onRegenerate: () => {} })
    expect(button("重试")).not.toBeNull()
    expect(button("继续")).toBeNull()
  })

  it("两个回调都没接时不渲染空壳", () => {
    mount({})
    expect(actions()).toBeNull()
  })
})
