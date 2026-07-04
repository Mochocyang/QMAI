import { beforeEach, expect, test, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

import { listDirectory, readFile, fileExists } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import {
  loadAllEntitySummaries,
  loadAllWikiPages,
  mapWithConcurrency,
  runDuplicateDetection,
} from "./dedup-runner"
import type { EntitySummary } from "./dedup"

const testLlmConfig: LlmConfig = {
  provider: "openai",
  model: "gpt-4",
  apiKey: "test",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  reasoning: { mode: "auto" },
  localCliIsolation: false,
}

const mockedListDirectory = vi.mocked(listDirectory)
const mockedReadFile = vi.mocked(readFile)
const mockedFileExists = vi.mocked(fileExists)
const mockedStreamChat = vi.mocked(streamChat)

function entityMarkdown(title: string): string {
  return `---
type: entity
title: ${title}
tags: []
---
# ${title}
`
}

function wikiTree(projectPath: string, pageCount: number): FileNode[] {
  const children: FileNode[] = []
  for (let i = 0; i < pageCount; i++) {
    children.push({
      name: `page-${i}.md`,
      path: `${projectPath}/wiki/entities/page-${i}.md`,
      is_dir: false,
    })
  }
  return [
    {
      name: "wiki",
      path: `${projectPath}/wiki`,
      is_dir: true,
      children: [
        {
          name: "entities",
          path: `${projectPath}/wiki/entities`,
          is_dir: true,
          children,
        },
      ],
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedFileExists.mockResolvedValue(false)
  mockedStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
    callbacks.onToken('{"groups": []}')
    callbacks.onDone()
  })
})

test("mapWithConcurrency respects concurrency limit", async () => {
  let inFlight = 0
  let maxInFlight = 0

  const results = await mapWithConcurrency(
    [1, 2, 3, 4, 5, 6],
    2,
    async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      inFlight--
      return n * 2
    },
  )

  expect(maxInFlight).toBeLessThanOrEqual(2)
  expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 12])
})

test("mapWithConcurrency omits null and undefined results", async () => {
  const results = await mapWithConcurrency(["a", "b", "c"], 3, async (item) => {
    if (item === "b") return null
    if (item === "c") return undefined
    return item.toUpperCase()
  })

  expect(results).toEqual(["A"])
})

test("mapWithConcurrency returns empty array for empty input", async () => {
  const fn = vi.fn(async () => "x")
  const results = await mapWithConcurrency([], 4, fn)
  expect(results).toEqual([])
  expect(fn).not.toHaveBeenCalled()
})

test("loadAllWikiPages reads wiki markdown files in parallel", async () => {
  mockedListDirectory.mockResolvedValue(wikiTree("/Project", 5))
  mockedReadFile.mockImplementation(async (path) => `content:${path}`)

  const pages = await loadAllWikiPages("/Project")

  expect(pages).toHaveLength(5)
  expect(mockedReadFile).toHaveBeenCalledTimes(5)
  for (const page of pages) {
    expect(page.path).toMatch(/^wiki\/entities\/page-\d+\.md$/)
    expect(page.content).toContain("content:")
  }
})

test("loadAllWikiPages skips unreadable files", async () => {
  mockedListDirectory.mockResolvedValue(wikiTree("/Project", 3))
  mockedReadFile.mockImplementation(async (path) => {
    if (path.endsWith("page-1.md")) {
      throw new Error("permission denied")
    }
    return `ok:${path}`
  })

  const pages = await loadAllWikiPages("/Project")

  expect(pages).toHaveLength(2)
  expect(pages.every((p) => !p.path.endsWith("page-1.md"))).toBe(true)
})

test("loadAllEntitySummaries reads entity and concept pages in parallel", async () => {
  mockedListDirectory.mockResolvedValue(wikiTree("/Project", 4))
  mockedReadFile.mockImplementation(async (path) => {
    const match = path.match(/page-(\d+)\.md$/)
    const idx = match?.[1] ?? "0"
    return entityMarkdown(`Page ${idx}`)
  })

  const summaries = await loadAllEntitySummaries("/Project")

  expect(summaries).toHaveLength(4)
  expect(mockedReadFile).toHaveBeenCalledTimes(4)
  expect(summaries.every((s) => s.type === "entity")).toBe(true)
})

test("loadAllEntitySummaries skips pages without frontmatter", async () => {
  mockedListDirectory.mockResolvedValue(wikiTree("/Project", 2))
  mockedReadFile.mockImplementation(async (path) => {
    if (path.endsWith("page-0.md")) return entityMarkdown("Valid")
    return "# no frontmatter\n"
  })

  const summaries = await loadAllEntitySummaries("/Project")

  expect(summaries).toHaveLength(1)
  expect(summaries[0]?.slug).toBe("page-0")
})

test("runDuplicateDetection returns scannedPageCount and skips disk when summaries provided", async () => {
  const summaries: EntitySummary[] = [
    {
      slug: "alpha",
      path: "wiki/entities/alpha.md",
      type: "entity",
      title: "Alpha",
      tags: [],
    },
    {
      slug: "beta",
      path: "wiki/entities/beta.md",
      type: "entity",
      title: "Beta",
      tags: [],
    },
  ]

  const result = await runDuplicateDetection(
    "/Project",
    testLlmConfig,
    { summaries },
  )

  expect(mockedListDirectory).not.toHaveBeenCalled()
  expect(mockedReadFile).not.toHaveBeenCalled()
  expect(result.scannedPageCount).toBe(2)
  expect(result.groups).toEqual([])
  expect(mockedStreamChat).toHaveBeenCalledTimes(1)
})

test("runDuplicateDetection short-circuits when fewer than two summaries", async () => {
  const summaries: EntitySummary[] = [
    {
      slug: "only-one",
      path: "wiki/entities/only-one.md",
      type: "entity",
      title: "Only One",
      tags: [],
    },
  ]

  const result = await runDuplicateDetection(
    "/Project",
    testLlmConfig,
    { summaries },
  )

  expect(result).toEqual({ groups: [], scannedPageCount: 1 })
  expect(mockedStreamChat).not.toHaveBeenCalled()
})

test("runDuplicateDetection invokes onProgress for loading and detecting", async () => {
  const stages: string[] = []
  mockedListDirectory.mockResolvedValue(wikiTree("/Project", 2))
  mockedReadFile.mockImplementation(async (path) => {
    const match = path.match(/page-(\d+)\.md$/)
    const idx = match?.[1] ?? "0"
    return entityMarkdown(`Page ${idx}`)
  })

  await runDuplicateDetection(
    "/Project",
    testLlmConfig,
    {
      onProgress: (stage) => {
        stages.push(stage)
      },
    },
  )

  expect(stages).toEqual(["loading", "detecting"])
})
