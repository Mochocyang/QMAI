// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { IntentClarityResult } from "@/lib/novel/outline-intent-clarity"
import { OutlineIntentDialog } from "./outline-intent-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

function result(overrides: Partial<IntentClarityResult> = {}): IntentClarityResult {
  return {
    clarity: "needs_input",
    module: "卷纲",
    analysis: "已读取《总纲》与《设定总索引》，第一卷已按折叠树标准完成。",
    detectedScope: "",
    missingItems: [
      "未明确要生成哪一卷的折叠树卷纲（第二卷归墟寄魂 / 第三卷记忆深渊）",
    ],
    options: [],
    question: "请选择本次要生成哪一卷的折叠树卷纲。",
    ...overrides,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
})

/** 选项按钮用 aria-label 精确定位，避免命中选项说明里的同名字样。 */
function optionButton(label: string): HTMLButtonElement | null {
  return document.querySelector(`button[aria-label="${label}"]`)
}

/** 「生成」按钮按整体文案精确匹配，不匹配选项说明里出现的「生成」二字。 */
function submitCustomButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "生成") as HTMLButtonElement | undefined
}

describe("大纲需求分析弹窗", () => {
  it("给出提问与可点选项，且模型没给选项时也有兜底候选", async () => {
    await act(async () => {
      root.render(
        <OutlineIntentDialog open result={result()} onSelect={() => {}} />,
      )
    })

    expect(document.body.textContent).toContain("请选择本次要生成哪一卷的折叠树卷纲")
    expect(optionButton("第二卷归墟寄魂")).not.toBeNull()
    expect(optionButton("第三卷记忆深渊")).not.toBeNull()
    expect(optionButton("自定义")).not.toBeNull()
  })

  it("判断依据收进折叠区，不再铺满正文", async () => {
    await act(async () => {
      root.render(
        <OutlineIntentDialog open result={result()} onSelect={() => {}} />,
      )
    })

    const details = document.querySelector("details")
    expect(details).not.toBeNull()
    expect(details?.querySelector("summary")?.textContent).toContain("判断依据")
    expect(details?.hasAttribute("open")).toBe(false)
  })

  it("点选具体范围时把该范围交给上层继续生成", async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <OutlineIntentDialog open result={result()} onSelect={onSelect} />,
      )
    })

    await act(async () => {
      optionButton("第二卷归墟寄魂")?.click()
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][1]).toBe("第二卷归墟寄魂")
  })

  it("选择自定义后就地展开输入框，填完直接提交", async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <OutlineIntentDialog open result={result()} onSelect={onSelect} />,
      )
    })

    await act(async () => {
      optionButton("自定义")?.click()
    })

    const textarea = document.querySelector("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set
        setter?.call(textarea, "第四卷 无名样本 的折叠树卷纲")
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })

    await act(async () => {
      submitCustomButton()?.click()
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][1]).toBe("第四卷 无名样本 的折叠树卷纲")
  })

  it("自定义内容为空时不提交", async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <OutlineIntentDialog open result={result()} onSelect={onSelect} />,
      )
    })

    await act(async () => {
      optionButton("自定义")?.click()
    })
    await act(async () => {
      submitCustomButton()?.click()
    })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it("已确认过的结果不重复弹窗", async () => {
    await act(async () => {
      root.render(
        <OutlineIntentDialog
          open
          decided
          result={result()}
          onSelect={() => {}}
        />,
      )
    })

    expect(document.body.textContent).not.toContain("请选择本次要生成哪一卷的折叠树卷纲")
  })

  it("是面板内锚定浮层，不是全屏居中弹窗，也不带黑色遮罩", async () => {
    await act(async () => {
      // 宿主自己声明 relative，模拟大纲面板根节点。
      root.render(
        <div className="relative h-full">
          <OutlineIntentDialog open result={result()} onSelect={() => {}} />
        </div>,
      )
    })

    const panel = document.querySelector('[data-testid="outline-intent-dialog"]')
    expect(panel).not.toBeNull()
    const className = panel?.className ?? ""
    // 贴住面板底部、宽度跟随面板、层级高于输入区。
    expect(className).toContain("absolute")
    expect(className).toContain("bottom-0")
    expect(className).toContain("inset-x-0")
    expect(className).toContain("z-50")
    // 全屏居中那套定位与遮罩必须彻底消失。
    expect(className).not.toContain("fixed")
    expect(className).not.toContain("top-1/2")
    expect(className).not.toContain("left-1/2")
    expect(document.querySelector(".fixed.inset-0")).toBeNull()
    // 浮层留在面板内部，而不是被 Portal 挂到 body 上。
    expect(panel?.closest(".relative.h-full")).not.toBeNull()
  })

  it("按 Esc 关闭", async () => {
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <OutlineIntentDialog
          open
          result={result()}
          onSelect={() => {}}
          onOpenChange={onOpenChange}
        />,
      )
    })

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("点浮层外部不再关闭：拖动窗口或点其他功能都不算取消", async () => {
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <OutlineIntentDialog
          open
          result={result()}
          onSelect={() => {}}
          onOpenChange={onOpenChange}
        />,
      )
    })

    // 顶栏窗口拖动区（Tauri 用 data-tauri-drag-region 声明），拖动窗口不该关掉浮层。
    const dragRegion = document.createElement("header")
    dragRegion.setAttribute("data-tauri-drag-region", "deep")
    document.body.appendChild(dragRegion)
    await act(async () => {
      dragRegion.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })
    expect(onOpenChange).not.toHaveBeenCalled()

    // 点其他功能按钮同样不该关掉浮层。
    const otherFeature = document.createElement("button")
    otherFeature.textContent = "其他功能"
    document.body.appendChild(otherFeature)
    await act(async () => {
      otherFeature.dispatchEvent(new Event("pointerdown", { bubbles: true }))
      otherFeature.dispatchEvent(new Event("click", { bubbles: true }))
    })
    expect(onOpenChange).not.toHaveBeenCalled()

    // 浮层仍然在，只有显式出口（✕ / Esc / 选选项）才关闭。
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    dragRegion.remove()
    otherFeature.remove()
  })

  it("点浮层内部不关闭", async () => {
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <OutlineIntentDialog
          open
          result={result()}
          onSelect={() => {}}
          onOpenChange={onOpenChange}
        />,
      )
    })

    await act(async () => {
      document.querySelector('[data-testid="outline-intent-dialog"]')
        ?.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("右上角 ✕ 仍然是显式关闭出口", async () => {
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <OutlineIntentDialog
          open
          result={result()}
          onSelect={() => {}}
          onOpenChange={onOpenChange}
        />,
      )
    })

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="关闭需求分析"]')?.click()
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
