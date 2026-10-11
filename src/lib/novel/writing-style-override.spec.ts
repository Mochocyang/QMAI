/**
 * 丁-2「文风写作」：生成时临时覆盖文风（只影响这一次，项目设置不写盘）。
 *
 * 这里覆盖三件**必须实测**的事（实施计划 §2「必须实测的三件事」）：
 * 1. 覆盖生效且**不并存**：项目启用 B、本次选 A ⇒ 最终提示词里只有 A；    
 * 2. 项目设置未被写盘：生成后读回 `.qmai/writing-style.json`，`enabledStyleId` 仍是原值；
 * 3. 「不用文风」（`writingStyle: ""`）不产生空标题。
 *
 * ⚠️ 为什么必须走**真实**的 `contextPackToPrompt`（守门文件那份）而不是 mock：
 * 它是覆盖文本会撞上的那道 fail-closed 守卫，也是「空字段是否仍输出标题」的判定处。
 * mock 掉它就等于把被测的性质删掉。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import type { BookStyleProfile } from "./book-analysis/types"
import { STYLE_FACETS, parseStyleFingerprintItem } from "./book-analysis/style-fingerprint"
import { buildEvidenceCandidates } from "./book-analysis/workbench-core"

const mem = new Map<string, string>()
/**
 * 盘上每一次 `writeFileAtomic` 的目标路径。
 * 用途：测量 2 里除了「读回验证」之外再钉一条「生成期间**一笔都没写**」。
 */
const writtenPaths: string[] = []

vi.mock("@/commands/fs", () => ({
  fileExists: vi.fn(async (path: string) => mem.has(path)),
  readFile: vi.fn(async (path: string) => {
    if (!mem.has(path)) throw new Error("ENOENT")
    return mem.get(path)!
  }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    writtenPaths.push(path)
    mem.set(path, content)
  }),
  createDirectory: vi.fn(async () => {}),
}))

import {
  buildWritingStyleContext,
  loadWritingStyleStore,
  resolveWritingStylePreset,
  setEnabledWritingStyle,
  upsertWritingStylePreset,
} from "./writing-style-store"
import { collectReferencedStylePresetIds } from "@/lib/reference/style-reference"
import { contextPackToPrompt, type ContextPack } from "./context-engine"
import {
  runDeepChapterGeneration,
  type DeepChapterGenerationDeps,
} from "./deep-chapter-generation"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, StreamCallbacks } from "@/lib/llm-client"
import { contractToTaskBriefText, type ChapterExecutionContract } from "./chapter-execution-contract"

const PROJECT = "E:/Novel"
const STORE_PATH = `${PROJECT}/.qmai/writing-style.json`

const llmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
  reasoning: { mode: "high" },
} satisfies LlmConfig

/** v1/旧画像：没有 layers / metrics / integratedDna ⇒ 走 `风格硬约束：` 那条分支。 */
function makeProfile(overrides: Partial<BookStyleProfile> = {}): BookStyleProfile {
  return {
    schemaVersion: 1,
    generatedAt: 1,
    sampledChapterIds: ["ch-0001"],
    narrativeDensity: "密度高、推进快",
    descriptionWeight: "",
    emotionRendering: "",
    sentenceStyle: "",
    rhetoricDensity: "",
    transitionStyle: "",
    narrativeVoice: "",
    dialogueStyle: "",
    thematicHabits: "",
    constitution: "1. 朴素\n2. 克制",
    samples: ["原文片段一"],
    ...overrides,
  }
}

/** 结构化画像（v2 拆书工作台发布的那种）：带 `workbenchStyle.styleFingerprint`。 */
async function makeStructuredWorkbenchStyle() {
  const evidence = await buildEvidenceCandidates([{
    chapterId: "c1",
    order: 1,
    start: 0,
    sourceHash: "a".repeat(64),
    text: "他略一沉吟，继而抬起头。她反问了一句。场景随后转到庭院。",
  }])
  const rules = Object.keys(STYLE_FACETS).map((dimension) => ({
    dimension,
    observation: "语言观察",
    condition: "场景需要时",
    action: `具体${dimension}写法。`,
    boundary: "不机械套用",
    evidenceIds: [evidence[0].id],
  }))
  return parseStyleFingerprintItem({
    subject: "文风",
    positioning: "克制白话叙事",
    limitations: "范围有限",
    coverage: Object.keys(STYLE_FACETS).map((dimension) => ({
      dimension,
      status: "observed",
      reason: "用于覆盖测试",
    })),
    rules,
    lexicon: [],
    scenes: [],
  }, evidence)
}

