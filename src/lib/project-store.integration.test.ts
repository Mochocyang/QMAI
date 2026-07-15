/**
 * Tier 4 — real-FS integration tests for project-store per-project config persistence.
 *
 * Verifies that project-level configs (novelConfig, revisionFeedbackWindowConfig,
 * sourceWatchConfig) are correctly persisted to project-directory files in .qmai/
 * and correctly recovered when the global app store has no data (simulating reinstall).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { realFs, createTempProject, writeFileRaw, fileExists, readFileRaw } from "@/test-helpers/fs-temp"
import type { NovelConfig, RevisionFeedbackWindowConfig, SourceWatchConfig, RerankConfig } from "@/stores/wiki-store"
import type { McpConfig } from "@/lib/mcp/config"

vi.mock("@/commands/fs", () => realFs)

const inMemoryStore = new Map<string, unknown>()

vi.mock("@/lib/web-store", () => ({
  getStore: async () => ({
    get: async <T>(key: string): Promise<T | null> => {
      if (inMemoryStore.has(key)) return inMemoryStore.get(key) as T
      return null
    },
    set: async (key: string, value: unknown): Promise<void> => {
      inMemoryStore.set(key, value)
    },
    save: async (): Promise<void> => {},
  }),
}))

import {
  saveNovelConfig,
  loadNovelConfig,
  saveRerankConfig,
  loadRerankConfig,
  saveRevisionFeedbackWindowConfig,
  loadRevisionFeedbackWindowConfig,
  saveSourceWatchConfig,
  loadSourceWatchConfig,
  saveMcpConfig,
  loadMcpConfig,
} from "./project-store"

let tmp: { path: string; cleanup: () => Promise<void> }

beforeEach(async () => {
  tmp = await createTempProject("project-store")
  inMemoryStore.clear()
})

afterEach(async () => {
  await tmp.cleanup()
})

function makeNovelConfig(overrides: Partial<NovelConfig> = {}): NovelConfig {
  return {
    contextTokenBudget: 200000,
    recentSummaryWindow: 16,
    searchTopK: 20,
    chapterTargetChars: 3000,
    autoIngestOnSave: true,
    autoExtractOnImport: true,
    reviewBeforeSave: false,
    deepPreviousChaptersAnalysis: false,
    deepChapterReview: true,
    reviewReasoningEffort: "high",
    writingModel: "claude-4-sonnet",
    reviewModel: "claude-4-sonnet",
    summaryModel: "claude-4-sonnet",
    extractModel: "claude-4-sonnet",
    communitySummaryEnabled: false,
    communitySummaryInterval: 5,
    communitySummaryAsync: false,
    autoGenerateChapterTitle: true,
    ...overrides,
    defaultLlmModel: overrides.defaultLlmModel ?? "",
    deAiModel: overrides.deAiModel ?? "",
    deAiBatchConcurrency: overrides.deAiBatchConcurrency ?? 3,
  }
}

function makeRevisionConfig(overrides: Partial<RevisionFeedbackWindowConfig> = {}): RevisionFeedbackWindowConfig {
  return {
    currentChapterIncludeShouldImprove: true,
    previousChapterCarryEnabled: true,
    lookbackChapterCount: 2,
    lookbackIncludeMustFixOnly: true,
    ...overrides,
  }
}

function makeSourceWatchConfig(overrides: Partial<SourceWatchConfig> = {}): SourceWatchConfig {
  return {
    enabled: true,
    autoIngest: true,
    includeExtensions: ["md", "txt"],
    excludeExtensions: ["tmp", "swp"],
    excludeDirs: [".git", "node_modules"],
    excludeGlobs: ["~$*"],
    maxFileSizeMb: 100,
    ...overrides,
  }
}

function makeRerankConfig(overrides: Partial<RerankConfig> = {}): RerankConfig {
  return {
    enabled: true,
    useMainLlm: false,
    provider: "custom",
    apiKey: "rerank-key",
    model: "rerank-model",
    ollamaUrl: "http://127.0.0.1:11434",
    customEndpoint: "http://127.0.0.1:1234/v1",
    apiMode: "chat_completions",
    maxCandidates: 14,
    ...overrides,
  }
}
function makeMcpConfig(): McpConfig {
  return {
    servers: [{
      id: "graph",
      name: "Knowledge Graph",
      enabled: true,
      tools: [{
        serverId: "graph",
        serverName: "Knowledge Graph",
        name: "query_graph",
        description: "Query graph",
        operation: "read",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "Query" } },
          required: ["query"],
        },
      }],
    }],
  }
}

describe("novelConfig — project-directory persistence", () => {
  it("round-trip save then load returns identical config", async () => {
    const config = makeNovelConfig({ contextTokenBudget: 100000, searchTopK: 15 })
    await saveNovelConfig(config, "proj-1", tmp.path)
    const loaded = await loadNovelConfig("proj-1", tmp.path)
    expect(loaded).toEqual(config)
  })

  it("persists to .qmai/novel-config.json", async () => {
    await saveNovelConfig(makeNovelConfig(), "proj-2", tmp.path)
    expect(await fileExists(`${tmp.path}/.qmai/novel-config.json`)).toBe(true)
    const raw = await readFileRaw(`${tmp.path}/.qmai/novel-config.json`)
    const parsed = JSON.parse(raw)
    expect(parsed.contextTokenBudget).toBe(200000)
  })

  it("returns null when neither file nor store has data", async () => {
    const loaded = await loadNovelConfig("proj-none", tmp.path)
    expect(loaded).toBeNull()
  })

  it("reinstall recovery: loads from project dir when global store is empty", async () => {
    const config = makeNovelConfig({ searchTopK: 15, writingModel: "custom-model" })
    await writeFileRaw(
      `${tmp.path}/.qmai/novel-config.json`,
      JSON.stringify(config),
    )
    const loaded = await loadNovelConfig("proj-r", tmp.path)
    expect(loaded?.searchTopK).toBe(15)
    expect(loaded?.writingModel).toBe("custom-model")
  })

  it("project dir file wins over global store (reinstall scenario)", async () => {
    inMemoryStore.set("projectNovelConfigs", { "proj-w": makeNovelConfig({ searchTopK: 5 }) })
    const dirConfig = makeNovelConfig({ searchTopK: 18, writingModel: "dir-model" })
    await writeFileRaw(
      `${tmp.path}/.qmai/novel-config.json`,
      JSON.stringify(dirConfig),
    )
    const loaded = await loadNovelConfig("proj-w", tmp.path)
    expect(loaded?.searchTopK).toBe(18)
    expect(loaded?.writingModel).toBe("dir-model")
  })

  it("migrates: when loaded from global store, writes to project dir", async () => {
    const config = makeNovelConfig({ searchTopK: 12, writingModel: "migrated-model" })
    inMemoryStore.set("projectNovelConfigs", { "proj-m": config })
    const loaded = await loadNovelConfig("proj-m", tmp.path)
    expect(loaded?.searchTopK).toBe(12)
    expect(loaded?.writingModel).toBe("migrated-model")
    expect(await fileExists(`${tmp.path}/.qmai/novel-config.json`)).toBe(true)
    const raw = await readFileRaw(`${tmp.path}/.qmai/novel-config.json`)
    expect(JSON.parse(raw).searchTopK).toBe(12)
  })

  it("fills in autoExtractOnImport when loading legacy novel config", async () => {
    const legacyConfig = {
      contextTokenBudget: 50000,
      recentSummaryWindow: 6,
      searchTopK: 8,
      autoIngestOnSave: false,
      reviewBeforeSave: true,
      writingModel: "writer",
      reviewModel: "reviewer",
      summaryModel: "summarizer",
      extractModel: "extractor",
    }
    await writeFileRaw(
      `${tmp.path}/.qmai/novel-config.json`,
      JSON.stringify(legacyConfig),
    )
    const loaded = await loadNovelConfig("proj-legacy", tmp.path)
    expect(loaded?.autoExtractOnImport).toBe(true)
  })
})

describe("revisionFeedbackWindowConfig — project-directory persistence", () => {
  it("round-trip save then load returns identical config", async () => {
    const config = makeRevisionConfig({ lookbackChapterCount: 5 })
    await saveRevisionFeedbackWindowConfig(config, "proj-3", tmp.path)
    const loaded = await loadRevisionFeedbackWindowConfig("proj-3", tmp.path)
    expect(loaded).toEqual(config)
  })

  it("persists to .qmai/revision-feedback-config.json", async () => {
    await saveRevisionFeedbackWindowConfig(makeRevisionConfig(), "proj-4", tmp.path)
    expect(await fileExists(`${tmp.path}/.qmai/revision-feedback-config.json`)).toBe(true)
  })

  it("returns defaults when neither file nor store has data", async () => {
    const loaded = await loadRevisionFeedbackWindowConfig("proj-none", tmp.path)
    expect(loaded).toEqual({
      currentChapterIncludeShouldImprove: true,
      previousChapterCarryEnabled: true,
      lookbackChapterCount: 2,
      lookbackIncludeMustFixOnly: true,
    })
  })

  it("reinstall recovery: loads from project dir when global store is empty", async () => {
    const config = makeRevisionConfig({ lookbackChapterCount: 8 })
    await writeFileRaw(
      `${tmp.path}/.qmai/revision-feedback-config.json`,
      JSON.stringify(config),
    )
    const loaded = await loadRevisionFeedbackWindowConfig("proj-r2", tmp.path)
    expect(loaded?.lookbackChapterCount).toBe(8)
  })

  it("project dir file wins over global store", async () => {
    inMemoryStore.set("projectRevisionFeedbackWindowConfigs", {
      "proj-x": makeRevisionConfig({ lookbackChapterCount: 1 }),
    })
    const dirConfig = makeRevisionConfig({ lookbackChapterCount: 10 })
    await writeFileRaw(
      `${tmp.path}/.qmai/revision-feedback-config.json`,
      JSON.stringify(dirConfig),
    )
    const loaded = await loadRevisionFeedbackWindowConfig("proj-x", tmp.path)
    expect(loaded?.lookbackChapterCount).toBe(10)
  })

  it("migrates: when loaded from global store, writes to project dir", async () => {
    const config = makeRevisionConfig({ lookbackChapterCount: 6 })
    inMemoryStore.set("projectRevisionFeedbackWindowConfigs", { "proj-m2": config })
    const loaded = await loadRevisionFeedbackWindowConfig("proj-m2", tmp.path)
    expect(loaded?.lookbackChapterCount).toBe(6)
    expect(await fileExists(`${tmp.path}/.qmai/revision-feedback-config.json`)).toBe(true)
  })
})

describe("sourceWatchConfig — project-directory persistence", () => {
  it("round-trip save then load returns identical config", async () => {
    const config = makeSourceWatchConfig({ enabled: true, maxFileSizeMb: 50 })
    await saveSourceWatchConfig(config, "proj-5", tmp.path)
    const loaded = await loadSourceWatchConfig("proj-5", tmp.path)
    expect(loaded).toEqual(config)
  })

  it("persists to .qmai/source-watch-config.json", async () => {
    await saveSourceWatchConfig(makeSourceWatchConfig(), "proj-6", tmp.path)
    expect(await fileExists(`${tmp.path}/.qmai/source-watch-config.json`)).toBe(true)
  })

  it("returns defaults when neither file nor store has data", async () => {
    const loaded = await loadSourceWatchConfig("proj-none", tmp.path)
    expect(loaded.enabled).toBe(true)
    expect(loaded.autoIngest).toBe(true)
  })

  it("reinstall recovery: loads from project dir when global store is empty", async () => {
    const config = makeSourceWatchConfig({ enabled: true, maxFileSizeMb: 42 })
    await writeFileRaw(
      `${tmp.path}/.qmai/source-watch-config.json`,
      JSON.stringify(config),
    )
    const loaded = await loadSourceWatchConfig("proj-r3", tmp.path)
    expect(loaded.enabled).toBe(true)
    expect(loaded.maxFileSizeMb).toBe(42)
  })

  it("project dir file wins over global store", async () => {
    inMemoryStore.set("sourceWatchConfig", { "proj-y": makeSourceWatchConfig({ enabled: false }) })
    const dirConfig = makeSourceWatchConfig({ enabled: true })
    await writeFileRaw(
      `${tmp.path}/.qmai/source-watch-config.json`,
      JSON.stringify(dirConfig),
    )
    const loaded = await loadSourceWatchConfig("proj-y", tmp.path)
    expect(loaded.enabled).toBe(true)
  })

  it("migrates: when loaded from global store, writes to project dir", async () => {
    const config = makeSourceWatchConfig({ enabled: true, maxFileSizeMb: 99 })
    inMemoryStore.set("sourceWatchConfig", { "proj-m3": config })
    const loaded = await loadSourceWatchConfig("proj-m3", tmp.path)
    expect(loaded.enabled).toBe(true)
    expect(await fileExists(`${tmp.path}/.qmai/source-watch-config.json`)).toBe(true)
  })
})
describe("rerankConfig persistence", () => {
  it("round-trip save then load returns identical config", async () => {
    const config = makeRerankConfig({ maxCandidates: 9, useMainLlm: true })
    await saveRerankConfig(config, "rerank-1", tmp.path)
    const loaded = await loadRerankConfig("rerank-1", tmp.path)
    expect(loaded).toEqual(config)
  })

  it("persists to .qmai/rerank-config.json", async () => {
    await saveRerankConfig(makeRerankConfig(), "rerank-2", tmp.path)
    expect(await fileExists(`${tmp.path}/.qmai/rerank-config.json`)).toBe(true)
  })

  it("reinstall recovery: loads from project dir when global store is empty", async () => {
    const config = makeRerankConfig({ model: "local-rerank", maxCandidates: 18 })
    await writeFileRaw(
      `${tmp.path}/.qmai/rerank-config.json`,
      JSON.stringify(config),
    )
    const loaded = await loadRerankConfig("rerank-r", tmp.path)
    expect(loaded?.model).toBe("local-rerank")
    expect(loaded?.maxCandidates).toBe(18)
  })
})

describe("mcpConfig persistence", () => {
  it("round-trip save then load returns normalized MCP config", async () => {
    const config = makeMcpConfig()

    await saveMcpConfig(config)
    const loaded = await loadMcpConfig()

    expect(loaded).toEqual(config)
  })

  it("normalizes invalid stored MCP config to an empty config", async () => {
    inMemoryStore.set("mcpConfig", { servers: "bad" })

    const loaded = await loadMcpConfig()

    expect(loaded).toEqual({ servers: [] })
  })
})
