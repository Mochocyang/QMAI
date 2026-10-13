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

/** 换掉顶层 setup 里的参与者名单（成员条相关用例共用）。 */
function withParticipants(
  s: ScenarioSession,
  participants: ScenarioSetup["participants"],
): ScenarioSession {
  return { ...s, setup: { ...s.setup, participants } }
}

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

/** 成员徽章里的灵魂小字；未绑定灵魂时整个元素不存在。 */
function soulOf(chip: HTMLElement | null): Element | null {
  return chip?.querySelector('[data-testid="scenario-member-soul"]') ?? null
}

function avatarOf(speakerId: string): HTMLElement | null {
  return findBySpeakerId("scenario-avatar", speakerId)
}

/**
 * 从 className 里取底色类名。
 *
 * 只比 bg-*：成员条头像 h-4、气泡头像 h-7，尺寸类名本来就不同，
 * 要比的是「同一个角色是不是同一个颜色」。
 */
function bgOf(el: Element | null | undefined): string[] {
  return (el?.className ?? "")
    .split(/\s+/)
    .filter((c) => c.startsWith("bg-"))
    .sort()
}

/**
 * 色板第 0 位的底色。
 *
 * 它同时是「seed 缺失」的落点：scenarioSpeakerTone(undefined) 内部把
 * 空串拿去散列，结果恒为下标 0。用它证明某条用例的期望色不在第 0 位 ——
 * 否则「兜底生效」会被「兜底前后恰好同色」蒙混过去。
 */
