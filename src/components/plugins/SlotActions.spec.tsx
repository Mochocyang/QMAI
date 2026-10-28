// @vitest-environment jsdom
/**
 * SlotActions 测试：插槽挂载的核心组件。
 *
 * 观察点：
 *   - 空插槽什么都不渲染（宿主工具栏不该被插件系统占位）；
 *   - 单个 action 只显示标题，多个才补来源插件（避免噪音/避免混淆）；
 *   - 点按钮能打开对应 action 的对话框（插槽→执行器的唯一通路）。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DeclarativeAction } from "@/lib/plugins/declarative/types"
import type { SlotActionEntry } from "@/lib/plugins/slots"
import { SlotActions } from "./SlotActions"

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

function entry(pluginName: string, overrides: Partial<DeclarativeAction> = {}): SlotActionEntry {
  return {
    pluginId: `plugin-${pluginName}`,
    pluginName,
    action: {
      id: `action-${pluginName}-${overrides.id ?? "generate"}`,
      title: overrides.title ?? "生成书名",
      prompt: { system: "sys", user: "user" },
      output: { mode: "text", targets: [] },
      ...overrides,
    },
  }
}

describe("SlotActions", () => {
  it("没有 action 时不渲染任何东西", () => {
    act(() => {
      root.render(<SlotActions entries={[]} />)
    })
    expect(host.innerHTML).toBe("")
  })

  it("只有一个 action 时只显示标题（不补插件名噪音）", () => {
    act(() => {
      root.render(<SlotActions entries={[entry("灵感生成器")]} />)
    })
    const button = host.querySelector<HTMLButtonElement>("[data-plugin-action]")!
    expect(button.textContent).toContain("生成书名")
    expect(button.textContent).not.toContain("灵感生成器")
    expect(button.title).not.toContain("来自插件")
  })

  it("多个 action 时 tooltip 带上来源插件（不致于两个同名按钮分不清）", () => {
    act(() => {
      root.render(
        <SlotActions
          entries={[entry("甲插件", { id: "a", title: "生成书名" }), entry("乙插件", { id: "b", title: "生成书名" })]}
        />,
      )
    })
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-plugin-action]")]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].title).toContain("来自插件「甲插件」")
    expect(buttons[1].title).toContain("来自插件「乙插件」")
  })

  it("menu 形态渲染成菜单项", () => {
    act(() => {
      root.render(<SlotActions variant="menu" entries={[entry("灵感生成器")]} />)
    })
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
    expect(host.querySelector('[role="menuitem"]')).not.toBeNull()
  })

  it("点击按钮会打开该 action 的对话框", async () => {
    const onApplyTarget = vi.fn(async () => {})
    act(() => {
      root.render(
        <SlotActions
          entries={[entry("灵感生成器", { title: "生成书名" })]}
          deps={{ llm: { call: async () => ({ text: "《长夜》" }) }, getConfig: async () => ({}) }}
          onApplyTarget={onApplyTarget}
        />,
      )
    })

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-plugin-action]")!.click()
    })
    // 对话框是 portal 到 body 的，这里查 document.body
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("生成书名")
    expect(document.body.querySelector("[data-plugin-action-dialog]")).not.toBeNull()
  })
})
