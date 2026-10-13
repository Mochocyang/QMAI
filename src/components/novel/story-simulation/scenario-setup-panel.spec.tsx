// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"

import { ScenarioSetupPanel } from "./scenario-setup-panel"
import {
  SCENARIO_CHARACTER_MAX,
  SCENARIO_MODERATOR_INTERVAL_DEFAULT,
  SCENARIO_MODERATOR_USER_ID,
  SCENARIO_MODERATOR_USER_NAME,
  SCENARIO_ROUND_MAX,
  estimateScenarioMessages,
  type ScenarioCandidate,
  type ScenarioSession,
  type ScenarioSetup,
} from "@/lib/novel/story-simulation/scenario-types"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 这个 mock 必须支持插值：面板把关键数字（预估条数、上限值）都通过
 * `t(key, { count })` 传出去，`t: (key) => key` 那种写法会让这些数字
 * 根本不出现在 DOM 里，断言就变成了对着空气断言。
 */
vi.mock("react-i18next", () => ({
  // 面板经由 scenario-engine → llm-client 间接拉起了 i18n 初始化，
  // 它需要这个导出才能 .use()，缺了会直接让整个测试文件收集失败。
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts
        ? `${key}(${Object.entries(opts)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(",")})`
        : key,
  }),
}))

function candidate(n: number): ScenarioCandidate {
  return {
    id: `c${n}`,
    name: `角色${n}`,
    profile: `角色${n}的档案`,
    auraId: null,
    auraName: null,
    speakingStyle: "简短",
    personality: ["沉稳"],
    knowledgeScope: [],
    doesNotKnow: [],
  }
}

const CANDIDATES = [
  candidate(1),
  candidate(2),
  candidate(3),
  candidate(4),
  candidate(5),
]

let container: HTMLDivElement
let root: Root
let onStart: Mock<(setup: ScenarioSetup) => void>
let onSoulChanged: Mock<() => void>

function render(
  candidates: ScenarioCandidate[] = CANDIDATES,
  savedScenarios: ScenarioSession[] = [],
  extracting = false,
) {
  act(() => {
    root.render(
      <ScenarioSetupPanel
        candidates={candidates}
        extracting={extracting}
        progress={null}
        sourceChapters={10}
        onSourceChaptersChange={() => {}}
        onReExtract={() => {}}
        projectPath="/proj"
        onSoulChanged={onSoulChanged}
        savedScenarios={savedScenarios}
        onStart={onStart}
        onOpenSaved={() => {}}
        onDeleteSaved={() => {}}
        onCancel={() => {}}
      />,
    )
  })
}

/** 构造一条历史情景。 */
function savedSession(
  over: Partial<ScenarioSession> = {},
): ScenarioSession {
  return {
    id: "s1",
    title: "论中庸",
    setup: {
      id: "s1",
      title: "论中庸",
      rules: { directive: "辩一辩" },
      format: "debate",
      rounds: 30,
      participants: [
        {
          id: SCENARIO_MODERATOR_USER_ID,
          name: SCENARIO_MODERATOR_USER_NAME,
          isModerator: true,
        },
      ],
      sourceChapters: 4,
      createdAt: "2026-10-11T00:00:00.000Z",
    },
    messages: [],
    status: "completed",
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    ...over,
  }
}

/**
 * React 受控组件：必须走原型上的 setter，否则 value tracker 会吞掉事件。
 * input / textarea / select 的 value 描述符分别挂在各自的原型上，认错原型
 * 一样会被吞掉 —— 所以这里三种都要认。
 */
function setNativeValue(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
  setter?.call(el, value)
}

/**
 * 点候选角色卡：未上台则上台，已上台则下台。
 *
 * 用 aria-label 定位而不是按顺序取第 N 个按钮 —— 网格里还有「设为主持人」
 * 与「绑定灵魂」两类按钮，按顺序取会在候选人一变多时就错位。
 */
function cardButton(name: string): HTMLButtonElement | undefined {
  return (
    container.querySelector<HTMLButtonElement>(
      `button[aria-label="storySimulation.scenarioToggleCharacter(name=${name})"]`,
    ) ?? undefined
  )
}

