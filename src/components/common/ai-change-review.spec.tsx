// @vitest-environment jsdom
import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./monaco-diff-editor", () => ({
  MonacoDiffEditor: ({ originalValue, modifiedValue, onChange }: {
    originalValue: string
    modifiedValue: string
    onChange: (value: string) => void
  }) => {
    const [value, setValue] = React.useState(modifiedValue)
    return (
      <div>
        <pre aria-label="原始源码">{originalValue}</pre>
        <textarea
          aria-label="最新源码"
          value={value}
          onChange={(event) => {
            const next = event.target.value
            setValue(next)
            onChange(next)
          }}
        />
      </div>
    )
  },
}))

import { AiChangeReview, type AiChangeReviewItem } from "./ai-change-review"

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`未找到按钮：${label}`)
  return button
}

describe("AiChangeReview", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("按文件勾选并提交选中项；取消勾选的不提交", async () => {
    const onConfirm = vi.fn()
    const items: AiChangeReviewItem[] = [{
      id: "outline",
      fileName: "总纲.md",
      originalContent: "# 旧总纲",
      modifiedContent: "# 新总纲",
      selected: true,
    }, {
      id: "character",
      fileName: "林默.md",
      originalContent: "",
      modifiedContent: "# 林默",
      selected: true,
    }]

    await act(async () => {
      root.render(
        <AiChangeReview
          open
          title="确认 AI 修改"
          items={items}
          onClose={() => {}}
          onConfirm={onConfirm}
        />,
      )
    })

    const characterCheckbox = document.body.querySelector('input[aria-label="保存 林默.md"]') as HTMLInputElement
    await act(async () => characterCheckbox.click())
    await act(async () => findButton(document.body, "确认保存").click())

    expect(onConfirm).toHaveBeenCalledOnce()
    const submitted = onConfirm.mock.calls[0][0] as AiChangeReviewItem[]
    expect(submitted).toHaveLength(1)
    expect(submitted[0].id).toBe("outline")
    expect(submitted[0].modifiedContent).toBe("# 新总纲")
    expect(submitted.some((i: AiChangeReviewItem) => i.id === "character")).toBe(false)
  })

  it("未选择任何文件时禁用确认保存", async () => {
    const onConfirm = vi.fn()
    const items: AiChangeReviewItem[] = [{
      id: "outline",
      fileName: "总纲.md",
      originalContent: "# 旧总纲",
      modifiedContent: "# 新总纲",
      selected: false,
    }]

    await act(async () => {
      root.render(
        <AiChangeReview
          open
          title="确认 AI 修改"
          items={items}
          onClose={() => {}}
          onConfirm={onConfirm}
        />,
      )
    })

    const btn = findButton(document.body, "确认保存")
    expect(btn.disabled).toBe(true)
  })

  it("可在源码对比和不带符号的渲染预览之间切换", async () => {
    await act(async () => {
      root.render(
        <AiChangeReview
          open
          title="确认 AI 修改"
          items={[{
            id: "outline",
            fileName: "总纲.md",
            originalContent: "# 旧总纲",
            modifiedContent: "# 新总纲",
            selected: true,
          }]}
          onClose={() => {}}
          onConfirm={() => {}}
        />,
      )
    })

    expect(document.body.querySelector('textarea[aria-label="最新源码"]')).not.toBeNull()
    await act(async () => findButton(document.body, "渲染预览").click())
    expect(document.body.textContent).toContain("原始内容预览")
    expect(document.body.textContent).toContain("最新内容预览")
    await act(async () => findButton(document.body, "源码对比").click())
    expect(document.body.querySelector('textarea[aria-label="最新源码"]')).not.toBeNull()
  })
})
