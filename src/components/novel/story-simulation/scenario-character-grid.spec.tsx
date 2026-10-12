// @vitest-environment jsdom

import { act, useState } from "react"
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

/** 取某个角色卡片上的「加入或移出舞台」开关按钮；这个 aria-label 形状是下游 Task 6 的定位锚点。 */
function toggleOf(name: string): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(
    `button[aria-label="把 ${name} 加入或移出舞台"]`,
  )
  if (!el) throw new Error(`找不到 ${name} 的卡片`)
  return el
}

/** 取某个角色所在的卡片容器。 */
function cardOf(name: string): HTMLElement {
  return toggleOf(name).closest("div.rounded-lg") as HTMLElement
}

/** 取卡片里的上台序号徽标（改动 D 给它挂了 scenario-stage-&lt;下标&gt; 这个稳定 id）。 */
function stageBadgeOf(name: string): HTMLElement | null {
  return cardOf(name).querySelector<HTMLElement>('[id^="scenario-stage-"]')
}

/** 取卡片里的灵魂入口按钮（未绑灵魂时是「绑定灵魂」，已绑时是「灵魂：X」）。 */
function soulButtonOf(name: string): HTMLButtonElement {
  const btn = Array.from(cardOf(name).querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes("灵魂"),
  )
  if (!btn) throw new Error(`找不到 ${name} 的灵魂入口`)
  return btn
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("要点击的元素不存在")
  act(() => {
    ;(node as HTMLElement).click()
  })
}

/** React 受控组件：必须走原型上的 setter，否则 value tracker 会吞掉事件。 */
function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(el, value)
}

