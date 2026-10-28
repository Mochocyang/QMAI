// @vitest-environment jsdom
/**
 * SchemaForm 测试。
 *
 * 观察点来自设计 §3.2/§6.3：6 种字段都要画出来、必填要能看见、下拉框没有选项时
 * 必须禁用并说明原因、输入要带着正确的值回给调用方（表单值错了，提示词就错了，
 * 而提示词错了用户只会怪模型）。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionForm } from "@/lib/plugins/declarative/types"
import {
  SchemaForm,
  coerceFieldValue,
  fieldInputId,
  toggleMultiSelectValue,
  type SchemaFormProps,
} from "./SchemaForm"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const form: ActionForm = {
  fields: [
    { key: "title", type: "text", label: "书名", required: true, description: "越短越有钩子", placeholder: "例如：长夜" },
    { key: "idea", type: "textarea", label: "你的灵感", rows: 6 },
    { key: "count", type: "number", label: "备选数量", min: 1, max: 10, step: 1 },
    { key: "genre", type: "select", label: "题材", options: [{ value: "scifi", label: "科幻" }] },
    {
      key: "tags",
      type: "multiselect",
      label: "标签",
      maxSelected: 1,
      options: [
        { value: "a", label: "悬疑" },
        { value: "b", label: "末世" },
      ],
    },
    { key: "enabled", type: "toggle", label: "启用" },
  ],
}

let host: HTMLDivElement
let root: Root

function render(props: Partial<SchemaFormProps> = {}) {
  const onChange = vi.fn()
  const merged: SchemaFormProps = { form, values: {}, onChange, ...props }
  act(() => {
    root.render(<SchemaForm {...merged} />)
  })
  return { container: host, onChange }
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("SchemaForm 渲染", () => {
  it("6 种字段全部渲染", () => {
    render()
    const fields = [...host.querySelectorAll("[data-schema-field]")].map((node) =>
      node.getAttribute("data-schema-field"),
    )
    expect(fields).toEqual(["title", "idea", "count", "genre", "tags", "enabled"])

    expect(host.querySelector<HTMLInputElement>(`#${fieldInputId("title")}`)?.type).toBe("text")
    expect(host.querySelector<HTMLTextAreaElement>(`#${fieldInputId("idea")}`)?.rows).toBe(6)
    expect(host.querySelector<HTMLInputElement>(`#${fieldInputId("count")}`)?.type).toBe("number")
    expect(host.querySelector<HTMLSelectElement>(`#${fieldInputId("genre")}`)?.tagName).toBe("SELECT")
    expect(host.querySelectorAll(`#${fieldInputId("tags")}-a, #${fieldInputId("tags")}-b`)).toHaveLength(2)
    expect(host.querySelector('[role="switch"]')).not.toBeNull()
  })

  it("必填字段显示星号并给出无障碍说明，非必填不显示", () => {
    render()
    const requiredLabel = host.querySelector(`label[for="${fieldInputId("title")}"]`)
    expect(requiredLabel?.textContent).toContain("*")
    expect(requiredLabel?.textContent).toContain("（必填）")

    const optionalLabel = host.querySelector(`label[for="${fieldInputId("idea")}"]`)
    expect(optionalLabel?.textContent).not.toContain("*")
  })

  it("label 的 htmlFor 与输入框 id 用 field.key 关联；description 是小字", () => {
    render()
    expect(host.querySelector(`label[for="${fieldInputId("title")}"]`)).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>(`#${fieldInputId("title")}`)?.placeholder).toBe("例如：长夜")
    expect(host.textContent).toContain("越短越有钩子")
  })

  it("select 没有 options 时禁用并显示「暂无可选项」", () => {
    render({ form: { fields: [{ key: "genre", type: "select", label: "题材", options: [] }] } })
    const select = host.querySelector<HTMLSelectElement>(`#${fieldInputId("genre")}`)
    expect(select?.disabled).toBe(true)
    expect(select?.textContent).toContain("暂无可选项")
  })

  it("错误信息按字段渲染在字段下方", () => {
    render({ errors: { title: "请填写书名" } })
    const field = host.querySelector('[data-schema-field="title"]')
    expect(field?.textContent).toContain("请填写书名")
    expect(field?.querySelector('[role="alert"]')).not.toBeNull()
  })
})

describe("SchemaForm 回调", () => {
  it("输入文本时带上完整 values 回调", () => {
    const { onChange } = render({ values: { title: "旧值", idea: "" } })
    const idea = host.querySelector<HTMLTextAreaElement>(`#${fieldInputId("idea")}`)!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(idea, "末日列车")
      idea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({ title: "旧值", idea: "末日列车" })
  })

  it("toggle 点击回调布尔值", () => {
    const { onChange } = render({ values: { enabled: false } })
    act(() => {
      host.querySelector<HTMLButtonElement>('[role="switch"]')!.click()
    })
    expect(onChange).toHaveBeenCalledWith({ enabled: true })
  })

  it("多选到上限后不再增加", () => {
    const { onChange } = render({ values: { tags: ["a"] } })
    const second = host.querySelector<HTMLInputElement>(`#${fieldInputId("tags")}-b`)!
    expect(second.disabled).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("字段值归一化（纯函数）", () => {
  it("coerceFieldValue：数字空值 → undefined，合法数字 → number", () => {
    const numberField = { key: "count", type: "number" as const, label: "数量" }
    expect(coerceFieldValue(numberField, "")).toBeUndefined()
    expect(coerceFieldValue(numberField, "5")).toBe(5)
    expect(coerceFieldValue(numberField, "1e")).toBe("1e")
  })

  it("toggleMultiSelectValue：去重、取消、上限", () => {
    expect(toggleMultiSelectValue(["a"], "b")).toEqual(["a", "b"])
    expect(toggleMultiSelectValue(["a", "b"], "a")).toEqual(["b"])
    expect(toggleMultiSelectValue(["a"], "b", 1)).toEqual(["a"])
  })
})
