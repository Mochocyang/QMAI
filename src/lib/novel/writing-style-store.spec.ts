import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BookStyleProfile } from "./book-analysis/types"
import { STYLE_FACETS, parseStyleFingerprintItem } from "./book-analysis/style-fingerprint"
import { buildEvidenceCandidates } from "./book-analysis/workbench-core"

const mem = new Map<string, string>()

vi.mock("@/commands/fs", () => ({
  fileExists: vi.fn(async (path: string) => mem.has(path)),
  readFile: vi.fn(async (path: string) => {
    if (!mem.has(path)) throw new Error("ENOENT")
    return mem.get(path)!
  }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    mem.set(path, content)
  }),
  createDirectory: vi.fn(async () => {}),
}))

import {
  loadWritingStyleStore,
  upsertWritingStylePreset,
  setEnabledWritingStyle,
  getEnabledWritingStyle,
  buildWritingStyleContext,
  removeWritingStylePreset,
  removeWritingStylePresetBySourceBook,
} from "./writing-style-store"

const PROJECT = "E:/Novel"

/** v1 形状的旧画像：没有 layers / metrics / integratedDna。 */
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
    samples: ["原文片段一", "原文片段二"],
    ...overrides,
  }
}

/** v2 形状：含分层产物与整合文档。 */
function makeDnaProfile(overrides: Partial<BookStyleProfile> = {}): BookStyleProfile {
  return makeProfile({
    schemaVersion: 2,
    layers: {
      languageDna: "短句为主。",
      structurePatterns: "推进章骨架。",
      cognitiveFrame: "能一句带过就不展开。",
      rhythmGuide: "一句一段用于转折。",
    },
    integratedDna: [
      "## 语言特征",
      "短句为主，平均句长 12 字。",
      "",
      "## 风格硬约束",
      "1. 环境描写不超过 2 句。",
    ].join("\n"),
    ...overrides,
  })
}

beforeEach(() => {
  mem.clear()
})

