// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PersonaDocumentView } from "./persona-document-view"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function render(props: Partial<Parameters<typeof PersonaDocumentView>[0]> = {}) {
  const onCommitField = vi.fn()
  await act(async () =>
    root.render(
      <PersonaDocumentView
        characterName={props.characterName ?? "杨寒"}
        roleType={props.roleType ?? "主角"}
        fields={props.fields ?? { 怎么说话: "短句，爱反问。" }}
        research={props.research ?? {}}
        injectPreview={props.injectPreview ?? "人物性格：毒舌"}
        onCommitField={onCommitField}
      />,
    ),
  )
  return onCommitField
}

describe("PersonaDocumentView（N1 整页文档 + R2 折叠研究文件）", () => {
  it("四章齐全，字段与正文都在同一份文档里", async () => {
    await render()
    for (const title of ["基本信息", "性格与灵魂", "语言与行为", "关系与状态", "研究文件"]) {
      expect(host.textContent, title).toContain(title)
    }
    expect(host.textContent).toContain("怎么说话")
    expect(host.querySelector('[data-testid="persona-doc-field-怎么说话"]')!.textContent).toContain("短句，爱反问。")
  })

  it("空字段用占位描述，不把占位写进内容", async () => {
    await render({ fields: {} })
    const empty = host.querySelector('[data-testid="persona-doc-field-外貌"]')!
    expect(empty.textContent).toBe("")
    expect(empty.getAttribute("data-placeholder")).toBe("（未填）")
  })

  it("失焦时把改后的文本提交回字段", async () => {
    const onCommitField = await render()
    const node = host.querySelector<HTMLElement>('[data-testid="persona-doc-field-怎么说话"]')!
    await act(async () => {
      node.textContent = "几乎不说话。"
      node.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
    expect(onCommitField).toHaveBeenCalledWith("怎么说话", "几乎不说话。")
  })

  it("内容没变时不提交，避免无意义保存", async () => {
    const onCommitField = await render()
    const node = host.querySelector<HTMLElement>('[data-testid="persona-doc-field-怎么说话"]')!
    await act(async () => {
      node.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
    expect(onCommitField).not.toHaveBeenCalled()
  })

  it("研究文件默认折叠，六份都在，未生成的标明状态", async () => {
    await render({ research: { 人物小传: "在黑雨里长大。" } })
    const folds = host.querySelectorAll("details")
    expect(folds).toHaveLength(6)
    // 默认不展开
    expect([...folds].every((node) => !(node as HTMLDetailsElement).open)).toBe(true)
    expect(host.textContent).toContain("已生成")
    expect(host.textContent).toContain("未生成")
  })

  it("研究文件正文按段落渲染", async () => {
    await render({ research: { 人物小传: "第一段。\n\n第二段。" } })
    const body = host.querySelector("details .ui-test-pdoc-fold-body")!
    expect(body.querySelectorAll("p")).toHaveLength(2)
  })
})
