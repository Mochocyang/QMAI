import { useTranslation } from "react-i18next"
import { Label } from "@/components/ui/label"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import {
  normalizeSidebarNavConfig,
  type SidebarNavItemId,
} from "@/lib/sidebar-nav-preferences"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

const UI_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
]

const FONT_SIZE_PRESETS = [
  { label: "小", value: 0.9 },
  { label: "默认", value: 1 },
  { label: "大", value: 1.15 },
  { label: "特大", value: 1.3 },
]

const SIDEBAR_NAV_LABEL_KEYS: Record<SidebarNavItemId, string> = {
  wiki: "novel.nav.wiki",
  sources: "novel.nav.sources",
  graph: "novel.nav.graph",
  lint: "novel.nav.lint",
  soul: "novel.nav.soul",
  bookAnalysis: "novel.nav.dismantling",
  reviewCenter: "novel.nav.reviewCenter",
  storySimulation: "novel.nav.storySimulation",
  search: "novel.nav.search",
  trash: "nav.trash",
}

export function InterfaceSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const scalePercent = Math.round(draft.uiFontSizeScale * 100)
  const sidebarNavConfig = normalizeSidebarNavConfig(draft.sidebarNavConfig)
  const hiddenSidebarNavIds = new Set(sidebarNavConfig.hidden)

  const handleToggleSidebarNavItem = (id: SidebarNavItemId, visible: boolean) => {
    const hidden = visible
      ? sidebarNavConfig.hidden.filter((itemId) => itemId !== id)
      : [...sidebarNavConfig.hidden, id]
    setDraft("sidebarNavConfig", normalizeSidebarNavConfig({
      ...sidebarNavConfig,
      hidden,
    }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.interface.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.interface.description")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("settings.sections.interface.uiLanguage")}</Label>
        <div className="flex flex-wrap gap-2">
          {UI_LANGUAGES.map((l) => {
            const active = draft.uiLanguage === l.value
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => setDraft("uiLanguage", l.value)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent"
                }`}
              >
                {l.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.interface.uiLanguageHint")}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <Label>{t("settings.sections.interface.sidebarNavTitle")}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("settings.sections.interface.sidebarNavDescription")}
          </p>
        </div>
        <div className="grid gap-2">
          {sidebarNavConfig.order.map((id) => {
            const visible = !hiddenSidebarNavIds.has(id)
            return (
              <label
                key={id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/40"
              >
                <span className="truncate">{t(SIDEBAR_NAV_LABEL_KEYS[id])}</span>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(e) => handleToggleSidebarNavItem(id, e.target.checked)}
                  className="h-4 w-4 accent-primary"
                  aria-label={t(SIDEBAR_NAV_LABEL_KEYS[id])}
                />
              </label>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.interface.sidebarNavOrderHint")}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <Label>界面字号</Label>
          <span className="text-xs text-muted-foreground">{scalePercent}%</span>
        </div>
        <input
          type="range"
          min={85}
          max={130}
          step={5}
          value={scalePercent}
          onChange={(e) => setDraft("uiFontSizeScale", Number(e.target.value) / 100)}
          className="w-full accent-primary"
          aria-label="界面字号"
        />
        <div className="flex flex-wrap gap-2">
          {FONT_SIZE_PRESETS.map((preset) => {
            const active = Math.abs(draft.uiFontSizeScale - preset.value) < 0.001
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => setDraft("uiFontSizeScale", preset.value)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent"
                }`}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          调整整个应用的字号，保存后立即生效。
        </p>
      </div>
    </div>
  )
}