async function seedPreset(name: string, sourceBook: string, profile: BookStyleProfile) {
  return upsertWritingStylePreset(PROJECT, { name, sourceBook, profile })
}

/** 项目启用 B、另有一条 A 可选。返回两条预设。 */
async function seedTwoStyles(profileA: BookStyleProfile, profileB: BookStyleProfile) {
  const a = await seedPreset("甲书 · 文风", "甲书A", profileA)
  const b = await seedPreset("乙书 · 文风", "乙书B", profileB)
  await setEnabledWritingStyle(PROJECT, b.id)
  return { a, b }
}

const styleHeading = () => i18n.t("novel.contextPack.writingStyle")

const basePack: ContextPack = {
  task: "生成第3章",
  chapterGoal: "",
  outline: "",
  recentSummaries: [],
  previousChapterEnding: "",
  characterStates: "",
  soulDoc: "",
  characterAuras: "",
  storyFrameworkBinding: "",
  cognitionStates: "",
  foreshadowingStates: "",
  timeline: "",
  relatedSettings: "",
  canonRules: "",
  writingStyle: "",
  searchResults: "",
  graphSearchResults: "",
  mustDo: "",
  mustAvoid: "",
  nextChapterAdvice: "",
  revisionDirectives: "",
  recentChapterContents: [],
}

beforeEach(() => {
  mem.clear()
  writtenPaths.length = 0
})

describe("文风覆盖：渲染器三态（undefined / null / string）", () => {
  it("undefined = 没有覆盖：与「读项目启用项」逐字节一致，且带前缀的是结构化画像", async () => {
    const workbenchStyle = await makeStructuredWorkbenchStyle()
    const { b } = await seedTwoStyles(
      makeProfile(),
      makeProfile({ schemaVersion: 2, workbenchStyle }),
    )

    const enabled = await buildWritingStyleContext(PROJECT)
    const noOverride = await buildWritingStyleContext(PROJECT, { styleIdOverride: undefined })

    expect(await resolveWritingStylePreset(PROJECT, undefined)).toMatchObject({ id: b.id })
    expect(noOverride).toBe(enabled)
    expect(noOverride).toContain("《乙书B》")
    expect(noOverride.startsWith("【已启用文风画像】")).toBe(true)
  })

  it("string = 用指定预设渲染：启用项的来源字样完全不出现在文本里", async () => {
    const { a } = await seedTwoStyles(makeProfile(), makeProfile())

    const override = await buildWritingStyleContext(PROJECT, { styleIdOverride: a.id })

    expect(override).toContain("《甲书A》")
    expect(override).not.toContain("《乙书B》")
    expect(await buildWritingStyleContext(PROJECT)).toContain("《乙书B》")
  })

  it("null = 本次显式不用文风：返回空串（**不**退化回项目启用项）", async () => {
    await seedTwoStyles(makeProfile(), makeProfile())

    expect(await buildWritingStyleContext(PROJECT, { styleIdOverride: null })).toBe("")
    expect(await resolveWritingStylePreset(PROJECT, null)).toBeNull()
    // 反向对照：没有覆盖时这里是有文本的，否则上面那条断言可能是恒真
    expect(await buildWritingStyleContext(PROJECT)).not.toBe("")
  })

  it("未知 id 不回退到项目启用项（否则用户会以为生效的是自己刚选的那条）", async () => {
    await seedTwoStyles(makeProfile(), makeProfile())

    expect(await buildWritingStyleContext(PROJECT, { styleIdOverride: "style-does-not-exist" })).toBe("")
  })

  it("覆盖也走 migrateStyleProfile：存量 v1 数据缺 constitution 时不抛错", async () => {
    /*
     * 直接写盘模拟**存量 v1 数据**（不走 upsert，那样必然带齐字段）：
     * 这条 profile 没有 `constitution`。`clip()` 内部会 `.trim()`，
     * 不迁移就是 TypeError —— 这正是 `getEnabledWritingStyle:186` 迁移要求
     * 被写进 `resolveWritingStylePreset` 的真实理由（不是为了切换渲染分支）。
     */
    mem.set(STORE_PATH, JSON.stringify({
      version: 1,
      enabledStyleId: null,
      styles: [{
        id: "style-legacy",
        name: "旧画像",
        sourceBook: "旧书C",
        profile: { schemaVersion: 1, generatedAt: 1, samples: [] },
        createdAt: 1,
        updatedAt: 1,
      }],
    }))

    const context = await buildWritingStyleContext(PROJECT, { styleIdOverride: "style-legacy" })
    expect(context).toContain("《旧书C》")
    expect(context).toContain("风格硬约束：")
  })
})

