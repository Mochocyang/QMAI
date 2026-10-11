/**
 * 侧栏底部操作栏：设置（左）+ 外观（右）。
 *
 * 位置说明：这两个入口原先分散在最左图标栏与顶栏；现在统一放到
 * 「章节列表 / 大纲列表」等**侧栏面板的底部**。为了让推演室、图谱、审阅中心、
 * 拆书、搜索历史、回收站等视图也都能进入，各侧栏面板统一渲染本组件。
 *
 * 「外观」= 皮肤切换（静水 / 纸间 / 星夜），原先在顶栏那个月亮图标；
 * 皮肤状态由外壳通过 AppearanceSkinProvider 透传下来。
 */

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Check, Moon, Settings } from "lucide-react"

import { useWikiStore } from "@/stores/wiki-store"
import { UI_TEST_SKINS } from "@/lib/ui-test"
import { useAppearanceSkin } from "@/components/layout/appearance-context"

const MENU_WIDTH = 200
const MENU_ROW_HEIGHT = 46
const MENU_PADDING = 36

export function SidebarBottomActions() {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSearchPanelOpen = useWikiStore((s) => s.setSearchPanelOpen)
  const appearance = useAppearanceSkin()

  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(
    null,
  )

  const currentSkin = appearance?.skin ?? "jing"

  useEffect(() => {
    if (!menuOpen) {
      setMenuStyle(null)
      return
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const menuHeight = UI_TEST_SKINS.length * MENU_ROW_HEIGHT + MENU_PADDING
      const left = Math.min(
        Math.max(4, rect.left),
        Math.max(4, window.innerWidth - MENU_WIDTH - 4),
      )
      // 底栏优先向上弹出
      const top = Math.max(4, rect.top - menuHeight - 6)
      setMenuStyle({ left, top })
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

  return (
    <div
      data-ui="sidebar-bottom-actions"
      className="flex shrink-0 items-center gap-1 border-t px-1.5 py-1.5"
    >
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

      {appearance && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          title={t("sidebarActions.appearance")}
          aria-label={t("sidebarActions.appearance")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
            menuOpen
              ? "bg-accent/60 text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
          }`}
        >
          <Moon className="h-4 w-4 shrink-0" />
          <span className="truncate">{t("sidebarActions.appearance")}</span>
        </button>
      )}

      {menuOpen &&
        menuStyle &&
        appearance &&
        createPortal(
          <div
            className="ui-test-menu-pop ui-test-skin-menu"
            style={{
              position: "fixed",
              left: menuStyle.left,
              top: menuStyle.top,
              width: MENU_WIDTH,
            }}
            role="menu"
            aria-label={t("sidebarActions.appearance")}
            data-tauri-drag-region="false"
          >
            <div className="ui-test-menu-title">
              {t("sidebarActions.appearance")}
            </div>
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
          </div>,
          document.body,
        )}
    </div>
  )
}
