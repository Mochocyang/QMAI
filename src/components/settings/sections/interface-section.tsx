import { useEffect, useId, useMemo, useState } from "react"
import { Check } from "lucide-react"
import { UI_TEST_SKINS, readUiTestSkin, writeUiTestSkin, type UiTestSkin } from "@/lib/ui-test"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import {
  BODY_FONT_OPTIONS,
  BODY_FONT_SIZE_MAX,
  BODY_FONT_SIZE_MIN,
  BODY_FONT_SIZE_PRESETS,
  UI_FONT_OPTIONS,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  UI_FONT_SIZE_PRESETS,
} from "@/lib/font-settings"
import {
  loadSystemCjkFonts,
  newSystemFontsOnly,
  systemFontValue,
  type SystemCjkFont,
} from "@/lib/system-fonts"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

/**
 * 本机字体（阶段 3）。
 *
 * ── 为什么用独立组件 ──
 * 枚举是异步的（要跨 IPC 问 Rust），若把状态放在 `UiTestInterfaceSection` 里，
 * 每次设置页因任何无关原因重渲染都会重新走一遍列表构造逻辑。
 * 抽出来让"异步加载"这件事只有一个归属，也让失败态能局部呈现。
 *
 * ── 失败与"没有"必须分开呈现 ──
 * `error` 非空 = 枚举**失败**（例如非 Windows 平台），此时只显示内置项，
 * 并说明原因；若把失败说成"本机没有中文字体"，那是个会被用户信以为真的假结论。
 *
 * ── 这里返回**原始**枚举结果，去重留给调用方 ──
 * 两个下拉的去重集合不同（界面与正文的内置表不是同一张）：一个字体可能被
 * 界面内置项覆盖、却没被正文内置项覆盖。若在这里就用界面表过滤掉，
 * 正文下拉会缺一项；反之亦然。故原始结果只取一次，派生两次。
 */
function useSystemFonts() {
  const [fonts, setFonts] = useState<SystemCjkFont[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadSystemCjkFonts().then((result) => {
      // 组件已卸载时不再 setState（设置页会被频繁开关）
      if (cancelled) return
      setFonts(result.fonts)
      setError(result.error)
    })
    return () => { cancelled = true }
  }, [])

  return { fonts, error }
}

