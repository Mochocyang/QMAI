/**
 * 跨作品剧情框架库 - 持久化读写
 *
 * 设计依据：方案 B 远期目标——框架作为顶层共享实体，可被多个拆文项目/章纲引用。
 *
 * 存储路径：{projectPath}/.qmai/plot-frameworks/library.json
 * 与拆文库 {projectPath}/.qmai/dismantling/library.json 同级，符合现有 .qmai 数据约定。
 *
 * 跨作品共享：同一个框架可被多个 DismantlingProject 拆出，通过 sourceDismantlingProjectId 追溯。
 * 主线/支线：每个框架标注 main/sub，主线按时间串联保证主线不乱。
 */

import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  applyAutoPacing,
  emptyPlotFrameworkLibrary,
  normalizePlotFramework,
  normalizePlotFrameworkLibrary,
  type PlotFramework,
  type PlotFrameworkLibrary,
  type PlotFrameworkSnapshot,
} from "./plot-framework"

/** 框架库存储目录 */
function getPlotFrameworkLibraryDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/plot-frameworks`
}

/** 框架库存储文件路径 */
export function getPlotFrameworkLibraryPath(projectPath: string): string {
  return `${getPlotFrameworkLibraryDir(projectPath)}/library.json`
}

/** 加载跨作品框架库（不存在则返回空库） */
export async function loadPlotFrameworkLibrary(projectPath: string): Promise<PlotFrameworkLibrary> {
  const path = getPlotFrameworkLibraryPath(projectPath)
  if (!(await fileExists(path))) return emptyPlotFrameworkLibrary()
  try {
    const parsed = JSON.parse(await readFile(path)) as Partial<PlotFrameworkLibrary>
    return normalizePlotFrameworkLibrary(parsed)
  } catch {
    return emptyPlotFrameworkLibrary()
  }
}

/** 保存跨作品框架库（写入前再做一次归一化，确保去重与排序） */
export async function savePlotFrameworkLibrary(
  projectPath: string,
  library: PlotFrameworkLibrary,
): Promise<void> {
  await createDirectory(getPlotFrameworkLibraryDir(projectPath)).catch(() => {})
  const normalized = normalizePlotFrameworkLibrary(library)
  await writeFile(getPlotFrameworkLibraryPath(projectPath), JSON.stringify(normalized, null, 2))
}

/**
 * 写入或更新单个框架到库
 * - 同 id 框架会被覆盖（保留 updatedAt 最新者）
 * - 自动应用 AI 节奏初判（用户手动校正过的不覆盖）
 * - 返回入库后的最终框架（已含自动节奏）
 */
export async function upsertPlotFramework(
  projectPath: string,
  framework: PlotFramework,
): Promise<PlotFramework> {
  const library = await loadPlotFrameworkLibrary(projectPath)
  const normalized = normalizePlotFramework(framework)
  if (!normalized) {
    throw new Error("剧情框架四段不完整，拒绝写入跨作品框架库（防半成品污染）")
  }

  // 自动节奏初判（用户已手动校正过的保留）
  const withPacing = applyAutoPacing(normalized)

  // 同 id 覆盖；新增则追加
  const idx = library.frameworks.findIndex((f) => f.id === withPacing.id)
  if (idx >= 0) {
    const existing = library.frameworks[idx]
    // 若正文发生变化，先生成上一版本快照存入 history
    if (isContentChanged(existing, withPacing)) {
      const snapshot = createSnapshot(existing)
      withPacing.history = [...(existing.history || []), snapshot].slice(-20)
    } else {
      withPacing.history = existing.history || []
    }
    library.frameworks[idx] = withPacing
  } else {
    library.frameworks.push(withPacing)
  }

  await savePlotFrameworkLibrary(projectPath, library)
  return withPacing
}

/** 判断框架正文是否发生实质性变化（决定是否要存历史快照） */
function isContentChanged(prev: PlotFramework, next: PlotFramework): boolean {
  return (
    prev.title !== next.title ||
    prev.beats.hook !== next.beats.hook ||
    prev.beats.buildup !== next.beats.buildup ||
    prev.beats.payoff !== next.beats.payoff ||
    prev.beats.endingHook !== next.beats.endingHook ||
    prev.directionHints !== next.directionHints ||
    prev.handcraftHints !== next.handcraftHints ||
    prev.reusableTemplate !== next.reusableTemplate
  )
}

/** 为框架创建版本快照 */
function createSnapshot(fw: PlotFramework): PlotFrameworkSnapshot {
  return {
    savedAt: fw.updatedAt,
    title: fw.title,
    beats: { ...fw.beats },
    directionHints: fw.directionHints,
    handcraftHints: fw.handcraftHints,
    reusableTemplate: fw.reusableTemplate,
  }
}

/** 批量入库（用于一次拆文批量产出多个框架的场景） */
export async function upsertPlotFrameworks(
  projectPath: string,
  frameworks: PlotFramework[],
): Promise<PlotFramework[]> {
  if (frameworks.length === 0) return []
  const library = await loadPlotFrameworkLibrary(projectPath)
  const accepted: PlotFramework[] = []

  for (const raw of frameworks) {
    const normalized = normalizePlotFramework(raw)
    if (!normalized) continue // 跳过半成品，不阻断整批
    const withPacing = applyAutoPacing(normalized)
    const idx = library.frameworks.findIndex((f) => f.id === withPacing.id)
    if (idx >= 0) library.frameworks[idx] = withPacing
    else library.frameworks.push(withPacing)
    accepted.push(withPacing)
  }

  await savePlotFrameworkLibrary(projectPath, library)
  return accepted
}

/** 按 id 移除框架 */
export async function removePlotFramework(projectPath: string, frameworkId: string): Promise<void> {
  const library = await loadPlotFrameworkLibrary(projectPath)
  library.frameworks = library.frameworks.filter((f) => f.id !== frameworkId)
  await savePlotFrameworkLibrary(projectPath, library)
}

/** 按 id 查询单个框架 */
export async function findPlotFramework(
  projectPath: string,
  frameworkId: string,
): Promise<PlotFramework | null> {
  const library = await loadPlotFrameworkLibrary(projectPath)
  return library.frameworks.find((f) => f.id === frameworkId) ?? null
}

/**
 * 用户手动校正框架节奏（pacing）
 * - 设置 autoPacing=false（标记为用户已校正，后续 AI 初判不再覆盖）
 * - 更新 updatedAt
 */
export async function manualAdjustPlotFrameworkPacing(
  projectPath: string,
  frameworkId: string,
  pacing: NonNullable<PlotFramework["pacing"]>,
): Promise<PlotFramework | null> {
  const library = await loadPlotFrameworkLibrary(projectPath)
  const idx = library.frameworks.findIndex((f) => f.id === frameworkId)
  if (idx === -1) return null
  library.frameworks[idx] = {
    ...library.frameworks[idx],
    pacing,
    autoPacing: false,
    updatedAt: Date.now(),
  }
  await savePlotFrameworkLibrary(projectPath, library)
  return library.frameworks[idx]
}
