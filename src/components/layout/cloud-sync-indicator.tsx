/**
 * 右上角云同步图标。
 *
 * 只在「云同步开关已打开」时渲染（关闭后图标消失，但连接态与凭据保留）。
 *
 * 状态**全部由图标本身表达**，不再弹气泡：
 * - 同步中：图标持续浮动呼吸（动画在 cloud-sync.css）
 * - 失败：图标变红（逐项失败或整轮失败都算），点击打开详情
 * - 授权过期：图标变黄，点击直接重新登录
 * - 成功：短暂的对勾，2 秒后回落成常态云
 *
 * 旧实现会在图标下方弹气泡（成功 4 秒自动消失、失败常驻）。问题是
 * 每次同步成功都会弹「已是最新，没有需要同步的内容」——用户点一次同步就被
 * 打搅一次，而且这句话本身没有任何信息量。状态用图标表达、失败靠红色吸引
 * 注意、细节交给点击，比气泡省事得多。
 */

import { useCallback, useEffect, useState } from "react"
import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import "./cloud-sync.css"
import { CLOUD_SYNC_OPEN_SETTINGS_EVENT } from "@/lib/cloud-sync/client"
import { resolveNotice } from "@/lib/cloud-sync/notice"
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

export function CloudSyncIndicator() {
  const config = useCloudSyncStore((state) => state.config)
  const runtime = useCloudSyncStore((state) => state.runtime)
  const notice = useCloudSyncStore((state) => state.notice)
  const openDetail = useCloudSyncStore((state) => state.openDetail)
  const beginLogin = useCloudSyncStore((state) => state.beginLogin)

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
    openDetail()
  }, [beginLogin, openDetail, view.state])

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
              aria-label={label}
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
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
