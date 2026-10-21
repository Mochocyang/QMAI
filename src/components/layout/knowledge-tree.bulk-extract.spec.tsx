// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { runBulkChapterIngest } = vi.hoisted(() => ({ runBulkChapterIngest: vi.fn() }))
vi.mock("@/lib/novel/chapter-bulk-ingest", () => ({ runBulkChapterIngest }))
vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(async (path: string) => path.endsWith("/wiki/chapters") ? [{
    name: "chapter-001.md", path: `${path}/chapter-001.md`, is_dir: false,
  }] : []),
  readFile: vi.fn(async () => "---\nchapter_number: 1\ntitle: 第1章\n---\n正文。"),
  fileExists: vi.fn(async () => false),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  openFileLocation: vi.fn(),
  copyFile: vi.fn(),
}))

import { KnowledgeTree } from "./knowledge-tree"
import { useWikiStore } from "@/stores/wiki-store"
import { useImportProgressStore } from "@/stores/import-progress-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const projectPath = "D:/Books/test"
const chapterPath = `${projectPath}/wiki/chapters/chapter-001.md`
let root: Root
let container: HTMLDivElement

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
  expect(button, label).toBeDefined()
  act(() => button!.click())
}

async function openExtractionDialog() {
  const row = container.querySelector(`[data-page-path="${chapterPath}"]`)
  expect(row).not.toBeNull()
  act(() => row!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })))
  clickButton("一键提取所有章节")
  await flush()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("选择章节提取范围")
  expect(runBulkChapterIngest).not.toHaveBeenCalled()
}

describe("章节右键批量提取范围", () => {
  beforeEach(async () => {
    runBulkChapterIngest.mockReset().mockResolvedValue({ total: 1, succeeded: 1, failed: 0, failures: [], cancelled: false })
    useImportProgressStore.setState({ tasks: [] })
    useWikiStore.setState({
      project: { id: "test", name: "test", path: projectPath },
      novelMode: true,
      selectedFile: null,
      fileTree: [{
        name: "wiki", path: `${projectPath}/wiki`, is_dir: true, children: [{
          name: "chapters", path: `${projectPath}/wiki/chapters`, is_dir: true, children: [{
            name: "chapter-001.md", path: chapterPath, is_dir: false,
          }],
        }],
      }],
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<KnowledgeTree filterType="chapter" />))
    await flush()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useWikiStore.setState(useWikiStore.getInitialState())
    useImportProgressStore.setState({ tasks: [] })
  })

  it.each([
    ["全部提取", "all"],
    ["仅提取未提取章节", "pending"],
  ])("选择 %s 后才开始对应范围的提取", async (label, mode) => {
    await openExtractionDialog()
    clickButton(label)
    await flush()
    expect(runBulkChapterIngest).toHaveBeenCalledExactlyOnceWith(projectPath, {
      mode,
      chapters: [expect.objectContaining({ path: chapterPath, chapterNumber: 1 })],
    })
  })

  it("取消后不启动提取", async () => {
    await openExtractionDialog()
    clickButton("取消")
    await flush()
    expect(runBulkChapterIngest).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