describe("覆盖文本的形状：与「已启用」路径同形（选择 (a) 的不对称被显式钉住）", () => {
  it("结构化画像的覆盖带 `【已启用文风画像】` 前缀 ⇒ 命中 contextPackToPrompt 的守卫", async () => {
    const workbenchStyle = await makeStructuredWorkbenchStyle()
    const { a } = await seedTwoStyles(makeProfile(), makeProfile())
    // 把 A 换成结构化画像（同 id 覆盖写入）
    await upsertWritingStylePreset(PROJECT, {
      name: "甲书 · 文风",
      sourceBook: "甲书A",
      profile: makeProfile({ schemaVersion: 2, workbenchStyle }),
    })

    const override = await buildWritingStyleContext(PROJECT, { styleIdOverride: a.id })

    expect(override.startsWith("【已启用文风画像】")).toBe(true)
    // 守卫真的看得见它：预算不足时停机（与「已启用」路径同一条闸门）
    expect(() => contextPackToPrompt({ ...basePack, writingStyle: override }, 200)).toThrow("文风")
    expect(contextPackToPrompt({ ...basePack, writingStyle: override }, 12000)).toContain(override)
  })

  it("v1/旧画像的覆盖**不带**前缀 ⇒ 与「已启用」路径一样不被守卫拦（既有行为，本批不改变）", async () => {
    const legacy = makeProfile({ constitution: "冷峻克制、短句推进" })
    const { a, b } = await seedTwoStyles(legacy, legacy)

    const override = await buildWritingStyleContext(PROJECT, { styleIdOverride: a.id })
    const enabled = await buildWritingStyleContext(PROJECT, { styleIdOverride: b.id })

    expect(override).toContain("风格硬约束：")
    expect(override).not.toContain("【已启用文风画像】")
    // 两条路径**同形**：除来源书名那一行外逐字节一致 ⇒ 覆盖不会比启用路径更严格
    const shapeOf = (text: string) => text.split("\n").slice(1).join("\n")
    expect(shapeOf(override)).toBe(shapeOf(enabled))
    expect(enabled.startsWith("【已启用文风画像】")).toBe(false)
    // 预算极小时两者都不停机（这就是 (a) 选择接受的那条静默路径）
    expect(() => contextPackToPrompt({ ...basePack, writingStyle: override }, 120)).not.toThrow()
    expect(() => contextPackToPrompt({ ...basePack, writingStyle: enabled }, 120)).not.toThrow()
  })
})

describe("测量 3：「不用文风」（空 writingStyle）不产生空标题", () => {
  it("空 writingStyle 既不出标题也不触发守卫；非空时有标题（正向对照，防恒真）", () => {
    const withStyle = contextPackToPrompt({ ...basePack, writingStyle: "悬疑、克制" }, 12000)
    expect(withStyle).toContain(styleHeading())
    expect(withStyle).toContain("悬疑、克制")

    const withoutStyle = contextPackToPrompt({ ...basePack, writingStyle: "" }, 12000)
    expect(withoutStyle).not.toContain(styleHeading())
    expect(withoutStyle).not.toContain("写作风格")
    // 前缀空串不匹配 ⇒ 不触发 fail-closed 守卫，不会因为「不用文风」而停机
    expect(() => contextPackToPrompt({ ...basePack, writingStyle: "" }, 120)).not.toThrow()
  })
})

