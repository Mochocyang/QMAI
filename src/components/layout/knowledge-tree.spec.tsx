import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "knowledge-tree.tsx"), "utf8")
const previewSource = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")

describe("KnowledgeTree chapter memory extraction menu", () => {
  it("positions the chapter directory once its async file tree is rendered", () => {
    expect(source).toContain("scrollChapterDirectory(container, selectedChapterPath)")
    expect(source).toContain('filterType !== "chapter" || !project || sectionNodes.length === 0')
    expect(source).toContain("isChapterPathInProject(selectedFile, projectPath)")
    expect(source).toContain("previousScroll.selectedChapterPath !== null || selectedChapterPath === null")
  })

  it("places one-click all chapter memory extraction in the chapter right-click menu", () => {
    expect(source).toContain("handleExtractAllChapterMemories")
    expect(source).toContain("一键提取所有章节")
    expect(source).toContain('filterType === "chapter" && pageMenu')
    expect(source).toContain("sortedChapterPages.map((page) => page.path)")
    expect(previewSource).not.toContain("一键提取所有章节")
  })

  /*
   * 进度、取消、逐章点亮灰点这些「界面反馈」只允许有一份实现。
   * 右键菜单与侧边栏那枚图标都必须走 chapter-bulk-ingest 的共享入口；
   * 谁再自己抄一遍循环，这条就会红。
   */
  it("delegates to the shared bulk ingest used by the sidebar one-click entry", () => {
    // 必须是动态 import：这棵树刻意不在顶层拖进 chapter-ingest 的整个模块图
    expect(source).toContain('const { runBulkChapterIngest } = await import("@/lib/novel/chapter-bulk-ingest")')
    expect(source).not.toContain('from "@/lib/novel/chapter-bulk-ingest"')
    expect(source).toContain("runBulkChapterIngest(projectPath, {")
    // 右键菜单的语义是「重新提取所有章节」，不能悄悄变成「只补未提取的」
    expect(source).toContain('mode: "all"')
    expect(source).toContain("chapters: sortedChapterPages.map((page) => ({")
    // 树算不出章号时靠文件名数字兜底，不传就会被整章跳过
    expect(source).toContain("fileChapterNumber: page.fileChapterNumber")
    // 提取完必须刷新列表，否则新提取的章节看不出变化
    expect(source).toContain("await loadPages()")
    expect(source).toContain("const tree = await listDirectory(projectPath)")
    expect(source).toContain("bumpDataVersion()")
    // 自己抄一份进度循环的痕迹必须消失
    expect(source).not.toContain("useImportProgressStore.getState().startTask")
    expect(source).not.toContain('const { ingestChapter } = await import("@/lib/novel/chapter-ingest")')
  })

  it("dispatches deleted chapter memory cleanup without awaiting it", () => {
    expect(source).toContain("enqueueDeletedChapterSourceMemoryCleanup")
    expect(source).toContain('void import("@/lib/novel/delete-source-memory")')
    expect(source).not.toContain("await cleanupDeletedSourceMemory")
    expect(source).toContain("await cleanupDeletedOutlineSourceMemory")
  })

  it("removes deleted chapter rows optimistically without showing chapter loading", () => {
    expect(source).toContain("setPages((previous) => previous.filter((page) => page.path !== pagePath))")
    expect(source).toContain('const showDeleteLoading = filterType === "outline" && isDeleting')
    expect(source).toContain("mapWithConcurrency(files, PAGE_METADATA_CONCURRENCY")
    expect(source).toContain('listDirectory(`${projectPath}/wiki/chapters`)')
    expect(source).toContain('listDirectory(`${projectPath}/wiki/outlines`)')
  })

  it("counts processing de-AI tasks in the sidebar running total", () => {
    expect(source).toContain("selectProjectDeAiTasks")
    expect(source).toContain("selectProjectDeAiTasks(deAiTasks, project?.path)")
    expect(source).toContain('t.status === "processing"')
    expect(source).toContain("const processingDeAiTasks = projectDeAiTasks.filter((t) => t.status === \"processing\")")
    expect(source).toContain("const runningCount = runningTasks.length + processingDeAiTasks.length")
    expect(source).toContain("{runningCount} 个任务运行中")
    expect(source).not.toContain("{runningTasks.length} 个任务运行中")
  })

  it("renders running de-AI tasks above settled import rows and keeps recent finished import tasks", () => {
    expect(source).toContain("useImportProgressStore.getState().pruneSettledTasks()")
    expect(source).toContain("{processingDeAiTasks.map((task) => (")
    expect(source).toContain("{[...runningTasks, ...settledImportTasks].map((task) => {")
    expect(source).toContain("{settledDeAiTasks.map((task) => (")
    expect(source).not.toContain("{projectTasks.slice(0, 20).map((task) => {")
    expect(source).not.toContain("{projectDeAiTasks.map((task) => (")
  })
})
