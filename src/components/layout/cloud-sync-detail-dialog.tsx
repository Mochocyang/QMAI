/**
 * 同步详情面板：回答「这次到底同步了什么」。
 *
 * 数据全部来自 store 的 batches / entries（后端写、前端读）。
 * 按批次倒序分组，每条显示方向、路径、书籍、大小与结果。
 */

import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, GitMerge, SkipForward } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { resolveNotice } from "@/lib/cloud-sync/notice"
import { providerLabel } from "@/lib/cloud-sync/providers"
import type { CloudProviderId, SyncBatch, SyncDirection, SyncEntry } from "@/lib/cloud-sync/types"
import { revealCloudSyncRemote } from "@/lib/cloud-sync/client"
import { loadRegisteredProjects } from "@/lib/project-store"
import { toast } from "@/lib/toast"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

const DIRECTION_META: Record<SyncDirection, { label: string; icon: typeof ArrowUpFromLine }> = {
  upload: { label: "上传", icon: ArrowUpFromLine },
  download: { label: "下载", icon: ArrowDownToLine },
  delete: { label: "删除", icon: SkipForward },
  conflict: { label: "冲突", icon: GitMerge },
  skip: { label: "跳过", icon: SkipForward },
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatBatchTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function batchSummary(batch: SyncBatch): string {
  const parts: string[] = []
  if (batch.counts.upload > 0) parts.push(`上传 ${batch.counts.upload}`)
  if (batch.counts.download > 0) parts.push(`下载 ${batch.counts.download}`)
  if (batch.counts.delete > 0) parts.push(`删除 ${batch.counts.delete}`)
  if (batch.counts.conflict > 0) parts.push(`冲突 ${batch.counts.conflict}`)
  if (batch.counts.failed > 0) parts.push(`失败 ${batch.counts.failed}`)
  return parts.length > 0 ? parts.join(" · ") : "没有变更"
}

function EntryRow({ entry }: { entry: SyncEntry }) {
  const meta = DIRECTION_META[entry.direction]
  const Icon = meta.icon
  const size = formatBytes(entry.bytes)
  const failure = !entry.ok ? resolveNotice(entry.errorCode).message : null

  return (
    <li className="ui-test-sync-entry" data-sync-direction={entry.direction} data-sync-ok={entry.ok}>
      <Icon className="ui-test-sync-entry-icon" aria-hidden="true" />
      <div className="ui-test-sync-entry-body">
        <p className="ui-test-sync-entry-path" title={entry.path}>
          {entry.path}
        </p>
        <p className="ui-test-sync-entry-meta">
          {meta.label}
          {entry.bookName ? ` · ${entry.bookName}` : ""}
          {size ? ` · ${size}` : ""}
          {failure ? ` · ${failure}` : ""}
        </p>
      </div>
    </li>
  )
}

/// 定夺成功后写进历史的那句话；用它判断某条冲突是否已经处理过。
const RESOLVED_PREFIXES = ["已改用云端版本", "已保留本地版本", "已按本地删除处理"]

function resolutionTimeByPath(entries: SyncEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const entry of entries) {
    const detail = entry.errorDetail ?? ""
    if (RESOLVED_PREFIXES.some((prefix) => detail.startsWith(prefix))) {
      const previous = out.get(entry.path) ?? 0
      if (entry.at >= previous) out.set(entry.path, entry.at)
    }
  }
  return out
}

function ConflictRow({
  entry,
  projectPath,
  provider,
}: {
  entry: SyncEntry
  projectPath?: string
  provider?: CloudProviderId | null
}) {
  const resolveConflict = useCloudSyncStore((state) => state.resolveConflict)
  const [pending, setPending] = useState<"local" | "cloud" | null>(null)

  const choose = async (choice: "local" | "cloud") => {
    if (!projectPath) return
    setPending(choice)
    try {
      const result = await resolveConflict({
        projectId: entry.bookId ?? "",
        projectPath,
        bookName: entry.bookName,
        rel: entry.path,
        choice,
        // 写回时要落到**同一个网盘**：A 盘的冲突不能拿 B 盘的远端去覆盖。
        provider,
      })
      if (!result.ok) {
        // 定夺失败属于「用户动作的结果」，用轻提示，不抢同步通知的气泡。
        toast.error(resolveNotice(result.errorCode).message)
      }
    } finally {
      setPending(null)
    }
  }

  return (
    <li className="ui-test-sync-conflict" data-sync-conflict-path={entry.path}>
      <div className="ui-test-sync-conflict-body">
        <p className="ui-test-sync-conflict-path" title={entry.path}>
          {entry.path}
        </p>
        <p className="ui-test-sync-conflict-meta">
          {entry.bookName ? `${entry.bookName} · ` : ""}
          两边都改过：云端旧版本另存为 <code>.remote-…</code> 副本
        </p>
      </div>
      <div className="ui-test-sync-conflict-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={!projectPath || pending !== null}
          title={projectPath ? undefined : "这本书不在本地了，没法定夺"}
          onClick={() => void choose("local")}
        >
          {pending === "local" ? "处理中…" : "保留本地"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!projectPath || pending !== null}
          title={projectPath ? undefined : "这本书不在本地了，没法定夺"}
          onClick={() => void choose("cloud")}
        >
          {pending === "cloud" ? "处理中…" : "改用云端"}
        </Button>
      </div>
    </li>
  )
}

