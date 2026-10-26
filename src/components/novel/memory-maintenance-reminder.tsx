import { useEffect } from "react"
import { subscribeProjectFileMutations } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { toast } from "@/lib/toast"
import { claimMemoryMaintenanceReminder, loadMemoryMaintenanceOverview } from "@/lib/novel/memory-maintenance"

/** Cheap local checks only. No model calls and no automatic deletion. */
export function MemoryMaintenanceReminder() {
  const project = useWikiStore((s) => s.project)
  const novelMode = useWikiStore((s) => s.novelMode)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  useEffect(() => {
    if (!project || !novelMode) return
    const captured = project
    let cancelled = false, generation = 0
    const isCurrent = () => !cancelled && useWikiStore.getState().project?.path === captured.path
    const check = async (revision: number) => {
      try {
        const overview = await loadMemoryMaintenanceOverview(captured.path)
        if (!isCurrent() || revision !== generation) return
        const warnings = await claimMemoryMaintenanceReminder(captured.path, overview)
        if (!warnings.length || !isCurrent() || revision !== generation) return
        toast.info(`${warnings.join("；")}。建议到维护工具扫描并主动清理。`, {
          title: "写作记忆数量较多", dedupeKey: `memory-maintenance:${captured.path}`,
          action: { label: "去清理", onClick: () => {
            if (useWikiStore.getState().project?.path !== captured.path) return
            useWikiStore.getState().setActiveView("maintenance")
          } },
        })
      } catch (error) { console.warn("[MemoryMaintenance] 自动检查失败:", error) }
    }
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => { const revision = ++generation; clearTimeout(timer); timer = setTimeout(() => { void check(revision) }, 1500) }
    const unsubscribe = subscribeProjectFileMutations(({ path }) => {
      if (path.startsWith(captured.path + "/") && /\/\.novel\/(?:cognition-state|character-states|foreshadowing-tracker|timeline)\.json$/.test(path)) schedule()
    })
    schedule()
    return () => { cancelled = true; clearTimeout(timer); unsubscribe() }
  }, [project?.path, novelMode, dataVersion])
  return null
}
