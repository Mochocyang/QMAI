/**
 * 右上角云同步图标。
 *
 * 只在「云同步开关已打开」时渲染（关闭后图标消失，但连接态与凭据保留）。
 *
 * 状态**全部由图标本身表达**，不再弹气泡：
 * - 同步中：图标持续浮动呼吸（动画在 cloud-sync.css）
 * - 失败：图标变红（逐项失败或整轮失败都算）
 * - 授权过期：图标变黄，点击直接重新登录
 * - 成功：短暂的对勾，2 秒后回落成常态云
 *
 * 旧实现会在图标下方弹气泡（成功 4 秒自动消失、失败常驻）。问题是
 * 每次同步成功都会弹「已是最新，没有需要同步的内容」——用户点一次同步就被
 * 打搅一次，而且这句话本身没有任何信息量。状态用图标表达、失败靠红色吸引
 * 注意、细节交给点击，比气泡省事得多。
 *
 * 唯一的例外是**同步失败**：点图标会先展开一个失败清单（而不是直接开详情），
 * 因为用户此刻最想知道的是「哪几项坏了、是哪个网盘、为什么」。清单里有
 * 「知道了」，点过之后这批失败算已读，红点不再烦人（只提醒新失败）。
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import "./cloud-sync.css"
import { CLOUD_SYNC_OPEN_SETTINGS_EVENT } from "@/lib/cloud-sync/client"
import { resolveNotice } from "@/lib/cloud-sync/notice"
import { providerLabel } from "@/lib/cloud-sync/providers"
import { deriveCloudSyncView, type CloudSyncIconName, type CloudSyncView } from "@/lib/cloud-sync/status"
import { totalSyncedCount, type CloudSyncNotice, type SyncEntry } from "@/lib/cloud-sync/types"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

const ICONS: Record<CloudSyncIconName, LucideIcon> = {
  Cloud,
  CloudOff,
  CloudUpload,
  CloudCheck,
  CloudAlert,
}

function openSettings(category: "cloudSync") {
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_OPEN_SETTINGS_EVENT, { detail: { category } }))
}

export function syncNoticeMessage(notice: CloudSyncNotice): string {
  if (notice.kind === "success") {
    const count = notice.counts ? totalSyncedCount(notice.counts) : 0
    return count > 0 ? `已同步 ${count} 项` : "已是最新，没有需要同步的内容"
  }
  return resolveNotice(notice.errorCode, { count: notice.counts?.conflict }).message
}

/**
 * 云图标点开的「同步失败」清单。
 *
 * 用户投诉：提示「有 N 项同步失败，点击右上角云图标查看详情」，点开却看不到失败内容。
 * 现在点图标（有失败时）直接列出失败的路径 + 网盘 + 原因：
 *   · 「知道了」→ 这批算已读，红点消失，之后只提醒新失败；
 *   · 「查看全部」→ 也算已读，并打开完整详情面板。
 * 用「下拉」而不是弹窗：用户只是想扫一眼哪几项坏了，不该被一个大窗口挡住。
 */
function SyncFailureList({
  entries,
  labelForBatch,
  onDismiss,
  onOpenDetail,
}: {
  entries: SyncEntry[]
  /** 批次 id → 网盘名。失败要说是哪个盘失败了，否则用户不知道去哪处理。 */
  labelForBatch: (batchId: string) => string
  onDismiss: () => void
  onOpenDetail: () => void
}) {
  const shown = entries.slice(-8).reverse()
  return (
    <div
      className="ui-test-header-hint is-right ui-test-cloud-failures"
      role="dialog"
      aria-label="同步失败"
      data-ui="cloud-sync-failure-list"
    >
      <p className="ui-test-cloud-failures-title">有 {entries.length} 项同步失败</p>
      <ul className="ui-test-cloud-failures-list">
        {shown.map((entry) => (
          <li key={entry.id} data-failure-path={entry.path}>
            <span className="ui-test-cloud-failures-provider" data-provider-label>
              {labelForBatch(entry.batchId)}
            </span>
            <span className="ui-test-cloud-failures-path" title={entry.path}>
              {entry.path}
            </span>
            <span className="ui-test-cloud-failures-reason">
              {entry.errorCode ? resolveNotice(entry.errorCode).message : "同步失败"}
            </span>
          </li>
        ))}
      </ul>
      {entries.length > shown.length ? (
        <p className="ui-test-cloud-failures-more">还有 {entries.length - shown.length} 项，在详情里看全部</p>
      ) : null}
      <div className="ui-test-header-hint-actions">
        <button type="button" className="ui-test-header-hint-dismiss" onClick={onOpenDetail}>
          查看全部
        </button>
        <button type="button" className="ui-test-header-hint-dismiss" onClick={onDismiss}>
          知道了
        </button>
      </div>
    </div>
  )
}

