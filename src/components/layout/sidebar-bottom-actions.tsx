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
import { Check, ChevronRight, LogOut, Palette, Settings, UserRound, Wrench } from "lucide-react"

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
  const accountTitle = accountUser ? `${accountDisplayNameText} · ${accountUser.email}` : "未登录 · 点击登录"

  const [menuOpen, setMenuOpen] = useState(false)
  /** 鼠标是否停在外观子菜单区域上（悬停展开/收起）。 */
  const [appearanceHovered, setAppearanceHovered] = useState(false)
  /** 用户用点击打开/收起的外观子菜单（鼠标移开后再定位）。 */
  const [appearancePinned, setAppearancePinned] = useState(false)
  /** 外观子菜单是否真的显示：默认折叠，悬停中或点击固定住。 */
  const appearanceVisible = appearanceHovered || appearancePinned
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuStyle, setMenuStyle] = useState<{
    left: number
    bottom: number
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
       * 菜单**以底边锚定**在触发按钮上方，而不是按估算高度去算 top。
       *
       * 不要给弹层设 max-height / overflow:auto：菜单只有四项（头像 + 外观 + 设置 +
       * 维护工具，约 200px），从来不需要滚；而一旦它变成滚动容器，「外观」右侧的
       * 皮肤子菜单会被裁掉，还会给弹层撑出一条横向滚动条（用户 2026-10-28 截图）。
       * 子菜单要溢出到菜单外面，父级必须是 overflow: visible。
       */
      setMenuStyle({
        left,
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
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

  /*
   * 账号条目：**未登录时直接弹出登录窗**，不再跳到设置页（用户 2026-11-01 要求）。
   * 已登录时仍进设置的「账号」分区 —— 改密码、换头像、改昵称都在那里。
   */
  const openAccount = () => {
    setMenuOpen(false)
    setSearchPanelOpen(false)
    if (accountUser) {
      goToSettings("account")
      return
    }
    useAccountStore.getState().openDialog("login")
  }

  /** 退出账号：清掉登录态与本地会话，底栏随即显示「未登录」。 */
  const handleLogout = async () => {
    setMenuOpen(false)
    try {
      await useAccountStore.getState().logout()
    } catch (error) {
      console.error("[account] 退出账号失败:", error)
    }
  }

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

  /** 选皮肤：切换后立刻收起菜单（折叠的子列表点一下就该生效）。 */
  const selectSkin = (skin: (typeof UI_TEST_SKINS)[number]["id"]) => {
    appearance?.selectSkin(skin)
    setMenuOpen(false)
  }

  /**
   * 底栏：头像 + 用户名在**左边**，齿轮在**最右**（参考用户给的参考图）。
   *
   * 与上一版的区别：整条底栏不再是「一个大按钮」——
   * 左半是可点的账号块（头像+名字），右侧是独立的设置齿轮（直接打开设置页）。
   * 中间留白把两者分开，头像因此稳定贴左，不会再被拉宽推到中间。
   */
  return (
    <div
      data-ui="sidebar-bottom-actions"
      className="flex shrink-0 items-center gap-1 border-t py-1 pr-1.5 pl-2.5"
    >
      {/*
       * 左侧账号块：**头像在最左，用户名在头像右侧**（用户 2026-10-28 最终确认的顺序）。
       *
       * 位置：底栏留 10px 左内边距（pl-2.5），再叠按钮自身的 2px 内衬，
       * 头像左边缘落在 12px 处 —— 与面板标题「章节列表」的文字左边对齐。
       * 之前是 pl-0（头像直接贴侧栏边界），用户 2026-10-28 反馈「太靠左」。
       *
       * 宽度：账号块 `flex-1 min-w-0`、用户名 `min-w-0 flex-1`，头像 `shrink-0`。
       * 之前的 `w-fit` 在 WebView2 里按 max-content 铺完名字后就收回成固定宽度，
       * 用户名 `truncate` 只剩零宽并被省略号吞掉 —— 用户截图上「头像右边什么都没有」就是这个
       * （2026-10-28 用户复报）。改成拉伸 + 让名字自己收缩，名字才会真正排在头像右侧。
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
        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-0.5 py-1 text-left transition-colors ${
          menuOpen
            ? "bg-accent/60 text-accent-foreground"
            : "hover:bg-accent/50 hover:text-accent-foreground"
        }`}
      >
        {accountUser ? (
          <span className="sidebar-account-avatar flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <AccountAvatar user={accountUser} baseUrl={accountSession?.baseUrl ?? null} />
          </span>
        ) : (
          <span className="sidebar-account-avatar flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
            <UserRound className="h-4 w-4" />
          </span>
        )}
        <span className="ui-test-account-name min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {accountDisplayNameText}
        </span>
      </button>

      {/* 右侧只剩公告铃铛：设置入口已在账号菜单里，不再重复放齿轮。 */}
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
              // 必须 visible：子菜单要弹到菜单右侧外面去（见 ui-test.css 的说明）
              overflow: "visible",
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
              onClick={openAccount}
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
             * 外观：**鼠标移上去就在它右侧弹出**三个皮肤主题，点击也仍然可以展开/收起。
             *
             * 为什么不做成「下方折叠列表」：菜单是 290px 的窄弹层，皮肤放在下面会把
             * 设置 / 维护工具顶到菜单外面（用户 2026-10-28 报「应该在右侧，不是下方」）。
             * 子菜单定位在 `.ui-avatar-appearance-group` 右侧，由 ui-test.css 负责。
             */}
            <div
              className="ui-avatar-appearance-group"
              onMouseEnter={() => setAppearanceHovered(true)}
              onMouseLeave={() => {
                setAppearanceHovered(false)
                setAppearancePinned(false)
              }}
            >
              <button
                type="button"
                role="menuitem"
                data-ui="sidebar-appearance-entry"
                className="ui-test-menu-item"
                aria-haspopup="menu"
                aria-expanded={appearanceVisible}
                onClick={() => setAppearancePinned((open) => !open)}
              >
                <Palette />
                <span className="ui-test-skin-copy">
                  <span>{t("sidebarActions.appearance")}</span>
                </span>
                <ChevronRight
                  className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${appearanceVisible ? "rotate-90" : ""}`}
                />
              </button>
              <div
                className="ui-avatar-appearance-sub"
                role="menu"
                aria-label={t("sidebarActions.appearance")}
                data-open={appearanceVisible ? "true" : "false"}
              >
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
              <Settings />
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
              <Wrench />
              <span className="ui-test-skin-copy">
                <span>维护工具</span>
              </span>
            </button>

            {/*
             * 退出账号：只在已登录时出现（未登录时没有可退的会话）。
             * 放在最后一项，与「设置 / 维护工具」这类入口之间用分隔语义隔开。
             */}
            {accountUser ? (
              <button
                type="button"
                role="menuitem"
                data-ui="sidebar-logout-entry"
                className="ui-test-menu-item"
                onClick={() => void handleLogout()}
              >
                <LogOut />
                <span className="ui-test-skin-copy">
                  <span>{t("sidebarActions.logout", { defaultValue: "退出账号" })}</span>
                </span>
              </button>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  )
}
