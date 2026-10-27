/**
 * 底栏的公告入口：铃铛 + 未读角标。
 *
 * 只负责「显示数字」和「打开弹窗」，不渲染弹窗本体 —— SidebarBottomActions
 * 被五个侧栏面板共用，弹窗要是放进来，同一时刻会有多层遮罩叠在一起。
 */

import { Bell } from "lucide-react"
import { useTranslation } from "react-i18next"

import { selectUnreadCount, useAnnouncementStore } from "@/stores/announcement-store"

export function AnnouncementBell() {
  const { t } = useTranslation()
  const unreadCount = useAnnouncementStore(selectUnreadCount)
  const dialogOpen = useAnnouncementStore((state) => state.dialogOpen)
  const openDialog = useAnnouncementStore((state) => state.openDialog)
  const label =
    unreadCount > 0
      ? t("announcements.bellWithUnread", { count: unreadCount })
      : t("announcements.bell")

  return (
    <button
      type="button"
      data-ui="announcement-bell"
      onClick={openDialog}
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={dialogOpen}
      className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
    >
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <span
          data-announcement-badge
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-medium text-destructive-foreground"
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  )
}
