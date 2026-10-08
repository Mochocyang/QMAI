import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { Check } from "lucide-react"
import { UI_TEST_SKINS, readUiTestSkin, writeUiTestSkin, type UiTestSkin } from "@/lib/ui-test"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import {
  BodyTypographyFields,
  useSystemFonts,
  type BodyTypographyValue,
} from "./body-typography-fields"
import {
  UI_FONT_OPTIONS,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  UI_FONT_SIZE_PRESETS,
} from "@/lib/font-settings"
import {
  newSystemFontsOnly,
  systemFontValue,
} from "@/lib/system-fonts"
import {
  BUNDLED_FONT_LICENSES,
  BUNDLED_FONT_LICENSES_DIR,
  HARMONYOS_PROMINENT_NOTICE,
} from "@/lib/bundled-font-licenses"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

/**
 * 本机字体（阶段 3）。
 *
 * 枚举、去重与失败态的实现已搬到共享组件 `./body-typography-fields`
 * （设置页与写作现场浮层共用那一份），此处只从那里取 hook 与组件。
 */
function UiTestInterfaceSection({ draft, setDraft }: Props) {
  const id = useId()
  const [skin, setSkin] = useState<UiTestSkin>(readUiTestSkin)
  const [skinError, setSkinError] = useState("")
  const { fonts: rawSystemFonts, error: systemFontError } = useSystemFonts()

  /*
   * 界面字体按**界面**内置表去重（用 useMemo 而不是每次渲染重算：
   * 枚举结果是模块级缓存的对象，本机列表可达数百项，每渲染一次重算一遍没必要）。
   * 正文字体的去重（按正文内置表）随正文字体控件一起住在共享组件里。
   */
  const uiSystemFonts = useMemo(
    () => newSystemFontsOnly(rawSystemFonts, UI_FONT_OPTIONS.map((o) => o.cssFamily)),
    [rawSystemFonts],
  )
  const scalePercent = Math.round(draft.uiFontSizeScale * 100)
  const sizePreset = UI_FONT_SIZE_PRESETS.find((preset) => Math.abs(draft.uiFontSizeScale - preset.value) < 0.001)

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

  /*
   * 共享控件的键 → 设置草稿的字段。
   * 写成显式 switch 而不是「键名相同就直接拼字符串」：
   * 拼字符串的写法在草稿字段改名后会静默写到一个不存在的键上，
   * 而 switch 会让 tsc 立刻报错。
   *
   * ⚠ `default` 里那句 `const _never: never = key` 不是装饰，它是**必需的**。
   *
   * 原先这里写的是 `default: break`，而它会让**共享控件新增参数**这件事
   * 完全静默：`BodyTypographyValue` 加第 7 个键时，switch 没覆盖它，
   * `default: break` 把它吸收掉，函数返回 undefined，界面上表现为
   * 「这一项怎么拖都没反应」—— 而 `tsc` 报 **0 个错**。
   * 上面那句"switch 会让 tsc 立刻报错"只对**改名**成立，对**新增键**不成立。
   *
   * 实测（用仓库自带 typescript 5.9.3 在内存里编译最小复现，
   * 见 .codex-temp/probe-b1-exhaustive-switch.mjs）：
   *   6 键 + default:break → 0 错（当前，基线）
   *   7 键 + default:break → 0 错（← 漏洞：新增参数静默丢写）
   *   6 键 + never 收尾    → 0 错（修法不误报）
   *   7 键 + never 收尾    → 1 错 TS2322（修法抓住了）
   *   7 键 + 删掉 default  → 0 错（所以"删掉 default"修不好）
   *
   * 为什么这个洞值得专门堵：任务 11 要在写作现场浮层里接同一个共享组件，
   * 那正是最可能给它加参数的时刻。没有这道防线，漏一个 case
   * 不会有任何红灯，只能靠人眼比对两份 switch。
   */
  const setBodyTypography = useCallback(<K extends keyof BodyTypographyValue>(
    key: K,
    next: BodyTypographyValue[K],
  ) => {
    switch (key) {
      case "fontFamily": setDraft("uiBodyFontFamily", next as SettingsDraft["uiBodyFontFamily"]); break
      case "fontPx": setDraft("uiBodyFontPx", next as number); break
      case "lineHeight": setDraft("uiBodyLineHeight", next as number); break
      case "letterSpacing": setDraft("uiBodyLetterSpacing", next as number); break
      case "marginX": setDraft("uiBodyMarginX", next as number | null); break
      case "safeBottom": setDraft("uiBodySafeBottom", next as number); break
      default: {
        // 走到这里说明上面漏了一个 case。赋给 never 会让 tsc 报 TS2322。
        // 全部 case 都覆盖时 key 收窄成 never，这一句是合法的（不误报）。
        const _never: never = key
        void _never
      }
    }
  }, [setDraft])

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
            未能读取本机字体（{systemFontError}），界面字体下拉只显示推荐的随包字体。
          </p>
        )}
        {/*
          正文字体与 5 个排版参数由共享组件渲染。
          为什么必须共用：设置页与写作现场浮层是两个入口，
          各写一套 JSX 的话，改了一处忘了另一处，用户就得到两套行为。
        */}
        <BodyTypographyFields
          idPrefix={id}
          value={{
            fontFamily: draft.uiBodyFontFamily,
            fontPx: draft.uiBodyFontPx,
            lineHeight: draft.uiBodyLineHeight,
            letterSpacing: draft.uiBodyLetterSpacing,
            marginX: draft.uiBodyMarginX,
            safeBottom: draft.uiBodySafeBottom,
          }}
          onChange={setBodyTypography}
        />
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
      </div>
      <BundledFontLicenses />
    </div>
  )
}

