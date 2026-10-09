import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { getDataSourceNamesForCategories, getAllDataSources } from "./context-data-sources"

describe("getDataSourceNamesForCategories", () => {
  it("returns only data sources that belong to allowed classification categories", () => {
    const names = getDataSourceNamesForCategories(["soul", "settings", "outline"])

    expect(names).toContain("soulDoc")
    expect(names).toContain("relatedSettings")
    expect(names).toContain("canonRules")
    expect(names).toContain("sourceCanon")
    expect(names).toContain("outline")
    expect(names).toContain("chapterOutline")
    expect(names).toContain("bookAnalysisReferences")
    expect(names).not.toContain("recentChapterContents")
    expect(names).not.toContain("searchResults")
    expect(names).not.toContain("graphSearchResults")
  })

  it("keeps multi-purpose snapshot and retrieval sources when any matching category is allowed", () => {
    const names = getDataSourceNamesForCategories(["recent_summaries"])

    expect(names).toContain("retrieval")
    expect(names).toContain("snapshots")
    expect(names).toContain("fallbackRecentSummaries")
    expect(names).not.toContain("recentChapterContents")
  })
})

describe("sourceCanon 数据源", () => {
  const projectPath = "/tmp/qmai-fanfic-project"

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock("@/commands/fs")
    vi.restoreAllMocks()
  })

  function findSource() {
    const source = getAllDataSources().find((item) => item.name === "sourceCanon")
    expect(source).toBeDefined()
    return source!
  }

  it("把同人正典归类到设定类，跟着相关设定一起被允许或禁止", () => {
    expect(getDataSourceNamesForCategories(["settings"])).toContain("sourceCanon")
    expect(getDataSourceNamesForCategories(["outline"])).not.toContain("sourceCanon")
  })

  it("按固定路径直读 .novel/fanfic-canon.md，不经模糊检索", async () => {
    const readFile = vi.fn(async (path: string) => {
      if (path === `${projectPath}/.novel/fanfic-canon.md`) {
        return [
          "---",
          'fanfic_mode: "canon"',
          'source_name: "斗破苍穹"',
          "allowed_deviations: []",
          "---",
          "",
          "## 世界观硬规则",
          "",
          "- 斗气分九段。",
        ].join("\n")
      }
      throw new Error(`unexpected path: ${path}`)
    })
    const fileExists = vi.fn(async () => true)
    vi.doMock("@/commands/fs", () => ({
      readFile,
      fileExists,
      writeFileAtomic: vi.fn(),
      createDirectory: vi.fn(),
      deleteFile: vi.fn(),
      listDirectory: vi.fn(),
    }))

    const { getAllDataSources: loadSources } = await import("./context-data-sources")
    const source = loadSources().find((item) => item.name === "sourceCanon")!
    const value = await source.load({ projectPath } as never)

    expect(readFile).toHaveBeenCalledWith(`${projectPath}/.novel/fanfic-canon.md`)
    // 注入的是正文，frontmatter 不占上下文预算
    expect(value).toContain("斗气分九段。")
    expect(value).not.toContain("fanfic_mode")
  })

  it("原创项目没有正典文件时返回空串，不影响既有行为", async () => {
    vi.doMock("@/commands/fs", () => ({
      readFile: vi.fn(async () => {
        throw new Error("ENOENT")
      }),
      fileExists: vi.fn(async () => false),
      writeFileAtomic: vi.fn(),
      createDirectory: vi.fn(),
      deleteFile: vi.fn(),
      listDirectory: vi.fn(),
    }))

    const { getAllDataSources: loadSources } = await import("./context-data-sources")
    const source = loadSources().find((item) => item.name === "sourceCanon")!
    await expect(source.load({ projectPath } as never)).resolves.toBe("")
  })

  it("读取失败不抛出，避免同人正典缺失中断整条生成链", async () => {
    vi.doMock("@/commands/fs", () => ({
      readFile: vi.fn(async () => {
        throw new Error("EACCES")
      }),
      fileExists: vi.fn(async () => true),
      writeFileAtomic: vi.fn(),
      createDirectory: vi.fn(),
      deleteFile: vi.fn(),
      listDirectory: vi.fn(),
    }))

    const { getAllDataSources: loadSources } = await import("./context-data-sources")
    const source = loadSources().find((item) => item.name === "sourceCanon")!
    await expect(source.load({ projectPath } as never)).resolves.toBe("")
  })

  it("同人正典优先于普通设定加载，保证预算紧张时先保住硬约束", () => {
    const source = findSource()
    const relatedSettings = getAllDataSources().find((item) => item.name === "relatedSettings")!
    expect(source.priority).toBeLessThan(relatedSettings.priority)
  })
})
