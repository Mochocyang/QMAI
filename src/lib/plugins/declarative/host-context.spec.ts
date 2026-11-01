/**
 * 宿主上下文读取的测试。
 *
 * 重点不是"能读出值"，而是**读不到时的口径**：没项目 → null、不是章节 → null、
 * 元数据坏了 → 其它字段照旧可用。任何一个变成抛错，用户就会在完全无关的时机
 * （还没打开项目、正在写大纲）被"生成失败"拦住。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadNovelProjectMeta } = vi.hoisted(() => ({ loadNovelProjectMeta: vi.fn() }))
vi.mock("@/lib/novel/project-meta", () => ({ loadNovelProjectMeta }))

import { useWikiStore } from "@/stores/wiki-store"
import { readChapterContext, readProjectContext, readSelectionContext } from "./host-context"

beforeEach(() => {
  loadNovelProjectMeta.mockReset()
  loadNovelProjectMeta.mockResolvedValue(null)
  useWikiStore.setState({ project: null, selectedFile: null, fileContent: "" })
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("readProjectContext", () => {
  it("没有项目 → null", async () => {
    await expect(readProjectContext()).resolves.toBeNull()
  })

  it("书名来自项目名（项目目录名就是书名真源），简介来自 project-meta.json", async () => {
    useWikiStore.setState({ project: { id: "p1", name: "长夜", path: "/books/长夜" } })
    loadNovelProjectMeta.mockResolvedValue({ description: "一个关于夜的故事" })

    await expect(readProjectContext()).resolves.toEqual({
      bookTitle: "长夜",
      bookIntro: "一个关于夜的故事",
    })
    expect(loadNovelProjectMeta).toHaveBeenCalledWith("/books/长夜")
  })

  it("没有 description 时不编简介，也不读 wiki 页面", async () => {
    useWikiStore.setState({ project: { id: "p1", name: "长夜", path: "/books/长夜" } })
    loadNovelProjectMeta.mockResolvedValue({ description: "   " })

    const context = await readProjectContext()
    expect(context).toEqual({ bookTitle: "长夜" })
    // 没有单一存储的字段一律不填（见 host-context.ts 文件头）
    expect(context?.bookTags).toBeUndefined()
    expect(context?.protagonist).toBeUndefined()
    expect(context?.setting).toBeUndefined()
  })

  it("元数据读取失败只降级，不抛错", async () => {
    useWikiStore.setState({ project: { id: "p1", name: "长夜", path: "/books/长夜" } })
    loadNovelProjectMeta.mockRejectedValue(new Error("EACCES"))

    await expect(readProjectContext()).resolves.toEqual({ bookTitle: "长夜" })
  })
})

describe("readChapterContext", () => {
  it("不是章节 / 没打开文档 → null", async () => {
    await expect(readChapterContext()).resolves.toBeNull()

    useWikiStore.setState({ selectedFile: "/books/长夜/wiki/outlines/主线.md", fileContent: "# 主线\n\n第一幕" })
    await expect(readChapterContext()).resolves.toBeNull()
  })

  it("章节：标题取 # 行，正文取标题之后的全文", async () => {
    useWikiStore.setState({
      selectedFile: "/books/长夜/wiki/chapters/001.md",
      fileContent: "# 第一章 雨夜\n\n　　他推开门。",
    })

    await expect(readChapterContext()).resolves.toEqual({ title: "第一章 雨夜", text: "　　他推开门。" })
  })

  it("空内容 → null（不返回一个字段全空的对象）", async () => {
    useWikiStore.setState({ selectedFile: "/books/长夜/wiki/chapters/001.md", fileContent: "   " })
    await expect(readChapterContext()).resolves.toBeNull()
  })
})

describe("readSelectionContext", () => {
  it("宿主没有选区读取 API：返回 undefined（插值按空值处理并进 missing）", () => {
    expect(readSelectionContext()).toBeUndefined()
  })
})
