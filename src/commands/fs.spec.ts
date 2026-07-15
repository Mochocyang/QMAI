import { beforeEach, describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import {
  deleteFile,
  subscribeProjectFileMutations,
  writeFile,
  writeFileAtomic,
  writeFileIfAbsent,
} from "./fs"

describe("project file mutation notifications", () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
  })

  it("notifies after successful writes and deletes", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeProjectFileMutations(listener)

    await writeFile("E:/Novel/wiki/chapters/1.md", "一")
    await writeFileAtomic("E:/Novel/wiki/outlines/main.md", "二")
    await deleteFile("E:/Novel/wiki/memory/old.md")

    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { type: "write", path: "E:/Novel/wiki/chapters/1.md" },
      { type: "write", path: "E:/Novel/wiki/outlines/main.md" },
      { type: "delete", path: "E:/Novel/wiki/memory/old.md" },
    ])
    unsubscribe()
  })

  it("does not notify when the underlying operation fails", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeProjectFileMutations(listener)
    invokeMock.mockRejectedValueOnce(new Error("磁盘错误"))

    await expect(writeFile("E:/Novel/wiki/chapters/1.md", "一")).rejects.toThrow("磁盘错误")
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("notifies only when an absent file is actually created", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeProjectFileMutations(listener)
    invokeMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(writeFileIfAbsent("E:/Novel/wiki/chapters/draft.md", "一")).resolves.toBe(false)
    await expect(writeFileIfAbsent("E:/Novel/wiki/chapters/draft-2.md", "二")).resolves.toBe(true)

    expect(invokeMock).toHaveBeenNthCalledWith(1, "write_file_if_absent", {
      path: "E:/Novel/wiki/chapters/draft.md",
      contents: "一",
    })
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({
      type: "write",
      path: "E:/Novel/wiki/chapters/draft-2.md",
    })
    unsubscribe()
  })
})
