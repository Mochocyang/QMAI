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
import { applyMemoryCleanup, applyMemoryCleanupRules, keepMemoryCleanupIssue, loadMemoryCleanupScan, planMemoryCleanupByRules, undoLastMemoryCleanup } from "@/lib/novel/memory-cleanup-runner"
import { RECOMMENDED_MEMORY_CLEANUP_RULES, type MemoryCleanupRuleOptions } from "@/lib/novel/memory-cleanup-rules"
import type { MemoryCleanupScan } from "@/lib/novel/memory-cleanup"
import { cancelMemoryCleanupSession, memoryCleanupSession, startMemoryCleanupSession, subscribeMemoryCleanupSession, visibleMemoryCleanupScan } from "@/lib/novel/memory-cleanup-session"
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
  const [rules, setRules] = useState<MemoryCleanupRuleOptions>(RECOMMENDED_MEMORY_CLEANUP_RULES)
  const [busy, setBusy] = useState<"scan" | "apply" | "undo" | "save" | "rules" | null>(null)
  const [error, setError] = useState("")
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState("")
  const [hydrated, setHydrated] = useState(false)
  const persistedSettings = useRef<string | null>(null)
  const scope = useRef<string | null>(null)
  const seenLogs = useRef(0)
  scope.current = project?.path ?? null
  const path = project?.path

  useEffect(() => {
    let cancelled = false
    const projectPath = path
    scope.current = projectPath ?? null
    persistedSettings.current = null
    const live = projectPath ? memoryCleanupSession(projectPath) : null
    const running = live?.status === "running"
    seenLogs.current = live?.logs.length ?? 0
    setHydrated(false); setOverview(null); setSelected(new Set()); setError(""); setRules(RECOMMENDED_MEMORY_CLEANUP_RULES)
    setBusy(running ? "scan" : null); setLogs(live?.logs ?? []); setScan(live?.scan ?? null)
    setProgress(running && live?.progress ? `${live.progress.done}/${live.progress.total} 批` : "")
    const unsub = projectPath ? subscribeMemoryCleanupSession(projectPath, () => {
      if (cancelled || scope.current !== projectPath) return
      const session = memoryCleanupSession(projectPath)
      if (!session) return
      setScan(session.scan); setLogs(session.logs)
      setProgress(session.status === "running" && session.progress ? `${session.progress.done}/${session.progress.total} 批` : "")
      setBusy((current) => session.status === "running" ? "scan" : current === "scan" ? null : current)
      if (session.status === "failed" && session.error) setError(session.error)
      for (const message of session.logs.slice(seenLogs.current)) if (message.startsWith("警告：")) toast.info(message, { persistent: true })
      seenLogs.current = session.logs.length
    }) : () => {}
    if (projectPath) void Promise.all([loadMemoryMaintenanceSettings(projectPath), loadMemoryCleanupScan(projectPath)]).then(([prefs, cached]) => {
      if (cancelled) return
      persistedSettings.current = JSON.stringify(prefs)
      setSettings(prefs)
      const session = memoryCleanupSession(projectPath)
      const visible = session?.status === "running" ? (session.scan ?? cached) : visibleMemoryCleanupScan(projectPath, cached)
      setScan(visible)
      if (session?.status !== "running" && visible?.complete === false && visible.fields?.length) {
        const restored = visible.fields.filter((field): field is MemoryField => (MEMORY_FIELDS as readonly string[]).includes(field))
        if (restored.length) setFields(restored)
      }
      setHydrated(true)
    }).catch((cause) => { if (!cancelled) setError(String(cause)) })
    return () => {
      cancelled = true
      unsub()
      scope.current = null
      const latest = useWikiStore.getState().project?.path ?? null
      if (projectPath && latest !== projectPath) cancelMemoryCleanupSession(projectPath)
    }
  }, [path])
  useEffect(() => {
    let cancelled = false
    if (path) void Promise.all([loadMemoryMaintenanceOverview(path), loadMemoryCleanupScan(path), loadMemoryMaintenanceSettings(path)]).then(([value, cached, prefs]) => {
      if (cancelled) return
      setOverview(value)
      const previous = persistedSettings.current
      if (previous !== null) setSettings((current) => JSON.stringify(current) === previous ? prefs : current)
      persistedSettings.current = JSON.stringify(prefs)
      if (memoryCleanupSession(path)?.status === "running") return
      if (!busy) { setScan(cached); setSelected(new Set()) }
    }).catch((cause) => { if (!cancelled) setError(String(cause)) })
    return () => { cancelled = true }
  }, [path, dataVersion])

  const config = useMemo(() => settings.modelId.trim() ? resolveModelConfig(settings.modelId, llmConfig, providers) : resolveDefaultModel(llmConfig), [settings.modelId, llmConfig, providers])
  const ready = hasUsableLlm(config, providers)
  const records = useMemo(() => new Map(scan?.records.map((r) => [r.id, r]) ?? []), [scan])
  const scanning = busy === "scan"
  const resumable = !scanning && scan?.complete === false
  const scannedCount = scan?.complete === false ? (scan.scannedRecordCount ?? 0) : (scan?.records.length ?? 0)
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
        if (scope.current !== currentPath) return
        setSelected(new Set())
        await startMemoryCleanupSession(currentPath, config, fields, scan)
        if (scope.current === currentPath) {
          const session = memoryCleanupSession(currentPath)
          if (session?.scan) setScan(session.scan)
          if (session?.status === "completed") setSelected(new Set())
        }
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
      if (scope.current !== currentPath) return
      const live = memoryCleanupSession(currentPath)
      if (live?.scan) setScan(live.scan)
      if (cause instanceof DOMException && cause.name === "AbortError") return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (scope.current === currentPath && memoryCleanupSession(currentPath)?.status !== "running") { setBusy(null); setProgress("") }
    }
  }
  async function runRules() {
    if (!path || busy || !hydrated) return
    const currentPath = path
    setBusy("rules"); setError(""); setLogs([])
    try {
      const plan = await planMemoryCleanupByRules(currentPath, rules)
      if (scope.current !== currentPath) return
      const { nonPositive, unupdated, stale, total } = plan.counts
      if (!total) { setError("这些规则没有命中来源记忆。"); return }
      if (!window.confirm(`将从来源删除 ${total} 条记忆：大纲快照 ${nonPositive} 条，出场后再隔 ${rules.unupdatedChapterGap} 章仍未更新 ${unupdated} 条，过旧章节 ${stale} 条。正文和大纲文件不变。是否执行？`)) return
      const removed = await applyMemoryCleanupRules(currentPath, rules, log)
      if (scope.current === currentPath) { setScan(null); setSelected(new Set()); toast.success(`已按规则清理 ${removed} 条来源记忆。`) }
    } catch (cause) {
      if (scope.current === currentPath) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (scope.current === currentPath && memoryCleanupSession(currentPath)?.status !== "running") { setBusy(null); setProgress("") }
    }
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
      <div className="space-y-3 rounded-md border p-3">
        <h4 className="text-sm font-semibold">用模型清理</h4>
        <p className="text-sm text-muted-foreground">识别重复、误提取和空泛记忆。选择候选后从来源删除，同步人物认知、人物状态、伏笔、时间线及记忆文档。历史事实不会仅因年代久远被判为无用。</p>
        <div className="flex flex-wrap gap-3">{MEMORY_FIELDS.map((field) => <label key={field} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fields.includes(field)} disabled={!!busy} onChange={(e) => setFields((old) => e.target.checked ? [...old, field] : old.filter((f) => f !== field))} />{MEMORY_LABELS[field]}</label>)}</div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm">检测模型</span><ChatModelSelector value={settings.modelId} onChange={(modelId) => setSettings((s) => ({ ...s, modelId }))} disabled={!!busy || !hydrated} />
          <Button size="sm" disabled={!!busy || !hydrated || !ready || !fields.length} onClick={() => void run("scan")}>{scanning && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{resumable ? "继续扫描" : "扫描记忆"}{scanning && progress ? ` ${progress}` : ""}</Button>
          {scanning && path && <Button variant="outline" size="sm" onClick={() => cancelMemoryCleanupSession(path)}>取消扫描</Button>}
        </div>
        {!ready && <p className="text-sm text-muted-foreground">请选择已配置且可用的检测模型。</p>}
        {scan && <div className="space-y-3">
        {scan.complete === false && <p className="text-sm text-muted-foreground">{scanning
          ? `扫描进行中（${scan.completedBatches ?? 0}/${scan.totalBatches ?? 0} 批），已发现的候选会保留。`
          : `扫描未完成（${scan.completedBatches ?? 0}/${scan.totalBatches ?? 0} 批）。已保留当前候选，可继续扫描。`}</p>}
        <div className="flex flex-wrap items-center gap-3 text-sm"><span>{scan.complete === false ? `已扫描 ${scannedCount} / ${scan.records.length} 条来源记忆` : `已扫描 ${scannedCount} 条来源记忆`}，发现 {scan.issues.length} 组候选</span>
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => setSelected(new Set(scan.issues.filter((i) => i.confidence === "high").map((i) => i.id)))}>选择高置信度候选</Button>
          <Button variant="destructive" size="sm" disabled={!!busy || !selected.size} onClick={() => void run("apply")}>{busy === "apply" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}清理选中项（{selected.size}）</Button>
        </div>
        {scan.issues.length === 0 && scan.complete !== false && <p className="text-sm text-muted-foreground">本次未发现需要处理的候选。无法定位到来源快照的手工条目不会被直接删除。</p>}
        {scan.issues.map((issue) => <div key={issue.id} className="space-y-2 rounded-md border bg-background p-3 text-sm">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={selected.has(issue.id)} disabled={!!busy} onChange={(e) => setSelected((old) => { const next = new Set(old); if (e.target.checked) next.add(issue.id); else next.delete(issue.id); return next })} />
            {issue.kind === "duplicate" ? "合并重复表达" : issue.kind === "superseded" ? "清理已被后续记录取代的复述" : "清理噪声"} · {{ high: "高", medium: "中", low: "低" }[issue.confidence]}置信度</label>
          <p>{issue.reason}</p>
          <ul className="space-y-1 text-muted-foreground">{issue.removeIds.map((id) => { const r = records.get(id); return r && <li key={id} className="break-words">删除 · {MEMORY_LABELS[r.field]} · {r.chapterNumber > 0 ? `第${r.chapterNumber}章` : `大纲快照${-r.chapterNumber}`}：{r.text}</li> })}</ul>
          {issue.keepId && <p className="break-words text-primary">保留依据 · 第{records.get(issue.keepId)?.chapterNumber}章：{records.get(issue.keepId)?.text}</p>}
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void keep(issue.id)}>保留，后续扫描不再建议此项</Button>
        </div>)}
        </div>}
      </div>
      <div className="space-y-3 rounded-md border p-3">
        <h4 className="text-sm font-semibold">一键清理</h4>
        <p className="text-sm text-muted-foreground">规则直接命中来源，不调用模型。推荐值已填好，可按这本书修改。不会改正文和大纲文件。</p>
        <label className="flex items-center gap-2 text-sm"><input data-testid="rule-non-positive" type="checkbox" checked={rules.dropNonPositiveChapters} disabled={!!busy || !hydrated} onChange={(e) => setRules((current) => ({ ...current, dropNonPositiveChapters: e.target.checked }))} />清理章节号小于等于 0 的大纲快照（编号如 -1）</label>
        <label className="flex flex-wrap items-center gap-2 text-sm">比最新正文章节至少落后<Input data-testid="stale-chapter-gap" className="h-8 w-24" type="number" min={0} max={100000} value={rules.staleChapterGap} disabled={!!busy || !hydrated} onChange={(e) => setRules((current) => ({ ...current, staleChapterGap: Number(e.target.value) }))} />章的来源（0 表示不启用，推荐 150）</label>
        <label className="flex flex-wrap items-center gap-2 text-sm">出场后再隔<Input data-testid="unupdated-chapter-gap" className="h-8 w-24" type="number" min={0} max={100000} value={rules.unupdatedChapterGap} disabled={!!busy || !hydrated} onChange={(e) => setRules((current) => ({ ...current, unupdatedChapterGap: Number(e.target.value) }))} />章仍未更新才删除该人物的状态和认知（0 表示不启用，推荐 30）</label>
        <Button variant="destructive" size="sm" disabled={!!busy || !hydrated} onClick={() => void runRules()}>{busy === "rules" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}一键清理</Button>
      </div>
      <Button variant="outline" size="sm" disabled={!!busy || !hydrated} onClick={() => void run("undo")}><RotateCcw className="mr-1 h-4 w-4" />撤销最近清理</Button>
    </>}
    {error && <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">{error}</p>}
    {logs.length > 0 && <details open={!!busy} className="text-sm"><summary className="cursor-pointer">处理日志</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{logs.join("\n")}</pre></details>}
  </section>
}
