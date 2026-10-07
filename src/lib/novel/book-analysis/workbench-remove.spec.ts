import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkbenchRevision } from "./workbench-core"
import { getPlotFrameworkLibraryPath, loadPlotFrameworkLibrary } from "../plot-framework-library"
import { loadWritingStyleStore } from "../writing-style-store"
import { loadWorkbenchRevisions, saveWorkbenchRevision } from "./workbench-storage"
import { confirmWorkbenchRevision, inspectWorkbenchPublication, workbenchAuraId } from "./workbench-publish"
import { deleteCustomCharacterAura } from "../character-aura"
import { removeWorkbenchRevisionItem, workbenchStoryFrameworkId } from "./workbench-remove"

const PROJECT = "/project"
const BOOK_PATH = "/project/book-analysis/book-1"

/**
 * 只 mock 文件系统与角色灵魂库：文风库、故事框架库用**真实模块**（跑在内存 fs 上），
 * 这样「删掉的是整版预设／框架」这句结论才有证据，而不是只断言调用了一次 mock。
 */
const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  auras: [] as any[],
  deleteAura: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error("文件缺失")
    return io.files.get(path)!
  },
  writeFile: async (path: string, text: string) => { io.files.set(path, text) },
  writeFileAtomic: async (path: string, text: string) => { io.files.set(path, text) },
  createDirectory: async () => {},
  // 目录也要认：loadWorkbenchRevisions 先 fileExists(<bookPath>/analysis/revisions) 才继续。
  fileExists: async (path: string) =>
    io.files.has(path) || [...io.files.keys()].some((key) => key.startsWith(`${path}/`)),
  listDirectory: async (path: string) => [...io.files.keys()]
    .filter((key) => key.startsWith(`${path}/`))
    .map((key) => ({ name: key.slice(path.length + 1), path: key, is_dir: false })),
}))
vi.mock("./analysis-engine", () => ({ loadChapterList: async () => [] }))
vi.mock("../character-aura", () => ({
  loadCharacterAuraStore: async () => ({ customAuras: [...io.auras], bindings: [] }),
  // 生产实现按 id 精确过滤：mock 照抄这一语义，才能证明「删对了哪一条」。
  deleteCustomCharacterAura: async (projectPath: string, auraId: string) => {
    io.deleteAura(projectPath, auraId)
    io.auras = io.auras.filter((aura) => aura.id !== auraId)
    return { customAuras: io.auras, bindings: [] }
  },
  updateCustomCharacterAura: async (_projectPath: string, auraId: string, patch: Record<string, unknown>) => {
    const index = io.auras.findIndex((aura) => aura.id === auraId)
    if (index < 0) throw new Error("未找到自定义灵魂")
    const updated = { ...io.auras[index], ...patch, id: auraId }
    io.auras[index] = updated
    return updated
  },
  createCustomCharacterAuraFromGeneratedSkill: async (_projectPath: string, input: any) => {
    const aura = { ...input, id: "custom-new", builtIn: false }
    io.auras.push(aura)
    return aura
  },
}))

function auraFixture(id: string, name: string, sourceNote = "", category = "拆书角色") {
  return {
    id, builtIn: false, name, category, sourceNote, corpus: "", styleDescription: "",
    behaviorRules: "", boundaries: "", notes: "",
  }
}
function charactersRevision(overrides: Partial<WorkbenchRevision> = {}): WorkbenchRevision {
  return {
    workbenchVersion: 2, id: "r-char", taskId: "t1", bookId: "book-1", bookTitle: "测试作品", skill: "characters",
    requirements: "", selectedChapterIds: [], createdAt: 1, evidence: [], coverage: [],
    items: [
      { subject: "许七安", summary: "先核对", limitations: "只覆盖本章", rules: [] },
      { subject: "魏渊", summary: "留后手", limitations: "只覆盖本章", rules: [] },
    ],
    ...overrides,
  }
}

function styleRevision(overrides: Partial<WorkbenchRevision> = {}): WorkbenchRevision {
  return {
    workbenchVersion: 2, id: "r-style", taskId: "t2", bookId: "book-1", bookTitle: "测试作品", skill: "style",
    requirements: "", selectedChapterIds: [], createdAt: 1, evidence: [], coverage: [],
    items: [
      { subject: "文风", summary: "短句", limitations: "只覆盖本章", rules: [] },
      { subject: "叙事声音", summary: "冷叙述", limitations: "只覆盖本章", rules: [] },
    ],
    ...overrides,
  }
}

function storyRevision(overrides: Partial<WorkbenchRevision> = {}): WorkbenchRevision {
  return {
    workbenchVersion: 2, id: "r-story", taskId: "t3", bookId: "book-1", bookTitle: "测试作品", skill: "story",
    requirements: "", selectedChapterIds: [], createdAt: 1, evidence: [], coverage: [],
    items: [
      { subject: "结构机制", summary: "目标受阻", limitations: "只覆盖本章", rules: [] },
      { subject: "悬念投放", summary: "后置信息", limitations: "只覆盖本章", rules: [] },
    ],
    ...overrides,
  }
}

