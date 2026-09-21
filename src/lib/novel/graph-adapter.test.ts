import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFile, writeFileAtomic, fileExists, createDirectory } from "@/commands/fs"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock("@/lib/sources-merge", () => ({
  mergeArrayFieldsIntoContent: vi.fn((newContent: string) => newContent),
}))

const mockReadFile = vi.mocked(readFile)
const mockWriteFileAtomic = vi.mocked(writeFileAtomic)
const mockFileExists = vi.mocked(fileExists)
const mockCreateDirectory = vi.mocked(createDirectory)

import { snapshotToGraphEdges, writePatchFieldsToWiki, writeSnapshotToWiki } from "./graph-adapter"
import type { ChapterSnapshot } from "./chapter-ingest"
import type { WikiUpdatePatch } from "./chapter-ingest-output"

const patch1: WikiUpdatePatch = {
  sharedWiki: true,
  entries: [
    {
      entryId: "character:林烬",
      entryType: "character",
      title: "林烬",
      mergeStrategy: "merge-by-entry-id",
      fields: {
        name: "林烬",
        appearanceChapters: [12],
        currentState: "确认太子与旧案有关",
        relationshipSummary: ["林烬->SUSPECTS->太子"],
        cognition: { knows: ["太子与旧案有关"] },
        latestChangeSource: "chapter-12",
        identity: "巡夜司暗探",
        faction: "巡夜司",
        goals: "追查旧案真相",
        arcChange: "从怀疑转向确认太子涉案",
      },
      sources: [{ chapterNumber: 12, snapshotId: "chapter-12" }],
    },
    {
      entryId: "location:黑塔",
      entryType: "location",
      title: "黑塔",
      mergeStrategy: "merge-by-entry-id",
      fields: {
        name: "黑塔",
        relatedChapters: [12],
        keyEvents: ["黑塔密谈"],
        latestChangeSource: "chapter-12",
        region: "皇城北区",
        type: "密牢",
        controller: "巡夜司",
        hiddenInfo: "塔中藏有旧案证物",
      },
      sources: [{ chapterNumber: 12, snapshotId: "chapter-12" }],
    },
    {
      entryId: "chapter:12",
      entryType: "chapter",
      title: "黑塔回响",
      mergeStrategy: "merge-by-entry-id",
      fields: {
        chapterNumber: 12,
        title: "黑塔回响",
        summary: "林烬在黑塔发现太子隐藏的旧案线索。",
        endingHook: "黑玉令在墙中发出回响。",
        canonStatus: "confirmed",
        createdAt: "2026-05-22T08:00:00.000Z",
      },
      sources: [{ chapterNumber: 12, snapshotId: "chapter-12" }],
    },
  ],
}

const patch2: WikiUpdatePatch = {
  sharedWiki: true,
  entries: [
    {
      entryId: "character:林烬",
      entryType: "character",
      title: "林烬",
      mergeStrategy: "merge-by-entry-id",
      fields: {
        name: "林烬",
        appearanceChapters: [13],
        currentState: "掌握黑玉令来自巡夜司旧库",
        relationshipSummary: ["林烬->SUSPECTS->太子"],
        cognition: { knows: ["太子与旧案有关", "黑玉令来自巡夜司旧库"] },
        latestChangeSource: "chapter-13",
      },
      sources: [{ chapterNumber: 13, snapshotId: "chapter-13" }],
    },
    {
      entryId: "chapter:13",
      entryType: "chapter",
      title: "第13章",
      mergeStrategy: "merge-by-entry-id",
      fields: {
        chapterNumber: 13,
        title: "第13章",
        summary: "林烬在巡夜司追查黑玉令的铸造记录。",
        endingHook: "旧库账册缺失了太子亲笔签押的一页。",
        canonStatus: "confirmed",
        createdAt: "2026-05-22T09:00:00.000Z",
      },
      sources: [{ chapterNumber: 13, snapshotId: "chapter-13" }],
    },
  ],
}

