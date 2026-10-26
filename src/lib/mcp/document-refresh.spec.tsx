// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  listDirectory: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  listDirectory: fs.listDirectory,
  readFile: vi.fn(async (path: string) => fs.files.get(path) ?? ""),
  writeFileAtomic: fs.writeFileAtomic,
  fileExists: vi.fn(async () => false),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  openFileLocation: vi.fn(),
  copyFile: vi.fn(),
}))

import { KnowledgeTree } from "@/components/layout/knowledge-tree"
import { useWikiStore } from "@/stores/wiki-store"
import { formatProjectChapter } from "./format-chapter"
import { registerOpenDocument } from "./open-document"
import { saveProjectDocument } from "./save-document"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const project = { id: "book", name: "book", path: "/book" }
const chapterPath = "/book/wiki/chapters/第1章.md"
const markdown = (title: string) => `---\nchapter_number: 1\nchapter_status: draft\ntitle: ${title}\n---\n# ${title}\n\n正文。`
let root: Root
let container: HTMLDivElement

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

beforeEach(async () => {
  fs.files.clear()
  fs.writeFileAtomic.mockReset().mockImplementation(async (path: string, content: string) => {
    fs.files.set(path, content)
  })
  fs.listDirectory.mockReset().mockImplementation(async (path: string): Promise<FileNode[]> => {
    const chapters = [...fs.files.keys()].filter((file) => file.startsWith("/book/wiki/chapters/"))
      .map((file) => ({ name: file.split("/").pop()!, path: file, is_dir: false }))
    if (path === "/book/wiki/chapters") return chapters
    if (path === "/book") return [{
      name: "wiki", path: "/book/wiki", is_dir: true, children: [{
        name: "chapters", path: "/book/wiki/chapters", is_dir: true, children: chapters,
      }],
    }]
    return []
  })
  useWikiStore.setState({ ...useWikiStore.getInitialState(), project, novelMode: true })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<KnowledgeTree filterType="chapter" />))
  await flush()
  fs.listDirectory.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  registerOpenDocument(null)
  useWikiStore.setState(useWikiStore.getInitialState())
})

describe("MCP document UI refresh", () => {
  it("shows a newly saved draft without reopening the project or selecting it", async () => {
    expect(container.textContent).not.toContain("新章节")
    await act(async () => {
      await saveProjectDocument({ projectPath: project.path, path: chapterPath, content: markdown("新章节") })
    })
    await flush()
    expect(container.querySelector(`[data-page-path="${chapterPath}"]`)?.textContent).toContain("新章节")
    const state = useWikiStore.getState()
    expect(state.fileTree[0]?.children?.[0]?.children?.[0]?.path).toBe(chapterPath)
    expect(state.projectPathIndex.byPath.has(chapterPath)).toBe(true)
    expect(state.dataVersion).toBe(1)
    expect(state.selectedFile).toBeNull()
  })

  it("reloads existing chapter metadata and updates its open editor", async () => {
    fs.files.set(chapterPath, markdown("旧标题"))
    const tree = await fs.listDirectory(project.path)
    act(() => useWikiStore.getState().setFileTree(tree))
    await flush()
    expect(container.textContent).toContain("旧标题")
    const applyMarkdown = vi.fn()
    registerOpenDocument({ path: chapterPath, isDirty: () => false, applyMarkdown })
    await act(async () => {
      await saveProjectDocument({ projectPath: project.path, path: chapterPath, content: markdown("新标题") })
    })
    await flush()
    expect(container.textContent).toContain("新标题")
    expect(container.textContent).not.toContain("旧标题")
    expect(applyMarkdown).toHaveBeenCalledWith(markdown("新标题"))
  })

  it("refreshes after formatting the saved chapter", async () => {
    fs.files.set(chapterPath, markdown("排版章节"))
    await act(async () => { await formatProjectChapter({ projectPath: project.path, path: chapterPath }) })
    await flush()
    expect(fs.files.get(chapterPath)).toContain("　　正文。")
    expect(container.textContent).toContain("排版章节")
    expect(useWikiStore.getState().dataVersion).toBe(1)
  })

  it("does not refresh or change the editor after a failed disk write", async () => {
    fs.writeFileAtomic.mockRejectedValueOnce(new Error("磁盘错误"))
    const applyMarkdown = vi.fn()
    registerOpenDocument({ path: chapterPath, isDirty: () => false, applyMarkdown })
    await expect(saveProjectDocument({ projectPath: project.path, path: chapterPath, content: "正文" })).rejects.toThrow("磁盘错误")
    expect(fs.listDirectory).not.toHaveBeenCalled()
    expect(applyMarkdown).not.toHaveBeenCalled()
    expect(useWikiStore.getState().dataVersion).toBe(0)
  })

  it("keeps dirty editor protection and refreshes an explicitly authorized overwrite", async () => {
    const applyMarkdown = vi.fn()
    registerOpenDocument({ path: chapterPath, isDirty: () => true, applyMarkdown })
    const input = { projectPath: project.path, path: chapterPath, content: markdown("覆盖章节") }
    await expect(saveProjectDocument(input)).rejects.toThrow("未保存的修改")
    expect(fs.writeFileAtomic).not.toHaveBeenCalled()
    expect(fs.listDirectory).not.toHaveBeenCalled()
    await act(async () => { await saveProjectDocument({ ...input, overwrite: true }) })
    await flush()
    expect(container.textContent).toContain("覆盖章节")
    expect(applyMarkdown).toHaveBeenCalledWith(input.content)
  })

  it("does not refresh another project's UI when the project changes during saving", async () => {
    const otherProject = { id: "other", name: "other", path: "/other" }
    fs.writeFileAtomic.mockImplementationOnce(async () => { useWikiStore.setState({ project: otherProject }) })
    await act(async () => {
      await saveProjectDocument({ projectPath: project.path, path: chapterPath, content: markdown("旧项目章节") })
    })
    expect(fs.listDirectory).not.toHaveBeenCalledWith(project.path, expect.anything())
    expect(useWikiStore.getState().fileTree).toEqual([])
    expect(useWikiStore.getState().dataVersion).toBe(0)
  })

  it("discards a pending tree refresh after switching projects", async () => {
    fs.listDirectory.mockImplementationOnce(async () => {
      useWikiStore.setState({ project: { id: "other", name: "other", path: "/other" } })
      return [{ name: "第1章.md", path: chapterPath, is_dir: false }]
    })
    await act(async () => {
      await saveProjectDocument({ projectPath: project.path, path: chapterPath, content: markdown("旧项目章节") })
    })
    expect(useWikiStore.getState().fileTree).toEqual([])
    expect(useWikiStore.getState().dataVersion).toBe(0)
  })
})
