import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { AnalysisChunkRecord, AnalysisModuleState, AnalysisSkill, AnalysisSkillStatus, BookAnalysisPipelineTask } from "./analysis-pipeline-types"
import type { AnalysisSkillAdapter } from "./analysis-skill-adapter"
import { createAnalysisScheduler } from "./analysis-scheduler"
import { createStyleAnalysisAdapter } from "./style-analysis-adapter"
import * as verification from "./verification-engine"

const fake = vi.hoisted(() => ({ files: new Map<string, string>(), requests: 0 }))
vi.mock("@/commands/fs", async (original) => ({ ...await original<typeof import("@/commands/fs")>(),
  readFile: async (path: string) => { if (!fake.files.has(path)) throw new Error("模拟文件不存在"); return fake.files.get(path)! },
  writeFile: async (path: string, text: string) => { fake.files.set(path, text) },
  writeFileAtomic: async (path: string, text: string) => { fake.files.set(path, text) },
  fileExists: async (path: string) => fake.files.has(path), createDirectory: async () => {}, listDirectory: async () => [],
}))
vi.mock("@/lib/llm-client", () => ({ streamChat: vi.fn(async (_config, messages, callbacks) => {
  fake.requests += 1
  const text = JSON.stringify(messages)
  const output = text.includes("质量审计员") ? {
    triple: ["crossDomain", "predictive", "unique"].map((key) => ({ key, status: "pass", detail: "证据完整", evidenceCount: 2 })),
    pressure: ["apply", "boundary", "confusion"].map((kind) => ({ kind, prompt: "验证场景", verdict: "pass", reason: "边界清楚" })),
  } : { constitution: "1. 用短句推进，避免重复解释", narrativeDensity: "紧凑", samples: ["原文里的动作。"], evidence: [] }
  callbacks.onToken(JSON.stringify(output)); callbacks.onDone()
  callbacks.onRequestTrace?.({ requestId: `mock-${fake.requests}`, provider: "openai", model: "test", apiMode: "chat_completions",
    startedAt: fake.requests, finishedAt: fake.requests + 1, durationMs: 1, status: "success", inputTokens: 100, outputTokens: 10, cacheReadTokens: 80 })
}) }))
vi.mock("@/lib/user-memory/store", async (original) => {
  const actual = await original<typeof import("@/lib/user-memory/store")>()
  return { ...actual, loadGlobalUserMemoryConfig: () => actual.normalizeGlobalUserMemoryConfig({ enabled: false }) }
})
vi.mock("@/lib/local-cli-config", () => ({ resolveRuntimeLocalCliConfig: async (config: LlmConfig) => config }))

const bookPath = "C:/cache-acceptance/book-analysis/book-1"
const config = { provider: "openai", model: "test", apiKey: "fixture", maxContextSize: 64000 } as LlmConfig
// 按 AnalysisModuleState 的真实契约构造模块状态。之前用 Object.fromEntries + as 强断，
// 推断出的字面量类型（skill: string）与 Record<AnalysisSkill, ...> 毫无重叠，才报 TS2352。
function moduleState(skill: AnalysisSkill, status: AnalysisSkillStatus): AnalysisModuleState {
  return { skill, status, range: { startOrder: 1, endOrder: 2 }, chunkIds: ["chunk-1", "chunk-2"],
    completedChunkIds: [], failedChunkId: null, resultPath: null, analysisVersion: 1, updatedAt: 1 }
}
function input(id: string, forceRefresh = false) {
  const task: BookAnalysisPipelineTask = {
    version: 1, id, bookId: "book-1", bookPath, projectPath: "C:/cache-acceptance", batchId: null,
    selectedSkills: ["style"], range: { startOrder: 1, endOrder: 2 }, status: "queued", currentSkill: null,
    forceRefresh, createdAt: 1, updatedAt: 1, startedAt: null, completedAt: null, error: null,
    modules: {
      characters: moduleState("characters", "skipped"),
      story: moduleState("story", "skipped"),
      style: moduleState("style", "pending"),
    },
  }
  const chunks: AnalysisChunkRecord[] = [1, 2].map((order) => ({ version: 1, id: `chunk-${order}`, taskId: id, skill: "style",
    chapterIds: [`ch-${order}`], startOrder: order, endOrder: order, wordCount: 1000, status: "pending", attempts: 0,
    resultPath: null, error: null, startedAt: null, completedAt: null, updatedAt: 1 }))
  return { task, chunks }
}
beforeEach(() => { fake.files.clear(); fake.requests = 0 })

describe("完整重复拆书流程的模型调用验收", () => {
  // 期望值口径：本用例的任务**不写** styleDepth，按 analysis-pipeline-types.ts:116
  // 的契约「留空按 DEFAULT_STYLE_ANALYSIS_DEPTH 处理」取默认值 "full"。full 深度下每个
  // 文风区块走 L1 语言 + L2 章节结构 + L3-L5 认知框架共 3 次调用（style-analysis-adapter.ts:261,300），
  // 故首轮 = 2 区块 × 3 + 汇总 1 + 后台验证 1 = 8 次（fast 深度才是每区块 1 次 = 4 次）。
  it("两区块×三层+汇总+后台验证首轮8次，普通重复0次，明确重提再次8次且总账不混算", async () => {
    const metadata = { title: "模拟作品", totalChapters: 2, totalWords: 2000, sourceType: "file" as const, createdAt: 1, updatedAt: 1 }
    fake.files.set(`${bookPath}/metadata.json`, JSON.stringify(metadata))
    for (const order of [1, 2]) fake.files.set(`${bookPath}/chapters/ch-${order}.md`, `---\ntitle: 第${order}章\norder: ${order}\n---\n` + "原文里的动作。".repeat(150))
    const adapter = createStyleAnalysisAdapter({ loadMetadata: async () => metadata,
      upsertPreset: vi.fn(), replaceEvidence: vi.fn(), loadManifest: async () => null, saveManifest: vi.fn(), rebuildContextIndex: vi.fn(),
    })
    const scheduler = createAnalysisScheduler({ llmConfig: config,
      adapters: { style: adapter, characters: {} as AnalysisSkillAdapter, story: {} as AnalysisSkillAdapter },
    })
    const spy = vi.spyOn(verification, "scheduleVerification")
    try {
      // fake.requests 是**累计**计数：cold 8 次 → warm 命中缓存不新增仍为 8 → refresh 强制重提再 +8 = 16。
      for (const [id, force, expected] of [["cold", false, 8], ["warm", false, 8], ["refresh", true, 16]] as const) {
        const { task, chunks } = input(id, force)
        await scheduler.enqueue(task, chunks)
        await Promise.all(spy.mock.results.map((result) => result.value))
        await scheduler.whenIdle()
        expect(fake.requests).toBe(expected)
        expect(scheduler.getSnapshot().tasks.find((value) => value.id === id)?.status).toBe("completed")
      }
      expect(scheduler.getSnapshot().tasks.map((task) => task.requestUsageTotals?.requestCount)).toEqual([8, 0, 8])
      const saved = JSON.parse(fake.files.get(`${bookPath}/analysis/tasks/cold.json`)!)
      expect(saved.requestUsageTotals).toMatchObject({ requestCount: 8, inputTokens: 800, cachedInputTokens: 640 })
      expect(saved.status).toBe("completed")
    } finally { spy.mockRestore(); await scheduler.dispose() }
  })
})
