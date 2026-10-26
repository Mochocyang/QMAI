import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Brain, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { resolveDefaultModel, resolveModelConfig } from "@/lib/novel/model-resolver"
import { toast } from "@/lib/toast"
import { MEMORY_FIELDS, MEMORY_LABELS, type MemoryField } from "@/lib/novel/memory-cleanup-policy"
import { applyMemoryCleanup, keepMemoryCleanupIssue, loadMemoryCleanupScan, runMemoryCleanupScan, undoLastMemoryCleanup } from "@/lib/novel/memory-cleanup-runner"
import type { MemoryCleanupScan } from "@/lib/novel/memory-cleanup"
import {
  DEFAULT_MEMORY_MAINTENANCE, MAINTENANCE_KINDS, MAINTENANCE_LABELS, loadMemoryMaintenanceOverview,
  loadMemoryMaintenanceSettings, memoryMaintenanceWarnings, updateMemoryMaintenanceSettings,
  type MemoryMaintenanceOverview, type MemoryMaintenanceSettings,
} from "@/lib/novel/memory-maintenance"

export function MemoryCleanupTool() {
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const providers = useWikiStore((s) => s.providerConfigs)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [settings, setSettings] = useState<MemoryMaintenanceSettings>(DEFAULT_MEMORY_MAINTENANCE)
  const [overview, setOverview] = useState<MemoryMaintenanceOverview | null>(null)
  const [scan, setScan] = useState<MemoryCleanupScan | null>(null)
  const [fields, setFields] = useState<MemoryField[]>([...MEMORY_FIELDS])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<"scan" | "apply" | "undo" | "save" | null>(null)
  const [error, setError] = useState("")
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState("")
  const [hydrated, setHydrated] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const persistedSettings = useRef<string | null>(null)
  const scope = useRef<string | null>(null)
  scope.current = project?.path ?? null
  const path = project?.path

  useEffect(() => {
    let cancelled = false
    scope.current = path ?? null
    persistedSettings.current = null
    setHydrated(false); setScan(null); setOverview(null); setSelected(new Set()); setError(""); setLogs([]); setBusy(null)
    if (path) void Promise.all([loadMemoryMaintenanceSettings(path), loadMemoryCleanupScan(path)]).then(([prefs, cached]) => {
      if (cancelled) return
      persistedSettings.current = JSON.stringify(prefs)
      setSettings(prefs); setScan(cached); setHydrated(true)
    }).catch((cause) => { if (!cancelled) setError(String(cause)) })
    return () => { cancelled = true; controller.current?.abort(); scope.current = null }
  }, [path])
  useEffect(() => {
    let cancelled = false
    if (path) void Promise.all([loadMemoryMaintenanceOverview(path), loadMemoryCleanupScan(path), loadMemoryMaintenanceSettings(path)]).then(([value, cached, prefs]) => {
      if (cancelled) return
      setOverview(value)
      const previous = persistedSettings.current
      if (previous !== null) setSettings((current) => JSON.stringify(current) === previous ? prefs : current)
      persistedSettings.current = JSON.stringify(prefs)
      if (!busy) { setScan(cached); setSelected(new Set()) }
    }).catch((cause) => { if (!cancelled) setError(String(cause)) })
    return () => { cancelled = true }
  }, [path, dataVersion])

  const config = useMemo(() => settings.modelId.trim() ? resolveModelConfig(settings.modelId, llmConfig, providers) : resolveDefaultModel(llmConfig), [settings.modelId, llmConfig, providers])
  const ready = hasUsableLlm(config, providers)
  const records = useMemo(() => new Map(scan?.records.map((r) => [r.id, r]) ?? []), [scan])
  const warnings = overview ? memoryMaintenanceWarnings(overview, settings) : []
  const log = (message: string) => { if (scope.current === path) { setLogs((old) => [...old.slice(-99), message]); if (message.startsWith("警告：")) toast.info(message, { persistent: true }) } }

  async function saveSettings() {
    if (!path) return
    const { enabled, limits, cognitionChars, modelId } = settings
    const value = await updateMemoryMaintenanceSettings(path, { enabled, limits, cognitionChars, modelId })
    if (scope.current === path) { persistedSettings.current = JSON.stringify(value); setSettings(value) }
  }
  async function run(action: "scan" | "apply" | "undo" | "save") {
    if (!path || busy || !hydrated) return
    const currentPath = path
    setBusy(action); setError(""); setLogs([])
    try {
      if (action === "save") { await saveSettings(); if (scope.current === currentPath) toast.success("已保存记忆清理提醒设置") }
      if (action === "scan") {
        if (!ready || !fields.length) throw new Error("请选择可用的检测模型及至少一类记忆。")
        await saveSettings()
        const abort = new AbortController(); controller.current = abort
        const result = await runMemoryCleanupScan(currentPath, config, { fields, signal: abort.signal, onLog: log,
          onProgress: (done, total) => { if (scope.current === currentPath) setProgress(`${done}/${total} 批`) } })
        if (scope.current === currentPath) { setScan(result); setSelected(new Set()) }
      }
      if (action === "apply" && scan) {
        const issues = scan.issues.filter((issue) => selected.has(issue.id))
        if (!issues.length) throw new Error("请先选择要处理的候选。")
        const count = new Set(issues.flatMap((i) => i.removeIds)).size
        if (!window.confirm(`将从来源删除 ${count} 条记忆，并同步派生文件。正文和大纲不变。是否执行？`)) return
        const removed = await applyMemoryCleanup(currentPath, scan, issues, log)
        if (scope.current === currentPath) {
          // Revisions changed: all previous suggestions must be rescanned.
          setScan(null); setSelected(new Set()); toast.success(`已从来源清理 ${removed} 条记忆。再次清理前请重新扫描。`)
        }
      }
      if (action === "undo") {
        await undoLastMemoryCleanup(currentPath, log)
        if (scope.current === currentPath) { setScan(null); setSelected(new Set()); toast.success("已撤销最近一次记忆清理") }
      }
    } catch (cause) {
      if (scope.current === currentPath && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (scope.current === currentPath) { setBusy(null); setProgress("") } }
  }
  async function keep(id: string) {
    const issue = scan?.issues.find((i) => i.id === id)
    if (!path || busy || !issue) return
    setBusy("save"); setError("")
    try {
      await keepMemoryCleanupIssue(path, issue)
      if (scope.current === path) {
        setScan((old) => old ? { ...old, issues: old.issues.filter((i) => i.id !== id) } : null)
        setSelected((old) => { const next = new Set(old); next.delete(id); return next })
      }
    } catch (cause) { if (scope.current === path) setError(String(cause)) }
    finally { if (scope.current === path) setBusy(null) }
  }

  return <section id="memory-cleanup" className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
    <div className="flex items-center gap-2"><Brain className="h-4 w-4" /><h3 className="text-sm font-semibold">清理写作记忆</h3></div>
    <p className="text-sm text-muted-foreground">识别重复、误提取和空泛记忆。选择候选后从来源删除，同步人物认知、人物状态、伏笔、时间线及记忆文档。历史事实不会仅因年代久远被判为无用。</p>
    {!project ? <p className="text-sm text-muted-foreground">请先打开项目。</p> : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{MAINTENANCE_KINDS.map((kind) => <div key={kind} className="rounded-md border p-3 text-sm"><span className="text-muted-foreground">{MAINTENANCE_LABELS[kind]}</span><div className="mt-1 text-lg font-semibold">{overview?.counts[kind] ?? "—"}</div></div>)}</div>
      {warnings.length > 0 && <p role="status" className="flex items-start gap-2 text-sm text-amber-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warnings.join("；")}。建议扫描后选择需要清理的内容。</p>}
      <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">自动提醒与阈值</summary><div className="mt-3 space-y-3">
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.enabled} disabled={!!busy || !hydrated} onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))} />记忆超量时提醒我去清理</label>
        <p className="text-muted-foreground">打开项目和记忆更新后自动检查，同一项目最多每 7 天提醒一次。超过阈值只提醒，由你主动选择清理。伏笔仅统计活跃条目。</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{MAINTENANCE_KINDS.map((kind) => <label key={kind} className="space-y-1">{MAINTENANCE_LABELS[kind]}上限<Input type="number" min={1} value={settings.limits[kind]} disabled={!!busy || !hydrated} onChange={(e) => setSettings((s) => ({ ...s, limits: { ...s.limits, [kind]: Number(e.target.value) } }))} /></label>)}</div>
        <label className="block max-w-xs space-y-1">认知文本字符上限<Input type="number" min={100} value={settings.cognitionChars} disabled={!!busy || !hydrated} onChange={(e) => setSettings((s) => ({ ...s, cognitionChars: Number(e.target.value) }))} /></label>
        <Button variant="outline" size="sm" disabled={!!busy || !hydrated} onClick={() => void run("save")}>保存提醒设置</Button>
      </div></details>
      <div className="flex flex-wrap gap-3">{MEMORY_FIELDS.map((field) => <label key={field} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fields.includes(field)} disabled={!!busy} onChange={(e) => setFields((old) => e.target.checked ? [...old, field] : old.filter((f) => f !== field))} />{MEMORY_LABELS[field]}</label>)}</div>
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm">检测模型</span><ChatModelSelector value={settings.modelId} onChange={(modelId) => setSettings((s) => ({ ...s, modelId }))} disabled={!!busy || !hydrated} />
        <Button size="sm" disabled={!!busy || !hydrated || !ready || !fields.length} onClick={() => void run("scan")}>{busy === "scan" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}扫描记忆{busy === "scan" ? ` ${progress}` : ""}</Button>
        {busy === "scan" && <Button variant="outline" size="sm" onClick={() => controller.current?.abort()}>取消扫描</Button>}
        <Button variant="outline" size="sm" disabled={!!busy || !hydrated} onClick={() => void run("undo")}><RotateCcw className="mr-1 h-4 w-4" />撤销最近清理</Button>
      </div>
      {!ready && <p className="text-sm text-muted-foreground">请选择已配置且可用的检测模型。</p>}
      {scan && <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm"><span>已扫描 {scan.records.length} 条来源记忆，发现 {scan.issues.length} 组候选</span>
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => setSelected(new Set(scan.issues.filter((i) => i.confidence === "high").map((i) => i.id)))}>选择高置信度候选</Button>
          <Button variant="destructive" size="sm" disabled={!!busy || !selected.size} onClick={() => void run("apply")}>{busy === "apply" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}清理选中项（{selected.size}）</Button>
        </div>
        {scan.issues.length === 0 && <p className="text-sm text-muted-foreground">本次未发现需要处理的候选。无法定位到来源快照的手工条目不会被直接删除。</p>}
        {scan.issues.map((issue) => <div key={issue.id} className="space-y-2 rounded-md border bg-background p-3 text-sm">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={selected.has(issue.id)} disabled={!!busy} onChange={(e) => setSelected((old) => { const next = new Set(old); if (e.target.checked) next.add(issue.id); else next.delete(issue.id); return next })} />
            {issue.kind === "duplicate" ? "合并重复表达" : issue.kind === "superseded" ? "清理已解除的认知盲区" : "清理噪声"} · {{ high: "高", medium: "中", low: "低" }[issue.confidence]}置信度</label>
          <p>{issue.reason}</p>
          <ul className="space-y-1 text-muted-foreground">{issue.removeIds.map((id) => { const r = records.get(id); return r && <li key={id} className="break-words">删除 · {MEMORY_LABELS[r.field]} · {r.chapterNumber > 0 ? `第${r.chapterNumber}章` : `大纲快照${-r.chapterNumber}`}：{r.text}</li> })}</ul>
          {issue.keepId && <p className="break-words text-primary">保留依据 · 第{records.get(issue.keepId)?.chapterNumber}章：{records.get(issue.keepId)?.text}</p>}
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void keep(issue.id)}>保留，后续扫描不再建议此项</Button>
        </div>)}
      </div>}
    </>}
    {error && <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">{error}</p>}
    {logs.length > 0 && <details open={!!busy} className="text-sm"><summary className="cursor-pointer">处理日志</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{logs.join("\n")}</pre></details>}
  </section>
}
