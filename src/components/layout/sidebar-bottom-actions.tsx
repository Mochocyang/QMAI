/**
 * 侧栏底部操作栏：外观（主题）切换 + 设置。
 *
 * 位置说明：原先这两个入口挂在最左侧的窄图标栏（IconSidebar）底部，
 * 现改为放到「章节列表 / 大纲列表」等**侧栏面板的底部**。为了让推演室、
 * 图谱、审阅中心、拆书、搜索历史、回收站等视图也都能进入外观与设置，
 * 各侧栏面板统一渲染本组件。
 *
 * 主题菜单的位置逻辑沿用原实现：贴在触发器附近、优先向上弹出。
 */

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Check, Moon, Settings, Sun, SunMoon } from "lucide-react"

import { useWikiStore } from "@/stores/wiki-store"
import { saveTheme } from "@/lib/project-store"
import { applyTheme, type ThemeMode } from "@/lib/theme-utils"

const THEME_OPTIONS: { value: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { value: "light", icon: Sun, labelKey: "theme.light" },
  { value: "dark", icon: Moon, labelKey: "theme.dark" },
  { value: "system", icon: SunMoon, labelKey: "theme.system" },
]

const MENU_WIDTH = 180
const MENU_ITEM_HEIGHT = 36
const MENU_PADDING = 8

export function SidebarBottomActions() {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSearchPanelOpen = useWikiStore((s) => s.setSearchPanelOpen)
  const theme = useWikiStore((s) => s.theme)
  const setTheme = useWikiStore((s) => s.setTheme)

  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(
    null,
  )

  const getThemeIcon = () => {
    const option = THEME_OPTIONS.find((o) => o.value === theme)
    const Icon = option?.icon ?? Sun
    return <Icon className="h-4 w-4 shrink-0" />
  }

  const handleSelectTheme = (nextTheme: ThemeMode) => {
    setTheme(nextTheme)
    saveTheme(nextTheme)
    applyTheme(nextTheme)
    setThemeMenuOpen(false)
  }

  useEffect(() => {
    if (!themeMenuOpen) {
      setMenuStyle(null)
      return
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const menuHeight = THEME_OPTIONS.length * MENU_ITEM_HEIGHT + MENU_PADDING
      const left = Math.min(
        Math.max(4, rect.left),
        Math.max(4, window.innerWidth - MENU_WIDTH - 4),
      )
      const availableAbove = rect.top
      const availableBelow = window.innerHeight - rect.bottom
      // 底栏优先向上弹出
      const top =
        availableAbove >= menuHeight + 6 || availableAbove >= availableBelow
          ? Math.max(4, rect.top - menuHeight - 6)
          : rect.bottom + 6
      setMenuStyle({ left, top })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [themeMenuOpen])

  return (
    <div
      data-ui="sidebar-bottom-actions"
      className="flex shrink-0 items-center gap-1 border-t px-1.5 py-1.5"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setThemeMenuOpen((open) => !open)}
        title={t("sidebarActions.switchTheme")}
        aria-label={t("sidebarActions.switchTheme")}
        aria-haspopup="menu"
        aria-expanded={themeMenuOpen}
        className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
          themeMenuOpen
            ? "bg-accent/60 text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
        }`}
      >
        {getThemeIcon()}
        <span className="truncate">{t("sidebarActions.appearance")}</span>
      </button>

      <button
        type="button"
        onClick={() => {
          setSearchPanelOpen(false)
          setActiveView("settings")
        }}
        title={t("sidebarActions.settings")}
        aria-label={t("sidebarActions.settings")}
        className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
          activeView === "settings"
            ? "qm-selected"
            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
        }`}
      >
        <Settings className="h-4 w-4 shrink-0" />
        <span className="truncate">{t("sidebarActions.settings")}</span>
      </button>

      {themeMenuOpen &&
        menuStyle &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setThemeMenuOpen(false)}
            />
            <div
              className="fixed z-50 rounded-md border bg-popover p-1 shadow-md"
              style={{ left: menuStyle.left, top: menuStyle.top, width: MENU_WIDTH }}
              role="menu"
              aria-label={t("sidebarActions.switchTheme")}
            >
              <div className="px-2.5 py-1 text-[0.6875rem] font-medium text-muted-foreground">
                {t("sidebarActions.appearance")}
              </div>
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon
                const isActive = theme === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => handleSelectTheme(option.value)}
                    className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                      isActive ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{t(option.labelKey)}</span>
                    <Check
                      className={`h-4 w-4 shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`}
                    />
                  </button>
                )
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
