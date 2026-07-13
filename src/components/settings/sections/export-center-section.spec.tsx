// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ExportDocument, ExportSource } from "@/lib/export-center/types"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { collectMock, exportMock, registryMock } = vi.hoisted(() => ({
  collectMock: vi.fn(),
  exportMock: vi.fn(),
  registryMock: vi.fn(),
}))

vi.mock("@/lib/export-center/collectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export-center/collectors")>()
  return { ...actual, collectAllProjectSources: collectMock }
})
vi.mock("@/lib/export-center/export-service", () => ({ exportDocuments: exportMock }))
vi.mock("@/lib/project-identity", () => ({ loadRegistry: registryMock }))

import { ExportCenterSection } from "./export-center-section"

const chapterDocument: ExportDocument = {
  title: "长安夜雨-章节",
  source: "chapters",
  blocks: [{ title: "第一章", paragraphs: ["正文"] }],
}

function sourceResult(chapters: ExportDocument[] = [chapterDocument]): Record<ExportSource, ExportDocument[]> {
  return {
    chapters,
    outlines: [],
    "book-analysis": [],
    "story-simulation": [],
    "soul-works": [],
  }
}

describe("设置中的统一导出中心", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    registryMock.mockResolvedValue({
      p1: { id: "p1", name: "长安夜雨", path: "C:/Novel", lastOpened: 2 },
      p2: { id: "p2", name: "旧梦", path: "C:/Old", lastOpened: 1 },
    })
    collectMock.mockResolvedValue(sourceResult())
    exportMock.mockResolvedValue({ status: "success", exportedCount: 1 })
    await act(async () => {
      root.render(<ExportCenterSection currentProject={{ id: "p1", name: "长安夜雨", path: "C:/Novel" }} />)
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  it("提供项目、五类来源和格式选择，缺失来源禁用且内容区可滚动", () => {
    expect(host.textContent).toContain("统一导出中心")
    expect(host.querySelectorAll("select option")).toHaveLength(2)
    expect(host.textContent).toContain("章节")
    expect(host.textContent).toContain("大纲")
    expect(host.textContent).toContain("拆书库")
    expect(host.textContent).toContain("剧情推演室")
    expect(host.textContent).toContain("灵魂作品")
    expect(host.textContent).toContain("UTF-8 TXT")
    expect(host.textContent).toContain("Word DOCX")
    expect((host.querySelector('input[value="outlines"]') as HTMLInputElement).disabled).toBe(true)
    expect(host.querySelector("[data-export-center-scroll]")?.className).toContain("overflow-y-auto")
    expect(host.querySelectorAll("fieldset")).toHaveLength(2)
    expect(Array.from(host.querySelectorAll("legend")).map((legend) => legend.textContent)).toEqual(["选择导出内容", "导出格式"])
  })

  it("导出期间禁用操作并显示中文成功反馈", async () => {
    let finish: ((value: { status: "success"; exportedCount: number }) => void) | undefined
    exportMock.mockReturnValueOnce(new Promise((resolvePromise) => { finish = resolvePromise }))
    const chapter = host.querySelector('input[value="chapters"]') as HTMLInputElement
    const docx = host.querySelector('input[value="docx"]') as HTMLInputElement
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "开始导出") as HTMLButtonElement

    await act(async () => {
      chapter.click()
      docx.click()
    })
    await act(async () => { button.click() })

    expect(host.textContent).toContain("正在导出…")
    expect((Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "正在导出…") as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { finish?.({ status: "success", exportedCount: 1 }) })
    expect(exportMock).toHaveBeenCalledWith([chapterDocument], "docx", undefined, expect.any(Function))
    expect(host.textContent).toContain("已成功导出 1 个文件。")
  })

  it("组件卸载后守卫失效并阻止继续更新状态或打开后续保存窗口", async () => {
    let finish: ((value: { status: "success"; exportedCount: number }) => void) | undefined
    exportMock.mockReturnValueOnce(new Promise((resolvePromise) => { finish = resolvePromise }))
    const chapter = host.querySelector('input[value="chapters"]') as HTMLInputElement
    await act(async () => { chapter.click() })
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "开始导出") as HTMLButtonElement
    await act(async () => { button.click() })
    const guard = exportMock.mock.calls[0][3] as () => boolean
    expect(guard()).toBe(true)

    await act(async () => root.unmount())
    expect(guard()).toBe(false)
    await act(async () => { finish?.({ status: "success", exportedCount: 1 }) })
    root = createRoot(host)
  })

  it("导出失败时显示中文错误且恢复操作", async () => {
    exportMock.mockRejectedValueOnce(new Error("磁盘空间不足"))
    const chapter = host.querySelector('input[value="chapters"]') as HTMLInputElement
    await act(async () => { chapter.click() })
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "开始导出") as HTMLButtonElement

    await act(async () => { button.click() })

    expect(host.textContent).toContain("导出失败：磁盘空间不足")
    expect((Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "开始导出") as HTMLButtonElement).disabled).toBe(false)
  })

  it("以独立设置分类最小接入 settings-view", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/settings/settings-view.tsx"), "utf8")
    expect(source).toContain('| "export-center"')
    expect(source).toContain('id: "export-center"')
    expect(source).toContain("<ExportCenterSection currentProject={project} />")
  })
})
