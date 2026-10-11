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

/*
 * 技能库 fixture（丁-3 修复批）。
 *
 * ⚠️ 上面那份 `providers` 只有 chapter / memory ⇒ 「技能库」分类在原来的用例里
 * **从不渲染**，于是 `filteredItems` 里那行 `item.skillSubtype === effectiveSkillSubtab`
 * 是**零覆盖**的：实测把它改成 `result.filter(() => true)`（等于删掉子类型过滤），
 * 162 个用例全绿。技能库子 tab 是丁-3 唯一新增的入口，必须在这里有真渲染。
 *
 * 三个子类型各给一条，且**条目名互不相同**，这样「列错子类型」一定会被文本断言抓到。
 */
function skillToken(id: string, title: string, subtype: "deai" | "writing" | "style"): ReferenceToken {
  return {
    id,
    category: "skill",
    title,
    skillId: `${subtype}-preset-id`,
    skillSubtype: subtype,
    displayTitle: title,
  }
}

const mixedSkillProviders: ReferenceProvider[] = [
  {
    category: "skill",
    fetchItems: vi.fn(async () => [
      skillToken("skill-deai", "去AI味一", "deai"),
      skillToken("skill-writing", "写作一", "writing"),
      skillToken("skill-style", "甲书 · 文风", "style"),
    ]),
  },
]

/** 只有 deai/writing 的 provider（= 大纲/细纲面板的形状：没有文风覆盖通道）。 */
const skillProvidersWithoutStyle: ReferenceProvider[] = [
  {
    category: "skill",
    fetchItems: vi.fn(async () => [
      skillToken("skill-deai", "去AI味一", "deai"),
      skillToken("skill-writing", "写作一", "writing"),
    ]),
  },
]

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === text)
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
   * 丁-3：技能库子 tab 的过滤。
   * `defaultTab` 传 "skill" 直接落在技能库上，省掉一次分类点击。
   */
  it("技能库子 tab 只列对应子类型的条目（默认去AI味，切到文风只看文风）", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          defaultTab="skill"
          providers={mixedSkillProviders}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    // 默认子 tab 是「去AI味技能」：只能看到 deai 条目
    expect(host.textContent).toContain("去AI味技能")
    expect(host.textContent).toContain("写作Skill")
    expect(host.textContent).toContain("文风")
    expect(host.textContent).toContain("去AI味一")
    expect(host.textContent, "默认子 tab 不得混入写作Skill条目").not.toContain("写作一")
    expect(host.textContent, "默认子 tab 不得混入文风条目").not.toContain("甲书 · 文风")

    // 切到「文风」：只列文风条目
    await act(async () => {
      findButton("文风")?.click()
    })
    await flush()

    expect(host.textContent).toContain("甲书 · 文风")
    expect(host.textContent, "文风子 tab 不得混入去AI味条目").not.toContain("去AI味一")
    expect(host.textContent, "文风子 tab 不得混入写作Skill条目").not.toContain("写作一")

    // 切到「写作Skill」：只列写作条目（证明上面不是「切谁都只显示文风」的巧合）
    await act(async () => {
      findButton("写作Skill")?.click()
    })
    await flush()

    expect(host.textContent).toContain("写作一")
    expect(host.textContent).not.toContain("甲书 · 文风")
    expect(host.textContent).not.toContain("去AI味一")
  })

  /*
   * 丁-3 修复批（SF-3）：**没有条目的子类型不摆出空子 tab**。
   *
   * 大纲/细纲面板的 skill provider 只吐 deai/writing（它没有文风覆盖通道），
   * 而 `SKILL_SUBTABS` 是模块级常量、原来被无条件渲染 ⇒ 那个面板会看到一个
   * 永远「暂无内容」的「文风」子 tab，用户会读成「库里没有文风」
   * 而不是「这个面板不支持引用文风」。
   */
  it("provider 没有某子类型的条目时，不摆出那个空子 tab（大纲面板看不到「文风」）", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          defaultTab="skill"
          providers={skillProvidersWithoutStyle}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    expect(host.textContent).toContain("去AI味技能")
    expect(host.textContent).toContain("写作Skill")
    expect(host.textContent, "没有文风条目的面板不得摆出「文风」子 tab").not.toContain("文风")
    // 反向对照：列表本身有内容（不是「整体没渲染」导致的假绿）
    expect(host.textContent).toContain("去AI味一")
  })

  /*
   * 子 tab 的**逃生口**：技能列表整体为空时（还没加载完，或库确实是空的）保留全部子 tab。
   *
   * ⚠️ 这条是**变异逼出来的**：把 `items.length === 0 ? SKILL_SUBTABS : ...` 的逃生口去掉
   * （恒走过滤分支），上面 8 条用例全绿 —— 因为没有任何用例跑过「空技能库」。
   * 代价是加载中/空库时子 tab 会先消失再出现（闪一下），
   * 而且会把「库里一条都没有」表达成「没有这个子类型」。
   */
  it("技能库整体为空时仍摆出全部子 tab（不闪、也不谎称「没有这个子类型」）", async () => {
    const emptySkillProviders: ReferenceProvider[] = [
      { category: "skill", fetchItems: vi.fn(async () => []) },
    ]

    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          defaultTab="skill"
          providers={emptySkillProviders}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    expect(host.textContent).toContain("暂无内容")
    expect(host.textContent).toContain("去AI味技能")
    expect(host.textContent).toContain("写作Skill")
    expect(host.textContent).toContain("文风")
  })

  /*
   * 子 tab 的可用性只看**有没有条目**，与用户当前的搜索词无关：
   * 搜索是用户当下的筛选，不该让子 tab 随关键词出现/消失。
   */
  it("搜索关键词不改变子 tab 的可见性", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          defaultTab="skill"
          providers={mixedSkillProviders}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    const search = host.querySelector("input[type='search']") as HTMLInputElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set
      valueSetter?.call(search, "甲书")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(host.textContent).toContain("暂无内容")
    expect(host.textContent, "搜索命不中时子 tab 仍应在").toContain("文风")
    expect(host.textContent).toContain("写作Skill")
  })
})
