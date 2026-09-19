import { useEffect, useId, useState } from "react"
import { Check } from "lucide-react"
import { IS_UI_TEST_BUILD, setUiTestMode, UI_TEST_SKINS, readUiTestSkin, writeUiTestSkin, type UiTestSkin } from "@/lib/ui-test"
import { isTauri } from "@/lib/platform"
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
    colors: ["#FFFFFF", "#10251D", "#9AD7B7"],
  },
  {
    value: "fangzheng",
    label: "直角工具型",
    description: "冷灰背景、清晰按钮与选中态、无圆角、紧凑设置密度。",
    colors: ["#F0F4F7", "#007A68", "#C8EFE6"],
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
    colors: ["#F4F7FC", "#304A8A", "#D6A35C"],
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
  bookAnalysis: "novel.nav.dismantling",
  reviewCenter: "novel.nav.reviewCenter",
  storySimulation: "novel.nav.storySimulation",
  search: "novel.nav.search",
  trash: "nav.trash",
}

/** 测试版只切换独立皮肤；字体等继续交给设置草稿和原保存流程。 */
async function switchUiTestMode(enabled: boolean) {
  const targetLabel = enabled ? "新版界面" : "旧版界面"
  if (!window.confirm("切换到" + targetLabel + "需要重启软件。是否立即关闭并重启？")) return
  try { setUiTestMode(enabled) } catch {}
  if (isTauri()) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close().catch(() => {}))
  } else {
    window.close()
  }
}

function UiTestInterfaceSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const [skin, setSkin] = useState<UiTestSkin>(readUiTestSkin)
  const [skinError, setSkinError] = useState("")
  const scalePercent = Math.round(draft.uiFontSizeScale * 100)
  const sizePreset = FONT_SIZE_PRESETS.find((preset) => Math.abs(draft.uiFontSizeScale - preset.value) < 0.001)
  const sidebarNavConfig = normalizeSidebarNavConfig(draft.sidebarNavConfig)

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      const current = root.dataset.uiTestSkin
      if (current === "jing" || current === "zhi" || current === "xing") setSkin(current)
    })
    observer.observe(root, { attributes: true, attributeFilter: ["data-ui-test-skin"] })
    return () => observer.disconnect()
  }, [])

  function chooseSkin(next: UiTestSkin) {
    try {
      writeUiTestSkin(next)
      setSkin(next)
      setSkinError("")
      window.dispatchEvent(new CustomEvent("qmai-ui-test-skin-change", { detail: next }))
    } catch {
      setSkinError("无法保存测试版外观，请重试。当前皮肤保持不变。")
    }
  }

  return (
    <div data-ui="interface-settings">
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-primary">界面版本</Label>
            <p className="mt-1 text-xs text-muted-foreground">当前为规格版界面，可切回旧版；点击后需要重启软件生效。</p>
          </div>
          <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => void switchUiTestMode(false)}>切换到旧版界面</button>
        </div>
      </div>

      <h1 className="ui-test-page-title">外观与界面</h1>
      <p className="ui-test-interface-description">选择适合当前写作的外观，让界面退后，让故事向前。</p>
      <section aria-label="推荐外观">
        <p className="ui-test-interface-label">推荐外观</p>
        <div data-ui="interface-skins" role="group" aria-label="测试版皮肤">
          {UI_TEST_SKINS.map((option) => (
            <button key={option.id} type="button" data-ui-skin-choice={option.id} aria-label={`${option.name}皮肤`} aria-pressed={skin === option.id} onClick={() => chooseSkin(option.id)}>
              <span aria-hidden="true" className={`ui-test-interface-swatch ui-test-skin-dot-${option.id}`} />
              <span className="ui-test-interface-skin-label"><span>{option.name}</span>{skin === option.id && <span className="ui-test-interface-selected"><Check aria-hidden="true" />已选择</span>}</span>
            </button>
          ))}
        </div>
        <p className="ui-test-interface-description">三款皮肤立即应用，仅保存到独立测试版外观偏好，不改变书稿或模型配置。</p>
        {skinError && <p role="alert" className="text-sm text-destructive">{skinError}</p>}
      </section>
      <div data-ui="interface-fields">
        <div className="ui-test-interface-row">
          <div><label htmlFor={`${id}-language`}>界面语言</label><p>只影响界面文案，不改变 AI 输出语言；保存后生效。</p></div>
          <select id={`${id}-language`} aria-label="界面语言" value={draft.uiLanguage} onChange={(event) => setDraft("uiLanguage", event.target.value)}>
            {UI_LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.value === "en" ? "英语" : language.label}</option>)}
          </select>
        </div>
        <div className="ui-test-interface-row">
          <div><label htmlFor={`${id}-font`}>界面字体</label><p>沿用本机已安装字体与系统回退；保存后生效。</p></div>
          <select id={`${id}-font`} aria-label="界面字体" value={draft.uiFontFamily} onChange={(event) => setDraft("uiFontFamily", event.target.value as SettingsDraft["uiFontFamily"])}>
            {UI_FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="ui-test-interface-row">
          <div><label htmlFor={`${id}-size`}>界面字号</label><p>当前 {scalePercent}%；保留字号预设和细调，保存后生效。</p></div>
          <div className="ui-test-interface-size">
            <select id={`${id}-size`} aria-label="字号预设" value={sizePreset?.value ?? "custom"} onChange={(event) => setDraft("uiFontSizeScale", Number(event.target.value))}>
              {!sizePreset && <option value="custom" disabled>自定义 · {scalePercent}%</option>}
              {FONT_SIZE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label} · {Math.round(preset.value * 100)}%</option>)}
            </select>
            <input type="range" min={85} max={130} step={5} value={scalePercent} aria-label="界面字号" onChange={(event) => setDraft("uiFontSizeScale", Number(event.target.value) / 100)} />
          </div>
        </div>
      </div>
      <details data-ui="interface-compatibility">
        <summary><span>兼容界面设置</span><span className="ui-test-interface-compatibility-hint">旧版风格与侧栏显隐</span></summary>
        <p>以下八种视觉风格与旧侧栏显隐仅供旧布局兼容，不用于切换当前测试版皮肤。测试版固定主导航不受旧显隐配置控制；修改后仍需点击页面底部“保存”。</p>
        <div className="ui-test-interface-legacy-styles" role="group" aria-label="旧版视觉风格">
          {VISUAL_STYLE_OPTIONS.map((option) => (
            <button key={option.value} type="button" data-ui-legacy-style={option.value} aria-pressed={draft.visualStyle === option.value} onClick={() => setDraft("visualStyle", option.value)}>
              <span className="ui-test-interface-legacy-colors" aria-hidden="true">{option.colors.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</span>
              <span>{option.label}</span>{draft.visualStyle === option.value && <Check aria-hidden="true" className="inline h-3.5 w-3.5" />}
              <small>{option.description}</small>
            </button>
          ))}
        </div>
        <p className="ui-test-interface-label">旧版侧栏显隐</p>
        <div className="ui-test-interface-legacy-nav">
          {sidebarNavConfig.order.map((item) => (
            <label key={item}>
              <span>{t(SIDEBAR_NAV_LABEL_KEYS[item])}</span>
              <input type="checkbox" aria-label={t(SIDEBAR_NAV_LABEL_KEYS[item])} checked={!sidebarNavConfig.hidden.includes(item)} onChange={(event) => setDraft("sidebarNavConfig", normalizeSidebarNavConfig({
                ...sidebarNavConfig,
                hidden: event.target.checked ? sidebarNavConfig.hidden.filter((value) => value !== item) : [...sidebarNavConfig.hidden, item],
              }))} />
            </label>
          ))}
        </div>
        <p className="ui-test-interface-description">此处保留原侧栏条目的显隐配置；不改变测试版三皮肤，也不会删除任何功能或数据。</p>
      </details>
    </div>
  )
}

export function InterfaceSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  if (IS_UI_TEST_BUILD) return <UiTestInterfaceSection draft={draft} setDraft={setDraft} />
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

      <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-primary">新版界面</Label>
            <p className="mt-1 text-xs text-muted-foreground">切换到新版写作界面；点击后需要重启软件生效。</p>
          </div>
          <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => void switchUiTestMode(true)}>切换到新版界面</button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <Label>视觉风格</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            选择软件界面的整体视觉方案；直角工具型会同时调整浅色、深色、按钮和选中状态。
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
                className={`rounded-lg border p-3 text-left transition-all ${
                  active
                    ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/45"
                    : "border-border hover:border-primary/70 hover:bg-accent/70 hover:shadow-sm hover:ring-1 hover:ring-primary/25"
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
