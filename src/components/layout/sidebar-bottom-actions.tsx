/**
 * 侧栏底部操作栏：设置（左）+ 公告（设置右侧）+ 外观（右）。
 *
 * 位置说明：这几个入口原先分散在最左图标栏与顶栏；现在统一放到
 * 「章节列表 / 大纲列表」等**侧栏面板的底部**。为了让推演室、图谱、审阅中心、
 * 拆书、搜索历史、回收站等视图也都能进入，各侧栏面板统一渲染本组件。
 *
 * 三个入口都只留图标（去文字化），可访问名称交给 title / aria-label；
 * 「公告」是铃铛 + 未读角标，弹窗本体挂在 App 根部，不在这里渲染。
 *
 * 「外观」= 皮肤切换（静水 / 纸间 / 星夜），原先在顶栏那个月亮图标；
 * 皮肤状态由外壳通过 AppearanceSkinProvider 透传下来。
 */

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Check, UserRound } from "lucide-react"

import { useWikiStore } from "@/stores/wiki-store"
import { useAccountStore } from "@/stores/account-store"
import { UI_TEST_SKINS } from "@/lib/ui-test"
import { useAppearanceSkin } from "@/components/layout/appearance-context"
import { AnnouncementBell } from "@/components/layout/announcement-bell"
import { AccountAvatar } from "@/components/account/account-avatar"
import { accountDisplayName } from "@/components/account/account-display"

// 与 .ui-test-skin-menu 的设计宽度一致（窄了会让「名称 + 说明」换行、看着不像完整菜单）
const MENU_WIDTH = 290

export function SidebarBottomActions() {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setActiveSettingsCategory = useWikiStore((s) => s.setActiveSettingsCategory)
  const setSearchPanelOpen = useWikiStore((s) => s.setSearchPanelOpen)
  const appearance = useAppearanceSkin()
  const accountUser = useAccountStore((state) => state.user)
  const accountSession = useAccountStore((state) => state.session)
  const accountDisplayNameText = accountUser
    ? accountDisplayName(accountUser.displayName, accountUser.email)
    : "未登录"
  const accountTitle = accountUser ? `${accountDisplayNameText} · ${accountUser.email}` : "账号与外观"

  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuStyle, setMenuStyle] = useState<{
    left: number
    bottom: number
    maxHeight: number
  } | null>(null)

  const currentSkin = appearance?.skin ?? "jing"

  useEffect(() => {
    if (!menuOpen) {
      setMenuStyle(null)
      return
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.min(
        Math.max(4, rect.left),
        Math.max(4, window.innerWidth - MENU_WIDTH - 4),
      )
      /*
       * 菜单**以底边锚定**在触发按钮上方，而不是按估算高度去算 top：
       * .ui-test-menu-pop 的 max-height 是固定值，若 top 按偏小的高度估算，
       * 菜单会向下越过窗口底边被裁掉（最后一项「星夜」只露一半）。
       * 用 bottom 锚定后高度自适应，另给 maxHeight 兜底，超出时才内部滚动。
       */
      setMenuStyle({
        left,
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
        maxHeight: Math.max(140, rect.top - 12),
      })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const outside = (event: PointerEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return
      if ((event.target as HTMLElement)?.closest?.(".ui-test-skin-menu")) return
      setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setMenuOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside, true)
      document.removeEventListener("keydown", escape)
    }
  }, [menuOpen])

  const selectSkin = (skin: (typeof UI_TEST_SKINS)[number]["id"]) => {
    appearance?.selectSkin(skin)
    setMenuOpen(false)
    triggerRef.current?.focus()
  }

  const openAccountSettings = () => {
    setMenuOpen(false)
    setSearchPanelOpen(false)
    // 先定分区再切视图：SettingsView 挂载后读取并消费这个分区
    setActiveSettingsCategory("account")
    setActiveView("settings")
  }

  const openMaintenance = () => {
    setMenuOpen(false)
    setSearchPanelOpen(false)
    setActiveView("maintenance")
  }

  return (
    <div
      data-ui="sidebar-bottom-actions"
      className="flex shrink-0 items-center gap-0 border-t px-1.5 py-1.5"
    >
      {/*
       * 左下角是头像入口（替代原来的设置齿轮，用户要求「头像功能移动到左下角」）。
       * 点它不直接弹账号信息，而是展开一个菜单：头像 + 外观设置（皮肤）+ 维护工具；
       * 菜单里点头像才去「设置 → 账号」。
       */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        title={accountTitle}
        aria-label="账号与外观"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-ui="sidebar-account-avatar"
        className={`flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md transition-colors ${
          menuOpen || activeView === "settings"
            ? "bg-accent/60 text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
        }`}
      >
        {accountUser ? (
          <AccountAvatar user={accountUser} baseUrl={accountSession?.baseUrl ?? null} />
        ) : (
          <UserRound className="h-4 w-4" />
        )}
      </button>

      <AnnouncementBell />

      {menuOpen &&
        menuStyle &&
        createPortal(
          <div
            className="ui-test-menu-pop ui-test-avatar-menu"
            style={{
              // 覆盖 .ui-test-menu-pop 的 absolute/top/right，改为按底边锚定的 fixed 弹层
              position: "fixed",
              top: "auto",
              right: "auto",
              left: menuStyle.left,
              bottom: menuStyle.bottom,
              width: MENU_WIDTH,
              maxHeight: menuStyle.maxHeight,
              overflowY: "auto",
            }}
            role="menu"
            aria-label="账号与外观"
            data-tauri-drag-region="false"
          >
            <button
              type="button"
              role="menuitem"
              data-ui="sidebar-avatar-account-entry"
              className="ui-test-menu-item flex w-full items-center gap-2.5 text-left"
              onClick={openAccountSettings}
            >
              {accountUser ? (
                <AccountAvatar user={accountUser} baseUrl={accountSession?.baseUrl ?? null} size="lg" />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
              <span className="ui-test-skin-copy min-w-0">
                <span className="truncate">{accountDisplayNameText}</span>
                <small className="truncate">{accountUser ? accountUser.email : "点击登录账号"}</small>
              </span>
            </button>

            {appearance && (
              <>
                <div className="ui-test-menu-title">{t("sidebarActions.appearance")}</div>
                {UI_TEST_SKINS.map((item) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={currentSkin === item.id}
                    className="ui-test-menu-item"
                    key={item.id}
                    onClick={() => selectSkin(item.id)}
                  >
                    <span className={`ui-test-skin-dot ui-test-skin-dot-${item.id}`} />
                    <span className="ui-test-skin-copy">
                      <span>{item.name}</span>
                      <small>{item.hint}</small>
                    </span>
                    {currentSkin === item.id && <Check />}
                  </button>
                ))}
              </>
            )}

            <div className="ui-test-menu-title">维护</div>
            <button
              type="button"
              role="menuitem"
              data-ui="sidebar-maintenance-entry"
              className="ui-test-menu-item"
              onClick={openMaintenance}
            >
              <span className="ui-test-skin-copy">
                <span>维护工具</span>
                <small>清理缓存、体检孤儿记忆</small>
              </span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
