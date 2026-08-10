import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  fileExists: vi.fn(async (path: string) => path.endsWith("/context-cache/v1")),
  getFileSize: vi.fn(async () => 0),
  getFileMd5: vi.fn(async () => "hash"),
  listDirectory: vi.fn(async () => []),
  readFile: vi.fn(async () => { throw new Error("文件不存在") }),
  subscribeProjectFileMutations: vi.fn(() => () => {}),
  writeFileAtomic: vi.fn(async () => {}),
}))

vi.mock("@/commands/fs", () => fsMocks)

import {
  disposeAllContextHubs,
  initializeProjectContextCache,
} from "./context-hub"

describe("context cache v1 migration", () => {
  beforeEach(() => {
    disposeAllContextHubs()
    fsMocks.createDirectory.mockClear()
    fsMocks.deleteFile.mockReset().mockResolvedValue(undefined)
    fsMocks.fileExists.mockReset().mockImplementation(async (path: string) => path.endsWith("/context-cache/v1"))
    fsMocks.listDirectory.mockReset().mockResolvedValue([])
    fsMocks.readFile.mockReset().mockRejectedValue(new Error("文件不存在"))
  })

  it("initializes v2 and deletes v1 in the background without reading its manifest", async () => {
    await initializeProjectContextCache("E:/Novel")

    await vi.waitFor(() => {
      expect(fsMocks.deleteFile).toHaveBeenCalledWith("E:/Novel/.qmai/context-cache/v1")
    })
    expect(fsMocks.createDirectory).toHaveBeenCalledWith("E:/Novel/.qmai/context-cache/v2")
    expect(fsMocks.readFile).not.toHaveBeenCalledWith("E:/Novel/.qmai/context-cache/v1/manifest.json")
  })

  it("does not block opening when legacy deletion fails and retries on the next open", async () => {
    fsMocks.deleteFile.mockRejectedValueOnce(new Error("文件占用"))

    await expect(initializeProjectContextCache("E:/Novel")).resolves.toBeUndefined()
    await vi.waitFor(() => expect(fsMocks.deleteFile).toHaveBeenCalledTimes(1))

    fsMocks.deleteFile.mockResolvedValue(undefined)
    await expect(initializeProjectContextCache("E:/Novel")).resolves.toBeUndefined()
    await vi.waitFor(() => expect(fsMocks.deleteFile).toHaveBeenCalledTimes(2))
  })
})