/** 最小可用的章节工作流 deps：只保留必填项 + 两个会被本用例走到的可选项。 */
function createDeps(pack: ContextPack): {
  deps: DeepChapterGenerationDeps
  prompts: string[]
} {
  const prompts: string[] = []
  const executionContract: ChapterExecutionContract = {
    objective: "推进线索",
    knownContext: [],
    assumptions: [],
    sceneSteps: [{
      id: "S1",
      title: "旧屋门口",
      purpose: "承接悬念",
      conflict: "要进屋",
      turn: "门内传来第二声响",
      requiredOutcome: "进入旧屋",
      acceptanceCriteria: ["出现门缝声承接"],
    }],
    mustDo: [],
    mustAvoid: [],
    dialogueGoals: [],
    informationFlow: { reveal: [], hide: [], mislead: [], foreshadow: [] },
    finalHook: "门外出现第二个人影",
    freeSpace: [],
  }
  /*
   * 与 deep-chapter-generation.spec.ts 同一套「像样的产出」：
   * 句式必须**多样**，否则重复度守卫会把稿子判成复读、长度也上不去。
   */
  const chapterText = (prefix: string, count = 3000) => {
    const scenes = [
      "雨水沿着瓦檐落下，旧屋里的灯影忽明忽暗，主角先确认门缝后的动静。",
      "他没有急着开口，而是把锈钥匙压在掌心，听见墙后传来短促的摩擦声。",
      "小晴醒来时仍有些发冷，她的回答补上了上一章留下的疑点，却也带出新的矛盾。",
      "两人沿着走廊往里走，地板下的空响让他们意识到这间屋子被人提前动过手脚。",
      "主角试探着推开柜门，里面没有想象中的尸体，只有一封被雨气浸软的旧信。",
      "信纸上的字迹和匿名信相互呼应，但关键名字被刻意刮掉，线索因此变得更危险。",
      "屋外的脚步声突然停住，像有人贴着门听他们说话，空气一下子绷紧。",
      "主角把小晴挡到身后，决定先带走信纸，却在箱底摸到第二把完全陌生的钥匙。",
    ]
    let text = prefix
    let index = 0
    while (text.length < count) {
      text += `${scenes[index % scenes.length]}第${index + 1}个细节把人物选择继续往前推。`
      index += 1
    }
    return text.slice(0, count)
  }
  const body = (prefix: string) => chapterText(prefix, 3000)
  // 任务书有最低完成线（DEEP_CHAPTER_BRIEF_MIN_CHARS = 100），凑够它免得走到重生成分支
  const taskBrief = () =>
    `${contractToTaskBriefText(executionContract)}${"本章必须推进锈钥匙线索，并承接上一章的门缝声。".repeat(6)}`
  const deps: DeepChapterGenerationDeps = {
    buildContextPack: vi.fn(async () => pack),
    // 真实实现（守门文件那份）：覆盖会撞上它的 fail-closed 守卫，这是本用例的要害
    contextPackToPrompt,
    reviewChapter: vi.fn(async () => []),
    runChapterExecutionContractBuild: vi.fn(async () => executionContract),
    streamChat: vi.fn(async (
      _config: LlmConfig,
      messages: ChatMessage[],
      callbacks: StreamCallbacks,
    ) => {
      const prompt = messages
        .map((message) => (typeof message.content === "string"
          ? message.content
          : message.content.map((block) => (block.type === "text" ? block.text : "")).join("")))
        .join("\n")
      prompts.push(prompt)
      const content = prompt.includes("简单审查") || prompt.includes("局部修改")
        ? body("最终")
        : prompt.includes("返修")
          ? body("返修")
          : prompt.includes("正文")
            ? body("初稿")
            : taskBrief()
      callbacks.onToken(content)
      callbacks.onDone()
    }),
  }
  return { deps, prompts }
}

