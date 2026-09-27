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

    expect(document.querySelector<HTMLInputElement>('[aria-label="修改 章纲-第001章.md 的文件名"]')?.value).toBe("章纲-第001章")
    expect(document.body.textContent).toContain("章纲")
  })

  it("非人物保存预览隐藏类型、写入方式、来源和引用 skill", async () => {
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
            referencedSkills: ["ZhanggangSkill/chapter-outline-builder"],
            sourceIntent: "生成第001章章纲",
            content: "正文",
          }]}
          onClose={() => {}}
          onConfirm={() => {}}
        />,
      )
    })

    const text = document.body.textContent ?? ""
    expect(text).not.toContain("类型：chapter-outline")
    expect(text).not.toContain("写入方式：create")
    expect(text).not.toContain("来源：生成第001章章纲")
    expect(text).not.toContain("引用 skill：ZhanggangSkill/chapter-outline-builder")
  })

  it("非人物保存时允许用户选择目标文件夹并提交选择结果", async () => {
    const onConfirm = vi.fn()
    await act(async () => {
      root.render(
        <OutlineSaveConfirmDialog
          open
          title="保存大纲"
          mode="normal"
          characterDrafts={[]}
          requests={[{
            targetFolder: "卷纲",
            fileName: "大纲剧情骨架.md",
            fileType: "volume-outline",
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "保存大纲",
            content: "正文",
          }]}
          onClose={() => {}}
          onConfirm={onConfirm}
        />,
      )
    })

    const select = document.body.querySelector(
      'select[aria-label="选择 大纲剧情骨架.md 的保存文件夹"]',
    ) as HTMLSelectElement
    expect(select).not.toBeNull()

    await act(async () => {
      select.value = "大纲"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => {
      findButton(document.body, "确认保存").click()
    })

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm.mock.calls[0][0].requests[0].targetFolder).toBe("大纲")
  })

  it("含 htmlContent 时显示 HTML/MD 格式选择并默认全选提交", async () => {
    const onConfirm = vi.fn()
    await act(async () => {
      root.render(
        <OutlineSaveConfirmDialog
          open
          title="保存卷纲"
          mode="normal"
          characterDrafts={[]}
          requests={[{
            targetFolder: "卷纲",
            fileName: "卷纲-第01卷.md",
            fileType: "volume-outline",
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "生成第01卷卷纲",
            content: "# 卷纲-第01卷",
            htmlContent: "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>",
          }]}
          onClose={() => {}}
          onConfirm={onConfirm}
        />,
      )
    })

    const mdCheckbox = document.body.querySelector(
      'input[aria-label="保存 MD 形式"]',
    ) as HTMLInputElement
    const htmlCheckbox = document.body.querySelector(
      'input[aria-label="保存 HTML 形式"]',
    ) as HTMLInputElement
    expect(mdCheckbox).not.toBeNull()
    expect(htmlCheckbox).not.toBeNull()
    expect(htmlCheckbox.disabled).toBe(false)
    expect(mdCheckbox.checked).toBe(true)
    expect(htmlCheckbox.checked).toBe(true)

    await act(async () => {
      findButton(document.body, "确认保存").click()
    })

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm.mock.calls[0][0].formats).toEqual({ md: true, html: true })
  })

  it("无 htmlContent 时 HTML 格式不可选", async () => {
    await act(async () => {
      root.render(
        <OutlineSaveConfirmDialog
          open
          title="保存大纲"
          mode="normal"
          characterDrafts={[]}
          requests={[{
            targetFolder: "卷纲",
            fileName: "卷纲-第01卷.md",
            fileType: "volume-outline",
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "生成第01卷卷纲",
            content: "# 卷纲-第01卷",
          }]}
          onClose={() => {}}
          onConfirm={() => {}}
        />,
      )
    })

    const htmlCheckbox = document.body.querySelector(
      'input[aria-label="保存 HTML 形式"]',
    ) as HTMLInputElement
    expect(htmlCheckbox).not.toBeNull()
    expect(htmlCheckbox.disabled).toBe(true)
    expect(document.body.textContent).toContain("本轮未生成 HTML 版本，无法保存 HTML")
  })
})
