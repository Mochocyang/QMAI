import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { AnalysisChunkRecord, BookAnalysisPipelineTask } from "./analysis-pipeline-types"
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
function input(id: string, forceRefresh = false) {
  const task: BookAnalysisPipelineTask = {
    version: 1, id, bookId: "book-1", bookPath, projectPath: "C:/cache-acceptance", batchId: null,
    selectedSkills: ["style"], range: { startOrder: 1, endOrder: 2 }, status: "queued", currentSkill: null,
    forceRefresh, createdAt: 1, updatedAt: 1, startedAt: null, completedAt: null, error: null,
    modules: Object.fromEntries(["characters", "story", "style"].map((skill) => [skill, {
      skill, status: skill === "style" ? "pending" : "skipped", range: { startOrder: 1, endOrder: 2 },
      chunkIds: ["chunk-1", "chunk-2"], completedChunkIds: [], failedChunkId: null, resultPath: null, analysisVersion: 1, updatedAt: 1,
    }])) as BookAnalysisPipelineTask["modules"],
  }
  const chunks: AnalysisChunkRecord[] = [1, 2].map((order) => ({ version: 1, id: `chunk-${order}`, taskId: id, skill: "style",
    chapterIds: [`ch-${order}`], startOrder: order, endOrder: order, wordCount: 1000, status: "pending", attempts: 0,
    resultPath: null, error: null, startedAt: null, completedAt: null, updatedAt: 1 }))
  return { task, chunks }
}
beforeEach(() => { fake.files.clear(); fake.requests = 0 })

describe("完整重复拆书流程的模型调用验收", () => {
  it("两区块+汇总+后台验证首轮4次，普通重复0次，明确重提再次4次且总账不混算", async () => {
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
      for (const [id, force, expected] of [["cold", false, 4], ["warm", false, 4], ["refresh", true, 8]] as const) {
        const { task, chunks } = input(id, force)
        await scheduler.enqueue(task, chunks)
        await Promise.all(spy.mock.results.map((result) => result.value))
        await scheduler.whenIdle()
        expect(fake.requests).toBe(expected)
        expect(scheduler.getSnapshot().tasks.find((value) => value.id === id)?.status).toBe("completed")
      }
      expect(scheduler.getSnapshot().tasks.map((task) => task.requestUsageTotals?.requestCount)).toEqual([4, 0, 4])
      const saved = JSON.parse(fake.files.get(`${bookPath}/analysis/tasks/cold.json`)!)
      expect(saved.requestUsageTotals).toMatchObject({ requestCount: 4, inputTokens: 400, cachedInputTokens: 320 })
      expect(saved.status).toBe("completed")
    } finally { spy.mockRestore(); await scheduler.dispose() }
  })
})