function selectCard(name: string) {
  const button = cardButton(name)
  if (!button) throw new Error(`找不到角色卡：${name}`)
  act(() => {
    button.click()
  })
}

/** 卡片是否在台上：网格把 aria-pressed 挂在 toggle 按钮上。 */
function cardPressed(name: string): string | null {
  return cardButton(name)?.getAttribute("aria-pressed") ?? null
}

/**
 * 卡片上的上台序号（1..N）。
 *
 * 序号渲染在 toggle 按钮里的那个胶囊上，没上台时是个空圈 —— 所以空字符串
 * 就是「这个人已经下台」。用序号而不是「在不在台上」来断言，才能证明
 * 裁切保留的是「前 N 个」而不是随便留下的 N 个。
 */
function stageOrder(name: string): string | undefined {
  return cardButton(name)?.querySelector("span")?.textContent?.trim()
}

/** 卡片上的「设为主持人」入口（上台且尚未担任主持人时才渲染）。 */
function setModeratorFromCard(name: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="storySimulation.scenarioSetModerator(name=${name})"]`,
  )
  if (!button) throw new Error(`找不到「设为主持人」按钮：${name}`)
  act(() => {
    button.click()
  })
}

/** 面板上的主持人下拉框（与「提取章节数」那个 select 区分开）。 */
function moderatorSelect(): HTMLSelectElement {
  const el = Array.from(container.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === SCENARIO_MODERATOR_USER_ID),
  )
  if (!el) throw new Error("找不到主持人下拉框")
  return el as HTMLSelectElement
}

/** 修改轮数输入框（页面上还有一个「角色数量」数字框，必须按 aria-label 认准）。 */
function setRounds(value: string) {
  const input = container.querySelector(
    'input[aria-label="storySimulation.scenarioRounds"]',
  ) as HTMLInputElement
  act(() => {
    setNativeValue(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

/** 「角色数量」数字框。 */
function characterCountInput(): HTMLInputElement {
  return container.querySelector(
    'input[aria-label="storySimulation.scenarioCharacterCount"]',
  ) as HTMLInputElement
}

/** 修改「角色数量」数字框（只发 input，不涉及失焦）。 */
function setCharacterCount(value: string) {
  const input = characterCountInput()
  act(() => {
    setNativeValue(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

/**
 * 让「角色数量」输入框失焦（夹取发生在失焦时）。
 *
 * 必须走 focus() + blur()：React 17 起 onBlur 是委托在原生 focusout 上的，
 * 手工派发一个 blur 事件根本到不了组件里。
 */
function blurCharacterCount() {
  act(() => {
    const input = characterCountInput()
    input.focus()
    input.blur()
  })
}

/** 填写「情景规则」（开始按钮要求它非空）。 */
function setDirective(value: string) {
  const textarea = container.querySelector(
    'textarea[aria-label="storySimulation.scenarioRules"]',
  ) as HTMLTextAreaElement
  act(() => {
    setNativeValue(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

/** 成本护栏的勾选框（页面上唯一的 checkbox）。 */
function costCheckbox(): HTMLInputElement | undefined {
  return Array.from(container.querySelectorAll("input[type=checkbox]")).find(
    (el) => (el as HTMLInputElement).type === "checkbox",
  ) as HTMLInputElement | undefined
}

function clickCheckbox(box: HTMLInputElement) {
  act(() => {
    box.click()
  })
}

/** 按可见文字找按钮。 */
function findButton(predicate: (text: string) => boolean) {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    predicate(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined
}

/** 角色数量按钮（3/4/5 人）——用单位文案与轮数预设按钮区分开。 */
function countButton(n: number): HTMLButtonElement | undefined {
  return findButton(
    (text) =>
      text.startsWith(`${n} `) && text.includes("scenarioCharacterCountUnit"),
  )
}

function startButton(): HTMLButtonElement | undefined {
  return findButton((text) => text.includes("scenarioStart"))
}

function clickButton(button: HTMLButtonElement) {
  act(() => {
    button.click()
  })
}

/** 所有会被屏幕阅读器即时播报的提示（role=alert）。 */
function alerts(): Element[] {
  return Array.from(container.querySelectorAll('[role="alert"]'))
}

/** 按文案片段找一句话提示（实现里提示都是 <p>）。 */
function noticeByText(fragment: string): Element | undefined {
  return Array.from(container.querySelectorAll("p")).find((el) =>
    el.textContent?.includes(fragment),
  )
}

/** 读取「已选 N / 共 M」的实时值。 */
function selectionCount(): string | undefined {
  return container.textContent?.match(
    /scenarioSelectedCount\([^)]*\)/,
  )?.[0]
}

/** 选满 3 名角色（默认角色数量就是 3），主持人默认由用户担任。 */
function selectThreeCharacters() {
  selectCard("角色1")
  selectCard("角色2")
  selectCard("角色3")
}

/** 与实现同一个估算函数，按「夹取之后」的轮数算出应有的预估条数。 */
function expectedMessages(selectedCount: number, rawRounds: number) {
  const participants = Array.from({ length: selectedCount }, (_, i) =>
    candidate(i + 1),
  ).map((c) => ({
    id: c.id,
    name: c.name,
    isModerator: false,
  }))
  return estimateScenarioMessages(
    participants,
    Math.min(rawRounds, SCENARIO_ROUND_MAX),
    SCENARIO_MODERATOR_INTERVAL_DEFAULT,
  )
}

describe("ScenarioSetupPanel · 轮数上限", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("输入超过上限的轮数时，成本预估按上限轮数计算", () => {
    render()
    selectThreeCharacters()
    setRounds("9999")

    const expected = expectedMessages(3, 9999)
    expect(expected).toBe(1 + 3 * SCENARIO_ROUND_MAX)

    // 界面上报出的数字必须是可以真的发生的那个
    expect(container.textContent).toContain(`count=${expected}`)
    // 未夹取的 29998 条是永远跑不出来的
    expect(container.textContent).not.toContain(`count=${1 + 3 * 9999}`)
  })

  it("输入超过上限的轮数时，明确告知会按上限执行", () => {
    render()
    selectThreeCharacters()
    setRounds("9999")

    expect(container.textContent).toContain(
      `storySimulation.scenarioRoundsClamped(max=${SCENARIO_ROUND_MAX})`,
    )
  })

  it("轮数在上限之内时不显示上限提示", () => {
    render()
    selectThreeCharacters()
    setRounds("50")

    expect(container.textContent).toContain(`count=${1 + 3 * 50}`)
    expect(container.textContent).not.toContain(
      "storySimulation.scenarioRoundsClamped",
    )
  })
})

describe("ScenarioSetupPanel · 成本确认", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("预估值一变，上一次的勾选就作废", () => {
    render()
    selectThreeCharacters()
    setRounds("50")

    const box = costCheckbox()
    expect(box).toBeDefined()
    clickCheckbox(box as HTMLInputElement)
    expect(costCheckbox()?.checked).toBe(true)

    // 改到另一个同样超阈值的规模：这是另一笔账，必须重新确认
    setRounds("60")

    expect(costCheckbox()).toBeDefined()
    expect(costCheckbox()?.checked).toBe(false)
  })

  it("把规模改小再改大，不能靠旧勾选蒙过去", () => {
    render()
    selectThreeCharacters()
    setRounds("50")

    clickCheckbox(costCheckbox() as HTMLInputElement)
    expect(costCheckbox()?.checked).toBe(true)

    // 降到阈值以下：确认框整个消失
    setRounds("10")
    expect(costCheckbox()).toBeUndefined()

    // 再改回大配置：确认框回来了，但不该是勾好的
    setRounds("50")
    expect(costCheckbox()).toBeDefined()
    expect(costCheckbox()?.checked).toBe(false)
  })
})

/**
 * 角色数量按钮是写死的 [3,4,5]，与真正提取到几个角色无关；而开始条件要求
 * 「已选人数 === 所选人数」。于是提取只找到 1~2 个角色时，用户永远凑不满，
 * 开始按钮灰着且不说原因（「没有候选角色」的提示只在 0 个角色时出现）。
 */
describe("ScenarioSetupPanel · 候选角色不足", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("候选不足 3 人时说明原因，而不是让开始按钮无解释地灰着", () => {
    render(CANDIDATES.slice(0, 2))
    selectCard("角色1")
    selectCard("角色2")

    expect(container.textContent).toContain(
      "storySimulation.scenarioCandidatesInsufficient(count=2,min=3)",
    )
    expect(startButton()?.disabled).toBe(true)
  })

  it("候选够用时不再显示不足提示", () => {
    render()
    expect(container.textContent).not.toContain(
      "storySimulation.scenarioCandidatesInsufficient",
    )
  })

  it("候选只有 3 人时，4 人与 5 人的数量按钮不可选", () => {
    render(CANDIDATES.slice(0, 3))

    expect(countButton(3)?.disabled).toBe(false)
    expect(countButton(4)?.disabled).toBe(true)
    expect(countButton(5)?.disabled).toBe(true)
  })

  it("候选变少后，已选人数被夹到候选数，而不是卡在凑不满的状态", () => {
    render()
    clickButton(countButton(5) as HTMLButtonElement)
    expect(selectionCount()).toContain("total=5")

    // 模拟「重新分析角色」后候选从 5 人变成 3 人
    render(CANDIDATES.slice(0, 3))

    expect(selectionCount()).toContain("total=3")
    expect(countButton(5)?.disabled).toBe(true)
  })
})

/**
 * 历史列表原本只说「N 条发言 · 时间」。作者真正要判断的是「这场值不值得
 * 再打开」—— 那就需要知道它是什么形式、计划多少轮、以及有没有被中途停掉。
 * 这些信息全都已经存在 Session 里（format / rounds / status），只是没显示。
 */
describe("ScenarioSetupPanel · 历史情景列表", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("每行显示对话形式与计划轮数", () => {
    render(CANDIDATES, [savedSession()])

    expect(container.textContent).toContain("辩论")
    expect(container.textContent).toContain("scenarioHistoryRounds(n=30)")
  })

  it("被中止的历史情景标出「已中止」", () => {
    render(CANDIDATES, [savedSession({ status: "cancelled" })])

    expect(container.textContent).toContain("scenarioStatusCancelled")
  })

  it("没被中止的历史情景不带中止标记", () => {
    render(CANDIDATES, [savedSession()])

    expect(container.textContent).not.toContain("scenarioStatusCancelled")
  })
})

/**
 * 「参考点」原来只是一句写进提示词的话，界面上没有任何地方说明它会不会被
 * 真正检索 —— 用户以为填了就会「以此为依据」。至少要说明它从项目资料里检索。
 */
describe("ScenarioSetupPanel · 参考点说明", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("说明参考点会从项目资料中检索、检索不到也能开演", () => {
    render()

    expect(container.textContent).toContain(
      "storySimulation.scenarioReferenceHint",
    )
  })
})

/** 10 名候选：用于验证自定义人数能真的超过 5。 */
const MANY = Array.from({ length: 10 }, (_, i) => candidate(i + 1))

describe("ScenarioSetupPanel · 自定义角色数量", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("保留 3/4/5 一键按钮", () => {
    render(MANY)
    expect(countButton(3)?.disabled).toBe(false)
    expect(countButton(4)?.disabled).toBe(false)
    expect(countButton(5)?.disabled).toBe(false)
  })

  it("自定义人数可以超过 5（上限 10）", () => {
    render(MANY)
    setCharacterCount("7")
    expect(selectionCount()).toContain("total=7")
  })

  it("自定义人数超界时夹到上限，并明确告知", () => {
    render(MANY)
    setCharacterCount("99")
    // 夹取发生在失焦时：setNativeValue 只发 input，不会自己失焦。
    blurCharacterCount()

    expect(container.textContent).toContain(
      `storySimulation.scenarioCharacterCountClamped(min=3,max=10)`,
    )
    // 只断言提示是不够的：提示照出、输入框却停在 99 也照样能过（实测如此）。
    // MANY 的 10 名候选正好等于上限，所以「不超过候选人数」那一步不会再改动它，
    // 失焦后输入框必须精确落在夹取后的值上。
    expect(MANY.length).toBe(SCENARIO_CHARACTER_MAX)
    expect(characterCountInput().value).toBe(String(SCENARIO_CHARACTER_MAX))
  })

  it("选满后再点候选不会多出人来，并给出原因", () => {
    render(MANY)
    selectThreeCharacters()

    selectCard("角色4")

    // 全等而不是子串：满员时照样加人的话会得到 `n=4,total=3`，它同样「包含
    // total=3」，子串断言对这种变异毫无反应（实测存活）。
    expect(selectionCount()).toBe("scenarioSelectedCount(n=3,total=3)")
    expect(container.textContent).toContain("storySimulation.scenarioFull(n=3)")
  })
})

/**
 * selectedIds 只增不减，而「候选变少」原来只夹了 characterCount。
 * 换人（重新分析 / 重新提取）后会出现「已选 5 / 共 3」这种自相矛盾的状态，
 * 而且空位明明还在却点不进去 —— 因为判断满员用的是那个虚高的已选人数。
 * 极端情况下 selectedIds 全是已消失的人时，canStart 的「两边长度相等」反而成立，
 * 会带着不存在的角色开演。这里守住「候选一变少，已消失的人就出局」。
 */
describe("ScenarioSetupPanel · 候选变少后裁掉已消失的角色", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("已选人数不会超过候选数，且新出现的角色仍点得进去", () => {
    render()
    clickButton(countButton(5) as HTMLButtonElement)
    selectCard("角色1")
    selectCard("角色2")
    selectCard("角色3")
    selectCard("角色4")
    selectCard("角色5")
    expect(selectionCount()).toContain("total=5")

    // 重新分析后只剩 3 人，且其中「角色6」是从没上过台的新角色
    render([candidate(1), candidate(2), candidate(6)])

    // 已消失的 3 人必须被裁掉：已选 2 / 共 3（人数也被夹到候选数）
    expect(selectionCount()).toContain("total=3")
    expect(selectionCount()).toContain("n=2")
    expect(selectionCount()).not.toContain("n=5")

    // 空位是真的空着，新角色必须点得进去
    selectCard("角色6")
    expect(selectionCount()).toContain("n=3")
    expect(container.textContent).not.toContain("storySimulation.scenarioFull")
  })
})

describe("ScenarioSetupPanel · 绑定灵魂入口", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ""
  })

  it("点候选卡上的「绑定灵魂」会打开绑定弹窗", async () => {
    render()

    // 每张未绑灵魂的卡片上都有这个入口，findButton 取文档顺序里的第一个 ——
    // 也就是第一张候选卡「角色1」；下面的标题断言正是钉住这一点。
    const bind = findButton((text) =>
      text.includes("storySimulation.scenarioBindSoul"),
    )
    expect(bind).toBeDefined()
    // 弹窗打开时会异步去读灵魂名单，用 await act 收尾，免得留下 act 警告
    await act(async () => {
      ;(bind as HTMLButtonElement).click()
    })

    // 弹窗走 Portal 渲染到 body，所以查 document.body
    expect(
      document.body.querySelector('[data-testid="scenario-soul-bind-dialog"]'),
    ).not.toBeNull()
    expect(document.body.textContent).toContain(
      "storySimulation.scenarioSoulDialogTitle(name=角色1)",
    )
  })
})

/**
 * 「网格选人 + 自定义人数」之后才第一次可达的一条路径：先把人数选到 5 并选满，
 * 再把人数改小。裁切原本只在「候选集合变化」时跑，改小人数不会让已经上台的人
 * 下台，于是「已选 5 / 共 3」永远凑不满，开始按钮再无解释地灰着，点掉一个变
 * 「已选 4 / 共 3」，而 toggleCharacter 还在说「已选满 3 个角色」。
 *
 * 用户已裁决：多出来的人自动下台（保留前 N 个，上台序号不动）。
 */
describe("ScenarioSetupPanel · 改小人数时收敛上台角色", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  /** 选满 5 人（点击顺序就是上台顺序）。 */
  function selectFiveCharacters() {
    for (const n of [1, 2, 3, 4, 5]) selectCard(`角色${n}`)
  }

  it("改小人数后多出来的人下台，开始按钮不再永久灰着", () => {
    render(MANY)
    setDirective("辩一辩")
    // 把轮数压到成本阈值以下：这条用例盯的是人数收敛，不能被成本护栏挡住
    setRounds("5")

    clickButton(countButton(5) as HTMLButtonElement)
    selectFiveCharacters()
    expect(selectionCount()).toBe("scenarioSelectedCount(n=5,total=5)")
    expect(startButton()?.disabled).toBe(false)

    clickButton(countButton(3) as HTMLButtonElement)

    expect(selectionCount()).toBe("scenarioSelectedCount(n=3,total=3)")
    expect(startButton()?.disabled).toBe(false)
  })

  it("保留的是前 N 个：上台序号 1/2/3 不动，末尾两人下台", () => {
    render(MANY)
    clickButton(countButton(5) as HTMLButtonElement)
    selectFiveCharacters()
    expect(stageOrder("角色1")).toBe("1")
    expect(stageOrder("角色5")).toBe("5")

    clickButton(countButton(3) as HTMLButtonElement)

    // 保留前 N 个意味着序号一格格都不动，用户看到的只是排在末尾的人下台
    expect(stageOrder("角色1")).toBe("1")
    expect(stageOrder("角色2")).toBe("2")
    expect(stageOrder("角色3")).toBe("3")
    expect(cardPressed("角色4")).toBe("false")
    expect(cardPressed("角色5")).toBe("false")
  })

  it("在输入框里改小人数并失焦，多出来的人同样下台", () => {
    render(MANY)
    setDirective("辩一辩")
    setRounds("5")
    clickButton(countButton(5) as HTMLButtonElement)
    selectFiveCharacters()

    setCharacterCount("3")
    // 输入框里现在正好是 3，与夹取后的值相同，所以「要不要提示被夹取」是不提示；
    // 但裁切本身绝不能因为「值没变」就被跳过（原来的提前 return 正是这么漏掉的）
    blurCharacterCount()

    expect(selectionCount()).toBe("scenarioSelectedCount(n=3,total=3)")
    expect(container.textContent).not.toContain("scenarioCharacterCountClamped")
    expect(startButton()?.disabled).toBe(false)
  })

  it("主持人正好被裁掉时，退回「由你主持」", () => {
    render(MANY)
    clickButton(countButton(5) as HTMLButtonElement)
    selectFiveCharacters()
    setModeratorFromCard("角色5")
    expect(moderatorSelect().value).toBe("c5")

    clickButton(countButton(3) as HTMLButtonElement)

    // 主持人本人已经下台，不能再继续主持
    expect(moderatorSelect().value).toBe(SCENARIO_MODERATOR_USER_ID)
  })
})

/**
 * 人数下限只在失焦时才夹，按键期间 2 / 0 都能进 state，而 canStart 原本只查
 * 「已选人数 === 所选人数」：填 2 再选 2 个人，开始按钮就是亮的；填 0 且一个
 * 都不选时 `0 === 0` 同样成立 —— 会带着低于下限、甚至空 participants 的配置
 * 进引擎。下限只能靠 canStart 挡（按键期间不能夹，否则「想输 10、先经过 1」
 * 会被当场夹成 3）。
 */
describe("ScenarioSetupPanel · 人数下限守卫", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("人数低于下限时开始按钮灰着，即使恰好把人都选上", () => {
    render(MANY)
    setDirective("辩一辩")
    // 轮数压到阈值以下，免得护栏替下限背锅
    setRounds("5")

    setCharacterCount("2")

    // 按键期间允许暂时越界：下限夹取要到失焦才做，否则想输 10 的人先经过 1
    // 就会被打成 3
    expect(characterCountInput().value).toBe("2")

    selectCard("角色1")
    selectCard("角色2")

    expect(selectionCount()).toBe("scenarioSelectedCount(n=2,total=2)")
    expect(startButton()?.disabled).toBe(true)
  })

  it("人数填 0 且一个都没选时也不会开演（那会带着空 participants 进引擎）", () => {
    render(MANY)
    setDirective("辩一辩")
    setRounds("5")

    setCharacterCount("0")

    expect(selectionCount()).toBe("scenarioSelectedCount(n=0,total=0)")
    expect(startButton()?.disabled).toBe(true)
  })
})

/**
 * 提示原本是「存下来的字符串」，一句话存下来就永远在场：人数改了、重新提取
 * 往返一趟、甚至另一类提示已经出现，它都还挂在屏幕上。这里守住「提示只为
 * 当前人数、当前这一轮提取负责」，并守住两类提示不可能同时在场。
 */
describe("ScenarioSetupPanel · 提示的时效性", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("改大人数后，旧的满员提示不再挂在屏幕上", () => {
    render(MANY)
    selectThreeCharacters()
    selectCard("角色4")
    expect(container.textContent).toContain("storySimulation.scenarioFull(n=3)")

    clickButton(countButton(4) as HTMLButtonElement)

    expect(selectionCount()).toBe("scenarioSelectedCount(n=3,total=4)")
    // 已经不满员了，「已选满 3 个角色」也就不能再留着
    expect(container.textContent).not.toContain("storySimulation.scenarioFull")
  })

  it("满员提示与夹取提示不会同时在场", () => {
    render(MANY)
    selectThreeCharacters()
    selectCard("角色4")
    expect(container.textContent).toContain("storySimulation.scenarioFull(n=3)")

    setCharacterCount("99")
    blurCharacterCount()

    expect(container.textContent).toContain(
      "storySimulation.scenarioCharacterCountClamped(min=3,max=10)",
    )
    // 「已选满 3 个角色」讲的是 3 人，而人数已经被夹到 10：两句同时在屏幕上
    // 就是自相矛盾
    expect(container.textContent).not.toContain("storySimulation.scenarioFull")
    expect(alerts()).toHaveLength(1)
  })

  it("重新提取往返一趟后，上一轮的提示不复活", () => {
    render(MANY)
    selectThreeCharacters()
    selectCard("角色4")
    expect(container.textContent).toContain("storySimulation.scenarioFull(n=3)")

    // 提取中：整个面板换成进度分支，但组件没有卸载，state 原样保留
    render(MANY, [], true)
    // 提取结束，候选还是这 10 个人，人数一个字没变
    render(MANY)

    expect(container.textContent).not.toContain("storySimulation.scenarioFull")
  })
})

/**
 * 三处提示都是「异步出现」的：屏幕上突然多出一行字，屏幕阅读器默认不会主动
 * 播报（审查实测 live region: 0）—— 对看不见屏幕的用户，这些提示等于不存在。
 * 照 scenario-soul-bind-dialog.tsx 的做法挂 role="alert"。
 */
describe("ScenarioSetupPanel · 提示的可访问性", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<(setup: ScenarioSetup) => void>()
    onSoulChanged = vi.fn<() => void>()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("夹取提示与满员提示都挂 role=alert", () => {
    render(MANY)
    setCharacterCount("99")
    blurCharacterCount()

    expect(
      noticeByText("storySimulation.scenarioCharacterCountClamped")?.getAttribute(
        "role",
      ),
    ).toBe("alert")

    // 另一条路径：满员提示（改回 3 人，再选满后点第 4 张卡）
    clickButton(countButton(3) as HTMLButtonElement)
    selectThreeCharacters()
    selectCard("角色4")

    expect(
      noticeByText("storySimulation.scenarioFull")?.getAttribute("role"),
    ).toBe("alert")
  })

  it("候选不足的提示也挂 role=alert", () => {
    render(CANDIDATES.slice(0, 2))

    expect(
      noticeByText(
        "storySimulation.scenarioCandidatesInsufficient",
      )?.getAttribute("role"),
    ).toBe("alert")
  })
})
