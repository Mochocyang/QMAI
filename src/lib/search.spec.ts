import { beforeEach, expect, test, vi } from "vitest"
import type { FileNode } from "@/types/wiki"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"
import { searchWiki } from "./search"

const mockedListDirectory = vi.mocked(listDirectory)
const mockedReadFile = vi.mocked(readFile)

beforeEach(() => {
  vi.clearAllMocks()
})

test("can cap content scanned for token matching", async () => {
  const files: FileNode[] = [
    {
      name: "big-source.md",
      path: "/Project/wiki/sources/big-source.md",
      is_dir: false,
    },
  ]
  mockedListDirectory.mockResolvedValue(files)
  mockedReadFile.mockResolvedValue(`# Big Source\n${"x".repeat(2000)}needle`)

  const results = await searchWiki("/Project", "needle", {
    includeVector: false,
    maxContentChars: 100,
  } as Parameters<typeof searchWiki>[2])

  expect(results).toEqual([])
})
