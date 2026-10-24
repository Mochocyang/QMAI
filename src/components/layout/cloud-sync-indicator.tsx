/**
 * 右上角云同步图标 + 状态气泡。
 *
 * 只在「云同步开关已打开」时渲染（关闭后图标消失，但连接态与凭据保留）。
 * 成功/失败提示都在这个图标下方弹，不走全局 toast：
 * - 成功：4 秒自动消失，鼠标悬停暂停计时
 * - 失败：常驻，带「重新登录 / 查看详情」动作
 */

import { useCallback, useEffect, useState } from "react"
import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import "./cloud-sync.css"
import { CLOUD_SYNC_OPEN_SETTINGS_EVENT } from "@/lib/cloud-sync/client"
import { noticeActionLabel, resolveNotice, type NoticeAction } from "@/lib/cloud-sync/notice"
import { deriveCloudSyncView, type CloudSyncIconName, type CloudSyncView } from "@/lib/cloud-sync/status"
import { totalSyncedCount, type CloudSyncNotice } from "@/lib/cloud-sync/types"
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

export function CloudSyncIndicator() {
  const config = useCloudSyncStore((state) => state.config)
  const runtime = useCloudSyncStore((state) => state.runtime)
  const notice = useCloudSyncStore((state) => state.notice)
  const dismissNotice = useCloudSyncStore((state) => state.dismissNotice)
  const openDetail = useCloudSyncStore((state) => state.openDetail)
  const beginLogin = useCloudSyncStore((state) => state.beginLogin)

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
    openDetail()
  }, [beginLogin, openDetail, view.state])

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

  if (!config.enabled) return null

  return (
    <div className="ui-test-cloud-anchor">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="ui-test-icon-btn ui-test-cloud-entry"
              data-cloud-sync-state={view.state}
              aria-label={view.label}
              aria-haspopup="dialog"
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
    </div>
  )
}
