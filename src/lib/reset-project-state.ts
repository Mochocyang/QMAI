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

  useReviewStore.setState({
    items: [],
  })

  useActivityStore.setState({
    items: [],
  })
}

export async function resetProjectState(): Promise<void> {
  resetProjectStores()

  const [dedupQueueMod, graphMod, fileSyncMod, scheduledImportMod] = await Promise.allSettled([
    import("@/lib/dedup-queue"),
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