describe("writing-style-store", () => {
  it("结构化文风启用后保留所有维度、词项和场景，不被旧字数预算截断", async () => {
    const evidence = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 0, sourceHash: "a".repeat(64), text: "他略一沉吟，继而抬起头。她反问了一句。场景随后转到庭院。" }])
    const rules = Object.keys(STYLE_FACETS).map((dimension) => ({
      dimension, observation: "语言观察", condition: "场景需要时", action: `具体${dimension}写法。` + "有条件地调整叙述。".repeat(20),
      boundary: "不机械套用", evidenceIds: [evidence[0].id],
    }))
    const item = parseStyleFingerprintItem({
      subject: "文风", positioning: "克制白话叙事", limitations: "范围有限",
      coverage: Object.keys(STYLE_FACETS).map((dimension) => ({ dimension, status: "observed", reason: "用于注入测试" })),
      rules, lexicon: [{ word: "略一沉吟", kind: "expression", usage: "短暂停顿", evidenceIds: [evidence[0].id] }],
      scenes: [{ scene: "场景转换", guidance: "通过新的观察对象切换场景", evidenceIds: [evidence[0].id] }],
    }, evidence)
    const preset = await upsertWritingStylePreset(PROJECT, { name: "画像", sourceBook: "测试作品", profile: makeDnaProfile({ workbenchStyle: item }) })
    expect(await buildWritingStyleContext(PROJECT)).toBe("")
    await setEnabledWritingStyle(PROJECT, preset.id)
    const context = await buildWritingStyleContext(PROJECT, { constitutionCharLimit: 50 })
    expect(context).toContain("【已启用文风画像】")
    for (const rule of item.rules) expect(context).toContain(rule.action)
    expect(context).toContain("略一沉吟")
    expect(context).toContain("通过新的观察对象切换场景")
    await setEnabledWritingStyle(PROJECT, null)
    expect(await buildWritingStyleContext(PROJECT)).toBe("")
  })
  it("dedupes presets by sourceBook and overwrites the profile", async () => {
    const a = await upsertWritingStylePreset(PROJECT, { name: "凡人·文风", sourceBook: "凡人", profile: makeProfile() })
    const b = await upsertWritingStylePreset(PROJECT, {
      name: "凡人·文风",
      sourceBook: "凡人",
      profile: makeProfile({ narrativeDensity: "更新后的密度" }),
    })

    expect(a.id).toBe(b.id)
    const store = await loadWritingStyleStore(PROJECT)
    expect(store.styles).toHaveLength(1)
    expect(store.styles[0].profile.narrativeDensity).toBe("更新后的密度")
  })

  it("enables and clears the active style", async () => {
    const preset = await upsertWritingStylePreset(PROJECT, { name: "x", sourceBook: "凡人", profile: makeProfile() })
    await setEnabledWritingStyle(PROJECT, preset.id)
    expect((await getEnabledWritingStyle(PROJECT))?.id).toBe(preset.id)

    await setEnabledWritingStyle(PROJECT, null)
    expect(await getEnabledWritingStyle(PROJECT)).toBeNull()
  })

  it("ignores an unknown style id when enabling", async () => {
    await upsertWritingStylePreset(PROJECT, { name: "x", sourceBook: "凡人", profile: makeProfile() })
    await setEnabledWritingStyle(PROJECT, "does-not-exist")
    expect(await getEnabledWritingStyle(PROJECT)).toBeNull()
  })

  it("returns empty context when nothing is enabled", async () => {
    await upsertWritingStylePreset(PROJECT, { name: "x", sourceBook: "凡人", profile: makeProfile() })
    expect(await buildWritingStyleContext(PROJECT)).toBe("")
  })

  it("injects the guard, constitution and samples by default", async () => {
    const preset = await upsertWritingStylePreset(PROJECT, { name: "x", sourceBook: "凡人修仙传", profile: makeProfile() })
    await setEnabledWritingStyle(PROJECT, preset.id)

    const ctx = await buildWritingStyleContext(PROJECT)
    expect(ctx).toContain("《凡人修仙传》")
    expect(ctx).toContain("严禁借用")
    expect(ctx).toContain("朴素")
    expect(ctx).toContain("原文片段一")
  })

  it("omits samples when includeSamples is false", async () => {
    const preset = await upsertWritingStylePreset(PROJECT, { name: "x", sourceBook: "凡人", profile: makeProfile() })
    await setEnabledWritingStyle(PROJECT, preset.id)

    const ctx = await buildWritingStyleContext(PROJECT, { includeSamples: false })
    expect(ctx).not.toContain("原文片段一")
    expect(ctx).toContain("朴素")
  })

  it("clips an over-long constitution to the configured limit", async () => {
    const preset = await upsertWritingStylePreset(PROJECT, {
      name: "x",
      sourceBook: "凡人",
      profile: makeProfile({ constitution: "约束".repeat(1000) }),
    })
    await setEnabledWritingStyle(PROJECT, preset.id)

    const ctx = await buildWritingStyleContext(PROJECT, { constitutionCharLimit: 100 })
    expect(ctx).toContain("…")
    expect(ctx.length).toBeLessThan(800)
  })

  it("新文风只注入证据仓库中当前启用的片段", async () => {
    const evidencePath = `${PROJECT}/book-analysis/book-1/analysis/evidence.json`
    mem.set(evidencePath, JSON.stringify({
      version: 1,
      bookId: "book-1",
      updatedAt: 1,
      snippets: [
        { id: "enabled", skill: "style", enabled: true, text: "幽默对白片段" },
        { id: "disabled", skill: "style", enabled: false, text: "已禁用片段" },
      ],
    }))
    const preset = await upsertWritingStylePreset(PROJECT, {
      name: "测试文风",
      sourceBook: "测试作品",
      sourceBookId: "book-1",
      evidenceIds: ["enabled", "disabled"],
      profile: makeProfile(),
    })
    await setEnabledWritingStyle(PROJECT, preset.id)

    const context = await buildWritingStyleContext(PROJECT)
    expect(context).toContain("幽默对白片段")
    expect(context).not.toContain("已禁用片段")
    expect(context).not.toContain("原文片段一")
  })
})

