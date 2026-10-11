// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReferencePickerDialog } from "./ReferencePickerDialog"
import type { ReferenceProvider } from "@/lib/reference/providers"
import type { ReferenceToken } from "@/lib/reference/types"

let host: HTMLDivElement
let root: Root

function makeToken(index: number): ReferenceToken {
  return {
    id: `ref-${index}`,
    category: "chapter",
    title: `章节${index}`,
    displayTitle: `章节${index}`,
    path: `C:/Novel/wiki/chapters/章节${index}.md`,
  }
}

const chapterItems = Array.from({ length: 11 }, (_, index) => makeToken(index + 1))
const technicalChapterItem: ReferenceToken = {
  id: "ref-technical",
  category: "chapter",
  title: "1/chapter-010",
  displayTitle: "第10章-灯下旧影",
  path: "C:/Novel/wiki/chapters/第10章-灯下旧影.md",
}

const providers: ReferenceProvider[] = [
  {
    category: "chapter",
    fetchItems: vi.fn(async () => chapterItems),
  },
  {
    category: "memory",
    fetchItems: vi.fn(async () => [{
      id: "memory-1",
      category: "memory" as const,
      title: "人物",
      displayTitle: "人物",
      path: "C:/Novel/wiki/memory/人物.md",
    }]),
  },
]

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

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

