// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OutlineDiscussCard } from "./outline-discuss-card"
import {
  OUTLINE_DISCUSS_CUSTOM_OPTION_ID,
  type OutlineDiscussProtocol,
} from "@/lib/novel/outline-discuss-protocol"

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (roots.length) {
    const mounted = roots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

function protocol(overrides: Partial<OutlineDiscussProtocol> = {}): OutlineDiscussProtocol {
  return {
    status: "needs_decision",
    module: "章节细纲",
    judgment: "第45章还缺一个开场选择",
    nextStep: "先定钩子",
    decisions: [
      {
        id: "d1",
        question: "这章用什么钩子？",
        options: [
          { id: "A", label: "仇人登门", description: "更狠" },
          { id: "B", label: "旧信重现", description: "更慢" },
          { id: OUTLINE_DISCUSS_CUSTOM_OPTION_ID, label: "其它（我来补充描述）", description: "" },
        ],
        preferenceId: "A",
        preferenceReason: "冲突来得更快",
      },
    ],
    agreed: [],
    ...overrides,
  }
}

async function renderCard(props: Partial<React.ComponentProps<typeof OutlineDiscussCard>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push({ root, container })
  const onSubmitAnswers = props.onSubmitAnswers ?? vi.fn(async () => true)
  const onConfirm = props.onConfirm ?? vi.fn(async () => true)
  const onContinue = props.onContinue ?? vi.fn()
  await act(async () => {
    root.render(
      <OutlineDiscussCard
        protocol={protocol()}
        onSubmitAnswers={onSubmitAnswers}
        onConfirm={onConfirm}
        onContinue={onContinue}
        {...props}
      />,
    )
  })
  const options = () => Array.from(container.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
  const submit = () => container.querySelector('[aria-label="选定继续讨论"]') as HTMLButtonElement | null
  const confirm = () => container.querySelector('[aria-label="定稿开始生成"]') as HTMLButtonElement | null
  const continueButton = () => container.querySelector('[aria-label="继续讨论"]') as HTMLButtonElement | null
  return { container, onSubmitAnswers, onConfirm, onContinue, options, submit, confirm, continueButton }
}

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("OutlineDiscussCard", () => {
  it("渲染拍板卡，标出 AI 倾向，且文案不提要素或计划", async () => {
    const { container, options } = await renderCard()

    expect(container.textContent).toContain("需要你拍板")
    expect(container.textContent).toContain("这章用什么钩子？")
    expect(container.textContent).toContain("AI 倾向")
    expect(container.textContent).toContain("冲突来得更快")
    expect(container.textContent).not.toContain("缺少要素")
    expect(container.textContent).not.toContain("生成计划")
    expect(options()).toHaveLength(3)
  })

  it("没选完时禁用提交，选定后把答案交给回调", async () => {
    const { options, submit, onSubmitAnswers } = await renderCard()

    expect(submit()?.disabled).toBe(true)
    await act(async () => options()[0].click())
    expect(submit()?.disabled).toBe(false)

    await act(async () => {
      submit()?.click()
      await Promise.resolve()
    })

    expect(onSubmitAnswers).toHaveBeenCalledWith([
      { id: "d1", question: "这章用什么钩子？", value: "仇人登门" },
    ])
  })

  it("选中自定义项后要求填写补充内容才能提交", async () => {
    const { container, options, submit } = await renderCard()

    await act(async () => options()[2].click())
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(submit()?.disabled).toBe(true)

    await setTextareaValue(textarea, "先写梦境闪回")
    expect(submit()?.disabled).toBe(false)
  })

  it("提交进行中防止重复点击", async () => {
    let finish!: (value: boolean) => void
    const pending = new Promise<boolean>((resolve) => { finish = resolve })
    const onSubmitAnswers = vi.fn(() => pending)
    const { options, submit } = await renderCard({ onSubmitAnswers })

    await act(async () => options()[0].click())
    await act(async () => {
      submit()?.click()
      submit()?.click()
      await Promise.resolve()
    })

    expect(onSubmitAnswers).toHaveBeenCalledTimes(1)
    expect(submit()?.disabled).toBe(true)
    expect(submit()?.getAttribute("aria-busy")).toBe("true")

    await act(async () => finish(true))
    expect(submit()?.getAttribute("aria-busy")).toBeNull()
  })

  it("ready 时渲染定稿卡并列出已拍板项", async () => {
    const { container, confirm, continueButton, onConfirm, onContinue } = await renderCard({
      protocol: protocol({
        status: "ready",
        judgment: "冲突和人物动机已经对齐",
        nextStep: "确认后开写",
        decisions: [],
        agreed: [{ id: "a1", question: "开场钩子", value: "仇人登门" }],
      }),
    })

    expect(container.textContent).toContain("可以定稿")
    expect(container.textContent).toContain("冲突和人物动机已经对齐")
    expect(container.textContent).toContain("开场钩子：仇人登门")
    expect(container.textContent).not.toContain("缺少要素")
    expect(container.querySelector('[aria-label="选定继续讨论"]')).toBeNull()

    await act(async () => {
      continueButton()?.click()
    })
    expect(onContinue).toHaveBeenCalledTimes(1)

    await act(async () => {
      confirm()?.click()
      await Promise.resolve()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("会话忙或卡片已用过时整卡置灰", async () => {
    const { options, submit, onSubmitAnswers } = await renderCard({
      disabled: true,
      disabledReason: "当前会话正在生成，请等待生成完成后再拍板。",
    })

    expect(options().every((option) => option.disabled)).toBe(true)
    expect(submit()?.disabled).toBe(true)
    expect(submit()?.title).toBe("当前会话正在生成，请等待生成完成后再拍板。")
    await act(async () => options()[0].click())
    expect(onSubmitAnswers).not.toHaveBeenCalled()
  })
})
