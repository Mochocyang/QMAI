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
    expect(source).not.toContain('import { runBulkChapterIngest } from')
    expect(source).toContain("runBulkChapterIngest(projectPath, {")
    // 两种范围都交给共享实现，入口不能写死全量提取。
    expect(source).toContain('handleExtractAllChapterMemories("all")')
    expect(source).toContain('handleExtractAllChapterMemories("pending")')
    expect(source).not.toContain('mode: "all"')
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

describe("KnowledgeTree 新建人物角色入口", () => {
  it("创建菜单与文档右键菜单都提供「新建人物角色」，且只在大纲视图出现", () => {
    // 两个入口必须是同一句 kind: "persona"：漏掉右键那个，用户会以为功能时有时无
    const matches = source.match(/kind: "persona"/g) ?? []
    expect(matches.length).toBe(2)
    // 章节视图没有人物小传概念，条件必须写死 outline
    const guard = source.match(/\{filterType === "outline" && \(/g) ?? []
    expect(guard.length).toBeGreaterThanOrEqual(2)
    expect(source).toContain('t("sidebar.newPersonaRole")')
    expect(source).toContain("UserPlus")
  })

  it("persona 不会被当成普通文件创建", () => {
    // 它要开档案面板，不能落进 pendingCreate 的取名流程
    expect(source).not.toContain('kind: filterType === "chapter" ? "volume" : "persona"')
  })
})
describe("KnowledgeTree 人物小传文件夹保护", () => {
  it("删文件夹前先拦受保护文件夹，且提示全中文", () => {
    expect(source).toContain("isProtectedOutlineFolder(folderNode.name)")
    expect(source).toContain('t("knowledgeTree.protectedFolderAlert")')
    // 拦截必须在本次删除动作真正动手之前，否则保护形同虚设：
    // 只看首个 moveFileToTrash 会误判，它属于上面的单文件删除函数。
    const folderStart = source.indexOf("const handleDeleteFolder")
    const guardAt = source.indexOf("isProtectedOutlineFolder(folderNode.name)")
    const deleteAt = source.indexOf("moveFileToTrash", folderStart)
    expect(folderStart).toBeGreaterThan(-1)
    expect(guardAt).toBeGreaterThan(folderStart)
    expect(deleteAt).toBeGreaterThan(guardAt)
  })

  it("只保护文件夹，不拦单个角色文件删除", () => {
    // 单个文件删除走 handleDeleteClick，那段里不该出现保护判断
    const deletePageStart = source.indexOf("const handleDeleteClick")
    const deleteFolderStart = source.indexOf("const handleDeleteFolder")
    expect(deletePageStart).toBeGreaterThan(-1)
    expect(deleteFolderStart).toBeGreaterThan(deletePageStart)
    const pageSlice = source.slice(deletePageStart, deleteFolderStart)
    expect(pageSlice).not.toContain("isProtectedOutlineFolder")
  })
})
describe("KnowledgeTree 删大纲时清理人物引用", () => {
  it("删大纲后调 detachOutlineRef，且失败只 warn 不影响删除", () => {
    expect(source).toContain("detachOutlineRef(projectPath, outlineFileName)")
    const callAt = source.indexOf("detachOutlineRef(projectPath, outlineFileName)")
    // 必须在文件真的移入回收站之后：先删文件再解引用，否则解引用成功但删除失败反而更糟
    const trashAt = source.indexOf("moveFileToTrash(projectPath, pagePath, filterType)")
    expect(trashAt).toBeGreaterThan(-1)
    expect(callAt).toBeGreaterThan(trashAt)
    // 失败不能冒泡：删大纲已经成功，清理失败只该留日志
    expect(source).toContain("清理人物小传引用失败")
  })

  it("只解引用，不在删大纲时删除角色", () => {
    // 连带删除必须由用户显式选择，不能用删大纲顺手把角色带走
    const callAt = source.indexOf("detachOutlineRef(projectPath, outlineFileName)")
    const slice = source.slice(Math.max(0, callAt - 400), callAt + 400)
    expect(slice).not.toContain("deleteFile")
    expect(slice).not.toContain("deletePersona")
  })
})
describe("KnowledgeTree 删大纲的连带提示", () => {
  it("先问再删：弹窗与档案操作都在移入回收站之前", () => {
    const dialogAt = source.indexOf('t("knowledgeTree.personaDetachConfirm"')
    const trashAt = source.indexOf("moveFileToTrash(projectPath, pagePath, filterType)")
    expect(dialogAt).toBeGreaterThan(-1)
    expect(trashAt).toBeGreaterThan(dialogAt)
  })

  it("只在大纲分支提示，章节不弹", () => {
    expect(source).toContain('if (filterType !== "chapter") {')
  })

  it("确定＝按规则移除，取消＝全部保留转潜伏", () => {
    expect(source).toContain("removePersonaFromProject(projectPath, plan.removals)")
    expect(source).toContain("keepPersonaAfterOutlineDelete(projectPath, outlineFileName)")
    // 受保护角色（manual / pinned / 被引用）不进入 removals，由 planPersonaDetach 决定
    expect(source).toContain("planPersonaDetach({ outlineFileName, skills: personaIndex.skills })")
  })

  it("人物小传处理失败不拦住删大纲", () => {
    expect(source).toContain("处理人物小传关联失败")
    // 该 try/catch 必须包住整段，且外层仍继续走删除流程
    const catchAt = source.indexOf("处理人物小传关联失败")
    expect(catchAt).toBeGreaterThan(-1)
    expect(source.indexOf("moveFileToTrash(projectPath, pagePath, filterType)")).toBeGreaterThan(catchAt)
  })
})