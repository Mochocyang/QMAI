// @vitest-environment jsdom
/**
 * ActionDialog / ResultPanel 测试。
 *
 * 最重要的一条是**空列表与降级的文案必须不同**（B1 特意拆开的两条路径）：
 * 如果两者渲染成同一句话，用户就分不清"我填得不对"和"模型不听话"，
 * 作者也看不到提示词跑偏的信号 —— 那是这次拆分存在的全部意义。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedOutput } from "@/lib/plugins/declarative/output"
import type { LlmCaller, RunActionDeps } from "@/lib/plugins/declarative/run"
import type { DeclarativeAction } from "@/lib/plugins/declarative/types"
import type { SlotActionEntry } from "@/lib/plugins/slots"
import {
  ActionDialog,
  ResultPanel,
  describeRunError,
  resultToText,
  targetBlockedReason,
} from "./ActionDialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function entry(overrides: Partial<DeclarativeAction> = {}): SlotActionEntry {
  return {
    pluginId: "idea-generator",
    pluginName: "灵感生成器",
    action: {
      id: "generate-titles",
      title: "生成书名",
      prompt: { system: "sys", user: "user" },
      output: {
        mode: "list",
        presentation: "chips",
        targets: [
          { kind: "project-field", field: "bookTitle", label: "设为书名", confirm: true },
          { kind: "insert-at-cursor", label: "插入到光标处" },
          { kind: "clipboard", label: "复制" },
        ],
      },
      ...overrides,
    },
  }
}

function depsWith(llm: LlmCaller): RunActionDeps {
  return { llm, getConfig: async () => ({}) }
}

function fixedLlm(text: string): LlmCaller {
  return {
    async call(_input, onDelta) {
      onDelta(text)
      return { text }
    },
  }
}

describe("ResultPanel：空列表与降级必须长得不一样", () => {
  it("空列表 → 「模型没有给出结果，可以调整后重试」", () => {
    const parsed: ParsedOutput = { kind: "list", items: [], degraded: false }
    act(() => {
      root.render(<ResultPanel parsed={parsed} presentation="chips" />)
    })

    expect(host.querySelector('[data-result-state="empty"]')).not.toBeNull()
    expect(host.textContent).toContain("模型没有给出结果，可以调整后重试")
    // 空列表**不该**出现"解析失败/原文"这类降级话术
    expect(host.textContent).not.toContain("没能按预期格式解析")
  })

  it("降级 → 显示原因 + 原文 + 重试", () => {
    const parsed: ParsedOutput = { kind: "degraded", text: "好的，我来分析一下……", reason: "没有解析出任何条目" }
    const onRetry = vi.fn()
    act(() => {
      root.render(<ResultPanel parsed={parsed} presentation="chips" onRetry={onRetry} />)
    })

    expect(host.querySelector('[data-result-state="degraded"]')).not.toBeNull()
    expect(host.textContent).toContain("没能按预期格式解析模型输出")
    expect(host.textContent).toContain("没有解析出任何条目")
    // 原文必须原样可见：用户可能只想从噪音里挑一句复制
    expect(host.textContent).toContain("好的，我来分析一下……")
    expect(host.textContent).not.toContain("模型没有给出结果")
  })

  it("有条目时按 chips 渲染", () => {
    act(() => {
      root.render(
        <ResultPanel
          parsed={{ kind: "list", items: ["《长夜》", "《归途》"], degraded: false }}
          presentation="chips"
        />,
      )
    })
    const chips = [...host.querySelectorAll('[data-result-state="list"] button')].map((node) => node.textContent)
    expect(chips).toEqual(["《长夜》", "《归途》"])
  })

  it("resultToText 把列表拼成按行文本（复制语义）", () => {
    expect(resultToText({ kind: "list", items: ["a", "b"], degraded: false })).toBe("a\nb")
    expect(resultToText({ kind: "text", text: "整段" })).toBe("整段")
  })
})

describe("ActionDialog：状态机与流式", () => {
  it("无表单时打开即开始生成，完成后展示 chips 与 targets", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const localRoot = createRoot(container)

    await act(async () => {
      localRoot.render(
        <ActionDialog
          open
          entry={entry()}
          onClose={() => {}}
          deps={depsWith(fixedLlm("《长夜》\n《归途》"))}
          onApplyTarget={async () => {}}
        />,
      )
    })
    // 让 runDeclarativeAction 的 promise 链跑完
    await act(async () => {
      await Promise.resolve()
    })

    const text = document.body.textContent ?? ""
    expect(text).toContain("生成书名")
    expect(text).toContain("《长夜》")
    expect(text).toContain("设为书名")
    // 没编辑器时「插入到光标处」必须禁用（并带 tooltip 说明）
    const insertButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "插入到光标处",
    ) as HTMLButtonElement | undefined
    expect(insertButton?.disabled).toBe(true)
    expect(insertButton?.title).toContain("需要先打开一个章节编辑器")

    await act(async () => localRoot.unmount())
    container.remove()
  })

  it("解析降级时对话框显示原因与原文，不报错也不空白", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const localRoot = createRoot(container)

    await act(async () => {
      localRoot.render(
        <ActionDialog
          open
          entry={entry({ output: { mode: "json", schema: { type: "array" }, targets: [] } })}
          onClose={() => {}}
          deps={depsWith(fixedLlm("我觉得可以这样：先写个开头"))}
          onApplyTarget={async () => {}}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const text = document.body.textContent ?? ""
    expect(text).toContain("没能按预期格式解析模型输出")
    expect(text).toContain("我觉得可以这样")

    await act(async () => localRoot.unmount())
    container.remove()
  })

  it("模型调用失败时显示可读原因并给重试", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const localRoot = createRoot(container)

    await act(async () => {
      localRoot.render(
        <ActionDialog
          open
          entry={entry()}
          onClose={() => {}}
          deps={depsWith({
            call: () => Promise.reject(new Error("模型连接超时")),
          })}
          onApplyTarget={async () => {}}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("模型连接超时")
    expect([...document.body.querySelectorAll("button")].some((button) => button.textContent === "重试")).toBe(true)

    await act(async () => localRoot.unmount())
    container.remove()
  })
})

describe("工具函数", () => {
  it("targetBlockedReason：insert-at-cursor 需要编辑器，其它目标不阻塞", () => {
    expect(targetBlockedReason({ kind: "insert-at-cursor", label: "插入到光标处" })).toContain("章节编辑器")
    expect(
      targetBlockedReason({ kind: "insert-at-cursor", label: "插入到光标处" }, { editorAvailable: true }),
    ).toBeUndefined()
    expect(targetBlockedReason({ kind: "clipboard", label: "复制" })).toBeUndefined()
  })

  it("describeRunError 优先展示中文原文", () => {
    expect(describeRunError("模型额度不足")).toBe("模型额度不足")
    expect(describeRunError(new Error("网络错误"))).toBe("网络错误")
    expect(describeRunError(undefined)).toBe("生成失败，请重试。")
  })
})
