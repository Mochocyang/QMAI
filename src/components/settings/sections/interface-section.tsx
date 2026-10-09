import { useEffect, useId, useMemo, useState } from "react"
import { Check } from "lucide-react"
import { UI_TEST_SKINS, readUiTestSkin, writeUiTestSkin, type UiTestSkin } from "@/lib/ui-test"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import { useSystemFonts } from "./body-typography-fields"
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
   * ⚠ 正文字体与 5 个排版参数（字号 / 行间距 / 字间距 / 左右边距 / 底部安全距离）
   * **已经从这个页面移走**，见下方 <div data-ui="interface-fields"> 里的注释。
   *
   * 这里原先有一个 6 分支的穷尽 switch（`setBodyTypography`），把共享控件的键
   * 映射到设置草稿字段，并用 `const _never: never = key` 兜住"新增第 7 个参数时
   * 静默丢写"。那套守卫随控件一起搬去了写作现场浮层 —— 现在映射在
   * preview-panel.tsx 的 `applyBodyTypographyChange` 里，**同样**带 never 收尾
   * （不要以为这里的守卫被削弱了：换了个位置，规则没变）。
   * 本页面不再持有这 6 个字段，所以此处也不该再有到它们的写入路径。
   */

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
          ── 正文字体与 5 个排版参数**不在这里**（用户明确要求）──

          用户原话：「设置当中显示的『正文字体、正文字号、行间距、字间距、
          左右边距、底部安全距离』这些内容，完全不需要放在这里。这些是在
          章节当中显示的，不应该放在设置当中。」

          这不是单纯的"挪个位置"：这 6 项是**章节正文的排版**，作用域是当前
          文档的正文观感，用户调它的时机是"正在写这一章的时候"。
          放进全局设置页有两个实际害处：
            · 心智模型错位 —— 在"外观与界面"里改，会以为改的是整个软件的外观，
              而它只影响正文；
            · 改了不生效的错觉 —— 设置页要先点「保存」才写盘，
              而写作现场是边拖边看、立即生效，同一个参数在两处行为不同。

          它们现在只由章节工具栏的「字体设置」浮层提供
          （preview-panel.tsx 里渲染那个共享控件）。
          本页面因此**不得**再渲染那个共享控件 ——
          这条由 interface-sidebar-nav.spec.ts 的正向+反向断言钉住。
          该页面保留的只有界面自己的字体与字号。
        */}
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
      {/*
        ⚠ 这一句**必须保持默认可见**，不许折进下面的 <details>。

        用户要求「这些不需要显示出来，隐藏起来」，指的是那一长串版权行。
        但 HarmonyOS 的许可第 2 条第 1 项是**强制**的：
          `YOU shall make a prominent notice in the software to state that
           HarmonyOS Sans Fonts are used.`
        折进默认收起的 <details> 就等于"用户看不到"，那条义务不再满足 ——
        这不是审美取舍，是许可合规问题，所以它单独留在折叠之外。
        用户已知悉并选择了这个方案（保留显著声明 + 折叠版权清单）。
      */}
      <p className="ui-test-interface-description" data-ui="harmonyos-notice">
        {HARMONYOS_PROMINENT_NOTICE}
      </p>
      {/*
        版权清单默认收起。它仍需**在界面里可达**：各款 OFL 字体要求保留版权声明，
        而随包的 fonts/licenses/ 满足的是"保留"，界面上给一个可展开的入口
        满足的是"用户能看到"。
      */}
      <details data-ui="bundled-font-license-details">
        <summary className="ui-test-interface-label">第三方字体许可</summary>
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
      </details>
    </section>
  )
}

export function InterfaceSection({ draft, setDraft }: Props) {
  return <UiTestInterfaceSection draft={draft} setDraft={setDraft} />
}
