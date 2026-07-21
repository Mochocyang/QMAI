import { beforeEach, expect, test, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
}))

import { readFile, writeFile, fileExists } from "@/commands/fs"
import {
  loadDedupScanCache,
  removeGroupFromDedupScanCache,
  saveDedupScanCache,
} from "./dedup-scan-cache"

const mockedReadFile = vi.mocked(readFile)
const mockedWriteFile = vi.mocked(writeFile)
const mockedFileExists = vi.mocked(fileExists)

beforeEach(() => {
  vi.clearAllMocks()
})

test("removeGroupFromDedupScanCache drops matching group and rewrites file", async () => {
  mockedFileExists.mockResolvedValue(true)
  mockedReadFile.mockResolvedValue(
    JSON.stringify({
      version: 1,
      projectId: "p1",
      scannedAt: 100,
      scannedPageCount: 4,
      modelId: "openai/gpt-4",
      groups: [
        {
          group: { slugs: ["alpha", "beta"], reason: "same", confidence: "high" },
          canonicalSlug: "alpha",
          skipped: false,
        },
        {
          group: { slugs: ["gamma", "delta"], reason: "same", confidence: "medium" },
          canonicalSlug: "gamma",
          skipped: false,
        },
      ],
    }),
  )

  const removed = await removeGroupFromDedupScanCache("/Project", ["beta", "alpha"])
  expect(removed).toBe(true)
  expect(mockedWriteFile).toHaveBeenCalledTimes(1)
  const written = JSON.parse(String(mockedWriteFile.mock.calls[0]?.[1]))
  expect(written.groups).toHaveLength(1)
  expect(written.groups[0].group.slugs).toEqual(["gamma", "delta"])
})

test("removeGroupFromDedupScanCache is a no-op when group absent", async () => {
  mockedFileExists.mockResolvedValue(true)
  mockedReadFile.mockResolvedValue(
    JSON.stringify({
      version: 1,
      projectId: "p1",
      scannedAt: 100,
      scannedPageCount: 2,
      groups: [
        {
          group: { slugs: ["gamma", "delta"], reason: "same", confidence: "low" },
          canonicalSlug: "gamma",
          skipped: false,
        },
      ],
    }),
  )

  const removed = await removeGroupFromDedupScanCache("/Project", ["alpha", "beta"])
  expect(removed).toBe(false)
  expect(mockedWriteFile).not.toHaveBeenCalled()
})

test("save + load round-trip keeps modelId", async () => {
  mockedFileExists.mockResolvedValue(true)
  let stored = ""
  mockedWriteFile.mockImplementation(async (_path, content) => {
    stored = String(content)
  })
  mockedReadFile.mockImplementation(async () => stored)

  await saveDedupScanCache("/Project", {
    version: 1,
    projectId: "p1",
    scannedAt: 1,
    scannedPageCount: 0,
    modelId: "x/y",
    groups: [],
  })
  const loaded = await loadDedupScanCache("/Project")
  expect(loaded?.modelId).toBe("x/y")
})
