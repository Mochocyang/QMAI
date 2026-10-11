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

// 与 .ui-test-skin-menu 的设计宽度一致（窄了会让「名称 + 说明」换行、看着不像完整菜单）
const MENU_WIDTH = 290

export function SidebarBottomActions() {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSearchPanelOpen = useWikiStore((s) => s.setSearchPanelOpen)
  const appearance = useAppearanceSkin()

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
        className={`flex min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
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
          className={`flex min-w-0 flex-1 items-center justify-end gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
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