describe("测量 1 + 2：覆盖生效且不并存 / 项目设置未被写盘", () => {
  it("项目启用 B、本次覆盖 A ⇒ 提示词只有 A；生成后 enabledStyleId 仍是 B", async () => {
    const { a, b } = await seedTwoStyles(makeProfile(), makeProfile())
    // 数据源层会给的那份文本 = 项目启用项 B（模拟 `contextPack.writingStyle`）
    const enabledTextB = await buildWritingStyleContext(PROJECT)
    const pack: ContextPack = { ...basePack, writingStyle: enabledTextB }
    const { deps, prompts } = createDeps(pack)

    // 生成开始前把「写盘记录」清零：之后的任何一笔都只可能来自这次生成
    writtenPaths.length = 0

    await runDeepChapterGeneration(
      {
        projectPath: PROJECT,
        userRequest: "生成第三章",
        chapterNumber: 3,
        llmConfig,
        writingStyleIdOverride: a.id,
      },
      {},
      deps,
    )

    const allPrompts = prompts.join("\n")
    // (1) 覆盖生效：A 进去了
    expect(allPrompts).toContain("《甲书A》")
    // (1b) 不并存：项目启用的 B **一个字都没进**提示词（是替换，不是追加）
    expect(allPrompts).not.toContain("《乙书B》")
    /*
     * 逐份计数的理由 —— **这是实测出来的，不是推的**。
     *
     * 实测（本用例本身 + 一次临时探针）：
     * - 正确代码：合并总数 = **2**，逐份 = `[1, 1]`（两次 streamChat 都带上下文包，
     *   即「文风段出现几次」是**跟着带包的提示词条数走**的，不是 1）；
     * - 把同一段覆盖文本复制两份、项目启用那条抹掉（M5b）：
     *   合并总数 = **4**，逐份 = `[2, 2]` ⇒ 逐份断言红。
     *
     * 所以「合并总数」的毛病不是"抓不到追加复制"，而是它**耦合在
     * 「这次跑了几次带包的 streamChat」上**：换一个会返修/会多跑一阶段的场景，
     * 正确代码的总数就变了，断言必须跟着重新校准（写成 `toBe(1)` 那种形式，
     * 在**正确代码上就是假红** —— 实测过）。
     * `每份 ≤1` 才是与阶段数无关的那条不变式，所以留它当主断言。
     */
    expect(prompts.length).toBeGreaterThan(0)
    for (const prompt of prompts) {
      expect(
        prompt.split("目标文风来源：").length - 1,
        "同一份提示词里不得出现两段文风",
      ).toBeLessThanOrEqual(1)
    }

    // (2) 项目设置未被写盘：读回验证 + 「生成期间一笔都没写」
    const store = await loadWritingStyleStore(PROJECT)
    expect(store.enabledStyleId).toBe(b.id)
    expect(writtenPaths.filter((path) => path.includes("writing-style.json"))).toEqual([])

    // 反向对照：**没有**覆盖时进提示词的是项目启用那条（否则上面 (1b) 可能恒真）
    const plain = createDeps(pack)
    await runDeepChapterGeneration(
      { projectPath: PROJECT, userRequest: "生成第三章", chapterNumber: 3, llmConfig },
      {},
      plain.deps,
    )
    expect(plain.prompts.join("\n")).toContain("《乙书B》")
    expect(plain.prompts.join("\n")).not.toContain("《甲书A》")
  })

  it("「本次不用文风」（null）⇒ 提示词里连写作风格一节都没有", async () => {
    const { b } = await seedTwoStyles(makeProfile(), makeProfile())
    const pack: ContextPack = { ...basePack, writingStyle: await buildWritingStyleContext(PROJECT) }
    const { deps, prompts } = createDeps(pack)

    await runDeepChapterGeneration(
      {
        projectPath: PROJECT,
        userRequest: "生成第三章",
        chapterNumber: 3,
        llmConfig,
        writingStyleIdOverride: null,
      },
      {},
      deps,
    )

    const allPrompts = prompts.join("\n")
    expect(allPrompts).not.toContain("《乙书B》")
    expect(allPrompts).not.toContain("目标文风来源：")
    expect(allPrompts).not.toContain(styleHeading())
    expect((await loadWritingStyleStore(PROJECT)).enabledStyleId).toBe(b.id)
  })

  it("不传覆盖时**连渲染器都不调**（pack 原样进 contextPackToPrompt）", async () => {
    const pack: ContextPack = { ...basePack, writingStyle: "项目启用文风原文" }
    const { deps } = createDeps(pack)
    const renderer = vi.fn(async () => "不该被调用")
    const seen: Array<ContextPack["writingStyle"]> = []
    deps.buildWritingStyleContext = renderer
    // 仍然调用真实实现，只顺手记下这次喂进去的 writingStyle
    deps.contextPackToPrompt = vi.fn((candidate: ContextPack, budget?: number, options?: { excludeOutline?: boolean }) => {
      seen.push(candidate.writingStyle)
      return contextPackToPrompt(candidate, budget, options)
    })

    await runDeepChapterGeneration(
      { projectPath: PROJECT, userRequest: "生成第三章", chapterNumber: 3, llmConfig },
      {},
      deps,
    )

    expect(renderer).not.toHaveBeenCalled()
    expect(seen[0]).toBe("项目启用文风原文")
  })

  it("覆盖走**浅拷贝**：不改动传进来的 contextPack（它可能来自 context-hub 缓存）", async () => {
    const pack: ContextPack = { ...basePack, writingStyle: "缓存里的项目启用文风" }
    const { deps } = createDeps(pack)
    const seen: Array<ContextPack["writingStyle"]> = []
    deps.buildWritingStyleContext = vi.fn(async () => "本次覆盖的文风")
    deps.contextPackToPrompt = vi.fn((candidate: ContextPack, budget?: number, options?: { excludeOutline?: boolean }) => {
      seen.push(candidate.writingStyle)
      return contextPackToPrompt(candidate, budget, options)
    })

    await runDeepChapterGeneration(
      {
        projectPath: PROJECT,
        userRequest: "生成第三章",
        chapterNumber: 3,
        llmConfig,
        writingStyleIdOverride: "style-a",
      },
      {},
      deps,
    )

    expect(seen[0]).toBe("本次覆盖的文风")
    // 原对象必须原封不动：否则第二次生成（没选文风）会拿到被改过的文本
    expect(pack.writingStyle).toBe("缓存里的项目启用文风")
  })

  it("覆盖渲染器收到的是 input.projectPath 与本次任务描述", async () => {
    const pack: ContextPack = { ...basePack, writingStyle: "x" }
    const { deps } = createDeps(pack)
    const renderer = vi.fn(async () => "覆盖文本")
    deps.buildWritingStyleContext = renderer
    deps.contextPackToPrompt = vi.fn((candidate: ContextPack, budget?: number, options?: { excludeOutline?: boolean }) =>
      contextPackToPrompt(candidate, budget, options))

    await runDeepChapterGeneration(
      {
        projectPath: PROJECT,
        userRequest: "生成第三章",
        chapterNumber: 3,
        llmConfig,
        writingStyleIdOverride: "style-a",
      },
      {},
      deps,
    )

    expect(renderer).toHaveBeenCalledWith(PROJECT, {
      task: expect.stringContaining("生成第三章"),
      styleIdOverride: "style-a",
    })
  })
})

