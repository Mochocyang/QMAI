import { beforeEach, describe, expect, it, vi } from "vitest"

const fs = vi.hoisted(() => ({ files: new Map<string, string>(), failPath: "" }))
vi.mock("@/commands/fs", () => {
  const exists = (path: string) => fs.files.has(path) || [...fs.files.keys()].some((file) => file.startsWith(path + "/"))
  const tree = (path: string): unknown[] => {
    const names = new Set([...fs.files.keys()].filter((p) => p.startsWith(path + "/")).map((p) => p.slice(path.length + 1).split("/")[0]))
    return [...names].map((name) => {
      const child = `${path}/${name}`, directory = !fs.files.has(child)
      return { name, path: child, is_dir: directory, ...(directory ? { children: tree(child) } : {}) }
    })
  }
  const write = async (path: string, text: string) => {
    if (fs.failPath === path) { fs.failPath = ""; throw new Error("模拟写盘失败") }
    fs.files.set(path, text)
  }
  return {
    fileExists: vi.fn(async (path: string) => exists(path)),
    readFile: vi.fn(async (path: string) => { if (!fs.files.has(path)) throw new Error(`Missing ${path}`); return fs.files.get(path)! }),
    writeFile: vi.fn(write), writeFileAtomic: vi.fn(write), createDirectory: vi.fn(async () => {}),
    deleteFile: vi.fn(async (path: string) => { fs.files.delete(path) }),
    listDirectory: vi.fn(async (path: string) => tree(path)),
  }
})
vi.mock("@/lib/llm-client", () => ({ streamChat: vi.fn(), DEFAULT_LLM_REQUEST_TIMEOUT_MS: 30000 }))
vi.mock("@/lib/embedding", () => ({ removePageEmbeddingStrict: vi.fn(async () => {}), embedPage: vi.fn(), searchByEmbedding: vi.fn(async () => []) }))

import { useWikiStore } from "@/stores/wiki-store"
import { applyMemoryCleanup, loadMemoryCleanupScan, runMemoryCleanupScan, undoLastMemoryCleanup } from "./memory-cleanup-runner"
import { collectMemoryRecords, type MemoryCleanupIssue, type MemoryCleanupScan } from "./memory-cleanup"
import { loadSnapshot, rebuildDerivedMemoryFromSnapshots, syncSnapshotToMemory, type ChapterSnapshot } from "./chapter-ingest"
import { DEFAULT_MEMORY_MAINTENANCE, REMINDER_COOLDOWN_MS, claimMemoryMaintenanceReminder, loadMemoryMaintenanceSettings, loadMemoryMaintenanceOverview, memoryMaintenanceWarnings, shouldRemindMemoryMaintenance, updateMemoryMaintenanceSettings } from "./memory-maintenance"
import { streamChat } from "@/lib/llm-client"
import { removePageEmbeddingStrict, embedPage } from "@/lib/embedding"
import { syncPersonaSkillChapterFacts } from "./persona-skill-facts"

const source = (n: number): ChapterSnapshot => ({
  chapterId: `chapter-${n}`, chapterNumber: n, revision: 1, summary: "已发生的剧情", characters: ["林默"], locations: [], organizations: [], items: [], events: [],
  characterStateChanges: [`林默：${n === 1 ? "状态噪声" : "健康"}`], relationshipChanges: [], knowledgeChanges: [`林默知道${n === 1 ? "认知噪声" : "密室位置"}`],
  foreshadowingChanges: [`新增：${n === 1 ? "伏笔噪声" : "钟楼钥匙"}`], newCanonFacts: [n === 1 ? "事实噪声" : "本世界存在魔法"], timelineEvents: [n === 1 ? "时间噪声" : "正式事件"], conflicts: [n === 1 ? "冲突噪声" : "正式冲突"], endingHook: "", graphNodes: [], graphEdges: [],
})
const snapPath = (n: number) => `/project/.novel/snapshots/00${n}.snapshot.json`
async function scanFixture(): Promise<MemoryCleanupScan> {
  const snapshots = (await Promise.all([loadSnapshot("/project", 1), loadSnapshot("/project", 2)])).filter((s): s is ChapterSnapshot => !!s)
  const records = collectMemoryRecords(snapshots)
  return { version: 1, scannedAt: Date.now(), records, issues: records.filter((r) => r.chapterNumber === 1).map((r) => ({ id: r.id, kind: "noise", removeIds: [r.id], reason: "误提取", confidence: "high" })) }
}
beforeEach(async () => {
  vi.clearAllMocks(); fs.files.clear(); fs.failPath = ""
  useWikiStore.setState({ novelMode: true, embeddingConfig: { ...useWikiStore.getState().embeddingConfig, enabled: false } })
  for (const n of [1, 2]) fs.files.set(snapPath(n), JSON.stringify(source(n)))
  fs.files.set("/project/wiki/entities/林默.md", "---\ntype: entity\n---\n# 林默\n\n## 章节信息\n- **角色认知**: 认知噪声\n\n## 作者备注\n私有设定保留\n")
  await rebuildDerivedMemoryFromSnapshots("/project")
})

