// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WikiProject } from "@/types/wiki"

const flags = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/ui-test", () => ({
  get IS_UI_TEST_BUILD() { return flags.enabled },
  UI_TEST_STORAGE_PREFIX: "qm-uitest-",
}))

import { getUiTestProjects, registerUiTestProject, registerUiTestProjects } from "./ui-test-library"

const key = "qm-uitest-library"
const book: WikiProject = { id: "stable-id", name: "真实书名", path: "C:/已选择目录/小说" }

beforeEach(() => {
  flags.enabled = true
  localStorage.clear()
})

describe("UI 测试版独立完整书库", () => {
  it("105 本完整持久保存，重新加载模块后仍全部保留", async () => {
    const books = Array.from({ length: 105 }, (_, n) => ({ id: `id-${n}`, name: `小说${n}`, path: `C:/已选择/${n}` }))
    for (const item of books) registerUiTestProject(item)
    expect(getUiTestProjects()).toEqual(books)
    vi.resetModules()
    const reloaded = await import("./ui-test-library")
    expect(reloaded.getUiTestProjects()).toEqual(books)
    expect(JSON.parse(localStorage.getItem(key)!).schemaVersion).toBe(1)
  })

  it("只写 qm-uitest- 索引，不改正式最近记录或项目登记", () => {
    localStorage.setItem("recentProjects", "正式版记录")
    localStorage.setItem("projectRegistry", "正式版目录")
    registerUiTestProject(book)
    expect(localStorage.getItem("recentProjects")).toBe("正式版记录")
    expect(localStorage.getItem("projectRegistry")).toBe("正式版目录")
    expect(localStorage.length).toBe(3)
    expect(getUiTestProjects()).toEqual([book])
  })

  it("正式版调用也不读取或写入书库", () => {
    flags.enabled = false
    localStorage.setItem(key, "损坏的测试版索引")
    expect(() => registerUiTestProject(book)).not.toThrow()
    expect(getUiTestProjects()).toEqual([])
    expect(localStorage.getItem(key)).toBe("损坏的测试版索引")
  })

  it("同名不同项目不合并，稳定 ID 的迁移只更新原记录", () => {
    const other = { id: "other-id", name: book.name, path: "D:/另一本同名小说" }
    registerUiTestProjects([book, other])
    const moved = { ...book, path: "E:/移动后的小说", name: "更新的书名" }
    registerUiTestProject(moved)
    expect(getUiTestProjects()).toEqual([moved, other])
  })

  it("Windows 同一路径的大小写、斜杠和尾斜杠不会重复登记", () => {
    registerUiTestProject(book)
    const refreshed = { ...book, id: "refreshed-id", path: "c:\\已选择目录\\小说\\" }
    registerUiTestProject(refreshed)
    expect(getUiTestProjects()).toEqual([refreshed])
  })

  it("非 Windows 大小写不同的绝对路径仍是两本书", () => {
    registerUiTestProjects([
      { ...book, id: "unix-1", path: "/books/Story" },
      { ...book, id: "unix-2", path: "/books/story" },
    ])
    expect(getUiTestProjects()).toHaveLength(2)
  })

  it.each([
    ["损坏 JSON", "{broken", /读取失败/],
    ["高版本", JSON.stringify({ schemaVersion: 9, projects: [book] }), /版本/],
    ["无效条目", JSON.stringify({ schemaVersion: 1, projects: [book, { id: "broken" }] }), /读取失败/],
  ])("%s 不被静默清空或覆盖", (_label, raw, message) => {
    localStorage.setItem(key, raw)
    expect(() => getUiTestProjects()).toThrow(message)
    expect(() => registerUiTestProject({ ...book, id: "new-id" })).toThrow(message)
    expect(localStorage.getItem(key)).toBe(raw)
  })

  it("读取后修改返回数组不篡改已存索引", () => {
    registerUiTestProject(book)
    const records = getUiTestProjects()
    records[0].name = "仅内存中的名字"
    records.push({ ...book, id: "unused" })
    expect(getUiTestProjects()).toEqual([book])
  })
})
