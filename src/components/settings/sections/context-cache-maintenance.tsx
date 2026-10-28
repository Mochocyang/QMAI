/**
 * 维护工具里的「缓存与孤儿资料」面板。
 *
 * 两块内容，都是**用户显式触发**才动作，避免启动时扫描大目录：
 * 1. 上下文缓存：显示 `.qmai/context-cache` 的占用，可一键清空（派生数据，删了会重建）；
 * 2. 记忆体检：列出「记忆快照还在、对应章节/大纲文件已删除」的孤儿来源，
 *    选中后清理 —— 这些摘要会被注入写作提示词，不清就是资料污染。
 */

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Database, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { clearContextCache, measureContextCache, type ContextCacheStat } from "@/lib/context-hub/cache-maintenance"
import { scanMemoryHealth, type MemoryHealthReport } from "@/lib/novel/memory-health"
import { deleteOrphanMemorySnapshots } from "@/lib/novel/delete-source-memory"
import { useWikiStore } from "@/stores/wiki-store"

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function ContextCacheMaintenance() {
  const project = useWikiStore((state) => state.project)
  const [stat, setStat] = useState<ContextCacheStat | null>(null)
  const [report, setReport] = useState<MemoryHealthReport | null>(null)
  const [busy, setBusy] = useState<"measure" | "clear" | "scan" | "clean" | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const projectPath = project?.path ?? ""

  const refreshStat = useCallback(async () => {
    if (!projectPath) return
    setBusy("measure")
    setError("")
    try {
      setStat(await measureContextCache(projectPath))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取缓存占用失败。")
    } finally {
      setBusy(null)
    }
  }, [projectPath])

  useEffect(() => {
    setStat(null)
    setReport(null)
    setSelected(new Set())
    setMessage("")
    setError("")
    void refreshStat()
  }, [refreshStat])

  async function handleClear() {
    if (!projectPath) return
    if (!window.confirm("清空上下文缓存？这是派生数据，删除后会在下次生成时自动重建，不影响大纲与章节内容。")) {
      return
    }
    setBusy("clear")
    setError("")
    setMessage("")
    try {
      const result = await clearContextCache(projectPath)
      setMessage(
        result.existed
          ? `已清空上下文缓存（${result.removedFiles} 个文件）。下次生成时会自动重建。`
          : "没有找到缓存目录，无需清理。",
      )
      await refreshStat()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "清空缓存失败，可能有文件正被占用。")
    } finally {
      setBusy(null)
    }
  }

  async function handleScan() {
    if (!projectPath) return
    setBusy("scan")
    setError("")
    setMessage("")
    try {
      const result = await scanMemoryHealth(projectPath)
      setReport(result)
      setSelected(new Set(result.orphans.map((orphan) => orphan.snapshotNumber)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "扫描失败。")
    } finally {
      setBusy(null)
    }
  }

  async function handleClean() {
    if (!projectPath || selected.size === 0) return
    if (!window.confirm(`清理选中的 ${selected.size} 条孤儿记忆？清理后无法恢复（不会影响现有章节与大纲文件）。`)) {
      return
    }
    setBusy("clean")
    setError("")
    setMessage("")
    try {
      const removed = await deleteOrphanMemorySnapshots(projectPath, [...selected])
      // 先重扫（它会清空提示），再写结果，否则提示会被重扫覆盖掉
      await handleScan()
      setMessage(`已清理 ${removed} 条孤儿记忆来源；派生记忆已重建。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "清理失败。")
    } finally {
      setBusy(null)
    }
  }

  function toggle(snapshotNumber: number) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(snapshotNumber)) next.delete(snapshotNumber)
      else next.add(snapshotNumber)
      return next
    })
  }

  if (!project) {
    return (
      <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4" data-ui="context-cache-maintenance">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">缓存与孤儿资料</h3>
        </div>
        <p className="text-sm text-muted-foreground">请先打开项目。</p>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-ui="context-cache-maintenance">
      {/* 上下文缓存 */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">上下文缓存</h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          `.qmai/context-cache` 里是派生数据（每次生成时的上下文快照、稳定前缀副本）。它们
          <strong className="px-1">不会</strong>
          被注入新的对话，但会占磁盘空间、也会保留已删除内容的副本。清空后会在下次生成时自动重建。
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">当前占用：</span>
          <span className="font-medium">
            {stat ? (stat.exists ? `${formatBytes(stat.totalBytes)} · ${stat.fileCount} 个文件` : "无缓存") : "读取中…"}
          </span>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refreshStat()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !stat?.exists}
            onClick={() => void handleClear()}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            {busy === "clear" ? "清空中…" : "清空缓存"}
          </Button>
        </div>
      </div>

      {/* 记忆体检 */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">记忆体检（孤儿来源）</h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          检查「记忆快照还在、但对应章节/大纲文件已经删除」的来源。这些摘要会被注入写作提示词、AI
          也能通过读记忆工具读到，不清就会用已删内容干扰新生成。扫描不调用模型，只比对文件。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void handleScan()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            {busy === "scan" ? "扫描中…" : report ? "重新扫描" : "开始体检"}
          </Button>
          {report ? (
            <span className="text-xs text-muted-foreground">
              快照 {report.snapshotCount} 个 · 现有章节 {report.chapterCount} 个 · 现有大纲 {report.outlineCount} 个
            </span>
          ) : null}
        </div>

        {report ? (
          report.orphans.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-500">
              <ShieldCheck className="h-4 w-4" />
              没有发现孤儿记忆，记忆与现有资料一致。
            </p>
          ) : (
            <div className="space-y-2">
              <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                发现 {report.orphans.length} 个孤儿来源（对应文件已不存在）：
              </p>
              <ul className="max-h-56 space-y-1 overflow-auto rounded-md border bg-background p-2 text-sm">
                {report.orphans.map((orphan) => (
                  <li key={orphan.snapshotNumber} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={selected.has(orphan.snapshotNumber)}
                      onChange={() => toggle(orphan.snapshotNumber)}
                      aria-label={`选择 ${orphan.label}`}
                    />
                    <span>{orphan.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {orphan.kind === "outline" ? "大纲来源" : "章节来源"}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy !== null || selected.size === 0} onClick={() => void handleClean()}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  {busy === "clean" ? "清理中…" : `清理选中（${selected.size}）`}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    setSelected(
                      selected.size === report.orphans.length
                        ? new Set()
                        : new Set(report.orphans.map((orphan) => orphan.snapshotNumber)),
                    )
                  }
                >
                  全选 / 全不选
                </Button>
              </div>
            </div>
          )
        ) : null}
      </div>

      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-500">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
