// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OutlineSaveConfirmDialog } from "./outline-save-confirm-dialog"

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

describe("OutlineSaveConfirmDialog", () => {
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

  it("关闭时不渲染保存内容", async () => {
    await act(async () => {
      root.render(
        <OutlineSaveConfirmDialog
          open={false}
          title="保存人物"
          mode="character"
          characterDrafts={[]}
          requests={[]}
          onClose={() => {}}
          onConfirm={() => {}}
        />,
      )
    })

    expect(host.textContent).toBe("")
  })

  it("人物保存时显示角色勾选列表并只提交选中角色", async () => {
    const onConfirm = vi.fn()
    await act(async () => {
      root.render(
        <OutlineSaveConfirmDialog
          open
          title="保存人物"
          mode="character"
          characterDrafts={[
            {
              id: "a",
              characterName: "林辰",
              roleType: "男主",
              fileName: "角色-男主-林辰.md",
              content: "A",
              selected: true,
              confidence: "high",
            },
            {
              id: "b",
              characterName: "苏晚",
              roleType: "女主",
              fileName: "角色-女主-苏晚.md",
              content: "B",
              selected: true,
              confidence: "high",
            },
          ]}
          requests={[]}
          onClose={() => {}}
          onConfirm={onConfirm}
        />,
      )
    })

    const checkbox = document.body.querySelector(
      'input[aria-label="保存 女主 - 苏晚"]',
    ) as HTMLInputElement
    await act(async () => {
      checkbox.click()
    })
    await act(async () => {
      findButton(document.body, "确认保存").click()
    })

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(
      onConfirm.mock.calls[0][0].characterDrafts.map(
        (draft: { characterName: string }) => draft.characterName,
      ),
    ).toEqual(["林辰"])
  })

  it("非人物保存显示单文件保存预览", async () => {
    await act(async () => {
      root.render(
        <OutlineSaveConfirmDialog
          open
          title="保存章纲"
          mode="normal"
          characterDrafts={[]}
          requests={[{
            targetFolder: "章纲",
            fileName: "章纲-第001章.md",
            fileType: "chapter-outline",
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "保存章纲",
            content: "正文",
          }]}
          onClose={() => {}}
          onConfirm={() => {}}
        />,
      )
    })

    expect(document.body.textContent).toContain("章纲-第001章.md")
    expect(document.body.textContent).toContain("章纲")
  })
})