describe("来源删除与派生文件同步", () => {
  it("只清理认知时，保留其他类别的运行状态及手工补充", async () => {
    const scan = await scanFixture()
    const state = JSON.stringify({ characters: [{ characterName: "林默", currentLocation: "作者指定地点", status: "作者补充状态", equipment: ["手工装备"], abilities: [], relationships: {}, lastUpdatedChapter: 2, lastUpdatedAt: "" }], lastUpdated: "" })
    fs.files.set("/project/.novel/character-states.json", state)
    const timeline = fs.files.get("/project/.novel/timeline.json")
    const selected = scan.issues.filter((issue) => scan.records.find((r) => r.id === issue.removeIds[0])?.field === "knowledgeChanges")
    await applyMemoryCleanup("/project", scan, selected)
    expect(fs.files.get("/project/.novel/character-states.json")).toBe(state)
    expect(fs.files.get("/project/.novel/timeline.json")).toBe(timeline)
    expect(fs.files.get("/project/wiki/tracking/角色状态.md")).toContain("作者补充状态")
  })
  it("清理六类来源并同步全部派生文件；重提取及重建也不恢复已删条目", async () => {
    const scan = await scanFixture()
    await expect(applyMemoryCleanup("/project", scan, scan.issues)).resolves.toBe(6)
    const snapshot = JSON.parse(fs.files.get(snapPath(1))!)
    for (const field of ["knowledgeChanges", "characterStateChanges", "foreshadowingChanges", "timelineEvents", "newCanonFacts", "conflicts"]) expect(snapshot[field]).toEqual([])
    for (const [path, text] of fs.files) if (/\/(?:wiki\/(?:memory|tracking|entities)|retrieval)\//.test(path)) expect(text, path).not.toContain("噪声")
    expect(fs.files.get("/project/wiki/entities/林默.md")).toContain("私有设定保留")
    expect(fs.files.get("/project/.novel/snapshots/001.snapshot.md")).not.toContain("噪声")
    expect(fs.files.get("/project/.novel/chapter-ingest-output/001.output.json")).not.toContain("噪声")
    const reextracted = source(1)
    await syncSnapshotToMemory("/project", reextracted)
    await rebuildDerivedMemoryFromSnapshots("/project")
    expect(reextracted.knowledgeChanges).toEqual([])
    expect(fs.files.get(snapPath(1))).not.toContain("噪声")
    expect(fs.files.get("/project/.novel/cognition-state.json")).not.toContain("噪声")
    expect(fs.files.get("/project/wiki/memory/character-cognition.md")).toContain("密室位置")
  })
  it("扫描后来源修订变化时，在写入任何清理记录前拒绝执行", async () => {
    const scan = await scanFixture()
    fs.files.set(snapPath(1), JSON.stringify({ ...source(1), revision: 2 }))
    await expect(applyMemoryCleanup("/project", scan, scan.issues)).rejects.toThrow("已变化")
    expect(fs.files.has("/project/.novel/memory-cleanup.json")).toBe(false)
  })
  it("派生同步失败会恢复来源、JSON、Markdown，并清除本次新建检索文件", async () => {
    const scan = await scanFixture(), before = new Map(fs.files)
    fs.failPath = "/project/wiki/entities/林默.md"
    await expect(applyMemoryCleanup("/project", scan, scan.issues)).rejects.toThrow("已恢复")
    for (const [path, text] of before) expect(fs.files.get(path), path).toBe(text)
    expect(fs.files.has("/project/.novel/memory-cleanup.json")).toBe(false)
    expect([...fs.files.keys()].some((path) => path.startsWith("/project/retrieval/"))).toBe(false)
  })
  it("撤销恢复所有备份；若清理后用户修改过文件则拒绝覆盖", async () => {
    const before = fs.files.get(snapPath(1)), scan = await scanFixture()
    await applyMemoryCleanup("/project", scan, scan.issues)
    await undoLastMemoryCleanup("/project")
    expect(fs.files.get(snapPath(1))).toBe(before)
    expect(fs.files.has("/project/.novel/memory-cleanup.json")).toBe(false)
    const again = await scanFixture()
    await applyMemoryCleanup("/project", again, again.issues)
    fs.files.set("/project/wiki/entities/林默.md", "用户的新内容")
    await expect(undoLastMemoryCleanup("/project")).rejects.toThrow("新变化")
    expect(fs.files.get("/project/wiki/entities/林默.md")).toBe("用户的新内容")
  })
  it("多组候选互相删除保留依据时拒绝执行", async () => {
    const scan = await scanFixture(), [a, b] = scan.records.filter((r) => r.field === "knowledgeChanges")
    const issues: MemoryCleanupIssue[] = [{ id: "a", kind: "duplicate", removeIds: [a.id], keepId: b.id, reason: "重复", confidence: "high" }, { id: "b", kind: "noise", removeIds: [b.id], reason: "噪声", confidence: "high" }]
    await expect(applyMemoryCleanup("/project", scan, issues)).rejects.toThrow("冲突")
  })
  it("模型输出只产生可审查候选，不在扫描阶段写来源", async () => {
    vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => { callbacks.onToken('{"issues":[]}'); callbacks.onDone?.() })
    const before = fs.files.get(snapPath(1))
    const scan = await runMemoryCleanupScan("/project", useWikiStore.getState().llmConfig, { fields: ["knowledgeChanges"] })
    expect(scan.records).toHaveLength(2)
    expect(scan.issues).toEqual([])
    expect(fs.files.get(snapPath(1))).toBe(before)
  })
  it("范围扫描只返回指定正文章节，范围外新增记忆不使结果过期", async () => {
    vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => { callbacks.onToken('{"issues":[]}'); callbacks.onDone?.() })
    const scan = await runMemoryCleanupScan("/project", useWikiStore.getState().llmConfig, { fields: ["knowledgeChanges"], scope: { fromChapter: 1, toChapter: 1 } })
    expect(scan.scanId).toBeTruthy()
    expect(scan.records).toHaveLength(1)
    fs.files.set(snapPath(2), JSON.stringify({ ...source(2), revision: 2 }))
    expect((await loadMemoryCleanupScan("/project"))?.scanId).toBe(scan.scanId)
    const issue: MemoryCleanupIssue = { id: "scope", kind: "noise", removeIds: [scan.records[0].id], reason: "误提取", confidence: "high" }
    expect(await applyMemoryCleanup("/project", scan, [issue])).toBe(1)
    expect((await loadSnapshot("/project", 2))?.knowledgeChanges).toEqual(source(2).knowledgeChanges)
  })
  it("撤销不检查或覆盖本次未改动的文件", async () => {
    const path = "/project/retrieval/notes.txt"
    fs.files.set(path, "与清理无关")
    const scan = await scanFixture()
    await applyMemoryCleanup("/project", scan, scan.issues)
    fs.files.set(path, "清理后新增的有效笔记")
    await expect(undoLastMemoryCleanup("/project")).resolves.toBeUndefined()
    expect(fs.files.get(path)).toBe("清理后新增的有效笔记")
  })
  it("同步人物 Skill 动态事实，迟到的后台学习也不能恢复已删认知", async () => {
    fs.files.set("/project/.qmai/persona-skills/index.json", JSON.stringify({ version: 1, skills: [{ id: "林默", characterName: "林默", aliases: [], roleType: "主角", tier: "major", status: "active", firstChapter: 1, lastChapter: 2, appearanceCount: 2, createdChapter: 1, lastLearnedChapter: 2, skillRevision: 1, pinned: false, editedByUser: false, hasResearch: false, updatedAt: "" }] }))
    const path = "/project/.qmai/persona-skills/林默/SKILL.md"
    fs.files.set(path, "# 林默\n\n## 当前状态\n\n第 1 章：状态噪声\n\n## 认知变化\n\n- 第 1 章：知道认知噪声\n\n## 作者备注\n\n自定义文字\n")
    const scan = await scanFixture()
    await applyMemoryCleanup("/project", scan, scan.issues)
    expect(fs.files.get(path)).not.toContain("噪声")
    expect(fs.files.get(path)).toContain("自定义文字")
    await syncPersonaSkillChapterFacts("/project", source(1))
    expect(fs.files.get(path)).not.toContain("噪声")
  })
  it("清除旧向量；索引失效失败时报告错误并恢复文件", async () => {
    fs.files.set("/project/.qmai/lancedb/.keep", "")
    const scan = await scanFixture(), before = fs.files.get(snapPath(1))
    vi.mocked(removePageEmbeddingStrict).mockRejectedValueOnce(new Error("向量索引不可写"))
    await expect(applyMemoryCleanup("/project", scan, scan.issues)).rejects.toThrow("向量索引不可写")
    expect(fs.files.get(snapPath(1))).toBe(before)
    expect(removePageEmbeddingStrict).toHaveBeenCalled()
  })
  it("启用向量检索时，用清理后的内容重新索引，保留有效事实的语义召回", async () => {
    fs.files.set("/project/.qmai/lancedb/.keep", "")
    useWikiStore.setState({ embeddingConfig: { ...useWikiStore.getState().embeddingConfig, enabled: true, model: "embed" } })
    vi.mocked(embedPage).mockResolvedValue(true)
    const scan = await scanFixture()
    await applyMemoryCleanup("/project", scan, scan.issues)
    expect(embedPage).toHaveBeenCalled()
    for (const call of vi.mocked(embedPage).mock.calls) expect(call[3]).not.toContain("噪声")
    expect(vi.mocked(embedPage).mock.calls.some((call) => call[3].includes("密室位置"))).toBe(true)
  })
  it("旧向量清除后，嵌入服务不可用只警告，不撤回已经完成的来源清理", async () => {
    fs.files.set("/project/.qmai/lancedb/.keep", "")
    useWikiStore.setState({ embeddingConfig: { ...useWikiStore.getState().embeddingConfig, enabled: true, model: "embed" } })
    vi.mocked(embedPage).mockResolvedValue(false)
    const scan = await scanFixture(), log = vi.fn()
    await expect(applyMemoryCleanup("/project", scan, scan.issues, log)).resolves.toBe(6)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("警告：旧向量已清除"))
    expect(removePageEmbeddingStrict).toHaveBeenCalled()
    expect((await loadSnapshot("/project", 1))?.knowledgeChanges).toEqual([])
    await expect(undoLastMemoryCleanup("/project", log)).resolves.toBeUndefined()
    expect((await loadSnapshot("/project", 1))?.knowledgeChanges).toEqual(source(1).knowledgeChanges)
  })
  it("只删伏笔时不重写不受影响的人物实体", async () => {
    const path = "/project/wiki/entities/林默.md", before = fs.files.get(path)
    const scan = await scanFixture()
    await applyMemoryCleanup("/project", scan, scan.issues.filter((issue) => scan.records.find((r) => r.id === issue.removeIds[0])?.field === "foreshadowingChanges"))
    expect(fs.files.get(path)).toBe(before)
  })
})

