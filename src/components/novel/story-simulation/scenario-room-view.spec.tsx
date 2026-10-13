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
  type ScenarioStreamingState,
} from "@/lib/novel/story-simulation/scenario-types"
import { SCENARIO_SPEAKER_TONES } from "@/lib/novel/story-simulation/scenario-avatar"

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
    streaming?: ScenarioStreamingState | null
    referenceInfo?: { count: number; truncated: boolean } | null
  } = {},
) {
  act(() => {
    root.render(
      <ScenarioRoomView
        session={s}
        running={over.running ?? false}
        streaming={over.streaming ?? null}
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

/**
 * 按身份（speakerId）定位成员标签 / 头像。
 *
 * 刻意不用 `[data-speaker-id="..."]` 这种属性选择器：当前系统里角色 id 恰好
 * 等于角色名（见 scenario-participant-selector 的 assembleParticipants：
 * candidate.id 直接来自 story-extractor 的 character.id === name），名字里
 * 一旦带上双引号或反斜杠，属性选择器就会失配甚至直接抛错。逐个比对 dataset
 * 的值对任何名字都安全。
 */
function findBySpeakerId(testId: string, speakerId: string): HTMLElement | null {
  for (const el of container.querySelectorAll(`[data-testid="${testId}"]`)) {
    if ((el as HTMLElement).dataset.speakerId === speakerId) {
      return el as HTMLElement
    }
  }
  return null
}

function memberChip(speakerId: string): HTMLElement | null {
  return findBySpeakerId("scenario-member", speakerId)
}

function avatarOf(speakerId: string): HTMLElement | null {
  return findBySpeakerId("scenario-avatar", speakerId)
}

/**
 * 气泡里的头像。
 *
 * 不能直接用 avatarOf：成员条渲染在对话流之前，同一个 speakerId 会先命中
 * 成员条上的那个头像。所以范围限定在气泡内，再逐个比对 dataset.speakerId
 * （理由同 findBySpeakerId：不用属性选择器，任何名字都安全）。
 */
function bubbleAvatarOf(speakerId: string): HTMLElement | null {
  for (const el of container.querySelectorAll(
    '[data-testid="scenario-bubble"] [data-testid="scenario-avatar"]',
  )) {
    if ((el as HTMLElement).dataset.speakerId === speakerId) {
      return el as HTMLElement
    }
  }
  return null
}

function streamingState(
  over: Partial<ScenarioStreamingState> = {},
): ScenarioStreamingState {
  return {
    kind: "character",
    speakerId: "甲",
    speakerName: "甲",
    content: "",
    ...over,
  }
}

/**
 * 「群组式」原本只体现在气泡左右分栏上：谁是角色、谁在场、轮到谁说话，
 * 全靠读气泡里的名字。生成中尤其难受 —— 只有一个转圈，看不出在等谁。
 */
describe("ScenarioRoomView · 群聊在场感", () => {
  it("成员条列出全部在场角色，并带上首字头像", () => {
    render(session([msg({})]))

    const bar = container.querySelector('[data-testid="scenario-member-bar"]')
    expect(bar).not.toBeNull()
    // 角色甲 + 用户主持人占位
    expect(memberChip("甲")).not.toBeNull()
    expect(memberChip(SCENARIO_MODERATOR_USER_ID)).not.toBeNull()
    expect(avatarOf("甲")?.textContent).toBe("甲")
    expect(avatarOf(SCENARIO_MODERATOR_USER_ID)?.textContent).toBe("主")
  })

  it("主持人用固定的主色，不参与角色配色（不然串场就认不出来了）", () => {
    render(session([msg({})]))

    expect(avatarOf(SCENARIO_MODERATOR_USER_ID)?.className).toContain(
      "bg-primary/15",
    )
    expect(avatarOf("甲")?.className).not.toContain("bg-primary/15")
  })

  it("主持人的历史气泡也用固定主色，而不是被当成普通角色散列配色", () => {
    // 上面那条只看成员条（走 p.isModerator 这条独立分支），气泡里的
    // scenarioSpeakerTone(message.speakerId, isModerator) 完全没人守：
    // 把 isModerator 传成 false，22 条全绿也不响一声。
    render(
      session([
        msg({
          kind: "moderator",
          speakerId: SCENARIO_MODERATOR_USER_ID,
          speakerName: SCENARIO_MODERATOR_USER_NAME,
        }),
      ]),
    )

    const avatar = bubbleAvatarOf(SCENARIO_MODERATOR_USER_ID)
    expect(avatar).not.toBeNull()
    expect(avatar?.className).toContain("bg-primary/15")
    // 主持人不能落进角色色板，否则「这句是串场」就认不出来了
    for (const tone of SCENARIO_SPEAKER_TONES) {
      expect(avatar?.className).not.toContain(tone.avatarClass)
    }
  })

  it("同一角色在成员条与气泡里的头像配色一致", () => {
    render(session([msg({ content: "天命之谓性。" })]))

    const chipAvatar = memberChip("甲")?.querySelector(
      '[data-testid="scenario-avatar"]',
    )
    // 这里原来写的是内联的 `[data-speaker-id="甲"]`：当前系统里角色 id 恰好
    // 等于角色名（story-extractor 的 character.id 直接来自 name），所以今天
    // 能过；名字里一旦带双引号或反斜杠，属性选择器就会失配甚至抛错。
    // 换成遍历比较只是测试侧的健壮性，断言不变，产品行为也没有任何改变。
    const bubbleAvatar = bubbleAvatarOf("甲")
    expect(bubbleAvatar).not.toBeNull()
    // 两处的尺寸类名不同（成员条 h-4、气泡 h-7），只比底色
    const bgOf = (el: Element | null | undefined) =>
      (el?.className ?? "")
        .split(/\s+/)
        .filter((c) => c.startsWith("bg-"))
        .sort()
    expect(bgOf(bubbleAvatar).length).toBeGreaterThan(0)
    expect(bgOf(bubbleAvatar)).toEqual(bgOf(chipAvatar))
  })

  it("角色气泡带自己的首字头像", () => {
    render(session([msg({})]))

    expect(
      container.querySelector(
        '[data-testid="scenario-bubble"] [data-testid="scenario-avatar"]',
      ),
    ).not.toBeNull()
  })

  it("用户自己发的气泡不带角色头像（右对齐，加了反而像别人发言）", () => {
    render(session([msg({ kind: "user", speakerId: "user", speakerName: "我" })]))

    const bubble = container.querySelector('[data-testid="scenario-bubble"]')
    expect(bubble?.querySelector('[data-testid="scenario-avatar"]')).toBeNull()
  })

  it("正在发言的成员被标出，其他人不被标", () => {
    render(session([msg({})]), {
      running: true,
      streaming: streamingState({ speakerId: "甲", speakerName: "甲" }),
    })

    expect(memberChip("甲")?.getAttribute("data-active")).toBe("true")
    expect(
      memberChip(SCENARIO_MODERATOR_USER_ID)?.getAttribute("data-active"),
    ).toBe("false")
  })

  it("还没吐字时明说「×× 正在输入」，而不是只转一个圈", () => {
    render(session([msg({})]), {
      running: true,
      streaming: streamingState({ content: "" }),
    })

    expect(container.textContent).toContain("scenarioTyping(name=甲)")
  })

  it("开始吐字后不再显示「正在输入」（那时已经有正文可看了）", () => {
    render(session([msg({})]), {
      running: true,
      streaming: streamingState({ content: "天" }),
    })

    expect(container.textContent).not.toContain("scenarioTyping")
  })

  it("没在生成时不显示「正在输入」", () => {
    render(session([msg({})]), { running: false, streaming: null })

    expect(container.textContent).not.toContain("scenarioTyping")
  })

  it("流式气泡按 speakerId 认角色，而不是拿名字当 id 顶替", () => {
    render(session([msg({})]), {
      running: true,
      streaming: streamingState({
        speakerId: "甲",
        speakerName: "甲某",
        content: "天",
      }),
    })

    const bubbles = container.querySelectorAll('[data-testid="scenario-bubble"]')
    // 不能用 querySelector 取「第一个」气泡：历史消息先于流式气泡渲染
    // （session.messages.map 在前、{streaming && ...} 在后），所以第一个永远
    // 是历史气泡。流式气泡按构造总是最后一个，改成取末尾。
    const bubble = bubbles[bubbles.length - 1]
    // 显示名用 speakerName，身份用引擎给的 speakerId —— 两者不一致时不能串角色
    expect(bubble?.getAttribute("data-speaker-id")).toBe("甲")
    expect(bubble?.textContent).toContain("甲某")
    // 成员条上高亮的仍然应该是 id 为「甲」的那位
    expect(memberChip("甲")?.getAttribute("data-active")).toBe("true")
  })
})