describe("writePatchFieldsToWiki", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("snapshotToGraphEdges 会把纯名称关系边归一到已知实体节点", () => {
    const snapshot: ChapterSnapshot = {
      chapterId: "chapter-1",
      chapterNumber: 1,
      summary: "测试章节",
      characters: ["杨妙萍", "庆川"],
      locations: [],
      organizations: ["院里"],
      items: ["竹哨"],
      events: [],
      characterStateChanges: [],
      relationshipChanges: [],
      knowledgeChanges: [],
      foreshadowingChanges: [],
      newCanonFacts: [],
      timelineEvents: [],
      conflicts: [],
      endingHook: "",
      graphNodes: [],
      graphEdges: [
        "杨妙萍->对抗->庆川",
        "杨妙萍->持有->竹哨(交给杨妙萍保管)",
        "庆川->属于->院里(编号092)",
      ],
    }

    expect(snapshotToGraphEdges(snapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "character:杨妙萍",
        target: "character:庆川",
        relation: "对抗",
      }),
      expect.objectContaining({
        source: "character:杨妙萍",
        target: "item:竹哨",
        relation: "HAS_ITEM",
      }),
      expect.objectContaining({
        source: "character:庆川",
        target: "organization:院里",
        relation: "BELONGS_TO",
      }),
    ]))
  })

  it("将单次 WikiUpdatePatch 的每个条目写入对应的实体页面", async () => {
    mockFileExists.mockResolvedValue(false)

    const paths = await writePatchFieldsToWiki("/project", patch1)

    expect(paths).toHaveLength(2)
    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/wiki/entities")
    expect(mockWriteFileAtomic).toHaveBeenCalledTimes(2)

    const linJinCall = mockWriteFileAtomic.mock.calls.find(
      ([path]) => path === "/project/wiki/entities/林烬.md",
    )
    expect(linJinCall).toBeDefined()
    const linJinContent = linJinCall![1]
    expect(linJinContent).toContain("---")
    expect(linJinContent).toContain("type: entity")
    expect(linJinContent).toContain('title: "林烬"')
    expect(linJinContent).toContain("tags: [character]")
    expect(linJinContent).toContain("# 林烬")
    expect(linJinContent).toContain("## 章节信息")
    expect(linJinContent).toContain("确认太子与旧案有关")
    expect(linJinContent).toContain("chapter-12")
    expect(linJinContent).toContain("## 身份")
    expect(linJinContent).toContain("巡夜司暗探")
    expect(linJinContent).toContain("## 阵营")
    expect(linJinContent).toContain("巡夜司")
    expect(linJinContent).toContain("## 目标")
    expect(linJinContent).toContain("追查旧案真相")
    expect(linJinContent).toContain("## 弧光变化")
    expect(linJinContent).toContain("从怀疑转向确认太子涉案")

    const chapterCall = mockWriteFileAtomic.mock.calls.find(
      ([path]) => path === "/project/wiki/entities/12.md",
    )
    expect(chapterCall).toBeUndefined()

    const locationCall = mockWriteFileAtomic.mock.calls.find(
      ([path]) => path === "/project/wiki/entities/黑塔.md",
    )
    expect(locationCall).toBeDefined()
    expect(locationCall![1]).toContain("tags: [location]")
    expect(locationCall![1]).toContain("## 区域")
    expect(locationCall![1]).toContain("皇城北区")
    expect(locationCall![1]).toContain("## 类型")
    expect(locationCall![1]).toContain("密牢")
    expect(locationCall![1]).toContain("## 控制者")
    expect(locationCall![1]).toContain("巡夜司")
    expect(locationCall![1]).toContain("## 隐藏信息")
    expect(locationCall![1]).toContain("塔中藏有旧案证物")
  })

  it("连续两次调用时对同一实体执行合并追加，不覆盖原有内容", async () => {
    mockFileExists.mockResolvedValue(false)
    await writePatchFieldsToWiki("/project", patch1)

    const firstPageContent = mockWriteFileAtomic.mock.calls.find(
      ([path]) => path === "/project/wiki/entities/林烬.md",
    )![1]
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/entities/林烬.md") return firstPageContent
      throw new Error("missing")
    })
    mockFileExists.mockImplementation(async (path) => {
      if (path === "/project/wiki/entities/林烬.md") return true
      return false
    })

    mockWriteFileAtomic.mockClear()
    const paths = await writePatchFieldsToWiki("/project", patch2)

    expect(paths).toHaveLength(1)

    const linJinCall = mockWriteFileAtomic.mock.calls.find(
      ([path]) => path === "/project/wiki/entities/林烬.md",
    )
    expect(linJinCall).toBeDefined()
    const mergedContent = linJinCall![1]
    expect(mergedContent).toContain("chapter-12")
    expect(mergedContent).toContain("chapter-13")
    expect(mergedContent).toContain("确认太子与旧案有关")
    expect(mergedContent).toContain("掌握黑玉令来自巡夜司旧库")
    expect(mergedContent).toContain("黑玉令来自巡夜司旧库")
  })

  it("会跳过章节、事件和整句型事实条目，只保留长期实体", async () => {
    mockFileExists.mockResolvedValue(false)

    const noisyPatch: WikiUpdatePatch = {
      sharedWiki: true,
      entries: [
        {
          entryId: "chapter:12",
          entryType: "chapter",
          title: "第12章",
          mergeStrategy: "merge-by-entry-id",
          fields: { chapterNumber: 12 },
          sources: [{ chapterNumber: 12, snapshotId: "chapter-12" }],
        },
        {
          entryId: "secret:1849在被广播点名时仍能以编号应答，说明其认知已遭诱导重塑。",
          entryType: "secret",
          title: "1849在被广播点名时仍能以编号应答，说明其认知已遭诱导重塑。",
          mergeStrategy: "merge-by-entry-id",
          fields: { content: "1849在被广播点名时仍能以编号应答，说明其认知已遭诱导重塑。" },
          sources: [{ chapterNumber: 12, snapshotId: "chapter-12" }],
        },
        {
          entryId: "event:黑雨之夜",
          entryType: "event",
          title: "黑雨之夜",
          mergeStrategy: "merge-by-entry-id",
          fields: { name: "黑雨之夜" },
          sources: [{ chapterNumber: 12, snapshotId: "chapter-12" }],
        },
        {
          entryId: "event:编号派试图以人格压缩和编号接管保全文明",
          entryType: "event",
          title: "编号派试图以人格压缩和编号接管保全文明",
          mergeStrategy: "merge-by-entry-id",
          fields: { name: "编号派试图以人格压缩和编号接管保全文明" },
          sources: [{ chapterNumber: 12, snapshotId: "chapter-12" }],
        },
      ],
    }

    const paths = await writePatchFieldsToWiki("/project", noisyPatch)

    expect(paths).toEqual([])
    expect(mockWriteFileAtomic).not.toHaveBeenCalled()
  })

  it("writeSnapshotToWiki 只会落长期实体，不再创建章节页和事件页", async () => {
    mockFileExists.mockResolvedValue(false)

    const snapshot: ChapterSnapshot = {
      chapterId: "chapter-12",
      chapterNumber: 12,
      summary: "黑雨之夜发生异变。",
      characters: ["林烬"],
      locations: ["黑塔"],
      organizations: [],
      items: ["黑玉令"],
      events: ["黑雨之夜", "1849在被广播点名时仍能以编号应答，说明其认知已遭诱导重塑。"],
      characterStateChanges: [],
      relationshipChanges: [],
      knowledgeChanges: [],
      foreshadowingChanges: [],
      newCanonFacts: [],
      timelineEvents: [],
      conflicts: [],
      endingHook: "",
      graphNodes: [],
      graphEdges: [],
    }

    const paths = await writeSnapshotToWiki("/project", snapshot)

    expect(paths).toEqual([
      "/project/wiki/entities/林烬.md",
      "/project/wiki/entities/黑塔.md",
      "/project/wiki/entities/黑玉令.md",
    ])
    expect(mockWriteFileAtomic.mock.calls.some(([path]) => path === "/project/wiki/entities/12.md")).toBe(false)
    expect(mockWriteFileAtomic.mock.calls.some(([path]) => path === "/project/wiki/entities/黑雨之夜.md")).toBe(false)
    expect(
      mockWriteFileAtomic.mock.calls.some(([path]) => path.includes("1849在被广播点名时仍能以编号应答")),
    ).toBe(false)
  })

  it("实体页面保留 writeSnapshotToWiki 写入的关系链接，buildWikiGraph 可继续解析", async () => {
    const existingPage = `---
type: entity
title: "林烬"
created: 2026-05-20
updated: 2026-05-20
tags: [character]
related: [太子, 黑塔]
sources: ["012.snapshot.json"]
---

# 林烬

- [[太子]] — 可疑
- [[黑塔]] — 出场于
`

    mockFileExists.mockResolvedValue(true)
    mockReadFile.mockResolvedValue(existingPage)

    await writePatchFieldsToWiki("/project", patch1)

    const linJinCall = mockWriteFileAtomic.mock.calls.find(
      ([path]) => path === "/project/wiki/entities/林烬.md",
    )
    expect(linJinCall).toBeDefined()
    const content = linJinCall![1]

    expect(content).toContain("- [[太子]] — 可疑")
    expect(content).toContain("- [[黑塔]] — 出场于")
    expect(content).toContain("## 章节信息")
    expect(content).toContain("确认太子与旧案有关")

    const relationLinkLines = content
      .split("\n")
      .filter((line) => /^\s*-\s*\[\[/.test(line))
    expect(relationLinkLines.length).toBeGreaterThanOrEqual(2)
  })
})
