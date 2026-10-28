/**
 * 上下文缓存的统计与清空。
 *
 * 清空是用户显式动作：必须删目录、并且把内存里的 hub 一起丢掉
 * （否则当前会话还会用内存里的旧副本，直到重启）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  fileExists: vi.fn(),
  deleteFile: vi.fn(),
}))
vi.mock("./context-hub", () => ({ disposeAllContextHubs: vi.fn() }))

import { deleteFile, fileExists, listDirectory } from "@/commands/fs"
import { disposeAllContextHubs } from "./context-hub"
import { clearContextCache, contextCachePath, measureContextCache } from "./cache-maintenance"

const mockListDirectory = vi.mocked(listDirectory)
const mockFileExists = vi.mocked(fileExists)
const mockDeleteFile = vi.mocked(deleteFile)
const mockDispose = vi.mocked(disposeAllContextHubs)

const projectPath = "E:/Novel"

beforeEach(() => {
  mockListDirectory.mockReset()
  mockFileExists.mockReset()
  mockDeleteFile.mockReset()
  mockDispose.mockReset()
})

describe("measureContextCache", () => {
  it("目录不存在时 exists=false", async () => {
    mockFileExists.mockResolvedValue(false)
    await expect(measureContextCache(projectPath)).resolves.toEqual({
      exists: false,
      fileCount: 0,
      totalBytes: 0,
    })
  })

  it("递归统计文件数与字节数", async () => {
    mockFileExists.mockResolvedValue(true)
    mockListDirectory.mockResolvedValue([
      { name: "v2", path: "E:/Novel/.qmai/context-cache/v2", is_dir: true, children: [
        { name: "a.json", path: "E:/Novel/.qmai/context-cache/v2/a.json", is_dir: false, size: 100 },
        { name: "snapshots", path: "E:/Novel/.qmai/context-cache/v2/snapshots", is_dir: true, children: [
          { name: "s.json", path: "E:/Novel/.qmai/context-cache/v2/snapshots/s.json", is_dir: false, size: 900 },
        ] },
      ] },
    ])

    await expect(measureContextCache(projectPath)).resolves.toEqual({
      exists: true,
      fileCount: 2,
      totalBytes: 1000,
    })
  })
})

describe("clearContextCache", () => {
  it("删除缓存目录、丢弃内存 hub，并返回删除的文件数", async () => {
    mockFileExists.mockResolvedValue(true)
    mockListDirectory.mockResolvedValue([
      { name: "a.json", path: contextCachePath(projectPath) + "/a.json", is_dir: false, size: 10 },
      { name: "b.json", path: contextCachePath(projectPath) + "/b.json", is_dir: false, size: 20 },
    ])
    mockDeleteFile.mockResolvedValue(undefined)

    const result = await clearContextCache(projectPath)

    expect(result).toEqual({ existed: true, removedFiles: 2 })
    expect(mockDeleteFile).toHaveBeenCalledWith(contextCachePath(projectPath))
    expect(mockDispose).toHaveBeenCalledTimes(1)
  })

  it("没有缓存时不报错、也不删东西", async () => {
    mockFileExists.mockResolvedValue(false)
    await expect(clearContextCache(projectPath)).resolves.toEqual({ existed: false, removedFiles: 0 })
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })
})
