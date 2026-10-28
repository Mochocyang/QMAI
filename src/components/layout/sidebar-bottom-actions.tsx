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

import { useWikiStore, type SettingsCategoryId } from "@/stores/wiki-store"
import { UI_TEST_SKINS } from "@/lib/ui-test"
import { useAppearanceSkin } from "@/components/layout/appearance-context"
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
  const appearance = useAppearanceSkin()
  const currentSkin = appearance?.skin ?? "jing"
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
    /*
     * 外部点击关闭。⚠️ 必须放行整个菜单（`.ui-test-avatar-menu`）：
     * 这里注册在**捕获阶段**，指针一按下就先跑；如果只放行旧的 `.ui-test-skin-menu`，
     * 在菜单里点任何一项都会先把菜单关掉，随后的 click 落在空气上 ——
     * 表现就是「这几个功能点了都没反应」（用户 2026-10-28 报的）。
     */
    const outside = (event: PointerEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return
      if ((event.target as HTMLElement)?.closest?.(".ui-test-avatar-menu")) return
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

  /** 通用设置入口（用户报「点头像后下面没有设置了」——这里是它回来的地方）。 */
  const openGeneralSettings = () => {
    setMenuOpen(false)
    setSearchPanelOpen(false)
    setActiveView("settings")
  }

  /** 选皮肤：切换后立刻收起菜单（悬停展开的子列表点一下就该生效）。 */
  const selectSkin = (skin: (typeof UI_TEST_SKINS)[number]["id"]) => {
    appearance?.selectSkin(skin)
    setMenuOpen(false)
  }

  return (
    <div
      data-ui="sidebar-bottom-actions"
      className="flex shrink-0 items-center gap-1 border-t py-1.5 pl-2 pr-1.5"
    >
      {/*
       * 左下角账号入口：头像 + 用户名一起显示，整块可点。
       *
       * 布局要点（用户 2026-10-28 反馈「头像跑到最中间」）：
       * 之前这里写了 `flex-1`，按钮被拉满整条底栏，头像就被 gap 推到了中间。
       * 现在改成按内容宽度（`w-fit`），头像自然贴左；给一点左内边距保证不贴边线。
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
        className={`flex w-fit max-w-[calc(100%-2rem)] min-w-0 shrink items-center gap-2 rounded-md px-1 py-1 text-left transition-colors ${
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

      {/* 公告铃铛靠最右：用 ml-auto 把剩余空间全吃掉（按钮本身不再 flex-1）。 */}
      <div className="ml-auto flex shrink-0 items-center">
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
             * 外观：**悬停展开**三个皮肤主题，菜单里不显示副标题（用户要求）。
             * 纯文字一行，鼠标移上去再列出主题，点具体主题直接切换。
             */}
            <div className="ui-avatar-appearance-group">
              <button
                type="button"
                role="menuitem"
                data-ui="sidebar-appearance-entry"
                className="ui-test-menu-item"
                aria-haspopup="menu"
                title="悬停选择主题皮肤"
              >
                <span className="ui-test-skin-copy">
                  <span>{t("sidebarActions.appearance")}</span>
                </span>
              </button>
              <div className="ui-avatar-appearance-sub" role="menu" aria-label={t("sidebarActions.appearance")}>
                {UI_TEST_SKINS.map((item) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={currentSkin === item.id}
                    className="ui-test-menu-item"
                    key={item.id}
                    data-ui={`sidebar-skin-${item.id}`}
                    onClick={() => selectSkin(item.id)}
                  >
                    <span className={`ui-test-skin-dot ui-test-skin-dot-${item.id}`} />
                    <span className="ui-test-skin-copy">
                      <span>{item.name}</span>
                    </span>
                    {currentSkin === item.id && <Check />}
                  </button>
                ))}
              </div>
            </div>

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
              </span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
