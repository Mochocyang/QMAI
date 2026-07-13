import { useEffect, useMemo, useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { collectAllProjectSources, EXPORT_SOURCES } from "@/lib/export-center/collectors"
import { exportDocuments } from "@/lib/export-center/export-service"
import type { ExportDocument, ExportFormat, ExportSource } from "@/lib/export-center/types"
import { loadRegistry } from "@/lib/project-identity"
import type { WikiProject } from "@/types/wiki"

interface ExportCenterSectionProps {
  currentProject?: WikiProject | null
}

interface SelectableProject extends WikiProject {
  lastOpened: number
}

const SOURCE_LABELS: Record<ExportSource, string> = {
  chapters: "章节",
  outlines: "大纲",
  "book-analysis": "拆书库",
  "story-simulation": "剧情推演室",
  "soul-works": "灵魂作品",
}

function emptySources(): Record<ExportSource, ExportDocument[]> {
  return {
    chapters: [],
    outlines: [],
    "book-analysis": [],
    "story-simulation": [],
    "soul-works": [],
  }
}

export function ExportCenterSection({ currentProject }: ExportCenterSectionProps) {
  const [projects, setProjects] = useState<SelectableProject[]>(() => currentProject
    ? [{ ...currentProject, lastOpened: Number.MAX_SAFE_INTEGER }]
    : [])
  const [selectedProjectId, setSelectedProjectId] = useState(currentProject?.id ?? "")
  const [documentsBySource, setDocumentsBySource] = useState(emptySources)
  const [selectedSources, setSelectedSources] = useState<Set<ExportSource>>(new Set())
  const [format, setFormat] = useState<ExportFormat>("txt")
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [message, setMessage] = useState("")
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadRegistry().then((registry) => {
      if (cancelled) return
      const merged = new Map<string, SelectableProject>()
      for (const entry of Object.values(registry)) merged.set(entry.id, entry)
      if (currentProject) {
        merged.set(currentProject.id, {
          ...currentProject,
          lastOpened: merged.get(currentProject.id)?.lastOpened ?? Number.MAX_SAFE_INTEGER,
        })
      }
      const next = Array.from(merged.values()).sort((a, b) => b.lastOpened - a.lastOpened)
      setProjects(next)
      setSelectedProjectId((value) => value || next[0]?.id || "")
    }).catch(() => {
      if (!cancelled) setMessage("读取项目列表失败，请稍后重试。")
    })
    return () => { cancelled = true }
  }, [currentProject])

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  useEffect(() => {
    let cancelled = false
    setSelectedSources(new Set())
    setDocumentsBySource(emptySources())
    setMessage("")
    if (!selectedProject) return () => { cancelled = true }

    setIsLoading(true)
    collectAllProjectSources(selectedProject).then((sources) => {
      if (!cancelled) setDocumentsBySource(sources)
    }).catch((error) => {
      if (!cancelled) {
        const detail = error instanceof Error && error.message ? `：${error.message}` : ""
        setMessage(`读取可导出内容失败${detail}`)
      }
    }).finally(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedProject])

  function toggleSource(source: ExportSource) {
    setSelectedSources((current) => {
      const next = new Set(current)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  async function handleExport() {
    const documents = EXPORT_SOURCES.flatMap((source) => selectedSources.has(source) ? documentsBySource[source] : [])
    if (documents.length === 0) {
      setMessage("请先选择至少一类可导出内容。")
      return
    }
    setIsExporting(true)
    setMessage("")
    try {
      const result = await exportDocuments(documents, format, undefined, () => mountedRef.current)
      if (!mountedRef.current) return
      setMessage(result.status === "cancelled"
        ? "已取消导出，未继续写入文件。"
        : `已成功导出 ${result.exportedCount} 个文件。`)
    } catch (error) {
      if (!mountedRef.current) return
      const detail = error instanceof Error && error.message ? error.message : "未知错误"
      setMessage(`导出失败：${detail}`)
    } finally {
      if (mountedRef.current) setIsExporting(false)
    }
  }

  const controlsDisabled = isLoading || isExporting
  const selectedDocumentCount = EXPORT_SOURCES.reduce(
    (total, source) => total + (selectedSources.has(source) ? documentsBySource[source].length : 0),
    0,
  )

  return (
    <div data-export-center-scroll className="max-h-[calc(100vh-7rem)] space-y-6 overflow-y-auto pr-1">
      <div>
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">统一导出中心</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          只读汇总项目内容，导出为 UTF-8 TXT 或真实 Word DOCX，不会修改源文件。
        </p>
      </div>

      <section className="space-y-3 rounded-md border bg-card p-4">
        <label className="block text-sm font-medium" htmlFor="export-project">选择项目</label>
        <select
          id="export-project"
          value={selectedProjectId}
          onChange={(event) => setSelectedProjectId(event.target.value)}
          disabled={controlsDisabled || projects.length === 0}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {projects.length === 0 ? <option value="">暂无可用项目</option> : null}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </section>

      <fieldset className="space-y-3 rounded-md border bg-card p-4">
        <legend className="px-1 text-sm font-medium">选择导出内容</legend>
        <div>
          <p className="mt-1 text-xs text-muted-foreground">没有内容的类别不可选择；每部作品保存为独立文件。</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {EXPORT_SOURCES.map((source) => {
            const count = documentsBySource[source].length
            const unavailable = count === 0
            return (
              <label key={source} className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${unavailable ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-accent/50"}`}>
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    value={source}
                    checked={selectedSources.has(source)}
                    onChange={() => toggleSource(source)}
                    disabled={controlsDisabled || unavailable}
                  />
                  {SOURCE_LABELS[source]}
                </span>
                <span className="text-xs text-muted-foreground">{isLoading ? "读取中" : unavailable ? "无内容" : `${count} 个文件`}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-md border bg-card p-4">
        <legend className="px-1 text-sm font-medium">导出格式</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/50">
            <input type="radio" name="export-format" value="txt" checked={format === "txt"} onChange={() => setFormat("txt")} disabled={controlsDisabled} />
            UTF-8 TXT
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/50">
            <input type="radio" name="export-format" value="docx" checked={format === "docx"} onChange={() => setFormat("docx")} disabled={controlsDisabled} />
            Word DOCX
          </label>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p role="status" className="min-w-0 flex-1 text-sm text-muted-foreground">
          {message || (selectedDocumentCount > 0 ? `将导出 ${selectedDocumentCount} 个文件。` : "请选择要导出的内容。")}
        </p>
        <Button type="button" onClick={() => void handleExport()} disabled={controlsDisabled || !selectedProject || selectedDocumentCount === 0}>
          {isExporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在导出…</> : "开始导出"}
        </Button>
      </div>
    </div>
  )
}
