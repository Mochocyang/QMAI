/**
 * 右上角云同步图标 + 状态气泡。
 *
 * 只在「云同步开关已打开」时渲染（关闭后图标消失，但连接态与凭据保留）。
 * 成功/失败提示都在这个图标下方弹，不走全局 toast：
 * - 成功：4 秒自动消失，鼠标悬停暂停计时
 * - 失败：常驻，带「重新登录 / 查看详情」动作
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import "./cloud-sync.css"
import { CLOUD_SYNC_OPEN_SETTINGS_EVENT } from "@/lib/cloud-sync/client"
import { noticeActionLabel, resolveNotice, type NoticeAction } from "@/lib/cloud-sync/notice"
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

/** 成功气泡停留时长。 */
export const SYNC_SUCCESS_BUBBLE_MS = 4_000

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

function SyncNotice({
  notice,
  onDismiss,
  onAction,
}: {
  notice: CloudSyncNotice
  onDismiss: () => void
  onAction: (action: NoticeAction) => void
}) {
  const failed = notice.kind === "failure"
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (failed || hovered) return
    const timer = setTimeout(onDismiss, SYNC_SUCCESS_BUBBLE_MS)
    return () => clearTimeout(timer)
  }, [failed, hovered, notice.at, onDismiss])

  const copy = failed ? resolveNotice(notice.errorCode, { count: notice.counts?.conflict }) : null
  const actionLabel = copy ? noticeActionLabel(copy.action) : null

  return (
    <div
      className="ui-test-header-hint is-right ui-test-cloud-bubble"
      role="status"
      data-cloud-sync-notice={notice.kind}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p className={failed ? "ui-test-cloud-bubble-text is-failure" : "ui-test-cloud-bubble-text"}>
        {syncNoticeMessage(notice)}
      </p>
      <div className="ui-test-header-hint-actions">
        {actionLabel && copy ? (
          <button type="button" className="ui-test-header-hint-dismiss" onClick={() => onAction(copy.action)}>
            {actionLabel}
          </button>
        ) : null}
        <button type="button" className="ui-test-header-hint-dismiss" onClick={onDismiss}>
          {failed ? "知道了" : "关闭"}
        </button>
      </div>
    </div>
  )
}

/**
 * 云图标点开的「同步失败」下拉列表。
 *
 * 用户投诉：提示「有 N 项同步失败，点击右上角云图标查看详情」，点开却什么都没有。
 * 原因是那 N 是运行态里的残留计数，历史里根本没有失败条目。现在：
 *   · 有失败 → 点图标直接列出失败的路径 + 原因（就是这个下拉）；
 *   · 没失败 → 点图标照旧打开完整详情。
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
  const dismissNotice = useCloudSyncStore((state) => state.dismissNotice)
  const openDetail = useCloudSyncStore((state) => state.openDetail)
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

  const view: CloudSyncView = deriveCloudSyncView(config, runtime)
  const Icon = ICONS[view.icon]

  const handleClick = useCallback(() => {
    if (view.state === "login-required") {
      openSettings("cloudSync")
      return
    }
    if (view.state === "auth-expired") {
      void beginLogin()
      return
    }
    // 有失败时先给下拉列表（用户点图标就是想知道"哪几项坏了"），
    // 没有失败才打开完整详情。
    //
    // 点图标本身必须能**关掉**已打开的下拉：这个按钮看起来就是个开关，
    // 之前只会「开」不会「关」，用户点它一下反而打不开别的（真实投诉）。
    if (failedEntries.length > 0) {
      setFailuresOpen((previous) => !previous)
      return
    }
    openDetail()
  }, [beginLogin, failedEntries.length, openDetail, view.state])

  const handleNoticeAction = useCallback(
    (action: NoticeAction) => {
      dismissNotice()
      if (action === "relogin") {
        void beginLogin()
        return
      }
      if (action === "settings") {
        openSettings("cloudSync")
        return
      }
      if (action === "detail") openDetail()
    },
    [beginLogin, dismissNotice, openDetail],
  )

  /*
   * 点下拉外面、或按 Esc 都要收起来。
   *
   * 之前只有「查看全部 / 知道了」能关，下拉会一直挂在页面上挡住内容 ——
   * 用户的原话是"点击其他内容弹窗也不会消失"。用 mousedown 而不是 click：
   * 点按钮时 click 会先触发一次，导致"点图标打开、同一次点击又关掉"。
   * 捕获阶段监听，保证在我们的按钮 onClick 之前判定。
   */
  useEffect(() => {
    if (!failuresOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      // 点在锚点（图标）或下拉内部时不算"点外面"，交给各自的 onClick 处理。
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
              aria-label={view.label}
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
        <TooltipContent>{view.label}</TooltipContent>
      </Tooltip>
      {notice ? (
        <SyncNotice notice={notice} onDismiss={dismissNotice} onAction={handleNoticeAction} />
      ) : null}
      {failuresOpen && failedEntries.length > 0 ? (
        <SyncFailureList
          entries={failedEntries}
          labelForBatch={(batchId) => {
            const provider = batches.find((batch) => batch.batchId === batchId)?.provider ?? null
            return provider ? providerLabel(provider) : "未知网盘"
          }}
          onDismiss={() => setFailuresOpen(false)}
          onOpenDetail={() => {
            setFailuresOpen(false)
            openDetail()
          }}
        />
      ) : null}
    </div>
  )
}