describe("ReferencePickerDialog", () => {
  it("renders nothing when closed", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open={false}
          providers={providers}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })

    expect(host.textContent).toBe("")
  })

  it("loads items, filters search, and confirms selected tokens", async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          providers={providers}
          projectPath="C:/Novel"
          onConfirm={onConfirm}
          onClose={onClose}
        />,
      )
    })
    await flush()

    expect(providers[0].fetchItems).toHaveBeenCalledWith("C:/Novel")
    expect(host.textContent).toContain("选择引用内容")
    expect(host.textContent).toContain("章节1")

    const search = host.querySelector("input[type='search']") as HTMLInputElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set
      valueSetter?.call(search, "章节11")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(host.textContent).toContain("章节11")
    expect(host.textContent).not.toContain("章节1章节2")

    const checkbox = host.querySelector("input[type='checkbox']") as HTMLInputElement
    await act(async () => {
      checkbox.click()
    })

    const confirm = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("确认引用"),
    )
    await act(async () => {
      confirm?.click()
    })

    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ title: "章节11" })])
    expect(onClose).toHaveBeenCalled()
  })

  it("uses the app surface styles and clear Chinese labels", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          providers={providers}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    const dialog = host.querySelector<HTMLElement>("[role='dialog']")
    expect(dialog).toBeTruthy()
    expect(dialog?.className).toContain("bg-background")
    expect(dialog?.className).toContain("max-w-[min(920px,calc(100vw-32px))]")
    expect(host.textContent).toContain("选择引用内容")
    expect(host.textContent).toContain("章节")
    expect(host.textContent).toContain("记忆库")
    expect(host.textContent).toContain("已选 0/10")
    expect(host.textContent).not.toMatch(/[📄🧠📋🔬⚡💬📝]/u)
  })

  it("uses the display title as the visible item name instead of technical file names", async () => {
    const technicalProviders: ReferenceProvider[] = [
      {
        category: "chapter",
        fetchItems: vi.fn(async () => [technicalChapterItem]),
      },
    ]

    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          providers={technicalProviders}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    expect(host.textContent).toContain("第10章-灯下旧影")
    expect(host.textContent).not.toContain("1/chapter-010")
  })

  it("does not select more than the maximum reference count", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          providers={providers}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    const checkboxes = Array.from(host.querySelectorAll("input[type='checkbox']")) as HTMLInputElement[]
    for (const checkbox of checkboxes) {
      await act(async () => {
        checkbox.click()
      })
    }

    const checked = Array.from(host.querySelectorAll("input[type='checkbox']:checked"))
    expect(checked).toHaveLength(10)
    expect(host.textContent).toContain("已选 10/10")
    expect(host.textContent).toContain("已达上限")
  })

  /*
   * === 「技能库」分类下的子 tab 过滤（丁-4 补）===
   *
   * ⚠️ 为什么必须补：这套用例原先的 fixture 里**根本没有 `skill` provider**，
   * 于是 `SKILL_SUBTABS` 与那条 `item.skillSubtype === skillSubtab` 过滤
   * **零覆盖** —— 丁-3 加了「文风」子 tab，丁-4 又加了「角色灵魂」，
   * 而「加了子 tab 但过滤条件写错」在两次改动里都不会有任何测试报警
   * （弹窗照常渲染、照常能选，只是列表里混进别的类型的条目）。
   */
  describe("技能库子 tab 过滤", () => {
    const skillItems: ReferenceToken[] = [
      { id: "sk-deai", category: "skill", title: "去AI味技能甲", skillId: "deai-1", skillSubtype: "deai", displayTitle: "去AI味技能甲" },
      { id: "sk-writing", category: "skill", title: "写作技能乙", skillId: "writing-1", skillSubtype: "writing", displayTitle: "写作技能乙" },
      { id: "sk-style", category: "skill", title: "甲书 · 文风", skillId: "style-a", skillSubtype: "style", displayTitle: "甲书 · 文风" },
      { id: "sk-soul", category: "skill", title: "许七安", skillId: "custom-xu", skillSubtype: "soul", displayTitle: "许七安" },
    ]
    const skillProviders: ReferenceProvider[] = [
      { category: "skill", fetchItems: vi.fn(async () => skillItems) },
    ]

    /** 当前可见的条目名（与渲染用的 checkbox 一一对应）。 */
    function visibleTitles(): string[] {
      return Array.from(host.querySelectorAll<HTMLElement>("label"))
        .map((label) => label.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
    }

    const findButton = (text: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === text)

    async function clickButton(text: string) {
      const button = findButton(text)
      expect(button, `应有按钮「${text}」`).toBeDefined()
      await act(async () => {
        button!.click()
      })
      await flush()
      await flush()
    }

    async function renderSkillPicker() {
      await act(async () => {
        root.render(
          <ReferencePickerDialog
            open
            providers={skillProviders}
            projectPath="C:/Novel"
            onConfirm={vi.fn()}
            onClose={vi.fn()}
          />,
        )
      })
      await flush()
      await flush()
      await clickButton("技能库")
    }

    it("「技能库」下有四个子 tab，且每个子 tab 只列它自己那一类条目", async () => {
      await renderSkillPicker()

      for (const label of ["去AI味技能", "写作Skill", "文风", "角色灵魂"]) {
        expect(findButton(label), `「技能库」下应有子 tab「${label}」`).toBeDefined()
      }

      // 默认子 tab 显示的是去AI味条目
      expect(visibleTitles()).toEqual(["去AI味技能甲"])

      await clickButton("写作Skill")
      expect(visibleTitles()).toEqual(["写作技能乙"])

      await clickButton("文风")
      expect(visibleTitles()).toEqual(["甲书 · 文风"])

      await clickButton("角色灵魂")
      expect(
        visibleTitles(),
        "「角色灵魂」子 tab 必须只列灵魂条目 —— 混进其它类型就是过滤条件写错了",
      ).toEqual(["许七安"])
    })

    it("从「角色灵魂」子 tab 确认引用：交出的 token 保留 aura id 与 soul 子类型", async () => {
      const onConfirm = vi.fn()
      await act(async () => {
        root.render(
          <ReferencePickerDialog
            open
            providers={skillProviders}
            projectPath="C:/Novel"
            onConfirm={onConfirm}
            onClose={vi.fn()}
          />,
        )
      })
      await flush()
      await flush()
      await clickButton("技能库")
      await clickButton("角色灵魂")

      const checkbox = host.querySelector("input[type='checkbox']") as HTMLInputElement
      await act(async () => {
        checkbox.click()
      })
      await clickButton("确认引用 1 项")

      /*
       * ⚠️ 断言的是**接口契约**（skillId = aura id、skillSubtype = "soul"），
       * 不是界面文案：消费端 `collectReferencedSoulAuraIds` 正是按这两项读的，
       * 少了任何一项都会静默变成「弹窗里能选、生成时什么都没绑」。
       */
      expect(onConfirm).toHaveBeenCalledWith([
        expect.objectContaining({ skillId: "custom-xu", skillSubtype: "soul" }),
      ])
    })
  })
})