function seedWritingStyleStore(enabledStyleId: string | null) {
  io.files.set(`${PROJECT}/.qmai/writing-style.json`, JSON.stringify({
    version: 1,
    enabledStyleId,
    styles: [
      { id: "style-1", name: "测试作品 · 文风", sourceBook: "测试作品", profile: {}, createdAt: 1, updatedAt: 2 },
      { id: "style-keep", name: "另一本 · 文风", sourceBook: "另一本", profile: {}, createdAt: 1, updatedAt: 2 },
    ],
  }))
}

function seedPlotFrameworkLibrary() {
  io.files.set(getPlotFrameworkLibraryPath(PROJECT), JSON.stringify({
    version: 1,
    frameworks: [
      {
        id: "wb-story-book-1", title: "测试作品 · 故事机制", line: "main", rangeChapterIds: [],
        beats: { hook: "开场", buildup: "升级", payoff: "兑现", endingHook: "悬念" },
        characters: [], foreshadowing: [], reusableTemplate: "", directionHints: "", handcraftHints: "",
        createdAt: 1, updatedAt: 1,
      },
      {
        id: "other-framework", title: "另一本的框架", line: "main", rangeChapterIds: [],
        beats: { hook: "开场", buildup: "升级", payoff: "兑现", endingHook: "悬念" },
        characters: [], foreshadowing: [], reusableTemplate: "", directionHints: "", handcraftHints: "",
        createdAt: 2, updatedAt: 2,
      },
    ],
  }))
}

beforeEach(() => {
  io.files.clear()
  io.auras = []
  io.deleteAura.mockClear()
})

describe("拆书条目删除：技能页分派", () => {
  it("角色页删掉的是灵魂库里那条真实条目（按与发布相同的同源判据解析），只标记该对象", async () => {
    io.auras = [auraFixture("custom-1700-abc123", "许七安", "来自拆书作品《测试作品》的可迁移人格。")]
    const next = await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision: charactersRevision(), subject: "许七安",
    })
    // 发布时决定「这条属于谁」用的就是 isSameBookAnalysisCharacterAura；
    // 删除必须落到同一条上，否则库里会留下删不掉的孤儿灵魂。
    expect(io.deleteAura).toHaveBeenCalledWith(PROJECT, "custom-1700-abc123")
    expect(io.auras).toEqual([])
    expect(next.removedSubjects).toEqual(["许七安"])
  })

  it("库里条目的 id 就是 workbenchAuraId(subject) 时按该确定性 id 删除（发布/删除同一推导）", async () => {
    const deterministicId = await workbenchAuraId("许七安")
    expect(deterministicId).toMatch(/^wb-[0-9a-f]{16}$/)
    // 刻意不给来源备注：这条只能靠确定性 id 命中，证明删除路径确实握有同一个 id。
    io.auras = [auraFixture(deterministicId, "许七安", "")]
    await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision: charactersRevision(), subject: "许七安",
    })
    expect(io.deleteAura).toHaveBeenCalledWith(PROJECT, deterministicId)
    expect(io.auras).toEqual([])
  })

  it("角色页删除库里不存在的对象不抛错，版本记录照常写入", async () => {
    const next = await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision: charactersRevision(), subject: "许七安",
    })
    expect(next.removedSubjects).toEqual(["许七安"])
    expect(io.deleteAura).toHaveBeenCalledWith(PROJECT, await workbenchAuraId("许七安"))
  })

  it("文风页删任一对象即删掉整版预设，并标记该版本全部 subject（含清空启用项）", async () => {
    seedWritingStyleStore("style-1")
    const next = await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision: styleRevision(), subject: "叙事声音",
    })
    const store = await loadWritingStyleStore(PROJECT)
    // 整版只有一个预设：删任一对象都是删它，否则会出现「预设已删、同版另一个对象还显示着」。
    expect(store.styles.map((preset) => preset.id)).toEqual(["style-keep"])
    expect(store.enabledStyleId).toBeNull()
    expect(next.removedSubjects).toEqual(["文风", "叙事声音"])
  })

  it("故事页删任一对象即删掉确定性的故事框架，并标记该版本全部 subject", async () => {
    seedPlotFrameworkLibrary()
    expect(workbenchStoryFrameworkId("book-1")).toBe("wb-story-book-1")
    const next = await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision: storyRevision(), subject: "悬念投放",
    })
    const library = await loadPlotFrameworkLibrary(PROJECT)
    expect(library.frameworks.map((framework) => framework.id)).toEqual(["other-framework"])
    expect(next.removedSubjects).toEqual(["结构机制", "悬念投放"])
  })

  it("重复删除同一对象是幂等的：removedSubjects 不重复追加", async () => {
    io.auras = [auraFixture("custom-1700-abc123", "许七安", "来自拆书作品《测试作品》的可迁移人格。")]
    const revision = charactersRevision({ removedSubjects: ["许七安"] })
    const next = await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision, subject: "许七安",
    })
    expect(next.removedSubjects).toEqual(["许七安"])
  })

  it("未知技能页必须抛错，且不产生任何删除副作用", async () => {
    const revision = charactersRevision({ skill: "unknown-skill" as never })
    await expect(removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision, subject: "许七安",
    })).rejects.toThrow("未知技能页")
    expect(io.deleteAura).not.toHaveBeenCalled()
  })

  it("删除结果已落盘：重新读出该版本仍能看到 removedSubjects", async () => {
    io.auras = [auraFixture("custom-1700-abc123", "许七安", "来自拆书作品《测试作品》的可迁移人格。")]
    const revision = charactersRevision()
    const next = await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision, subject: "许七安",
    })
    const stored = await loadWorkbenchRevisions(BOOK_PATH)
    expect(stored.find((item) => item.id === revision.id)?.removedSubjects).toEqual(["许七安"])
    expect(next.removedSubjects).toEqual(["许七安"])
  })
})

