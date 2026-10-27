/**
 * 公告弹窗。挂在 App 根部，全局只有一个 —— SidebarBottomActions 被五个侧栏
 * 面板共用，弹窗要是跟着铃铛渲染，同一时刻会叠出好几层遮罩。
 *
 * 交互约定（与需求逐条对应）：
 * - 点标题展开正文，**展开即视为已读**（再收起也不回退）；
 * - 底部「全部已读」一次清掉剩余未读；
 * - 没有「清空」：公告是发布方的历史记录，用户只有读没读，没有删不删。
 */

import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatAnnouncementDate, formatRelativeTime, type Announcement } from "@/lib/announcements"
import { openExternalUrl } from "@/lib/open-external-url"
import { selectUnreadCount, useAnnouncementStore } from "@/stores/announcement-store"

export function AnnouncementDialog() {
  const { t } = useTranslation()
  const open = useAnnouncementStore((state) => state.dialogOpen)
  const items = useAnnouncementStore((state) => state.items)
  const readIds = useAnnouncementStore((state) => state.readIds)
  const status = useAnnouncementStore((state) => state.status)
  const lastFetchedAt = useAnnouncementStore((state) => state.lastFetchedAt)
  const unreadCount = useAnnouncementStore(selectUnreadCount)
  const closeDialog = useAnnouncementStore((state) => state.closeDialog)
  const refresh = useAnnouncementStore((state) => state.refresh)
  const markRead = useAnnouncementStore((state) => state.markRead)
  const markAllRead = useAnnouncementStore((state) => state.markAllRead)

  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 关掉就收起展开项：下次打开回到「只看标题」，否则一进来就是一屏正文。
  useEffect(() => {
    if (!open) setExpandedId(null)
  }, [open])

  const toggle = (item: Announcement) => {
    setExpandedId((current) => (current === item.id ? null : item.id))
    void markRead(item.id)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog()
      }}
    >
      <DialogContent className="max-w-[640px] gap-0 p-0" data-testid="announcement-dialog">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle>{t("announcements.title")}</DialogTitle>
          <DialogDescription>
            {unreadCount > 0
              ? t("announcements.unreadSummary", { count: unreadCount })
              : t("announcements.allReadHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-2">
          <AnnouncementList
            items={items}
            readIds={readIds}
            status={status}
            expandedId={expandedId}
            onToggle={toggle}
            onRetry={() => void refresh()}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">
              {lastFetchedAt
                ? t("announcements.lastUpdated", { time: formatRelativeTime(lastFetchedAt) })
                : t("announcements.neverUpdated")}
            </span>
            <Button variant="ghost" size="xs" onClick={() => void refresh()}>
              {t("announcements.refresh")}
            </Button>
          </div>
          <Button size="sm" disabled={unreadCount === 0} onClick={() => void markAllRead()}>
            {t("announcements.markAllRead")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface AnnouncementListProps {
  items: Announcement[]
  readIds: Set<string>
  status: "idle" | "loading" | "ready" | "error"
  expandedId: string | null
  onToggle: (item: Announcement) => void
  onRetry: () => void
}

function AnnouncementList({
  items,
  readIds,
  status,
  expandedId,
  onToggle,
  onRetry,
}: AnnouncementListProps) {
  const { t } = useTranslation()

  if (items.length === 0) {
    if (status === "error") {
      return (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <p>{t("announcements.loadFailed")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            {t("announcements.retry")}
          </Button>
        </div>
      )
    }
    if (status === "loading") {
      return (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {t("announcements.loading")}
        </div>
      )
    }
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {t("announcements.empty")}
      </div>
    )
  }

  return (
    <ul className="divide-y">
      {items.map((item) => {
        const unread = !readIds.has(item.id)
        const expanded = expandedId === item.id
        return (
          <li key={item.id} className="py-1">
            <button
              type="button"
              data-announcement-id={item.id}
              data-unread={unread ? "true" : "false"}
              aria-expanded={expanded}
              onClick={() => onToggle(item)}
              className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-accent/40"
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                  unread ? "bg-destructive" : "border border-muted-foreground/40"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      unread ? "font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {item.title}
                  </span>
                  {item.pinned && (
                    <span className="shrink-0 rounded-full bg-accent/60 px-1.5 py-0.5 text-[0.625rem] text-accent-foreground">
                      {t("announcements.pinned")}
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatAnnouncementDate(item.publishedAt)}
                  </span>
                </span>
              </span>
            </button>

            {expanded && (
              <div className="px-1.5 pb-3 pl-6 text-sm leading-relaxed text-foreground/90">
                <div className="[&_a]:underline [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-medium [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5">
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(event) => {
                            // 不在 webview 里跳转：外链一律交给系统浏览器。
                            event.preventDefault()
                            if (href) void openExternalUrl(href)
                          }}
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {item.body}
                  </ReactMarkdown>
                </div>
                {item.url && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="mt-1 px-0 text-xs"
                    onClick={() => void openExternalUrl(item.url!)}
                  >
                    {t("announcements.openLink")}
                  </Button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