describe("writing-style-store · Writing DNA 注入", () => {
  async function enable(profile: BookStyleProfile, extra: Record<string, unknown> = {}) {
    const preset = await upsertWritingStylePreset(PROJECT, {
      name: "x",
      sourceBook: "凡人修仙传",
      profile,
      ...extra,
    })
    await setEnabledWritingStyle(PROJECT, preset.id)
    return preset
  }

  it("硬约束排在整合文档正文之前，保证不被挤掉", async () => {
    await enable(makeDnaProfile())
    const ctx = await buildWritingStyleContext(PROJECT)

    expect(ctx.indexOf("风格硬约束")).toBeGreaterThan(-1)
    expect(ctx.indexOf("风格硬约束")).toBeLessThan(ctx.indexOf("Writing DNA 要点"))
  })

  it("整合文档注入时摘掉硬约束小节，避免同一段内容注入两遍", async () => {
    await enable(makeDnaProfile())
    const ctx = await buildWritingStyleContext(PROJECT)

    expect(ctx).toContain("平均句长 12 字")
    // 「环境描写不超过 2 句」只应来自 constitution 字段，不应随正文再来一次
    expect(ctx.split("环境描写不超过 2 句").length - 1).toBeLessThanOrEqual(1)
  })

  it("v1 旧画像没有整合文档时降级为只注入硬约束", async () => {
    await enable(makeProfile())
    const ctx = await buildWritingStyleContext(PROJECT)

    expect(ctx).toContain("风格硬约束")
    expect(ctx).toContain("朴素")
    expect(ctx).not.toContain("Writing DNA 要点")
  })

  it("v1 旧画像读出时迁移为 v2 形状并按层归类 9 维内容", async () => {
    await enable(makeProfile())
    const preset = await getEnabledWritingStyle(PROJECT)

    expect(preset?.profile.schemaVersion).toBe(2)
    expect(preset?.profile.layers?.languageDna).toContain("密度高、推进快")
    expect(preset?.profile.layers?.rhythmGuide).toBe("")
  })

  it("给了 task 时按题材从 chapter-meta 检索最接近的原文片段", async () => {
    mem.set(`${PROJECT}/book-analysis/book-1/analysis/chapter-meta.json`, JSON.stringify({
      version: 1,
      bookId: "book-1",
      updatedAt: 1,
      entries: [
        {
          chapterId: "ch-0001", order: 1, title: "宗门试炼", wordCount: 900,
          hookType: "冲突式", structurePattern: "冲突章", sceneCount: 2,
          topicTags: ["宗门试炼"], dialogueRatio: 0.4, updatedAt: 1,
        },
        {
          chapterId: "ch-0002", order: 2, title: "赶路", wordCount: 900,
          hookType: "场景式", structurePattern: "过渡章", sceneCount: 1,
          topicTags: ["赶路"], dialogueRatio: 0.1, updatedAt: 1,
        },
      ],
    }))
    mem.set(`${PROJECT}/book-analysis/book-1/chapters/ch-0001.md`, "---\nid: ch-0001\n---\n试炼场上血流成河。")
    mem.set(`${PROJECT}/book-analysis/book-1/chapters/ch-0002.md`, "---\nid: ch-0002\n---\n他们走了三天。")

    await enable(makeDnaProfile(), { sourceBookId: "book-1" })
    const ctx = await buildWritingStyleContext(PROJECT, { task: "写一场宗门试炼的对决", relevantChapterCount: 1 })

    expect(ctx).toContain("题材最接近的原文片段")
    expect(ctx).toContain("试炼场上血流成河")
    expect(ctx).not.toContain("他们走了三天")
  })

  it("chapter-meta 缺失时回落到 profile.samples", async () => {
    await enable(makeDnaProfile(), { sourceBookId: "book-1" })
    const ctx = await buildWritingStyleContext(PROJECT, { task: "写一场对决" })

    expect(ctx).toContain("原文片段一")
    expect(ctx).not.toContain("题材最接近的原文片段")
  })

  it("没有 task 时不做检索，直接用已有样本", async () => {
    await enable(makeDnaProfile(), { sourceBookId: "book-1" })
    const ctx = await buildWritingStyleContext(PROJECT)

    expect(ctx).toContain("原文片段一")
  })

  it("整合文档正文超预算时被截断，但硬约束完整保留", async () => {
    await enable(makeDnaProfile({
      constitution: "1. 环境描写不超过 2 句。",
      integratedDna: `## 语言特征\n${"细节".repeat(2000)}\n\n## 风格硬约束\n1. 环境描写不超过 2 句。`,
    }))
    const ctx = await buildWritingStyleContext(PROJECT)

    expect(ctx).toContain("环境描写不超过 2 句")
    expect(ctx).toContain("…")
    expect(ctx.length).toBeLessThan(6000)
  })
})