/**
 * 随包字体的第三方许可告知。
 *
 * ── 为什么这是**必需**的，不是"顺手加的版权页" ──
 * 随包的 9 款族里有一款不是 OFL：鸿蒙黑体（HarmonyOS Sans SC）。它的许可
 * （HarmonyOS Sans Fonts License Agreement）第 2 条第 1 项是**强制**义务：
 *
 *   `YOU shall make a prominent notice in the software to state that
 *    HarmonyOS Sans Fonts are used.`
 *
 * 注意"In the software"—— 仅仅把许可证文本随安装包放到磁盘上**不满足**这一条，
 * 那句话必须出现在用户能看到的界面上。第 4 条（保留版权声明与本协议）
 * 才由随包的 `fonts/licenses/` 满足。所以这里既有显著声明，也列出各款版权行。
 *
 * 该许可还有两个产品层面需知悉的性质：**不可转让**、且**可被撤销**。
 *
 * ── 数据不写在这里 ──
 * 全部来自 `src/lib/bundled-font-licenses.json`，并由
 * `scripts/check-bundled-font-licenses.mjs` 对照随包清单与许可原文核对。
 * 清单增删字体而这里没跟上，就变成"告知不完整"或"告知与事实不符" ——
 * 两者都不会有任何测试失败来提醒，所以必须靠校验脚本。
 */
function BundledFontLicenses() {
  return (
    <section aria-label="第三方字体许可" data-ui="bundled-font-licenses">
      <p className="ui-test-interface-label">第三方字体许可</p>
      <p className="ui-test-interface-description" data-ui="harmonyos-notice">
        {HARMONYOS_PROMINENT_NOTICE}
      </p>
      <ul className="ui-test-interface-description" data-ui="bundled-font-license-list">
        {BUNDLED_FONT_LICENSES.map((font) => (
          <li key={font.family}>
            <span>{font.display}</span>
            <span> · {font.license}</span>
            <span> · {font.copyright}</span>
          </li>
        ))}
      </ul>
      <p className="ui-test-interface-description">
        以上字体的完整许可证原文随安装包提供，位于安装目录的 {BUNDLED_FONT_LICENSES_DIR} 文件夹下。
      </p>
    </section>
  )
}

export function InterfaceSection({ draft, setDraft }: Props) {
  return <UiTestInterfaceSection draft={draft} setDraft={setDraft} />
}