/**
 * 「发布 id」与「删除 id」同源守卫（设计 §6.2，实施中修正）。
 *
 * 原设计假设 aura id 是 `wb-${sha256(subject)}`，实测不成立：
 * createCustomCharacterAuraFromGeneratedSkill 用的是 `custom-${now}-${random}`
 * （character-aura.ts:432），wb- 形式只在 publishWorkbenchCharacter 里赋给一个
 * 从不外传的临时 ExtractedCharacter.id。因此下面这组用例钉的是**行为结论**：
 * 确认入库后拿 publishedIds 找得到真实条目，删除必须落到同一条上。
 */
describe("发布与删除同源守卫", () => {
  function publishableRevision(): WorkbenchRevision {
    return charactersRevision({
      items: [{
        subject: "许七安", summary: "先核对再判断", limitations: "只覆盖本章",
        rules: [{
          id: "R1", dimension: "mentalModel", observation: "核对", condition: "信息不足",
          action: "先核对再判断", boundary: "例外未知", evidenceIds: [],
        }],
      }],
    })
  }

  it("确认入库后 publishedIds 里的真实条目，能被删除路径真删掉", async () => {
    io.auras = [auraFixture("custom-abc123", "许七安", "来自拆书作品《测试作品》的可迁移人格。")]
    const revision = publishableRevision()
    await saveWorkbenchRevision(BOOK_PATH, revision)
    const preview = await inspectWorkbenchPublication(PROJECT, revision)
    const confirmed = await confirmWorkbenchRevision(PROJECT, BOOK_PATH, revision.id, preview.fingerprint)
    expect(confirmed.publishedIds).toEqual(["custom-abc123"])

    await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision: confirmed, subject: "许七安",
    })
    expect(io.auras.map((aura) => aura.id)).toEqual([])
  })

  it("反证：只按 workbenchAuraId 删，真实条目仍在库里（所以必须解析真实 id）", async () => {
    // 真实场景的库条目：id 是发布时生成的 custom-...，书名只在来源备注里。
    io.auras = [auraFixture("custom-abc123", "许七安", "来自拆书作品《测试作品》的可迁移人格。")]
    const deterministicId = await workbenchAuraId("许七安")
    // 直接调底层删除接口 + 「同源推导出的 id」，模拟「只改了一半」的未来实现。
    await deleteCustomCharacterAura(PROJECT, deterministicId)
    expect(io.auras.map((aura) => aura.id)).toEqual(["custom-abc123"])

    // 同一份数据换成走删除路径：这次必须真的删掉。
    await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision: charactersRevision(), subject: "许七安",
    })
    expect(io.auras.map((aura) => aura.id)).toEqual([])
  })

  it("库里存在两条同 (书名, 角色名) 的灵魂时两条都要删掉，不留同名残留", async () => {
    // 新版发布与 legacy 导入是两套 id 体系，同一本书同一个人可能各留一条。
    io.auras = [
      auraFixture("custom-old1", "许七安", "来自拆书作品《测试作品》的可迁移人格。"),
      auraFixture("custom-old2", "许七安", "来自拆书作品《测试作品》的角色分析。"),
      auraFixture("custom-other", "许七安", "来自拆书作品《另一本书》的可迁移人格。"),
    ]
    await removeWorkbenchRevisionItem({
      projectPath: PROJECT, bookPath: BOOK_PATH, revision: charactersRevision(), subject: "许七安",
    })
    expect(io.auras.map((aura) => aura.id)).toEqual(["custom-other"])
    expect(io.deleteAura).toHaveBeenCalledTimes(2)
  })
})
