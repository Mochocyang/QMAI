/**
 * Centralized reset of all per-project state.
 * MUST be called (and AWAITED) both when leaving a project and when opening a
 * new one, to prevent cross-project data contamination.
 *
 * Returns once every store/cache has actually been cleared so the caller can
 * trust that downstream project-opening steps will not race with lingering
 * cleanup.
 */

import { pauseQueue as pauseIngestQueue } from "@/lib/ingest-queue"
import { useActivityStore } from "@/stores/activity-store"
import { useChatStore } from "@/stores/chat-store"
import { useFavoriteSkillStore } from "@/stores/favorite-skill-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useReviewStore } from "@/stores/review-store"

export function resetProjectStores(): void {
  useChatStore.setState({
    conversations: [],
    messages: [],
    activeConversationId: null,
    mode: "chat",
    ingestSource: null,
    streamingContents: {},
  })

  useOutlineChatStore.setState({
    conversations: [],
    activeConversationId: null,
    streamingContents: {},
    runStates: {},
    pendingReferenceTokens: [],
    loaded: false,
  })

  useReviewStore.setState({
    items: [],
  })

  useActivityStore.setState({
    items: [],
  })

  // v4 R7：重置收藏 store 状态
  // 只清空 currentProjectPath（退出项目后无当前项目）
  // favorites 全局数据保留；loaded 保持 true（数据已加载，无需重新加载，退出项目后仍可查看收藏 Tab）
  useFavoriteSkillStore.setState({
    currentProjectPath: "",
  })
}

export async function resetProjectState(): Promise<void> {
  resetProjectStores()

  // View-switch restore key is process-global; clear so the next project cannot
  // reopen another book's chapter via icon-sidebar session restore.
  try {
    sessionStorage.removeItem("lk-last-chapter-path")
  } catch {
    /* ignore quota / unavailable storage */
  }

  const [dedupQueueMod, foreshadowingCleanupQueueMod, graphMod, fileSyncMod, scheduledImportMod] =
    await Promise.allSettled([
      import("@/lib/dedup-queue"),
      import("@/lib/foreshadowing-cleanup-queue"),
      import("@/lib/graph-relevance"),
      import("@/lib/project-file-sync"),
      import("@/lib/scheduled-import"),
    ])

  if (scheduledImportMod.status === "fulfilled") {
    try {
      scheduledImportMod.value.stopScheduledImport()
    } catch (err) {
      console.warn("[Reset Project State] stopScheduledImport failed:", err)
    }
  } else {
    console.warn("[Reset Project State] Failed to load scheduled-import:", scheduledImportMod.reason)
  }

  try {
    // Flush active ingest work to disk before the next project restores its own queue.
    await pauseIngestQueue()
  } catch (err) {
    console.warn("[Reset Project State] pauseQueue failed:", err)
  }

  if (dedupQueueMod.status === "fulfilled") {
    try {
      await dedupQueueMod.value.pauseQueue()
    } catch (err) {
      console.warn("[Reset Project State] dedup pauseQueue failed:", err)
    }
  } else {
    console.warn("[Reset Project State] Failed to load dedup-queue:", dedupQueueMod.reason)
  }

  if (foreshadowingCleanupQueueMod.status === "fulfilled") {
    try {
      await foreshadowingCleanupQueueMod.value.pauseForeshadowingCleanupQueue()
    } catch (err) {
      console.warn("[Reset Project State] foreshadowing cleanup pauseQueue failed:", err)
    }
  } else {
    console.warn(
      "[Reset Project State] Failed to load foreshadowing-cleanup-queue:",
      foreshadowingCleanupQueueMod.reason,
    )
  }

  if (graphMod.status === "fulfilled") {
    try {
      graphMod.value.clearGraphCache()
    } catch (err) {
      console.warn("[Reset Project State] clearGraphCache failed:", err)
    }
  } else {
    console.warn("[Reset Project State] Failed to load graph-relevance:", graphMod.reason)
  }

  if (fileSyncMod.status === "fulfilled") {
    try {
      await fileSyncMod.value.stopProjectFileSync()
    } catch (err) {
      console.warn("[Reset Project State] stopProjectFileSync failed:", err)
    }
  } else {
    console.warn("[Reset Project State] Failed to load project-file-sync:", fileSyncMod.reason)
  }
}
