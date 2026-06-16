import { describe, it, expect, vi, beforeEach } from "vitest"
import { persistCharacterToDisk } from "./character-disk-store"

vi.mock("@/commands/fs", () => ({
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
}))

import { writeFile, createDirectory } from "@/commands/fs"

const mockedWrite = vi.mocked(writeFile)
const mockedMkdir = vi.mocked(createDirectory)

describe("persistCharacterToDisk", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes character JSON under bookPath/characters/{id}.json", async () => {
    mockedMkdir.mockResolvedValue(undefined)
    mockedWrite.mockResolvedValue(undefined)

    await persistCharacterToDisk("/p/book-1", {
      id: "c-1", name: "许七安", description: "desc",
    } as any)

    expect(mockedMkdir).toHaveBeenCalledTimes(1)
    expect(mockedWrite).toHaveBeenCalledTimes(1)
    const [path, content] = mockedWrite.mock.calls[0]
    expect(path).toBe("/p/book-1/characters/c-1.json")
    expect(JSON.parse(content as string).name).toBe("许七安")
  })

  it("throws if writeFile fails (so caller can toast)", async () => {
    mockedMkdir.mockResolvedValue(undefined)
    mockedWrite.mockRejectedValue(new Error("disk full"))

    await expect(
      persistCharacterToDisk("/p/book-1", { id: "c-1" } as any),
    ).rejects.toThrow("disk full")
  })
})
