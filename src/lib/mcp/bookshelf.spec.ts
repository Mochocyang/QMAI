import { describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { findShelfBook, formatBookshelf, formatCurrentOpen, openBookshelf } from "./bookshelf"
import type { WikiProject } from "@/types/wiki"

const books: WikiProject[] = [
  { id: "a", name: "红警", path: "/books/red" },
  { id: "b", name: "红警", path: "/books/red-2" },
  { id: "c", name: "程序员", path: "/books/coder" },
]

describe("bookshelf tools", () => {
  it("lists every book and reports an empty shelf", () => {
    expect(formatBookshelf([])).toBe("书架是空的")
    expect(formatBookshelf(books)).toContain("红警")
    expect(formatBookshelf(books)).toContain("id：c")
    expect(formatBookshelf(books)).toContain("/books/coder")
  })

  it("opens by id or path, and rejects an ambiguous name", async () => {
    expect(findShelfBook(books, { id: "c" }).path).toBe("/books/coder")
    expect(findShelfBook(books, { path: "/books/red" }).id).toBe("a")
    expect(() => findShelfBook(books, { name: "红警" })).toThrow("有多本同名书")
    expect(() => findShelfBook(books, {})).toThrow("请提供书名")
    const openInApp = vi.fn(async () => {})
    const opened = await openBookshelf({ name: "程序员" }, {
      load: async () => books,
      open: async (path) => books.find((book) => book.path === path)!,
      openInApp,
    })
    expect(opened).toContain("已打开：程序员")
    expect(openInApp).toHaveBeenCalledWith(books[2])
  })

  it("reports the book and file that are open now", () => {
    useWikiStore.setState({
      project: { id: "c", name: "程序员", path: "/books/coder" },
      selectedFile: "/books/coder/QM/chapters/第1章.md",
    })
    const text = formatCurrentOpen(
      useWikiStore.getState().project,
      useWikiStore.getState().selectedFile,
    )
    expect(text).toContain("当前打开：程序员")
    expect(text).toContain("第1章.md")
    expect(formatCurrentOpen(null, null)).toBe("当前没有打开的书")
    useWikiStore.setState({ project: null, selectedFile: null })
  })
})