/** 往搜索框里敲一个词。 */
function typeSearch(value: string) {
  const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索角色"]')
  if (!search) throw new Error("搜索框不存在")
  act(() => {
    setNativeValue(search, value)
    search.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function makeMany(count: number, extra: ScenarioCandidate[] = []): ScenarioCandidate[] {
  return [
    ...extra,
    ...Array.from({ length: count }, (_, i) => makeCandidate(`角色${i}`)),
  ]
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
    // 结构化取徽标本身，而不是在整卡文本里找数字：名字/性格/灵魂名含数字会让断言假阳性。
    expect(stageBadgeOf("苏九")?.textContent).toBe("1")
    expect(stageBadgeOf("沈砚")?.textContent).toBe("2")
    // 未上台的卡片应当连序号徽标都不渲染。原来写的是 `not.toContain("1")`，
    // 而「林清越」这个名字与这张卡片上的任何文案都不含数字，断言恒真、没有鉴别力；
    // 序号徽标是卡片内唯一带 place-items-center 的 span（未上台只有空心圆占位）。
    expect(cardOf("林清越").querySelector("span.place-items-center")).toBeNull()
  })

  it("点一下上台、再点一下下台：选中态完全由父组件回传的 props 驱动", () => {
    // 用一个真的持有 selectedIds 的 harness 驱动 props 更新，才能钉住「往返」这件事；
    // 只断言回调被调用的话，与上一条「未上台时点击」走的是同一条代码路径。
    function Harness() {
      const [selected, setSelected] = useState<string[]>([])
      return (
        <ScenarioCharacterGrid
          candidates={CANDIDATES}
          selectedIds={selected}
          characterCount={3}
          moderatorId="__user__"
          onToggle={(id) =>
            setSelected((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            )
          }
          onSetModerator={vi.fn()}
          onBindSoul={vi.fn()}
        />
      )
    }
    act(() => {
      root.render(<Harness />)
    })

    expect(toggleOf("沈砚").getAttribute("aria-pressed")).toBe("false")
    click(toggleOf("沈砚"))
    expect(toggleOf("沈砚").getAttribute("aria-pressed")).toBe("true")
    expect(stageBadgeOf("沈砚")?.textContent).toBe("1")
    click(toggleOf("沈砚"))
    expect(toggleOf("沈砚").getAttribute("aria-pressed")).toBe("false")
    expect(stageBadgeOf("沈砚")).toBeNull()
  })

  it("哑组件纯度：父组件不更新 props，点击就不会自行改变选中态", () => {
    const { onToggle } = renderGrid()
    click(toggleOf("沈砚"))
    expect(onToggle).toHaveBeenCalledWith("沈砚")
    // 上报归上报，选中态得等父组件回传；组件自己不能记在内部 state 里。
    expect(toggleOf("沈砚").getAttribute("aria-pressed")).toBe("false")
    expect(toggleOf("沈砚").getAttribute("aria-describedby")).toBeNull()
    expect(stageBadgeOf("沈砚")).toBeNull()
    renderGrid()
    expect(toggleOf("沈砚").getAttribute("aria-pressed")).toBe("false")
  })

  it("aria-pressed 如实反映是否已上台", () => {
    renderGrid({ selectedIds: ["沈砚"] })
    expect(toggleOf("沈砚").getAttribute("aria-pressed")).toBe("true")
    expect(toggleOf("苏九").getAttribute("aria-pressed")).toBe("false")
  })

  it("满员时未上台的卡片被标记为不可选（回调照发，由父组件拒绝并提示）", () => {
    const { onToggle } = renderGrid({ selectedIds: ["沈砚", "林清越"], characterCount: 2 })
    const card = cardOf("苏九")
    // 不看具体 Tailwind 类名：把 opacity-60 改成 opacity-50 行为没变、测试不该红。
    expect(card.querySelector('[aria-disabled="true"]')).toBeTruthy()
    // 已上台的卡片不受满员影响，不该被标成不可选。
    expect(cardOf("沈砚").querySelector('[aria-disabled="true"]')).toBeNull()
    click(toggleOf("苏九"))
    expect(onToggle).toHaveBeenCalledWith("苏九")
  })

  it("未绑定灵魂时给的是可点的「绑定灵魂」入口，而不是一句死文案", () => {
    const { onBindSoul } = renderGrid()
    // 按卡片定位而不是取全页第一个「绑定灵魂」：沈砚与林清越都没绑灵魂，
    // 全局取第一个会把这条断言绑死在候选顺序上。
    const bind = soulButtonOf("沈砚")
    expect(bind.textContent).toContain("绑定灵魂")
    click(bind)
    expect(onBindSoul).toHaveBeenCalledWith(expect.objectContaining({ id: "沈砚" }))
  })

  it("已绑定灵魂时显示灵魂名，并可点开更换", () => {
    const { onBindSoul } = renderGrid()
    // 同样按卡片定位：全页第一个「游侠」是顺序耦合。
    const soul = soulButtonOf("苏九")
    expect(soul.textContent).toContain("灵魂")
    expect(soul.textContent).toContain("游侠")
    click(soul)
    expect(onBindSoul).toHaveBeenCalledWith(expect.objectContaining({ id: "苏九" }))
  })

  it("已上台且不是主持人时出现「设为主持人」", () => {
    const { onSetModerator } = renderGrid({ selectedIds: ["沈砚"] })
    const btn = host.querySelector('button[aria-label="把「沈砚」设为主持人"]')
    expect(btn).toBeTruthy()
    click(btn)
    expect(onSetModerator).toHaveBeenCalledWith("沈砚")
  })

  it("只有已上台的角色才有「设为主持人」", () => {
    renderGrid({ selectedIds: ["苏九"] })
    expect(host.querySelectorAll('button[aria-label*="设为主持人"]')).toHaveLength(1)
  })

  it("已是主持人时显示徽标，且不再显示「设为主持人」", () => {
    renderGrid({ selectedIds: ["沈砚"], moderatorId: "沈砚" })
    expect(cardOf("沈砚").textContent).toContain("主持人")
    expect(host.querySelector('button[aria-label*="设为主持人"]')).toBeNull()
  })

  it("两个入口的可访问名都带角色名，屏幕阅读器能分辨是给谁操作", () => {
    renderGrid({ selectedIds: ["沈砚", "苏九"] })
    // 开关按钮的可访问名形状是下游 Task 6 的定位锚点，必须保持不变。
    expect(toggleOf("沈砚").getAttribute("aria-label")).toBe("把 沈砚 加入或移出舞台")
    // 设为主持人：图标按钮没有可见文本，可访问名与 title 都靠 aria-label。
    const mod = host.querySelector('button[aria-label="把「沈砚」设为主持人"]')
    expect(mod?.getAttribute("title")).toBe("把「沈砚」设为主持人")
    // 灵魂入口：可见文案是短的「绑定灵魂」（卡上已有角色名，不重复），
    // 角色名落在可访问名与 title 上，屏幕阅读器才分得清是给谁绑。
    expect(soulButtonOf("林清越").textContent).toBe("绑定灵魂")
    expect(soulButtonOf("林清越").getAttribute("aria-label")).toBe("为「林清越」绑定灵魂")
    // 已绑灵魂那张卡显示的是灵魂名，角色名落在 title 上。
    expect(soulButtonOf("苏九").getAttribute("title")).toBe("更换或解绑「苏九」的灵魂")
  })

  it("已上台时把序号徽标接进 aria-describedby，未上台不接", () => {
    renderGrid({ selectedIds: ["苏九"] })
    const badge = stageBadgeOf("苏九")
    expect(badge?.textContent).toBe("1")
    // aria-label 会盖掉按钮子树文本，序号只能靠 description 被读到。
    expect(toggleOf("苏九").getAttribute("aria-describedby")).toBe(badge?.id)
    expect(toggleOf("苏九").getAttribute("aria-label")).toBe("把 苏九 加入或移出舞台")
    expect(toggleOf("沈砚").getAttribute("aria-describedby")).toBeNull()
  })

  it("主持人徽标也进 aria-describedby，身份不只靠视觉", () => {
    renderGrid({ selectedIds: ["沈砚"], moderatorId: "沈砚" })
    const ids = (toggleOf("沈砚").getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean)
    expect(ids).toHaveLength(2)
    const described = ids
      .map((id) => host.querySelector(`[id="${id}"]`)?.textContent ?? "")
      .join(" ")
    expect(described).toContain("1")
    expect(described).toContain("主持人")
  })

  it("候选少时不出现搜索框", () => {
    renderGrid()
    expect(host.querySelector('input[aria-label="搜索角色"]')).toBeNull()
  })

  it("候选正好等于默认阈值（12）时仍不出现搜索框", () => {
    renderGrid({ candidates: makeMany(12) })
    expect(host.querySelector('input[aria-label="搜索角色"]')).toBeNull()
  })

  it("候选比默认阈值多一个（13）时就出现搜索框", () => {
    renderGrid({ candidates: makeMany(13) })
    expect(host.querySelector('input[aria-label="搜索角色"]')).toBeTruthy()
  })

  it("searchThreshold 是公开 API：调大后候选再多也不出搜索框", () => {
    renderGrid({ candidates: makeMany(13), searchThreshold: 20 })
    expect(host.querySelector('input[aria-label="搜索角色"]')).toBeNull()
  })

  it("候选超过阈值时出现搜索框，且能按名字过滤", async () => {
    renderGrid({ candidates: makeMany(15) })
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

  it("按灵魂名也能搜到角色", async () => {
    renderGrid({ candidates: makeMany(14, [CANDIDATES[2]]) })
    typeSearch("游侠")
    await flush()
    expect(host.textContent).toContain("苏九")
    expect(host.textContent).not.toContain("角色0")
  })

  it("过滤后一个都不匹配时给出空态，而不是一片空白", async () => {
    renderGrid({ candidates: makeMany(15) })
    typeSearch("查无此人")
    await flush()
    expect(host.textContent).toContain("没有匹配")
  })

  it("候选变少到不再显示搜索框时，残留的关键词会被清掉", async () => {
    const many = makeMany(15)
    renderGrid({ candidates: many })
    typeSearch("查无此人")
    await flush()
    expect(host.textContent).toContain("没有匹配")

    // 阈值以内 → 搜索框消失。此时若不把 query 清掉，界面只剩「没有匹配…」，
    // 而用户已经没有任何控件能把它清掉。
    renderGrid({ candidates: many.slice(0, 3) })
    await flush()
    expect(host.querySelector('input[aria-label="搜索角色"]')).toBeNull()
    expect(host.textContent).not.toContain("没有匹配")
    expect(host.textContent).toContain("角色0")
  })

  it("候选在点选前就能看到名字、灵魂、性格与说话风格", () => {
    const candidates = [
      makeCandidate("沈砚", {
        personality: ["谨慎", "寡言"],
        speakingStyle: "冷硬短句，很少解释",
        auraId: "a1",
        auraName: "游侠",
      }),
    ]
    renderGrid({ candidates, selectedIds: [] })
    expect(toggleOf("沈砚").getAttribute("aria-pressed")).toBe("false")
    const card = cardOf("沈砚")
    expect(card.textContent).toContain("沈砚")
    expect(card.textContent).toContain("游侠")
    expect(card.textContent).toContain("谨慎")
    expect(card.textContent).toContain("说话风格：冷硬短句，很少解释")
  })

  it("没有说话风格时不渲染那一行", () => {
    renderGrid()
    expect(host.textContent).not.toContain("说话风格")
  })

  it("性格词最多只渲染前 3 个", () => {
    renderGrid({
      candidates: [makeCandidate("沈砚", { personality: ["谨慎", "寡言", "多疑", "固执"] })],
    })
    const card = cardOf("沈砚")
    expect(card.textContent).toContain("谨慎")
    expect(card.textContent).toContain("多疑")
    expect(card.textContent).not.toContain("固执")
  })

  it("selectedIds 里混进不在候选中的陈旧 id 时不崩，也不把别的卡标成上台", () => {
    renderGrid({ selectedIds: ["已被删掉的角色", "沈砚"] })
    expect(toggleOf("沈砚").getAttribute("aria-pressed")).toBe("true")
    // 序号取自 selectedIds 里的位置，陈旧 id 会让序号断档（从 2 开始）；
    // 这是既有且安全的行为，用测试钉住，避免以后顺手「修」成崩。
    expect(stageBadgeOf("沈砚")?.textContent).toBe("2")
    expect(toggleOf("苏九").getAttribute("aria-pressed")).toBe("false")
    expect(stageBadgeOf("苏九")).toBeNull()
  })

  it("候选为空时不渲染任何东西", () => {
    renderGrid({ candidates: [] })
    expect(host.textContent?.trim()).toBe("")
  })
})
