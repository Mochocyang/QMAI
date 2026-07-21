import { beforeEach, expect, test, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
}))

import { readFile, writeFile, fileExists } from "@/commands/fs"
import { loadDedupModelPrefs, saveDedupModelPrefs } from "./dedup-model-prefs"

const mockedReadFile = vi.mocked(readFile)
const mockedWriteFile = vi.mocked(writeFile)
const mockedFileExists = vi.mocked(fileExists)

beforeEach(() => {
  vi.clearAllMocks()
})

test("saveDedupModelPrefs writes detect and merge ids", async () => {
  await saveDedupModelPrefs("/Project", {
    detectModelId: "cheap/model",
    mergeModelId: "strong/model",
  })
  expect(mockedWriteFile).toHaveBeenCalledTimes(1)
  const written = JSON.parse(String(mockedWriteFile.mock.calls[0]?.[1]))
  expect(written).toEqual({
    detectModelId: "cheap/model",
    mergeModelId: "strong/model",
  })
})

test("loadDedupModelPrefs accepts legacy modelId as detect", async () => {
  mockedFileExists.mockResolvedValue(true)
  mockedReadFile.mockResolvedValue(
    JSON.stringify({ modelId: "legacy/detect-only" }),
  )
  const prefs = await loadDedupModelPrefs("/Project")
  expect(prefs).toEqual({
    detectModelId: "legacy/detect-only",
    mergeModelId: undefined,
  })
})
