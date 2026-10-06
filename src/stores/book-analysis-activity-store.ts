import { create } from "zustand"
import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { toast } from "@/lib/toast"
import { useWikiStore } from "./wiki-store"
import { useBookAnalysisStore } from "./book-analysis-store"
import { analysisOutcomeChanges, type AnalysisOutcome } from "@/lib/novel/book-analysis/analysis-activity"
import type { BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"

const normalized = (path: string) => normalizePath(path).replace(/\/+$/, "")
const recordPath = (projectPath: string) => joinPath(projectPath, ".qmai", "book-analysis-notifications.json")
async function readOutcomes(projectPath: string): Promise<AnalysisOutcome[]> {
  const path = recordPath(projectPath)
  if (!(await fileExists(path))) return []
  const data: unknown = JSON.parse(await readFile(path))
  if (!Array.isArray(data)) throw new Error("拆书通知记录格式不正确，未覆盖原文件")
  return data.filter((item): item is AnalysisOutcome => Boolean(item && typeof item.id === "string"
    && item.projectPath === projectPath && ["completed", "failed"].includes(item.status)
    && typeof item.title === "string" && typeof item.message === "string" && typeof item.taskId === "string"))
}
interface ActivityState {
  projectPath: string | null; outcomes: AnalysisOutcome[]; error: string | null
  navigation: Pick<AnalysisOutcome, "projectPath" | "bookId" | "taskId" | "skill"> | null
  initializeProject(path: string): Promise<void>
  record(outcome: AnalysisOutcome): Promise<void>
}
export const useBookAnalysisActivityStore = create<ActivityState>((set, get) => ({
  projectPath: null, outcomes: [], error: null, navigation: null,
  async initializeProject(rawPath) {
    const path = normalized(rawPath)
    if (get().projectPath === path) return
    set({ projectPath: path, outcomes: [], error: null })
    try {
      const loaded = await readOutcomes(path)
      if (get().projectPath === path) set((state) => ({ outcomes: [...new Map([...loaded, ...state.outcomes].map((e) => [e.id, e])).values()] }))
    } catch (error) {
      if (get().projectPath === path) set({ error: error instanceof Error ? error.message : "通知记录读取失败" })
    }
  },
  async record(outcome) {
    const path = normalized(outcome.projectPath)
    if (get().projectPath === path) set((state) => ({ outcomes: [...state.outcomes.filter((e) => e.id !== outcome.id), outcome] }))
    await withProjectLock(`${path}#book-analysis-notifications`, async () => {
      const entries = await readOutcomes(path)
      await createDirectory(joinPath(path, ".qmai"))
      await writeFileAtomic(recordPath(path), JSON.stringify([...entries.filter((e) => e.id !== outcome.id), outcome], null, 2))
    })
  },
}))

export function openBookAnalysisOutcome(outcome: Pick<AnalysisOutcome, "projectPath" | "bookId" | "taskId" | "skill">): boolean {
  if (normalized(useWikiStore.getState().project?.path ?? "") !== normalized(outcome.projectPath)) {
    toast.info("请先打开该任务所属的项目，再查看拆书结果")
    return false
  }
  useBookAnalysisActivityStore.setState({ navigation: { projectPath: outcome.projectPath, bookId: outcome.bookId, taskId: outcome.taskId, skill: outcome.skill } })
  useBookAnalysisStore.getState().setSelectedLibraryBookId(outcome.bookId)
  useWikiStore.getState().setActiveView("bookAnalysis")
  return true
}

export function syncBookAnalysisActivities(
  next: { projectPath: string | null; tasks: BookAnalysisPipelineTask[] },
  previous: { projectPath: string | null; tasks: BookAnalysisPipelineTask[] },
) {
  if (!next.projectPath) return
  void useBookAnalysisActivityStore.getState().initializeProject(next.projectPath)
  if (next.projectPath !== previous.projectPath || next.tasks === previous.tasks) return
  for (const event of analysisOutcomeChanges(next.tasks, previous.tasks)) {
    void useBookAnalysisActivityStore.getState().record(event).catch(() => toast.error("拆书结果通知未能保存到后台活动，请检查磁盘后重试"))
    const show = event.status === "completed" ? toast.success : toast.error
    show(event.message, { title: event.title, persistent: true, dedupeKey: event.id, action: {
      label: event.status === "completed" ? "查看结果" : "查看任务", onClick: () => openBookAnalysisOutcome(event),
    } })
  }
}
