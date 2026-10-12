// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ScenarioRoomView } from "./scenario-room-view"
import {
  SCENARIO_MODERATOR_USER_ID,
  SCENARIO_MODERATOR_USER_NAME,
  type ScenarioMessage,
  type ScenarioSession,
  type ScenarioSetup,
} from "@/lib/novel/story-simulation/scenario-types"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("react-i18next", () => ({
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

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFileAtomic: vi.fn(async () => {}),
}))

const setup: ScenarioSetup = {
  id: "s1",
  title: "论中庸",
  rules: { directive: "辩一辩" },
  format: "debate",
  rounds: 10,
  participants: [
    {
      id: SCENARIO_MODERATOR_USER_ID,
      name: SCENARIO_MODERATOR_USER_NAME,
      isModerator: true,
    },
    { id: "甲", name: "甲", isModerator: false },
  ],
  sourceChapters: 4,
  createdAt: "2026-10-11T00:00:00.000Z",
}

function msg(over: Partial<ScenarioMessage>): ScenarioMessage {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "character",
    speakerId: "甲",
    speakerName: "甲",
    round: 1,
    content: "天命之谓性。",
    timestamp: "2026-10-11T00:00:00.000Z",
    ...over,
  }
}

function session(
  messages: ScenarioMessage[],
  status: ScenarioSession["status"] = "completed",
): ScenarioSession {
  return {
    id: "s1",
    title: "论中庸",
    setup,
    messages,
    status,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
  }
}

let container: HTMLDivElement
let root: Root
let onContinue: ReturnType<typeof vi.fn<() => void>>

function render(
  s: ScenarioSession,
  over: {
    remainingRounds?: number
    running?: boolean
    referenceInfo?: { count: number; truncated: boolean } | null
  } = {},
) {
  act(() => {
    root.render(
      <ScenarioRoomView
        session={s}
        running={over.running ?? false}
        streaming={null}
        progress={null}
        input=""
        onInputChange={() => {}}
        onSend={() => {}}
        onExport={() => {}}
        onCancel={() => {}}
        onBack={() => {}}
        onContinue={onContinue}
        remainingRounds={over.remainingRounds ?? 0}
        referenceInfo={over.referenceInfo ?? null}
      />,
    )
  })
}

function findButton(predicate: (text: string) => boolean) {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    predicate(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined
}

function clickButton(button: HTMLButtonElement) {
  act(() => {
    button.click()
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  onContinue = vi.fn<() => void>()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("ScenarioRoomView · 推理文本", () => {
  it("有 reasoning 的发言提供「思考」开关，展开后可见原文", () => {
    render(session([msg({ reasoning: "先立论再举例" })]))

    const toggle = findButton((text) =>
      text.includes("storySimulation.scenarioReasoning"),
    )
    expect(toggle).toBeDefined()
    // 默认收起，不占版面
    expect(container.textContent).not.toContain("先立论再举例")

    clickButton(toggle as HTMLButtonElement)
    expect(container.textContent).toContain("先立论再举例")
  })

  it("没有 reasoning 的发言不渲染思考开关", () => {
    render(session([msg({})]))

    expect(
      findButton((text) =>
        text.includes("storySimulation.scenarioReasoning"),
      ),
    ).toBeUndefined()
  })
})

describe("ScenarioRoomView · 会话状态", () => {
  it("被中止的会话明确标出「已中止」", () => {
    render(session([msg({})], "cancelled"))

    expect(container.textContent).toContain(
      "storySimulation.scenarioStatusCancelled",
    )
  })

  it("正常跑完的会话不显示中止标记", () => {
    render(session([msg({})], "completed"))

    expect(container.textContent).not.toContain(
      "storySimulation.scenarioStatusCancelled",
    )
  })
})

/**
 * 「停止」原本等于毁掉剩余计划：50 轮跑到第 12 轮中止，想跑完只能手动插话
 * 38 次，而每条插话固定只跑 1 轮。有剩余轮数时可一键接着跑。
 */
describe("ScenarioRoomView · 继续生成剩余轮数", () => {
  it("有剩余轮数时提供「继续生成」，并报出还剩几轮", () => {
    render(session([msg({ round: 12 })], "cancelled"), { remainingRounds: 38 })

    const button = findButton((text) =>
      text.includes("storySimulation.scenarioContinue"),
    )
    expect(button).toBeDefined()
    expect(button?.disabled).toBe(false)
    expect(container.textContent).toContain(
      "scenarioContinue(n=38)",
    )
  })

  it("点击后触发 onContinue", () => {
    render(session([msg({ round: 12 })], "cancelled"), { remainingRounds: 38 })

    clickButton(
      findButton((text) =>
        text.includes("storySimulation.scenarioContinue"),
      ) as HTMLButtonElement,
    )
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it("没有剩余轮数时不显示「继续生成」，避免点出一个空跑", () => {
    render(session([msg({ round: 50 })], "completed"), { remainingRounds: 0 })

    expect(
      findButton((text) =>
        text.includes("storySimulation.scenarioContinue"),
      ),
    ).toBeUndefined()
  })

  it("正在生成时不能用「继续生成」重复触发", () => {
    render(session([msg({ round: 12 })], "cancelled"), {
      remainingRounds: 38,
      running: true,
    })

    expect(
      findButton((text) =>
        text.includes("storySimulation.scenarioContinue"),
      ),
    ).toBeUndefined()
  })
})

/**
 * 「参考点」写着「必须以此为依据」，但检索落空时界面与成功时一模一样，
 * 作者只会以为模型不听话。所以要如实报出依据了几篇资料。
 */
describe("ScenarioRoomView · 参考资料", () => {
  /** 填了参考点的会话 —— 与顶层 setup（未填）区分开。 */
  function withReference(s: ScenarioSession): ScenarioSession {
    return {
      ...s,
      setup: { ...s.setup, rules: { ...s.setup.rules, reference: "《中庸》" } },
    }
  }

  it("注入了资料时报出篇数", () => {
    render(withReference(session([msg({})])), {
      referenceInfo: { count: 3, truncated: false },
    })

    expect(container.textContent).toContain(
      "scenarioReferenceInjected(count=3)",
    )
  })

  it("资料被截断时如实说明，不假装完整", () => {
    render(withReference(session([msg({})])), {
      referenceInfo: { count: 3, truncated: true },
    })

    expect(container.textContent).toContain("scenarioReferenceTruncated")
  })

  it("填了参考点却一篇都没检索到时明说，而不是装作一切正常", () => {
    render(withReference(session([msg({})])), { referenceInfo: null })

    expect(container.textContent).toContain("scenarioReferenceMissing")
    expect(container.textContent).not.toContain("scenarioReferenceInjected")
  })

  it("没填参考点时不显示任何资料标记", () => {
    render(session([msg({})]), { referenceInfo: null })

    expect(container.textContent).not.toContain("scenarioReferenceInjected")
    expect(container.textContent).not.toContain("scenarioReferenceMissing")
    expect(container.textContent).not.toContain("scenarioReferenceTruncated")
  })
})