/*
 * 丁-3：输入框 `@` 引用 → 覆盖 id → **真的进本次生成的提示词**。
 *
 * 上游那一半（引用弹窗里的条目、芯片、发送时写进 getter）在
 * `chat-panel.mount.spec.tsx`；这里把 id 的来源换成**引用 token**，
 * 于是「用户 @ 了一条文风」与「本次提示词里出现的是那条文风」之间
 * 只剩 `collectReferencedStylePresetIds` + `writingStyleIdOverride` 两个环节，
 * 都在这个用例里。硬写 `a.id`（本文件前面的用例）测不到解析那一环。
 */
describe("丁-3：@ 引用的文风经覆盖通道进入本次提示词", () => {
  it("引用 A ⇒ 提示词里只有 A，项目启用的 B 一个字都不出现", async () => {
    const { a } = await seedTwoStyles(makeProfile(), makeProfile())
    const pack: ContextPack = { ...basePack, writingStyle: await buildWritingStyleContext(PROJECT) }
    const { deps, prompts } = createDeps(pack)

    // token 形状与引用弹窗产出的一致（`skillId` 是预设 id，见 style-reference.ts）
    const referencedPresetId = collectReferencedStylePresetIds([{
      id: "ref-1",
      category: "skill",
      title: "甲书 · 文风",
      skillId: a.id,
      skillSubtype: "style",
      displayTitle: "甲书 · 文风",
    }])[0]
    expect(referencedPresetId, "引用必须解析出预设 id，否则下面测的是「没有覆盖」").toBe(a.id)

    await runDeepChapterGeneration(
      {
        projectPath: PROJECT,
        userRequest: "生成第三章",
        chapterNumber: 3,
        llmConfig,
        writingStyleIdOverride: referencedPresetId,
      },
      {},
      deps,
    )

    const allPrompts = prompts.join("\n")
    expect(allPrompts).toContain("《甲书A》")
    expect(allPrompts).not.toContain("《乙书B》")
  })
})
