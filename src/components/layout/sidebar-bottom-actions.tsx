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
import { UserRound } from "lucide-react"

import { useWikiStore, type SettingsCategoryId } from "@/stores/wiki-store"
import { useAccountStore } from "@/stores/account-store"
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

  /**
   * 统一的「去设置」动作。
   *
   * 关键点：`activeSettingsCategory` 会被 SettingsView 的 effect **读走并清空**，
   * 而那个 effect 依赖 `changeCategory`（它内部依赖 `active`）。如果目标分区恰好
   * 就是当前分区（例如已经停在「界面」再点外观），`changeCategory` 会提前 return，
   * 消费逻辑却照旧把请求清掉 —— 用户看到的就是「点了没反应」（用户 2026-10-28 报的）。
   *
   * 所以这里：同一 tick 里既下发分区、又强制刷新视图；**相同分区再点一次**时给
   * 一个非空 → 空的二次写入，让 SettingsView 的 effect 重新跑一遍。
   */
  const goToSettings = (category: SettingsCategoryId) => {
    setMenuOpen(false)
    setSearchPanelOpen(false)
    setActiveSettingsCategory(category)
    setActiveView("settings")
    // 已经在该视图时，靠一次微任务重放请求，确保分区生效
    queueMicrotask(() => {
      const state = useWikiStore.getState()
      if (state.activeView === "settings" && state.activeSettingsCategory === null) {
        state.setActiveSettingsCategory(category)
      }
    })
  }

  const openAccountSettings = () => goToSettings("account")

  const openMaintenance = () => {
    setMenuOpen(false)
    setSearchPanelOpen(false)
    setActiveView("maintenance")
  }

  /** 外观入口：不再把皮肤全部摊开，而是跳到「设置 → 界面」（那里才是完整的外观设置）。 */
  const openAppearanceSettings = () => goToSettings("interface")

  /** 通用设置入口（用户报「点头像后下面没有设置了」——这里是它回来的地方）。 */
  const openGeneralSettings = () => {
    setMenuOpen(false)
    setSearchPanelOpen(false)
    setActiveView("settings")
  }

  return (
    <div
      data-ui="sidebar-bottom-actions"
      className="flex shrink-0 items-center gap-1 border-t py-1.5 pl-3 pr-1.5"
    >
      {/*
       * 左下角是账号入口：头像 + 用户名一起显示（用户要求），整块可点。
       * 点它展开菜单（账号信息 / 外观设置 / 设置 / 维护工具），不再直接弹账号信息。
       *
       * 左边距 pl-3：头像原本紧贴侧栏边线，用户要求「向右再移动一部分」。
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
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors ${
          menuOpen || activeView === "settings"
            ? "bg-accent/60 text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
        }`}
      >
        {accountUser ? (
          <span className="sidebar-account-avatar flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <AccountAvatar user={accountUser} baseUrl={accountSession?.baseUrl ?? null} />
          </span>
        ) : (
          <span className="sidebar-account-avatar flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <UserRound className="h-4 w-4" />
          </span>
        )}
        <span className="ui-test-account-name truncate text-xs font-medium">{accountDisplayNameText}</span>
      </button>

      {/* 公告铃铛推到最右（用户要求），与图标栏其它入口同一尺寸节奏。 */}
      <div className="flex shrink-0 items-center">
        <AnnouncementBell />
      </div>

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

            {/*
             * 外观不再把皮肤列表摊在菜单里（用户：「不要将外观全部展开」）：
             * 这里只留一个入口，跳到设置里的「界面」——那里才是完整的外观设置。
             */}
            <button
              type="button"
              role="menuitem"
              data-ui="sidebar-appearance-entry"
              className="ui-test-menu-item"
              onClick={openAppearanceSettings}
            >
              <span className="ui-test-skin-copy">
                <span>{t("sidebarActions.appearance")}</span>
                <small>主题皮肤与界面细节（在设置 › 界面）</small>
              </span>
            </button>

            {/* 设置入口：从原左下角齿轮搬到这里，避免功能丢失。 */}
            <button
              type="button"
              role="menuitem"
              data-ui="sidebar-settings-entry"
              className="ui-test-menu-item"
              onClick={openGeneralSettings}
            >
              <span className="ui-test-skin-copy">
                <span>{t("sidebarActions.settings")}</span>
                <small>模型、云同步、网络等全部设置</small>
              </span>
            </button>

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