describe("自动超量提醒", () => {
  it("边界值不提醒，条目或文本超过阈值才提醒，支持关闭和冷却", () => {
    const prefs = DEFAULT_MEMORY_MAINTENANCE
    const overview = { counts: { ...prefs.limits }, cognitionChars: prefs.cognitionChars, totalForeshadowing: 1000 }
    expect(memoryMaintenanceWarnings(overview, prefs)).toEqual([])
    expect(shouldRemindMemoryMaintenance({ ...overview, cognitionChars: prefs.cognitionChars + 1 }, prefs)).toBe(true)
    expect(shouldRemindMemoryMaintenance({ ...overview, cognitionChars: 99999 }, { ...prefs, enabled: false })).toBe(false)
    expect(shouldRemindMemoryMaintenance({ ...overview, cognitionChars: 99999 }, { ...prefs, lastRemindedAt: 1000 }, REMINDER_COOLDOWN_MS)).toBe(false)
  })
  it("项目隔离，提醒时间持久化，并发检查只提醒一次", async () => {
    const overview = { counts: { ...DEFAULT_MEMORY_MAINTENANCE.limits, cognition: 301 }, cognitionChars: 100, totalForeshadowing: 0 }
    const results = await Promise.all([claimMemoryMaintenanceReminder("/project", overview), claimMemoryMaintenanceReminder("/project", overview)])
    expect(results.filter((r) => r.length)).toHaveLength(1)
    expect((await loadMemoryMaintenanceSettings("/project")).lastRemindedAt).toBeGreaterThan(0)
    expect(await claimMemoryMaintenanceReminder("/other", overview)).not.toEqual([])
    await updateMemoryMaintenanceSettings("/project", { enabled: false, limits: { ...DEFAULT_MEMORY_MAINTENANCE.limits, cognition: 500 } })
    expect((await loadMemoryMaintenanceSettings("/project")).lastRemindedAt).toBeGreaterThan(0)
    expect((await loadMemoryMaintenanceSettings("/project")).limits.cognition).toBe(500)
  })
  it("活跃伏笔数量不包含已回收和已放弃项", async () => {
    fs.files.set("/project/.novel/foreshadowing-tracker.json", JSON.stringify({ items: [{ status: "planted" }, { status: "resolved" }, { status: "abandoned" }], lastUpdated: "" }))
    expect((await loadMemoryMaintenanceOverview("/project")).counts.foreshadowing).toBe(1)
  })
})