export function CloudSyncDetailDialog() {
  const open = useCloudSyncStore((state) => state.detailOpen)
  const closeDetail = useCloudSyncStore((state) => state.closeDetail)
  const clearHistory = useCloudSyncStore((state) => state.clearHistory)
  const markFailuresSeen = useCloudSyncStore((state) => state.markFailuresSeen)
  const config = useCloudSyncStore((state) => state.config)
  const batches = useCloudSyncStore((state) => state.batches)
  const entries = useCloudSyncStore((state) => state.entries)
  const runNowFromRegistry = useCloudSyncStore((state) => state.runNowFromRegistry)
  const retry = useCloudSyncStore((state) => state.retry)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  /*
   * 「同步失败」筛选：只保留失败条目。
   *
   * 用户投诉过「提示有失败，点进来却看不到失败内容」——以前失败条目和几百条
   * 成功记录混在一起，还得自己翻。现在底部有一个直达按钮，点一下只剩失败项。
   */
  const [onlyFailed, setOnlyFailed] = useState(false)
  /*
   * 「清空同步记录」是**不可撤销**的（历史文件直接删掉），
   * 所以要点两次：第一次进入待确认态，第二次才真删。
   * 与章节删除用同一套交互，避免"顺手点一下就没了"。
   */
  const [clearArmed, setClearArmed] = useState(false)
  // 「这一轮没有任何变更」的批次默认收起来不显示：自动同步会每两分钟跑一轮，
  // 全留在列表里会把真正有内容的轮次挤到看不见的地方。
  const [projectPaths, setProjectPaths] = useState<Record<string, string>>({})

  /*
   * 「打开远端目录」对三种网盘的含义不一样：
   * - 本地文件夹：真的能打开资源管理器。
   * - 百度网盘：打开网页版对应目录。
   * - WebDAV：**没有可浏览的网页** —— 浏览器直接 GET 根目录会被服务端拒绝
   *   （坚果云返回 OperationNotAllowed，用户看到一页错误 XML）。
   *   这里改成把地址复制给他，粘到自己习惯的客户端里。
   */
  const revealOrCopyRemote = async () => {
    if (config.provider === "webdav") {
      const url = config.webdavUrl ?? ""
      try {
        await navigator.clipboard.writeText(url)
        toast.success("远端地址已复制，粘贴到你的 WebDAV 客户端即可打开")
      } catch {
        toast.error(`远端地址：${url}`)
      }
      return
    }
    try {
      await revealCloudSyncRemote()
    } catch (error) {
      // 「打开远端目录」是用户主动动作，不属于同步通知，用轻提示即可。
      toast.error(error instanceof Error ? error.message : "还没有可以打开的远端目录")
    }
  }

  // 后端不持有项目注册表：定夺时要拿到书目录的绝对路径。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void loadRegisteredProjects()
      .then((projects) => {
        if (cancelled) return
        const next: Record<string, string> = {}
        for (const project of projects) next[project.id] = project.path
        setProjectPaths(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open])

  const pendingConflicts = useMemo(() => {
    const resolvedAt = resolutionTimeByPath(entries)
    return entries.filter((entry) => {
      if (entry.direction !== "conflict" || !entry.ok) return false
      const resolved = resolvedAt.get(entry.path)
      return resolved === undefined || entry.at > resolved
    })
  }, [entries])

  const grouped = useMemo(() => {
    const byBatch = new Map<string, SyncEntry[]>()
    for (const entry of entries) {
      const list = byBatch.get(entry.batchId) ?? []
      list.push(entry)
      byBatch.set(entry.batchId, list)
    }
    return [...batches]
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((batch) => ({ batch, items: byBatch.get(batch.batchId) ?? [] }))
      /*
       * 只保留**真的有动作**的轮次。
       *
       * 以前留了个「另有 N 轮没有文件变更（点这里一并显示）」的开关，用户明确说
       * 没有意义：一轮什么都没传，展示出来只会让人以为同步出了问题。
       * 现在彻底不显示，连「另有 N 轮」的交代都不要。
       */
      .map(({ batch, items }) => ({
        batch,
        items: onlyFailed ? items.filter((entry) => !entry.ok) : items,
      }))
      .filter(({ items }) => items.length > 0)
      .slice(0, 20)
  }, [batches, entries, onlyFailed])

  const failedEntries = entries.filter((entry) => !entry.ok)
  const failedIds = failedEntries.map((entry) => entry.id)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : closeDetail())}>
      <DialogContent className="ui-test-sync-dialog">
        <DialogHeader>
          <DialogTitle>同步详情</DialogTitle>
          <DialogDescription>
            {config.connected
              ? `${providerLabel(config.provider)} · 最近 200 条记录`
              : "还没有连接网盘"}
          </DialogDescription>
        </DialogHeader>

        {config.connected && pendingConflicts.length > 0 ? (
          <section className="ui-test-sync-conflicts" aria-label="待定夺的冲突">
            <h3 className="ui-test-sync-conflicts-title">
              有 {pendingConflicts.length} 处冲突，选一份保留
            </h3>
            <p className="ui-test-sync-conflicts-hint">
              两边都改过同一份文件。定夺后原路径只留你选的那份，另一份的副本会被清掉。
            </p>
            <ul className="ui-test-sync-conflict-list">
              {pendingConflicts.map((entry) => (
                <ConflictRow
                  key={entry.id}
                  entry={entry}
                  projectPath={entry.bookId ? projectPaths[entry.bookId] : undefined}
                  // 冲突归属哪个网盘：按它所在批次查（每批次只对应一个目标）。
                  provider={
                    batches.find((batch) => batch.batchId === entry.batchId)?.provider ?? null
                  }
                />
              ))}
            </ul>
          </section>
        ) : null}

        {!config.connected ? (
          <p className="ui-test-sync-empty">打开云同步并登录网盘后，这里会显示每次上传、下载和删除的文件。</p>
        ) : grouped.length === 0 ? (
          onlyFailed ? (
            <p className="ui-test-sync-empty">没有同步失败的记录。</p>
          ) : (
            <p className="ui-test-sync-empty">
              还没有同步记录。点「立即同步」开始第一次同步。
            </p>
          )
        ) : (
          <div className="ui-test-sync-batches">
            {grouped.map(({ batch, items }) => {
              const isCollapsed = collapsed[batch.batchId] === true
              return (
                <section key={batch.batchId} className="ui-test-sync-batch" data-batch-state={batch.state}>
                  <button
                    type="button"
                    className="ui-test-sync-batch-head"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((previous) => ({ ...previous, [batch.batchId]: !isCollapsed }))
                    }
                  >
                    {isCollapsed ? <ChevronRight /> : <ChevronDown />}
                    {/*
                      先标「进了哪个网盘」，再报时间与数量：用户最常问的是
                      「这份稿子到底同步到哪个盘了」，平台名放最前面一眼就能分组看。
                    */}
                    <span className="ui-test-sync-batch-provider">
                      {batch.provider ? providerLabel(batch.provider) : "未知网盘"}
                    </span>
                    <span className="ui-test-sync-batch-time">{formatBatchTime(batch.startedAt)}</span>
                    <span className="ui-test-sync-batch-summary">{batchSummary(batch)}</span>
                  </button>
                  {isCollapsed ? null : (
                    <ul className="ui-test-sync-entry-list">
                      {items.length === 0 ? (
                        <li className="ui-test-sync-entry is-empty">本轮没有文件变更</li>
                      ) : (
                        items.map((entry) => <EntryRow key={entry.id} entry={entry} />)
                      )}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )}

        <div className="ui-test-sync-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={!config.connected}
            onClick={() => void revealOrCopyRemote()}
          >
            {config.provider === "webdav" ? "复制远端地址" : "打开远端目录"}
          </Button>
          {failedIds.length > 0 ? (
            <Button
              variant={onlyFailed ? "default" : "outline"}
              size="sm"
              data-ui="cloud-sync-only-failed"
              aria-pressed={onlyFailed}
              onClick={() => setOnlyFailed((previous) => !previous)}
            >
              同步失败（{failedIds.length}）
            </Button>
          ) : null}
          {failedIds.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => void retry(failedIds)}>
              重试失败项
            </Button>
          ) : null}
          {/* 清空记录放在最左：它是破坏性操作，不该挨着「立即同步」。 */}
          {clearArmed ? (
            <Button
              variant="destructive"
              size="sm"
              data-ui="cloud-sync-clear-history-confirm"
              onClick={() => {
                setClearArmed(false)
                markFailuresSeen()
                void clearHistory()
              }}
            >
              确认清空？
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              data-ui="cloud-sync-clear-history"
              disabled={batches.length === 0 && entries.length === 0}
              onClick={() => setClearArmed(true)}
            >
              清空同步记录
            </Button>
          )}
          <Button
            size="sm"
            disabled={!config.connected}
            onClick={() => void runNowFromRegistry("manual")}
          >
            立即同步
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
