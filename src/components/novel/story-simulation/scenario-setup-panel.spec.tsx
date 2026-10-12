// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"

import { ScenarioSetupPanel } from "./scenario-setup-panel"
import {
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
) {
  act(() => {
    root.render(
      <ScenarioSetupPanel
        candidates={candidates}
        extracting={false}
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

/** React 受控组件：必须走原型上的 setter，否则 value tracker 会吞掉事件。 */
function setNativeValue(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
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
function selectCard(name: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="storySimulation.scenarioToggleCharacter(name=${name})"]`,
  )
  if (!button) throw new Error(`找不到角色卡：${name}`)
  act(() => {
    button.click()
  })
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

/** 修改「角色数量」数字框。 */
function setCharacterCount(value: string) {
  const input = container.querySelector(
    'input[aria-label="storySimulation.scenarioCharacterCount"]',
  ) as HTMLInputElement
  act(() => {
    setNativeValue(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
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
    // 必须走 focus() + blur()：React 17 起 onBlur 是委托在原生 focusout 上的，
    // 手工派发一个 blur 事件根本到不了组件里。
    act(() => {
      const input = container.querySelector(
        'input[aria-label="storySimulation.scenarioCharacterCount"]',
      ) as HTMLInputElement
      input.focus()
      input.blur()
    })

    expect(container.textContent).toContain(
      `storySimulation.scenarioCharacterCountClamped(min=3,max=10)`,
    )
  })

  it("选满后再点候选不会多出人来，并给出原因", () => {
    render(MANY)
    selectThreeCharacters()

    selectCard("角色4")

    expect(selectionCount()).toContain("total=3")
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
