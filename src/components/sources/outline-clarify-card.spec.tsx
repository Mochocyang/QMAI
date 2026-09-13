// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OutlineClarifyCard } from "./outline-clarify-card"
import {
  OUTLINE_PLAN_CUSTOM_OPTION_ID,
  type OutlinePlanProtocol,
} from "@/lib/novel/outline-plan-protocol"

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

function protocol(overrides: Partial<OutlinePlanProtocol> = {}): OutlinePlanProtocol {
  return {
    status: "needs_input",
    module: "章节细纲",
    elements: [],
    missing: ["章节范围", "本章目标"],
    questions: [
      {
        id: "q1",
        key: "chapterRange",
        question: "要生成哪些章的章纲？",
        multiple: false,
        options: [
          { id: "A", label: "往后 1 章", description: "最稳" },
          { id: "B", label: "往后 5 章", description: "" },
          { id: "C", label: "往后 10 章", description: "" },
          { id: OUTLINE_PLAN_CUSTOM_OPTION_ID, label: "其它（我来补充描述）", description: "" },
        ],
      },
      {
        id: "q2",
        key: "chapterGoal",
        question: "本章目标是什么？",
        multiple: true,
        options: [
          { id: "A", label: "推进主线", description: "" },
          { id: "B", label: "铺垫伏笔", description: "" },
          { id: "C", label: "兑现爽点", description: "" },
          { id: OUTLINE_PLAN_CUSTOM_OPTION_ID, label: "其它（我来补充描述）", description: "" },
        ],
      },
    ],
    ...overrides,
  }
}

async function renderCard(props: Partial<React.ComponentProps<typeof OutlineClarifyCard>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push({ root, container })
  const onSubmitAnswers = props.onSubmitAnswers ?? vi.fn(async () => true)
  await act(async () => {
    root.render(
      <OutlineClarifyCard
        protocol={protocol()}
        onSubmitAnswers={onSubmitAnswers}
        {...props}
      />,
    )
  })
  const options = () => Array.from(container.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
  const submit = () => container.querySelector('[aria-label="提交补充要素"]') as HTMLButtonElement
  return { container, onSubmitAnswers, options, submit }
}

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("OutlineClarifyCard", () => {
  it("渲染所有问题，每问至少 3 个真实选项外加自定义输入项", async () => {
    const { container, options } = await renderCard()

    expect(container.textContent).toContain("要生成哪些章的章纲？")
    expect(container.textContent).toContain("本章目标是什么？")
    expect(container.textContent).toContain("待补要素：章节范围、本章目标")
    expect(options()).toHaveLength(8)

    const customOptions = options().filter((option) => option.textContent?.includes("其它"))
    expect(customOptions).toHaveLength(2)
    expect(options().slice(0, 3).every((option) => !option.textContent?.includes("其它"))).toBe(true)
  })

  it("必答问题没填完时禁用提交", async () => {
    const { options, submit } = await renderCard()

    expect(submit().disabled).toBe(true)

    await act(async () => options()[0].click())
    expect(submit().disabled).toBe(true)

    await act(async () => options()[4].click())
    expect(submit().disabled).toBe(false)
  })

  it("选中自定义项后要求填写补充内容才能提交", async () => {
    const { container, options, submit } = await renderCard()

    await act(async () => options()[3].click())
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement
    expect(textarea).not.toBeNull()

    await act(async () => options()[4].click())
    expect(submit().disabled).toBe(true)

    await setTextareaValue(textarea, "第 21-25 章")
    expect(submit().disabled).toBe(false)
  })

  it("单选互斥、多选可叠加，并把标签汇总成答案交给回调", async () => {
    const { options, submit, onSubmitAnswers } = await renderCard()

    await act(async () => options()[0].click())
    await act(async () => options()[1].click())
    await act(async () => options()[4].click())
    await act(async () => options()[5].click())
    await act(async () => {
      submit().click()
      await Promise.resolve()
    })

    expect(onSubmitAnswers).toHaveBeenCalledTimes(1)
    expect(onSubmitAnswers).toHaveBeenCalledWith([
      { key: "chapterRange", label: "章节范围", question: "要生成哪些章的章纲？", value: "往后 5 章" },
      { key: "chapterGoal", label: "本章目标", question: "本章目标是什么？", value: "推进主线；铺垫伏笔" },
    ])
  })

  it("提交进行中防止重复点击", async () => {
    let finish!: (value: boolean) => void
    const pending = new Promise<boolean>((resolve) => { finish = resolve })
    const onSubmitAnswers = vi.fn(() => pending)
    const { options, submit } = await renderCard({ onSubmitAnswers })

    await act(async () => options()[0].click())
    await act(async () => options()[4].click())
    await act(async () => {
      submit().click()
      submit().click()
      await Promise.resolve()
    })

    expect(onSubmitAnswers).toHaveBeenCalledTimes(1)
    expect(submit().disabled).toBe(true)
    expect(submit().getAttribute("aria-busy")).toBe("true")

    await act(async () => finish(true))
    expect(submit().getAttribute("aria-busy")).toBeNull()
  })

  it("会话忙或卡片已用过时整卡置灰并给出中文原因", async () => {
    const { options, submit, onSubmitAnswers } = await renderCard({
      disabled: true,
      disabledReason: "当前会话正在生成，请等待生成完成后再补充信息。",
    })

    expect(options().every((option) => option.disabled)).toBe(true)
    expect(submit().disabled).toBe(true)
    expect(submit().title).toBe("当前会话正在生成，请等待生成完成后再补充信息。")
    await act(async () => options()[0].click())
    expect(onSubmitAnswers).not.toHaveBeenCalled()
  })

  it("协议不是 needs_input 或没有追问时不渲染", async () => {
    const { container } = await renderCard({ protocol: protocol({ questions: [] }) })
    expect(container.textContent).toBe("")

    const ready = await renderCard({ protocol: protocol({ status: "ready" }) })
    expect(ready.container.textContent).toBe("")
  })
})