export function CloudSyncIndicator() {
  const config = useCloudSyncStore((state) => state.config)
  const runtime = useCloudSyncStore((state) => state.runtime)
  const notice = useCloudSyncStore((state) => state.notice)
  const openDetail = useCloudSyncStore((state) => state.openDetail)
  const markSeen = useCloudSyncStore((state) => state.markFailuresSeen)
  const beginLogin = useCloudSyncStore((state) => state.beginLogin)
  const entries = useCloudSyncStore((state) => state.entries)
  const batches = useCloudSyncStore((state) => state.batches)

  // 失败条目只从**历史记录**算：那才是真发生过的事。
  const failedEntries = entries.filter((entry) => !entry.ok)
  const [failuresOpen, setFailuresOpen] = useState(false)
  /** 整个云图标锚点。用来判断"点的是不是外面"。 */
  const anchorRef = useRef<HTMLDivElement | null>(null)

  // 2 秒绿色对勾需要一次重渲染才能回落到常态图标。
  const [, force] = useState(0)
  useEffect(() => {
    if (typeof runtime.recentSuccessAt !== "number") return
    const timer = setTimeout(() => force((tick) => tick + 1), 2_100)
    return () => clearTimeout(timer)
  }, [runtime.recentSuccessAt])

  const failedRecently = notice?.kind === "failure"
  const view: CloudSyncView = deriveCloudSyncView(config, runtime, Date.now(), {
    lastFailure: failedRecently,
  })
  const Icon = ICONS[view.icon]
  // 失败时把具体原因放进 tooltip：图标只有一个颜色，说不清是断网还是鉴权被拒。
  const label = failedRecently && notice ? `云同步：${syncNoticeMessage(notice)}，点击查看` : view.label

  const handleClick = useCallback(() => {
    if (view.state === "login-required") {
      openSettings("cloudSync")
      return
    }
    if (view.state === "auth-expired") {
      void beginLogin()
      return
    }
    /*
     * 有失败时先展开清单（用户点图标就是想知道"哪几项坏了"），
     * 再点一次收起来 —— 这个按钮看起来就是个开关。
     * 没有失败才直接打开完整详情。
     */
    if (failedEntries.length > 0) {
      setFailuresOpen((previous) => !previous)
      return
    }
    openDetail()
  }, [beginLogin, failedEntries.length, openDetail, view.state])

  /*
   * 点清单外面、或按 Esc 都要收起来。
   *
   * 用 mousedown 而不是 click：点按钮时 click 会先触发一次，
   * 导致"点图标打开、同一次点击又关掉"。捕获阶段监听，保证在按钮 onClick 之前判定。
   */
  useEffect(() => {
    if (!failuresOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      // 点在锚点（图标）或清单内部时不算"点外面"，交给各自的 onClick 处理。
      if (anchorRef.current?.contains(target)) return
      setFailuresOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFailuresOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [failuresOpen])

  if (!config.enabled) return null

  return (
    <div className="ui-test-cloud-anchor" ref={anchorRef}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="ui-test-icon-btn ui-test-cloud-entry"
              data-cloud-sync-state={view.state}
              aria-label={label}
              aria-haspopup={failedEntries.length > 0 ? "menu" : "dialog"}
              onClick={handleClick}
            >
              <Icon />
              {view.badge ? (
                <span className={`ui-test-cloud-badge is-${view.badge}`} aria-hidden="true" />
              ) : null}
            </button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {failuresOpen && failedEntries.length > 0 ? (
        <SyncFailureList
          entries={failedEntries}
          labelForBatch={(batchId) => {
            const provider = batches.find((batch) => batch.batchId === batchId)?.provider ?? null
            return provider ? providerLabel(provider) : "未知网盘"
          }}
          onDismiss={() => {
            // 「知道了」= 已读：红点消失，之后只提醒新失败。
            markSeen()
            setFailuresOpen(false)
          }}
          onOpenDetail={() => {
            // 「查看全部」也算看过了。
            markSeen()
            setFailuresOpen(false)
            openDetail()
          }}
        />
      ) : null}
    </div>
  )
}
