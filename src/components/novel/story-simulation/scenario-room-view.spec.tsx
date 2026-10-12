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

function render(s: ScenarioSession) {
  act(() => {
    root.render(
      <ScenarioRoomView
        session={s}
        running={false}
        streaming={null}
        progress={null}
        input=""
        onInputChange={() => {}}
        onSend={() => {}}
        onExport={() => {}}
        onCancel={() => {}}
        onBack={() => {}}
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
