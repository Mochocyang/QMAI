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
      className="relative flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
    >
      <Bell className="h-4 w-4" />
      {/*
        角标刻意做得很小：它只是「有新公告」的提示，不是需要看清数字的计数器。
        原来是一个 12px 高、带数字的红胶囊，盖住了半个铃铛；现在固定成一个
        6px 的红点，外面加一圈背景色描边 —— 铃铛是描边图标，没有这圈描边
        红点会糊进线条里。
        未读数仍然通过 aria-label / title 完整播报（见上面 label），
        鼠标悬停与读屏都拿得到「有几条未读」，只是不再画在图标上。
      */}
      {unreadCount > 0 && (
        <span
          data-announcement-badge
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-1 size-1.5 rounded-full bg-destructive ring-2 ring-background"
        />
      )}
    </button>
  )
}