function tone0Bg(): string[] {
  return SCENARIO_SPEAKER_TONES[0].avatarClass
    .split(/\s+/)
    .filter((c) => c.startsWith("bg-"))
    .sort()
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
    // 两处的尺寸类名不同（成员条 h-4、气泡 h-7），只比底色（bgOf 见文件上方）
    expect(bgOf(bubbleAvatar).length).toBeGreaterThan(0)
    expect(bgOf(bubbleAvatar)).toEqual(bgOf(chipAvatar))
  })

  it("同场两个不同角色拿到不同颜色（配色不是全房间一个色）", () => {
    // 把 scenario-avatar 的 `hash % LEN` 恒定化（所有人同色）后，本文件原本
    // 23 条全绿：房间视图里没有一条用例守着「真的按各自的 id 散列出不同色」。
    // 按当前色板，甲落下标 2、乙落 1 —— 两者必须不同色。
    render(
      withParticipants(session([msg({})]), [
        { id: "甲", name: "甲", isModerator: false },
        { id: "乙", name: "乙", isModerator: false },
      ]),
    )

    const first = avatarOf("甲")
    const second = avatarOf("乙")
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(bgOf(first)).not.toEqual(bgOf(second))
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

/**
 * 规格（2026-10-12-scenario-redesign-design.html:435）要求成员徽章是
 * 「圆形头像（名字首字）+ 名字 + 灵魂小字」，主持人带徽标。
 *
 * 灵魂名本身就是数据：participants[].auraName 由 candidateToParticipant
 * 从候选带进来，所以直接显示即可 —— 不新增文案 key、不加「灵魂：」前缀。
 */
describe("ScenarioRoomView · 成员条的灵魂小字", () => {
  it("绑了灵魂的成员在自己的徽章里带出灵魂名", () => {
    render(
      withParticipants(session([msg({})]), [
        { id: "甲", name: "甲", isModerator: false, auraName: "游侠" },
        { id: "乙", name: "乙", isModerator: false, auraName: "账房先生" },
      ]),
    )

    const chipA = memberChip("甲")
    const chipB = memberChip("乙")
    expect(chipA).not.toBeNull()
    expect(chipB).not.toBeNull()
    // 断言限定在「各自的徽章内」：两个角色都绑了灵魂，全局 toContain 分不清是谁的
    expect(soulOf(chipA)?.textContent).toBe("游侠")
    expect(soulOf(chipB)?.textContent).toBe("账房先生")
    expect(chipA?.textContent).not.toContain("账房先生")
    expect(chipB?.textContent).not.toContain("游侠")
    // 灵魂小字是纯展示：绑定入口在设置面板，这里不能长成可点的样子
    expect(soulOf(chipA)?.tagName).toBe("SPAN")
    expect(soulOf(chipA)?.getAttribute("role")).toBeNull()
  })

  it("名字与灵魂名之间有 aria-hidden 分隔符，避免读屏连读成「甲游侠」", () => {
    render(
      withParticipants(session([msg({})]), [
        { id: "甲", name: "甲", isModerator: false, auraName: "游侠" },
      ]),
    )

    const chip = memberChip("甲")
    expect(chip).not.toBeNull()

    // 灵魂小字本身仍只承载灵魂名：分隔符必须是它的兄弟节点，不能混进去
    expect(soulOf(chip)?.textContent).toBe("游侠")

    // 两个文本 span 之间必须真的有个分隔符元素；纯视觉的空白节点不算
    const sep = Array.from(chip?.children ?? []).find(
      (el) => el.getAttribute("aria-hidden") === "true",
    )
    expect(sep).toBeTruthy()
    expect(sep?.textContent).toBe("·")
    // 它不能给无障碍名添字，否则等于偷偷加了前缀
    expect(sep?.getAttribute("aria-label")).toBeNull()
  })

  it("没绑灵魂的成员既不渲染灵魂小字，也不出现分隔符", () => {
    render(
      withParticipants(session([msg({})]), [
        { id: "甲", name: "甲", isModerator: false, auraName: null },
      ]),
    )

    const chip = memberChip("甲")
    expect(chip).not.toBeNull()
    // 没绑灵魂时名字后面不该多出一个孤零零的「·」
    expect(chip?.textContent).not.toContain("·")
  })

  it("没绑灵魂的成员不渲染任何灵魂小字（连空壳都不留）", () => {
    render(
      withParticipants(session([msg({})]), [
        { id: "甲", name: "甲", isModerator: false, auraName: null },
        // 空串与「键整个不存在」都要覆盖：旧会话里三种都可能出现
        { id: "乙", name: "乙", isModerator: false, auraName: "" },
        { id: "丙", name: "丙", isModerator: false },
      ]),
    )

    for (const id of ["甲", "乙", "丙"]) {
      const chip = memberChip(id)
      expect(chip).not.toBeNull()
      // 「没渲染」与「渲染了一个空的」是两回事：数元素，别数文字
      expect(
        chip?.querySelectorAll('[data-testid="scenario-member-soul"]').length,
      ).toBe(0)
      expect(chip?.textContent).not.toContain("null")
      expect(chip?.textContent).not.toContain("undefined")
    }
  })
})

/**
 * 规格（同上 :531）：历史情景（旧数据没有 speakerId）→ 可选字段缺省时按
 * speakerName 兜底取配色，不报错。
 *
 * scenario-store 的加载只校验「messages 是数组」，不逐条校验字段，
 * 所以旧会话里 speakerId 这个键可能整个不存在。
 */
describe("ScenarioRoomView · 历史情景缺 speakerId", () => {
  it("缺 speakerId 的气泡按 speakerName 兜底取色，与同角色的正常气泡同色", () => {
    // 显式造一条「键整个不存在」的旧消息：类型上 speakerId 是必填的，
    // 这里如实模拟从磁盘读回来的老数据。
    const legacy = {
      id: "legacy-1",
      kind: "character",
      speakerName: "甲",
      round: 1,
      content: "旧数据：天命之谓性。",
      timestamp: "2026-10-11T00:00:00.000Z",
    } as ScenarioMessage

    render(session([legacy, msg({ speakerId: "甲", speakerName: "甲" })]))

    const bubbleAvatars = container.querySelectorAll(
      '[data-testid="scenario-bubble"] [data-testid="scenario-avatar"]',
    )
    expect(bubbleAvatars.length).toBe(2)

    // 期望色取自成员条上的同一个人：规格要的是「同一角色颜色保持不变」
    const expectedBg = bgOf(
      memberChip("甲")?.querySelector('[data-testid="scenario-avatar"]'),
    )
    // 前提：甲本来就不落在色板第 0 位 —— 否则「兜底生效」会被
    // 「兜底前后恰好同色」蒙混过去（第 0 位正是 seed 缺失时的落点）
    expect(expectedBg).not.toEqual(tone0Bg())

    // 顺序即消息顺序：第 0 条是缺 speakerId 的老数据
    expect(bgOf(bubbleAvatars[1])).toEqual(expectedBg)
    expect(bgOf(bubbleAvatars[0])).toEqual(expectedBg)
  })

  it("speakerId 是空串或纯空白（手工改坏的脏数据）也按 speakerName 兜底", () => {
    // 空串与纯空白都是真值，`??` 兜不住它们；不兜的话这两个气泡会一起落到
    // 色板第 0 位，和成员条上同一个角色不同色。
    const dirty = ["", "   "].map((speakerId, i) => ({
      id: `dirty-${i}`,
      kind: "character" as const,
      speakerId,
      speakerName: "甲",
      round: 1,
      content: `脏数据 ${i}。`,
      timestamp: "2026-10-11T00:00:00.000Z",
    })) as ScenarioMessage[]

    render(session([...dirty, msg({ speakerId: "甲", speakerName: "甲" })]))

    const expectedBg = bgOf(
      memberChip("甲")?.querySelector('[data-testid="scenario-avatar"]'),
    )
    // 前提与上一条同：甲本来就不在第 0 位，否则「兜底生效」无从判别
    expect(expectedBg).not.toEqual(tone0Bg())

    const bubbleAvatars = container.querySelectorAll(
      '[data-testid="scenario-bubble"] [data-testid="scenario-avatar"]',
    )
    expect(bubbleAvatars.length).toBe(3)
    for (const avatar of Array.from(bubbleAvatars)) {
      expect(bgOf(avatar)).toEqual(expectedBg)
    }
  })
})
