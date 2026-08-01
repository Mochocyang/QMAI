/**
 * 章节写完后自动更新 wiki/tracking/ 追踪文件
 *
 * 从 JSON 存储加载最新数据，同步写入 Markdown 追踪文件，
 * 同时保持 JSON 文件兼容性。
 */

import { normalizePath } from "@/lib/path-utils"
import {
  loadCharacterStates,
  saveCharacterStates,
  type CharacterStateStore,
} from "./character-state"
import {
  loadForeshadowingTracker,
  saveForeshadowingTracker,
  type ForeshadowingStore,
} from "./foreshadowing-tracker"
import { loadTimeline } from "./timeline"
import {
  writeContextMd,
  writeForeshadowingMd,
  writeCharacterStateMd,
  writeTimelineMd,
} from "./tracking-files"
import type { WritingProgress, ResolvedForeshadowingRecord } from "./tracking-types"

/**
 * 章节完成后更新所有追踪文件
 *
 * @param projectPath - 项目路径
 * @param chapterNumber - 章节编号
 * @param chapterTitle - 章节标题
 * @param chapterBody - 章节正文（不含 frontmatter）
 * @param snapshotSummary - 章节快照摘要
 */
export async function updateTrackingAfterChapter(
  projectPath: string,
  chapterNumber: number,
  chapterTitle: string,
  _chapterBody: string,
  _snapshotSummary: string,
): Promise<void> {
  const pp = normalizePath(projectPath)

  // 1. 从 JSON 加载最新数据（已在 ingestChapter 中更新）
  const charStore: CharacterStateStore = await loadCharacterStates(pp)
  const fStore: ForeshadowingStore = await loadForeshadowingTracker(pp)
  const timeline = await loadTimeline(pp)

  // 2. 更新 角色状态.md
  try {
    await writeCharacterStateMd(pp, charStore)
  } catch (err) {
    console.warn("[TrackingUpdater] 角色状态.md 写入失败:", err instanceof Error ? err.message : err)
  }

  // 3. 更新 伏笔.md
  try {
    const resolvedRecords: ResolvedForeshadowingRecord[] = fStore.items
      .filter((f) => f.status === "resolved" && f.resolvedChapter != null)
      .map((f) => ({
        id: f.id,
        resolvedInChapter: f.resolvedChapter!,
        resolution: `伏笔「${f.name}」在第${f.resolvedChapter}章回收`,
      }))
    await writeForeshadowingMd(pp, fStore.items, resolvedRecords)
  } catch (err) {
    console.warn("[TrackingUpdater] 伏笔.md 写入失败:", err instanceof Error ? err.message : err)
  }

  // 4. 更新 时间线.md
  try {
    await writeTimelineMd(pp, timeline.entries)
  } catch (err) {
    console.warn("[TrackingUpdater] 时间线.md 写入失败:", err instanceof Error ? err.message : err)
  }

  // 5. 构建写作进度并写入 上下文.md
  try {
    const activeForeshadowing = fStore.items.filter(
      (f) => f.status !== "resolved" && f.status !== "abandoned",
    )
    const progress: WritingProgress = {
      lastCompletedChapter: chapterNumber,
      lastCompletedChapterTitle: chapterTitle,
      lastUpdated: new Date().toLocaleString("zh-CN"),
      currentArc: "进行中",
      activeForeshadowingCount: activeForeshadowing.length,
      keyPendingForeshadowing: activeForeshadowing.slice(0, 5).map((f) => f.name),
      relationshipStatus: "",
      nextChapterGuidance: "",
      notes: [],
    }
    await writeContextMd(pp, progress)
  } catch (err) {
    console.warn("[TrackingUpdater] 上下文.md 写入失败:", err instanceof Error ? err.message : err)
  }

  // 6. 写入 JSON 保持兼容（独立调用时确保数据持久化）
  try {
    await saveCharacterStates(pp, charStore)
    await saveForeshadowingTracker(pp, fStore)
  } catch (err) {
    console.warn("[TrackingUpdater] JSON 持久化失败:", err instanceof Error ? err.message : err)
  }
}