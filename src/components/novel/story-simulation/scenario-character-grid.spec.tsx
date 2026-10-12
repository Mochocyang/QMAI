// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import type { ScenarioCandidate } from "@/lib/novel/story-simulation/scenario-types"
import { ScenarioCharacterGrid } from "./scenario-character-grid"

function makeCandidate(
  name: string,
  overrides: Partial<ScenarioCandidate> = {},
): ScenarioCandidate {
  return {
    id: name,
    name,
    profile: "",
    auraId: null,
    auraName: null,
    speakingStyle: "",
    personality: [],
    knowledgeScope: [],
    doesNotKnow: [],
    ...overrides,
  }
}

const CANDIDATES = [
  makeCandidate("沈砚", { personality: ["谨慎", "寡言"] }),
  makeCandidate("林清越"),
  makeCandidate("苏九", { auraId: "a1", auraName: "游侠" }),
]

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** 渲染网格；未显式传入的回调一律用空 spy 顶上。 */
function renderGrid(props: Partial<React.ComponentProps<typeof ScenarioCharacterGrid>> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onSetModerator: vi.fn(),
    onBindSoul: vi.fn(),
  }
  act(() => {
    root.render(
      <ScenarioCharacterGrid
        candidates={CANDIDATES}
        selectedIds={[]}
        characterCount={3}
        moderatorId="__user__"
        {...handlers}
        {...props}
      />,
    )
  })
  return handlers
}

/** 取某个角色所在的卡片容器。 */
function cardOf(name: string): HTMLElement {
  const toggle = host.querySelector<HTMLButtonElement>(
    `button[aria-label="把 ${name} 加入或移出舞台"]`,
  )
  if (!toggle) throw new Error(`找不到 ${name} 的卡片`)
  return toggle.closest("div.rounded-lg") as HTMLElement
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("要点击的元素不存在")
  act(() => {
    ;(node as HTMLElement).click()
  })
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(text),
  )
}

/** React 受控组件：必须走原型上的 setter，否则 value tracker 会吞掉事件。 */
function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(el, value)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("ScenarioCharacterGrid", () => {
  it("未上台时点击卡片即请求上台", () => {
    const { onToggle } = renderGrid()
    click(host.querySelector('button[aria-label="把 沈砚 加入或移出舞台"]'))
    expect(onToggle).toHaveBeenCalledWith("沈砚")
  })

  it("已上台的卡片显示上台序号，顺序与 selectedIds 一致", () => {
    renderGrid({ selectedIds: ["苏九", "沈砚"] })
    expect(cardOf("苏九").textContent).toContain("1")
    expect(cardOf("沈砚").textContent).toContain("2")
    // 未上台的卡片应当连序号徽标都不渲染。原来写的是 `not.toContain("1")`，
    // 而「林清越」这个名字与这张卡片上的任何文案都不含数字，断言恒真、没有鉴别力；
    // 序号徽标是卡片内唯一带 place-items-center 的 span（未上台只有空心圆占位）。
    expect(cardOf("林清越").querySelector("span.place-items-center")).toBeNull()
  })

  it("点已上台的卡片也走同一个回调（由父组件决定是下台）", () => {
    const { onToggle } = renderGrid({ selectedIds: ["沈砚"] })
    click(host.querySelector('button[aria-label="把 沈砚 加入或移出舞台"]'))
    expect(onToggle).toHaveBeenCalledWith("沈砚")
  })

  it("满员时不再把候选算作可上台（回调照发，由父组件拒绝并提示）", () => {
    const { onToggle } = renderGrid({ selectedIds: ["沈砚", "林清越"], characterCount: 2 })
    const card = cardOf("苏九")
    expect(card.className).toContain("opacity-60")
    click(host.querySelector('button[aria-label="把 苏九 加入或移出舞台"]'))
    expect(onToggle).toHaveBeenCalledWith("苏九")
  })

  it("未绑定灵魂时给的是可点的「绑定灵魂」入口，而不是一句死文案", () => {
    const { onBindSoul } = renderGrid()
    // 按卡片定位而不是取全页第一个「绑定灵魂」：沈砚与林清越都没绑灵魂，
    // 全局取第一个会把这条断言绑死在候选顺序上。
    const bind = Array.from(cardOf("沈砚").querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("绑定灵魂"),
    )
    expect(bind).toBeTruthy()
    click(bind)
    expect(onBindSoul).toHaveBeenCalledWith(expect.objectContaining({ id: "沈砚" }))
  })

  it("已绑定灵魂时显示灵魂名，并可点开更换", () => {
    const { onBindSoul } = renderGrid()
    const soul = buttonByText("游侠")
    expect(soul?.textContent).toContain("灵魂")
    click(soul)
    expect(onBindSoul).toHaveBeenCalledWith(expect.objectContaining({ id: "苏九" }))
  })

  it("已上台且不是主持人时出现「设为主持人」", () => {
    const { onSetModerator } = renderGrid({ selectedIds: ["沈砚"] })
    click(host.querySelector('button[aria-label="设为主持人"]'))
    expect(onSetModerator).toHaveBeenCalledWith("沈砚")
  })

  it("只有已上台的角色才有「设为主持人」", () => {
    renderGrid({ selectedIds: ["苏九"] })
    expect(host.querySelectorAll('button[aria-label="设为主持人"]')).toHaveLength(1)
  })

  it("已是主持人时显示徽标，且不再显示「设为主持人」", () => {
    renderGrid({ selectedIds: ["沈砚"], moderatorId: "沈砚" })
    expect(cardOf("沈砚").textContent).toContain("主持人")
    expect(host.querySelector('button[aria-label="设为主持人"]')).toBeNull()
  })

  it("候选少时不出现搜索框", () => {
    renderGrid()
    expect(host.querySelector('input[aria-label="搜索角色"]')).toBeNull()
  })

  it("候选超过阈值时出现搜索框，且能按名字过滤", async () => {
    const many = Array.from({ length: 15 }, (_, i) => makeCandidate(`角色${i}`))
    renderGrid({ candidates: many })
    const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索角色"]')
    expect(search).toBeTruthy()
    act(() => {
      setNativeValue(search!, "角色3")
      search!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await flush()
    expect(host.textContent).toContain("角色3")
    expect(host.textContent).not.toContain("角色4")
  })

  it("过滤后一个都不匹配时给出空态，而不是一片空白", async () => {
    const many = Array.from({ length: 15 }, (_, i) => makeCandidate(`角色${i}`))
    renderGrid({ candidates: many })
    const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索角色"]')!
    act(() => {
      setNativeValue(search, "查无此人")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await flush()
    expect(host.textContent).toContain("没有匹配")
  })

  it("候选为空时不渲染任何东西", () => {
    renderGrid({ candidates: [] })
    expect(host.textContent?.trim()).toBe("")
  })
})