function UiTestInterfaceSection({ draft, setDraft }: Props) {
  const id = useId()
  const [skin, setSkin] = useState<UiTestSkin>(readUiTestSkin)
  const [skinError, setSkinError] = useState("")
  const { fonts: rawSystemFonts, error: systemFontError } = useSystemFonts()

  /*
   * 各自按**自己的**内置表去重（用 useMemo 而不是每次渲染重算：
   * 枚举结果是模块级缓存的对象，本机列表可达数百项，每渲染一次重算一遍没必要）。
   */
  const uiSystemFonts = useMemo(
    () => newSystemFontsOnly(rawSystemFonts, UI_FONT_OPTIONS.map((o) => o.cssFamily)),
    [rawSystemFonts],
  )
  const bodySystemFonts = useMemo(
    () => newSystemFontsOnly(rawSystemFonts, BODY_FONT_OPTIONS.map((o) => o.cssFamily)),
    [rawSystemFonts],
  )
  const scalePercent = Math.round(draft.uiFontSizeScale * 100)
  const sizePreset = UI_FONT_SIZE_PRESETS.find((preset) => Math.abs(draft.uiFontSizeScale - preset.value) < 0.001)
  const bodyScalePercent = Math.round(draft.uiBodyFontSizeScale * 100)
  const bodySizePreset = BODY_FONT_SIZE_PRESETS.find((preset) => Math.abs(draft.uiBodyFontSizeScale - preset.value) < 0.001)

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
      <h1 className="ui-test-page-title">外观与界面</h1>
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
          <div><label htmlFor={`${id}-font`}>界面字体</label><p>沿用本机已安装字体与系统回退；保存后生效。</p></div>
          <select id={`${id}-font`} aria-label="界面字体" value={draft.uiFontFamily} onChange={(event) => setDraft("uiFontFamily", event.target.value as SettingsDraft["uiFontFamily"])}>
            <optgroup label="推荐">
              {UI_FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
            {/*
              本机字体分组（阶段 3）。
              没有枚举结果时**不显示空分组** —— 一个空的 <optgroup> 会让用户以为
              自己机器上没装中文字体，而更常见的原因只是这里还没加载完。
            */}
            {uiSystemFonts.length > 0 && (
              <optgroup label="本机中文字体">
                {uiSystemFonts.map((font) => {
                  const value = systemFontValue(font.family)
                  // sanitize 不通过的族名不进列表（systemFontValue 返回 null）
                  return value ? <option key={value} value={value}>{font.display}</option> : null
                })}
              </optgroup>
            )}
          </select>
        </div>
        {systemFontError && (
          <p role="status" className="ui-test-interface-description">
            未能读取本机字体（{systemFontError}），两个下拉都只显示推荐的随包字体。
          </p>
        )}
        <div className="ui-test-interface-row">
          <div><label htmlFor={`${id}-body-font`}>正文字体</label><p>只影响小说正文与书卷感衬线标题，与界面字体相互独立。</p></div>
          <select id={`${id}-body-font`} aria-label="正文字体" value={draft.uiBodyFontFamily} onChange={(event) => setDraft("uiBodyFontFamily", event.target.value as SettingsDraft["uiBodyFontFamily"])}>
            <optgroup label="推荐">
              {BODY_FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
            {/* 与界面字体同一份枚举结果；去重按正文内置表单独算 */}
            {bodySystemFonts.length > 0 && (
              <optgroup label="本机中文字体">
                {bodySystemFonts.map((font) => {
                  const value = systemFontValue(font.family)
                  return value ? <option key={value} value={value}>{font.display}</option> : null
                })}
              </optgroup>
            )}
          </select>
        </div>
        <div className="ui-test-interface-row">
          <div><label htmlFor={`${id}-size`}>界面字号</label><p>当前 {scalePercent}%；保留字号预设和细调，保存后生效。</p></div>
          <div className="ui-test-interface-size">
            <select id={`${id}-size`} aria-label="字号预设" value={sizePreset?.value ?? "custom"} onChange={(event) => setDraft("uiFontSizeScale", Number(event.target.value))}>
              {!sizePreset && <option value="custom" disabled>自定义 · {scalePercent}%</option>}
              {UI_FONT_SIZE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label} · {Math.round(preset.value * 100)}%</option>)}
            </select>
            <input type="range" min={Math.round(UI_FONT_SIZE_MIN * 100)} max={Math.round(UI_FONT_SIZE_MAX * 100)} step={5} value={scalePercent} aria-label="界面字号" onChange={(event) => setDraft("uiFontSizeScale", Number(event.target.value) / 100)} />
          </div>
        </div>
        <div className="ui-test-interface-row">
          <div><label htmlFor={`${id}-body-size`}>正文字号</label><p>当前 {bodyScalePercent}%；在界面字号之上只作用于正文与文档标题，保存后生效。</p></div>
          <div className="ui-test-interface-size">
            <select id={`${id}-body-size`} aria-label="正文字号预设" value={bodySizePreset?.value ?? "custom"} onChange={(event) => setDraft("uiBodyFontSizeScale", Number(event.target.value))}>
              {!bodySizePreset && <option value="custom" disabled>自定义 · {bodyScalePercent}%</option>}
              {BODY_FONT_SIZE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label} · {Math.round(preset.value * 100)}%</option>)}
            </select>
            <input type="range" min={Math.round(BODY_FONT_SIZE_MIN * 100)} max={Math.round(BODY_FONT_SIZE_MAX * 100)} step={5} value={bodyScalePercent} aria-label="正文字号" onChange={(event) => setDraft("uiBodyFontSizeScale", Number(event.target.value) / 100)} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function InterfaceSection({ draft, setDraft }: Props) {
  return <UiTestInterfaceSection draft={draft} setDraft={setDraft} />
}
