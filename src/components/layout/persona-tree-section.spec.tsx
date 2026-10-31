// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 人物区段把「人物」搬回了大纲第一栏，所以这几条盯着的是
 * **它点了之后到底改了什么**：只应该切中栏内容（`personaOutlinePane`），
 * 不该跳整页视图（`activeView`）。
 */
const storeState: {
  project: { path: string } | null
  personaOutlinePane: unknown
  setPersonaOutlinePane: (focus: unknown) => void
} = {
  project: { path: "/tmp/project" },
  personaOutlinePane: null,
  setPersonaOutlinePane: vi.fn(),
}

const indexMock = vi.fn()
const sightingsMock = vi.fn()

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))

vi.mock("@/lib/novel/persona-skill-store", () => ({
  loadPersonaSkillIndex: (...args: unknown[]) => indexMock(...args),
  loadPersonaSightings: (...args: unknown[]) => sightingsMock(...args),
}))

import { PersonaTreeSection } from "./persona-tree-section"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  storeState.personaOutlinePane = null
  storeState.setPersonaOutlinePane = vi.fn()
  indexMock.mockResolvedValue({
    version: 1,
    skills: [
      { id: "杨寒", characterName: "杨寒", roleType: "主角", status: "active", appearanceCount: 18, pinned: true, aliases: [], tier: "major" },
      { id: "杨津艺", characterName: "杨津艺", roleType: "次要", status: "dormant", appearanceCount: 1, pinned: false, aliases: [], tier: "minor", autoUpdate: false },
    ],
  })
  sightingsMock.mockResolvedValue({
    version: 1,
    sightings: [
      { characterName: "地下铁门守卫", aliases: [], roleType: "", appearanceCount: 1, firstChapter: 5, lastChapter: 5, chapters: [5] },
    ],
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => root.render(<PersonaTreeSection />))
}

describe("PersonaTreeSection（大纲第一栏的人物小传）", () => {
  it("固定文件夹「人物小传」带锁定图标与总数，活跃/候选都在里面", async () => {
    await render()
    const section = host.querySelector('[data-testid="persona-tree-section"]')!
    expect(section).not.toBeNull()
    expect(section.textContent).toContain("人物小传")
    expect(section.textContent).toContain("活跃角色")
    expect(section.textContent).toContain("候选角色")
    // 2 位活跃 + 1 位候选
    expect(section.textContent).toContain("3")
  })

  it("角色节点按索引渲染，潜伏角色带灰点、冻结角色带「冻」标记", async () => {
    await render()
    expect(host.querySelector('[data-testid="persona-tree-item-杨寒"]')).not.toBeNull()
    const dormant = host.querySelector('[data-testid="persona-tree-item-杨津艺"]')!
    expect(dormant.textContent).toContain("杨津艺")
    expect(dormant.textContent).toContain("冻")
  })

  it("点角色只切中栏内容，不跳整页视图", async () => {
    await render()
    await act(async () =>
      host.querySelector<HTMLElement>('[data-testid="persona-tree-item-杨寒"]')!.click(),
    )
    expect(storeState.setPersonaOutlinePane).toHaveBeenCalledWith({ mode: "persona", id: "杨寒" })
  })

  it("区段里不再有「新建人物角色」按钮：统一走顶部新建菜单", async () => {
    await render()
    expect(host.querySelector('[data-testid="persona-tree-create"]')).toBeNull()
  })

  it("候选角色右键出菜单：建档 / 删除", async () => {
    await render()
    await act(async () =>
      host.querySelector<HTMLElement>('[data-testid="persona-tree-candidates-toggle"]')!.click(),
    )
    const row = host.querySelector<HTMLElement>('[data-testid="persona-tree-candidate-地下铁门守卫"]')!
    await act(async () => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }))
    })
    const menu = host.querySelector('[data-testid="persona-tree-menu"]')!
    expect(menu).not.toBeNull()
    expect(menu.querySelector('[data-testid="persona-tree-menu-promote"]')).not.toBeNull()
    expect(menu.querySelector('[data-testid="persona-tree-menu-delete-candidate"]')).not.toBeNull()
  })

  it("右键菜单不会被自己的全局监听关掉（曾经右键完全没反应）", async () => {
    await render()
    const row = host.querySelector<HTMLElement>('[data-testid="persona-tree-item-杨寒"]')!
    await act(async () => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }))
    })
    // 模拟浏览器行为：contextmenu 之后事件继续冒泡到 window
    await act(async () => {
      window.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="persona-tree-menu"]')).not.toBeNull()
  })

  it("点菜单外部会收起菜单，点菜单内部不会", async () => {
    await render()
    const row = host.querySelector<HTMLElement>('[data-testid="persona-tree-item-杨寒"]')!
    await act(async () => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }))
    })
    // 菜单内部按下：不应收起
    await act(async () => {
      const item = host.querySelector<HTMLElement>('[data-testid="persona-tree-menu-important"]')!
      item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="persona-tree-menu"]')).not.toBeNull()
    // 外部按下：收起
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="persona-tree-menu"]')).toBeNull()
  })

  it("活跃角色右键出菜单：标记重要 / 打开 / 删除", async () => {
    await render()
    const row = host.querySelector<HTMLElement>('[data-testid="persona-tree-item-杨寒"]')!
    await act(async () => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }))
    })
    expect(host.querySelector('[data-testid="persona-tree-menu-important"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="persona-tree-menu-open"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="persona-tree-menu-delete-persona"]')).not.toBeNull()
  })

  it("点「人物小传」只折叠，不导航到任何视图", async () => {
    await render()
    const folder = host.querySelector<HTMLElement>('[data-testid="persona-tree-folder"]')!
    expect(folder.getAttribute("aria-expanded")).toBe("true")
    await act(async () => folder.click())
    // 折叠了
    expect(folder.getAttribute("aria-expanded")).toBe("false")
    // 但没有触发任何导航
    expect(storeState.setPersonaOutlinePane).not.toHaveBeenCalled()
  })

  it("点「活跃角色」整行切换展开/折叠", async () => {
    await render()
    const toggle = host.querySelector<HTMLElement>('[data-testid="persona-tree-active-toggle"]')!
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelector('[data-testid="persona-tree-item-杨寒"]')).not.toBeNull()
    await act(async () => toggle.click())
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(host.querySelector('[data-testid="persona-tree-item-杨寒"]')).toBeNull()
  })

  it("候选角色默认折叠，展开后才出现名字", async () => {
    await render()
    expect(host.textContent).not.toContain("地下铁门守卫")
    await act(async () =>
      host.querySelector<HTMLElement>('[data-testid="persona-tree-candidates-toggle"]')!.click(),
    )
    expect(host.textContent).toContain("地下铁门守卫")
  })
})
