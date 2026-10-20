// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReferencePickerDialog, matchesReferenceKeyword, pinFavoriteSkills } from "./ReferencePickerDialog"
import { useFavoriteSkillStore } from "@/stores/favorite-skill-store"
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

/**
 * 技能库子 tab 按钮的文本（只取子 tab 那一条，不含弹窗其它文案与条目名）。
 *
 * ⚠️ 不要用 `host.textContent` 做**负向**断言来判「没有某个子 tab」：
 * 整弹窗文本里任何 copy 或 fixture 条目名只要含那两个词，就会因为**与行为无关**的原因变红
 * —— 那正是本批 SF-2 那条假阳性的形状（一条只可能被文案满足的断言）。负向断言只针对子 tab 按钮。
 */
function skillSubtabButtonLabels(): string[] {
  const bar = host.querySelector<HTMLElement>('[data-ui-reference="skill-subtabs"]')
  if (!bar) return []
  return Array.from(bar.querySelectorAll("button"))
    .map((button) => button.textContent?.trim() ?? "")
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
    expect(skillSubtabButtonLabels()).toEqual(["去AI味技能", "写作Skill", "文风"])
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

    expect(skillSubtabButtonLabels()).toEqual(["去AI味技能", "写作Skill"])
    // 反向对照：列表本身有内容（不是「整体没渲染」导致的假绿）
    expect(host.textContent).toContain("去AI味一")
  })

  /*
   * 🔴 承重路径（丁-3 第二轮修复）：**当前子 tab 不在可用列表里时要回退**。
   *
   * 生产可达：`resolveAvailableDeAiSkills`（`de-ai-skill-library.ts`）
   * = 内置技能 − `disabledSkillIds`，而技能库页提供**逐技能启停**
   * ⇒「禁用全部去AI味技能 + 有 ≥1 条文风预设 + 没有写作 Skill」时，
   * `items` 非空但**没有 deai 条目**，而默认子 tab 正是 `"deai"`。
   * 没有 `effectiveSkillSubtab` 的回退，高亮会停在一个**已被隐藏**的 tab 上、
   * 列表恒为「暂无内容」—— 用户看不到那条文风，也看不出为什么。
   *
   * ⚠️ 这条是**变异逼出来的**：把 `effectiveSkillSubtab` 换成 `skillSubtab`
   * （去掉回退），本文件其余用例**全绿** —— 之前的 fixture 都有 deai 条目，
   * 回退分支从没被走过。
   */
  it("只有文风条目时高亮落到「文风」并列出条目（而不是空列表）", async () => {
    const onConfirm = vi.fn()
    const onlyStyleProviders: ReferenceProvider[] = [
      {
        category: "skill",
        fetchItems: vi.fn(async () => [skillToken("skill-style", "甲书 · 文风", "style")]),
      },
    ]

    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          defaultTab="skill"
          providers={onlyStyleProviders}
          projectPath="C:/Novel"
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    // 只剩一个子 tab，且它就是「文风」
    expect(skillSubtabButtonLabels()).toEqual(["文风"])
    // 列表显示那条文风条目，而不是「暂无内容」（用户看得见的症状）
    expect(host.textContent).not.toContain("暂无内容")
    expect(host.textContent).toContain("甲书 · 文风")
    // 高亮也必须落在它身上（否则用户看到的是一个没有选中项的 tab 条）
    expect(findButton("文风")?.className, "「文风」子 tab 应是高亮态").toContain("bg-primary")

    // 它是**可用入口**而不是装饰：能选中、能确认，且确认出来的 token 带着预设 id
    const checkbox = host.querySelector("input[type='checkbox']") as HTMLInputElement
    expect(checkbox, "列表里应有可勾选的文风条目").not.toBeNull()
    await act(async () => {
      checkbox.click()
    })
    expect(host.textContent).toContain("已选 1/10")

    const confirm = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("确认引用"))
    await act(async () => {
      confirm?.click()
    })
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ skillId: "style-preset-id", skillSubtype: "style" }),
    ])
  })

  /*
   * 子 tab 的**逃生口**：技能列表整体为空时保留全部子 tab。
   *
   * ⚠️ 这条是**变异逼出来的**：把 `items.length === 0 ? SKILL_SUBTABS : ...` 的逃生口去掉
   * （恒走过滤分支），上面 8 条用例全绿 —— 因为没有任何用例跑过「空技能库」。
   * 它保证的是**首次打开 / 列表确实是空的**时不闪，并把「库里一条都没有」
   * 如实表达为「暂无内容」而不是「没有这个子类型」。
   * （切换分类时 `items` 是上一个分类的旧值，那不在这条逃生口的覆盖范围内，
   *   `ReferencePickerDialog.tsx` 的注释里写明了这个边界。）
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
    // ⚠️ 合并期订正：丁-4 往 `SKILL_SUBTABS` 加了「角色灵魂」⇒ 逃出口摆出的是**四条**。
    // 这条断言正是「逃出口 = 模块级全集」这个性质的钉子，所以必须随全集一起变。
    expect(skillSubtabButtonLabels()).toEqual(["去AI味技能", "写作Skill", "文风", "角色灵魂"])
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
    expect(skillSubtabButtonLabels(), "搜索命不中时子 tab 仍应在").toEqual(["去AI味技能", "写作Skill", "文风"])
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

describe("ReferencePickerDialog 写作Skill：展示名搜索与收藏置顶", () => {
  const writingItems: ReferenceToken[] = [
    { id: "w1", category: "skill", title: "dialogue-emotion", displayTitle: "对话与情绪", skillId: "skill:1", skillSubtype: "writing" },
    { id: "w2", category: "skill", title: "battle-scene", displayTitle: "战斗描写", skillId: "skill:2", skillSubtype: "writing" },
    { id: "w3", category: "skill", title: "esports-live", displayTitle: "文娱直播电竞", skillId: "skill:3", skillSubtype: "writing" },
  ]
  const writingProviders: ReferenceProvider[] = [{ category: "skill", fetchItems: vi.fn(async () => writingItems) }]

  async function renderWriting() {
    await act(async () => {
      root.render(<ReferencePickerDialog open defaultTab="skill" providers={writingProviders} projectPath="C:/Novel" onConfirm={vi.fn()} onClose={vi.fn()} />)
    })
    await flush()
  }

  function listedTitles(): string[] {
    return Array.from(host.querySelectorAll("label span.block.truncate")).map((node) => node.textContent ?? "")
  }

  afterEach(() => {
    useFavoriteSkillStore.setState({ favorites: [] })
  })

  it("按界面上显示的中文名能搜到（title 是机器名）", async () => {
    await renderWriting()
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "战斗描写")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(listedTitles()).toEqual(["战斗描写"])
  })

  it("已收藏的技能置顶，其余保持原顺序", async () => {
    useFavoriteSkillStore.setState({
      favorites: [{ favoriteId: "f", library: "writing", skillId: "skill:3", originProjectPath: "", source: "project", snapshot: {} as never, favoritedAt: 1 }],
    })
    await renderWriting()
    expect(listedTitles()).toEqual(["文娱直播电竞", "对话与情绪", "战斗描写"])
  })

  it("pinFavoriteSkills 稳定排序且按库区分", () => {
    const items: ReferenceToken[] = [
      { id: "a", category: "skill", title: "a", displayTitle: "a", skillId: "x", skillSubtype: "deai" },
      { id: "b", category: "skill", title: "b", displayTitle: "b", skillId: "x", skillSubtype: "writing" },
      { id: "c", category: "skill", title: "c", displayTitle: "c", skillId: "y", skillSubtype: "deai" },
    ]
    expect(pinFavoriteSkills(items, new Set(["de-ai:y", "de-ai:x"])).map((i) => i.id)).toEqual(["a", "c", "b"])
    expect(pinFavoriteSkills(items, new Set()).map((i) => i.id)).toEqual(["a", "b", "c"])
  })

  it("截断的展示名去掉省略号后仍可匹配", () => {
    expect(matchesReferenceKeyword({ id: "z", category: "skill", title: "long", displayTitle: "一二三四五六七八九十一二三四五六七八九十..." }, "九十")).toBe(true)
  })
})
