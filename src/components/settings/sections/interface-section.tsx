import { useTranslation } from "react-i18next"
import { Label } from "@/components/ui/label"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import {
  normalizeSidebarNavConfig,
  type SidebarNavItemId,
} from "@/lib/sidebar-nav-preferences"
import { UI_FONT_OPTIONS } from "@/lib/font-settings"

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

const VISUAL_STYLE_OPTIONS = [
  {
    value: "classic",
    label: "经典原版",
    description: "保留当前浅色、深色配色。",
    colors: ["#ffffff", "#171717", "#e5e5e5"],
  },
  {
    value: "tianqing",
    label: "天青釉色",
    description: "天青主题色、冰裂浅底、鎏金点缀。",
    colors: ["#3D8B9E", "#E3F3F8", "#C4A265"],
  },
  {
    value: "qingci",
    label: "青瓷墨韵",
    description: "青瓷主色、宣纸暖底、檀木点缀。",
    colors: ["#3E6360", "#EDE6D8", "#B8956A"],
  },
  {
    value: "yunshan",
    label: "云山黛色",
    description: "黛蓝主题色、晨雾浅底、石绿辅助。",
    colors: ["#35647A", "#DAEEF5", "#3A7A5C"],
  },
  {
    value: "cangzhu",
    label: "苍苍竹色",
    description: "竹青主题色、竹编暖纸背景、金竹辅助色。",
    colors: ["#3E6B58", "#EDE8D8", "#C8A96E"],
  },
  {
    value: "yuebai",
    label: "月白黛蓝",
    description: "黛蓝主题色、霜月浅底、琥珀点缀。",
    colors: ["#4A5E95", "#DDE5F0", "#C4956A"],
  },
  {
    value: "gumo",
    label: "古墨流金",
    description: "古金主题色、象牙浅底、玄墨层次。",
    colors: ["#C49A3C", "#F5F0E8", "#D4AD5A"],
  },
] as const

const SIDEBAR_NAV_LABEL_KEYS: Record<SidebarNavItemId, string> = {
  wiki: "novel.nav.wiki",
  sources: "novel.nav.sources",
  graph: "novel.nav.graph",
  lint: "novel.nav.lint",
  soul: "novel.nav.soul",
  skillLibrary: "novel.nav.skillLibrary",
  writingSkillLibrary: "novel.nav.writingSkillLibrary",
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

      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <Label>视觉风格</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            东方美学方案不会覆盖原设计，可随时切回经典原版。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {VISUAL_STYLE_OPTIONS.map((option) => {
            const active = draft.visualStyle === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setDraft("visualStyle", option.value)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border hover:bg-accent/50"
                }`}
              >
                <div className="mb-3 flex gap-1.5">
                  {option.colors.map((color) => (
                    <span
                      key={color}
                      className="h-7 flex-1 rounded-md border"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="text-sm font-medium">{option.label}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</p>
              </button>
            )
          })}
        </div>
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
        <div>
          <Label>界面字体</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            默认使用本机系统字体，也可以切换为本机已安装的常见字体。
          </p>
        </div>
        <select
          value={draft.uiFontFamily}
          onChange={(e) => setDraft("uiFontFamily", e.target.value as SettingsDraft["uiFontFamily"])}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring/30"
          aria-label="界面字体"
        >
          {UI_FONT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
