// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OutlineWizardDialog } from "./outline-wizard-dialog"
import { createNovelGenerationRequestPackage } from "@/lib/novel/novel-generation-request-package"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

function findButton(host: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(host.querySelectorAll("button")) as HTMLButtonElement[]
  const button = buttons.find(
    (item) => item.textContent?.replace(/\s+/g, " ").trim() === text,
  )
  if (!button) throw new Error(`未找到按钮：${text}`)
  return button
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

describe("OutlineWizardDialog", () => {
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
  })

  it("关闭时不渲染弹窗内容", async () => {
    await act(async () => {
      root.render(
        <OutlineWizardDialog open={false} onOpenChange={() => {}} onSubmit={() => {}} />,
      )
    })

    expect(host.textContent).toBe("")
  })

  it("渲染固定字段且不出现男女频融合", async () => {
    await act(async () => {
      root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={() => {}} />)
    })

    expect(document.body.textContent).toContain("生成小说大纲")
    expect(document.body.textContent).toContain("生成任务")
    expect(document.body.textContent).toContain("篇幅类型")
    expect(document.body.textContent).toContain("频道方向")
    expect(document.body.textContent).toContain("故事灵感")
    expect(document.body.textContent).not.toContain("男女频融合")
  })

  it("故事灵感为空时阻止提交", async () => {
    const onSubmit = vi.fn()
    await act(async () => {
      root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={onSubmit} />)
    })

    await act(async () => {
      findButton(document.body, "提交需求").click()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("请先填写故事灵感或处理要求。")
  })

  it("填写故事灵感后提交结构化请求", async () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(<OutlineWizardDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)
    })

    const textarea = document.body.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set
      valueSetter?.call(textarea, "一个穿越者靠军宣短视频改变国运")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      findButton(document.body, "提交需求").click()
    })

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      task: "newBook",
      length: "long",
      channel: "male",
      inspiration: "一个穿越者靠军宣短视频改变国运",
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("marks real initial values as implicit", async () => {
    const { createDefaultOutlineWizardRequest } = await import("./outline-wizard-dialog")
    const request = createDefaultOutlineWizardRequest()
    expect(request.sellingPoints).toEqual(["AI 根据灵感推荐"])
    expect(request).toMatchObject({ length: "long", channel: "male", narrative: "thirdPerson", explicit: {} })
  })

  it("clears explicit genre fields when channel derives a new genre", async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={onSubmit} />))
    // 选择自定义题材并填入
    await act(async () => {
      setSelectValue(document.body.querySelector('select[aria-label="题材类型"]') as HTMLSelectElement, "custom")
    })
    const custom = document.body.querySelector('input[aria-label="自定义题材"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(custom, "自定义题材")
      custom.dispatchEvent(new Event("input", { bubbles: true }))
      // 切换到女频：题材与自定义题材的显式标记都被清空
      setSelectValue(document.body.querySelector('select[aria-label="频道方向"]') as HTMLSelectElement, "female")
    })
    const textarea = document.body.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(textarea, "灵感")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      findButton(document.body, "提交需求").click()
    })
    expect(onSubmit.mock.calls[0][0].explicit.genre).toBeUndefined()
    expect(onSubmit.mock.calls[0][0].explicit.customGenre).toBeUndefined()
    expect(createNovelGenerationRequestPackage(onSubmit.mock.calls[0][0], "model").details.join("\n")).not.toContain("题材类型")
    // 切回男频并选择真实题材：题材的显式标记保留，生成详情包含题材
    await act(async () => {
      setSelectValue(document.body.querySelector('select[aria-label="频道方向"]') as HTMLSelectElement, "male")
    })
    await act(async () => {
      setSelectValue(document.body.querySelector('select[aria-label="题材类型"]') as HTMLSelectElement, "dushi")
    })
    await act(async () => findButton(document.body, "提交需求").click())
    expect(onSubmit.mock.calls[1][0].explicit.genre).toBe(true)
    expect(createNovelGenerationRequestPackage(onSubmit.mock.calls[1][0], "model").details.join("\n")).toContain("题材类型")
  })

  function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  }

  async function selectCreationType(value: string) {
    await act(async () => {
      setSelectValue(
        document.body.querySelector('select[aria-label="创作类型"]') as HTMLSelectElement,
        value,
      )
    })
  }

  it("默认是原创，不显示任何同人字段", async () => {
    await act(async () => root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={() => {}} />))

    expect(document.body.querySelector('select[aria-label="创作类型"]')).not.toBeNull()
    expect(document.body.querySelector('input[aria-label="原作名称"]')).toBeNull()
    expect(document.body.querySelector('select[aria-label="同人模式"]')).toBeNull()
    expect(document.body.querySelector('textarea[aria-label="原作素材"]')).toBeNull()
    expect(document.body.textContent).not.toContain("同人模式")
  })

  it("切到同人后出现原作、模式、素材与容许偏离，并自动落到同人衍生题材", async () => {
    await act(async () => root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={() => {}} />))
    await selectCreationType("fanfic")

    expect(document.body.querySelector('input[aria-label="原作名称"]')).not.toBeNull()
    expect(document.body.querySelector('select[aria-label="同人模式"]')).not.toBeNull()
    expect(document.body.querySelector('textarea[aria-label="原作素材"]')).not.toBeNull()
    expect(document.body.textContent).toContain("容许偏离")
    expect(
      (document.body.querySelector('select[aria-label="题材类型"]') as HTMLSelectElement).value,
    ).toBe("tongren")
    // 四种标准模式 + 自定义
    const modes = Array.from(
      document.body.querySelector('select[aria-label="同人模式"]')!.querySelectorAll("option"),
    ).map((option) => option.value)
    expect(modes).toEqual(["canon", "au", "ooc", "cp", "custom"])
  })

  it("切回原创时隐藏同人字段，并离开同人衍生题材", async () => {
    await act(async () => root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={() => {}} />))
    await selectCreationType("fanfic")
    await selectCreationType("original")

    expect(document.body.querySelector('input[aria-label="原作名称"]')).toBeNull()
    expect(document.body.querySelector('textarea[aria-label="原作素材"]')).toBeNull()
    expect(
      (document.body.querySelector('select[aria-label="题材类型"]') as HTMLSelectElement).value,
    ).not.toBe("tongren")
  })

  it("项目里没有正典时不显示复用选项", async () => {
    await act(async () =>
      root.render(
        <OutlineWizardDialog open onOpenChange={() => {}} onSubmit={() => {}} projectPath="/proj" />,
      ),
    )
    await selectCreationType("fanfic")

    expect(document.body.querySelector('input[aria-label="复用已有正典"]')).toBeNull()
    expect(document.body.textContent).not.toContain("复用已有正典")
  })

  it("同人必填项没填全时阻止提交并给出可执行提示", async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={onSubmit} />))
    await selectCreationType("fanfic")
    await act(async () => {
      setInputValue(
        document.body.querySelector('textarea[aria-label="故事灵感/处理要求"]') as HTMLTextAreaElement,
        "想写原作未展示的空白期",
      )
    })
    await act(async () => findButton(document.body, "提交需求").click())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("请填写原作名称")
  })

  it("填写了原作名称但没给素材时仍然拦下，说明素材是正典来源", async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={onSubmit} />))
    await selectCreationType("fanfic")
    await act(async () => {
      setInputValue(document.body.querySelector('input[aria-label="原作名称"]') as HTMLInputElement, "斗破苍穹")
      setInputValue(
        document.body.querySelector('textarea[aria-label="故事灵感/处理要求"]') as HTMLTextAreaElement,
        "想写原作未展示的空白期",
      )
    })
    await act(async () => findButton(document.body, "提交需求").click())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("请粘贴或导入原作素材")
  })

  it("同人字段填全后提交完整的同人请求", async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={onSubmit} />))
    await selectCreationType("fanfic")
    await act(async () => {
      setInputValue(
        document.body.querySelector('input[aria-label="原作名称"]') as HTMLInputElement,
        "斗破苍穹",
      )
      setSelectValue(
        document.body.querySelector('select[aria-label="同人模式"]') as HTMLSelectElement,
        "au",
      )
      setInputValue(
        document.body.querySelector('textarea[aria-label="原作素材"]') as HTMLTextAreaElement,
        "斗气大陆，斗气分九段。",
      )
    })
    // 勾选一条容许偏离
    await act(async () => {
      findButton(document.body, "改写原作结局").click()
    })
    await act(async () => {
      setInputValue(
        document.body.querySelector('textarea[aria-label="故事灵感/处理要求"]') as HTMLTextAreaElement,
        "从分歧点开始写新线",
      )
    })
    await act(async () => findButton(document.body, "提交需求").click())

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      creation: "fanfic",
      genre: "tongren",
      fanficMode: "au",
      fanficSourceName: "斗破苍穹",
      fanficSourceMaterial: "斗气大陆，斗气分九段。",
      fanficAllowedDeviations: ["改写原作结局"],
    })
  })

  it("自定义同人模式未描述时被拦下，描述后放行", async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(<OutlineWizardDialog open onOpenChange={() => {}} onSubmit={onSubmit} />))
    await selectCreationType("fanfic")
    await act(async () => {
      setInputValue(document.body.querySelector('input[aria-label="原作名称"]') as HTMLInputElement, "斗破苍穹")
      setSelectValue(document.body.querySelector('select[aria-label="同人模式"]') as HTMLSelectElement, "custom")
      setInputValue(document.body.querySelector('textarea[aria-label="原作素材"]') as HTMLTextAreaElement, "斗气分九段")
      setInputValue(document.body.querySelector('textarea[aria-label="故事灵感/处理要求"]') as HTMLTextAreaElement, "日后谈")
    })
    expect(document.body.querySelector('input[aria-label="自定义同人模式"]')).not.toBeNull()

    await act(async () => findButton(document.body, "提交需求").click())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("请用自己的话描述本作与原作的关系边界。")

    await act(async () => {
      setInputValue(
        document.body.querySelector('input[aria-label="自定义同人模式"]') as HTMLInputElement,
        "原作结局十年后的低魔日后谈",
      )
    })
    await act(async () => findButton(document.body, "提交需求").click())
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0][0].fanficCustomMode).toBe("原作结局十年后的低魔日后谈")
  })
})