/**
 * 文风预设删除（设计 §7：文风库原本没有任何删除接口）。
 * 删除是「连使用库一起真删」，所以启用态必须跟着一起清，不能留下悬空启用项。
 */
describe("文风预设删除", () => {
  it("按 id 删掉对应预设，其它预设保留", async () => {
    const target = await upsertWritingStylePreset(PROJECT, { name: "甲书 · 文风", sourceBook: "甲书", profile: makeProfile() })
    const keep = await upsertWritingStylePreset(PROJECT, { name: "乙书 · 文风", sourceBook: "乙书", profile: makeProfile() })

    const next = await removeWritingStylePreset(PROJECT, target.id)

    expect(next.styles.map((preset) => preset.id)).toEqual([keep.id])
    expect((await loadWritingStyleStore(PROJECT)).styles.map((preset) => preset.id)).toEqual([keep.id])
  })

  it("按 sourceBook 删掉对应预设，其它来源的预设保留", async () => {
    await upsertWritingStylePreset(PROJECT, { name: "甲书 · 文风", sourceBook: "甲书", profile: makeProfile() })
    const keep = await upsertWritingStylePreset(PROJECT, { name: "乙书 · 文风", sourceBook: "乙书", profile: makeProfile({ narrativeDensity: "乙书的密度" }) })

    const next = await removeWritingStylePresetBySourceBook(PROJECT, "甲书")

    expect(next.styles.map((preset) => preset.id)).toEqual([keep.id])
    expect(next.styles[0].profile.narrativeDensity).toBe("乙书的密度")
    expect((await loadWritingStyleStore(PROJECT)).styles).toHaveLength(1)
  })

  it("删掉的正是当前启用项时必须清空 enabledStyleId，不留悬空的启用项", async () => {
    const target = await upsertWritingStylePreset(PROJECT, { name: "甲书 · 文风", sourceBook: "甲书", profile: makeProfile() })
    await setEnabledWritingStyle(PROJECT, target.id)

    const next = await removeWritingStylePresetBySourceBook(PROJECT, "甲书")

    expect(next.enabledStyleId).toBeNull()
    expect((await loadWritingStyleStore(PROJECT)).enabledStyleId).toBeNull()
    expect(await getEnabledWritingStyle(PROJECT)).toBeNull()
    expect(await buildWritingStyleContext(PROJECT)).toBe("")
  })

  it("删的不是当前启用项时启用态原样保留", async () => {
    const enabled = await upsertWritingStylePreset(PROJECT, { name: "乙书 · 文风", sourceBook: "乙书", profile: makeProfile() })
    await upsertWritingStylePreset(PROJECT, { name: "甲书 · 文风", sourceBook: "甲书", profile: makeProfile() })
    await setEnabledWritingStyle(PROJECT, enabled.id)

    const next = await removeWritingStylePresetBySourceBook(PROJECT, "甲书")

    expect(next.enabledStyleId).toBe(enabled.id)
    expect((await getEnabledWritingStyle(PROJECT))?.id).toBe(enabled.id)
  })

  it("删不存在的目标不抛错，store 内容不变", async () => {
    const keep = await upsertWritingStylePreset(PROJECT, { name: "甲书 · 文风", sourceBook: "甲书", profile: makeProfile() })
    const before = await loadWritingStyleStore(PROJECT)

    const byId = await removeWritingStylePreset(PROJECT, "style-does-not-exist")
    expect(byId.styles.map((preset) => preset.id)).toEqual([keep.id])
    expect(byId.enabledStyleId).toEqual(before.enabledStyleId)

    const byBook = await removeWritingStylePresetBySourceBook(PROJECT, "没有这本书")
    expect(byBook).toEqual(byId)
    expect(await loadWritingStyleStore(PROJECT)).toEqual(byId)
  })
})
