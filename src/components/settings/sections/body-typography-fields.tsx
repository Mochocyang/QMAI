import { useEffect, useId, useMemo, useState } from "react"
import {
  BODY_FONT_OPTIONS,
  BODY_FONT_PX_MAX,
  BODY_FONT_PX_MIN,
  BODY_FONT_PX_PRESETS,
  BODY_LETTER_SPACING_MAX,
  BODY_LETTER_SPACING_MIN,
  BODY_LINE_HEIGHT_MAX,
  BODY_LINE_HEIGHT_MIN,
  BODY_MARGIN_X_MAX,
  BODY_MARGIN_X_MIN,
  BODY_SAFE_BOTTOM_MAX,
  BODY_SAFE_BOTTOM_MIN,
  defaultBodyMarginXForViewport,
  type BodyFontFamily,
  type BodyTypographySettings,
} from "@/lib/font-settings"
import {
  loadSystemCjkFonts,
  newSystemFontsOnly,
  systemFontValue,
  type SystemCjkFont,
} from "@/lib/system-fonts"

/**
 * 本机字体（阶段 3）。
 *
 * ── 为什么用独立组件 / 独立 hook ──
 * 枚举是异步的（要跨 IPC 问 Rust），若把状态放在调用方里，
 * 每次无关重渲染都会重走一遍列表构造。抽出来后"异步加载"只有一个归属，
 * 失败态也能局部呈现。`loadSystemCjkFonts` 本身是模块级缓存，
 * 设置页与写作现场浮层各调一次不会额外付出代价。
 *
 * ── 失败与"没有"必须分开呈现 ──
 * error 非空 = 枚举**失败**（例如非 Windows 平台），此时只显示内置项并说明原因；
 * 把失败说成"本机没有中文字体"是个会被用户信以为真的假结论。
 *
 * ── 返回**原始**枚举结果，去重留给调用方 ──
 * 界面下拉与正文下拉的内置表不是同一张，一个字体可能被界面表覆盖、
 * 却没被正文表覆盖。在这里就用某一张表过滤，另一张就会缺项。
 */
export function useSystemFonts(): { fonts: SystemCjkFont[]; error: string | null } {
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

/**
 * 6 个排版参数的一组取值。设置页传草稿，写作现场传 store，形态统一。
 *
 * 用 extends 而不是把那 5 个字段再抄一遍：任务 9 与任务 11 各有一处
 * 「控件键 → 字段」的手写映射，两份结构相同的类型正是
 * fontPx / lineHeight 被写反时不会报错的地方。继承之后字段只有一处定义。
 *
 * 注意：`defaultBodyMarginXForViewport` 与它依赖的三个范围常量
 * **不在本文件**，它们和其余范围一起住在 `@/lib/font-settings`
 * —— CSS 兜底值 clamp(20px,4vw,48px) 也必须只有一个来源，
 * 否则设置页显示的「当前边距」会和真实渲染对不上。
 * 本文件只需要从那里 import 使用。
 */
export interface BodyTypographyValue extends BodyTypographySettings {
  fontFamily: BodyFontFamily
}

/*
 * 编译期把这条关系钉死。
 *
 * 为什么需要一行看着多余的赋值：`extends` 是**单向**的，日后有人
 * 为了"灵活"把 BodyTypographyValue 改成独立接口、字段顺序一乱，
 * `applyBodyTypography(value)` 这种"整体传下去"的调用仍然会过 ——
 * 直到某个字段被写反。这一行让"两者必须互相兼容"变成编译错误，
 * 而不是运行时才发现行间距被当成了字号。
 * 用 `void` 消费掉，避免 noUnusedLocals 报未使用。
 */
const _bodyTypographyValueIsBodyTypographySettings: BodyTypographySettings = {} as BodyTypographyValue
void _bodyTypographyValueIsBodyTypographySettings

interface Props {
  value: BodyTypographyValue
  onChange: <K extends keyof BodyTypographyValue>(key: K, next: BodyTypographyValue[K]) => void
  /** aria/id 前缀；两个入口各传自己的，避免同一页面出现重复 id。 */
  idPrefix?: string
  /** 紧凑模式（写作现场浮层用）：省掉说明段落。 */
  dense?: boolean
}

interface SliderRowProps {
  id: string
  label: string
  hint: string
  min: number
  max: number
  step: number
  value: number
  display: string
  dense: boolean
  onChange: (next: number) => void
}

function SliderRow({ id, label, hint, min, max, step, value, display, dense, onChange }: SliderRowProps) {
  return (
    <div className="ui-test-interface-row">
      <div>
        <label htmlFor={id}>{label}</label>
        {dense ? null : <p>{hint}</p>}
      </div>
      <div className="ui-test-interface-size">
        {/*
          这里刻意**不给**类名：原设计的 ui-test-interface-value 在全仓 CSS 里
          并不存在（已 grep 确认），挂一个没有任何样式的孤立类名只会让人以为
          它被样式接管了。当前值这一行靠 .ui-test-interface-size 的
          flex 列布局与 gap 排版，形状与设置页其余滑块一致。
          data-ui-typography-value 是给测试用的取值钩子（按参数名定位），
          不参与样式。
        */}
        <span data-ui-typography-value={label}>{display}</span>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </div>
  )
}

/**
 * 正文字体与排版参数控件。
 *
 * 设置页（外观与界面）与写作现场浮层共用一个组件：两处各写一套 JSX
 * 是这类功能最常见的腐坏方式 —— 改了一处忘了另一处，用户就得到两套行为。
 * 取值来源不同（草稿 / store），但控件与语义完全相同。
 *
 * 它是**受控**的：值只从 `value` 来，改动只通过 `onChange` 出去，
 * 自己不持有任何持久化状态（唯一的内部状态是本机字体枚举结果，那是外部数据）。
 */
export function BodyTypographyFields({ value, onChange, idPrefix, dense = false }: Props) {
  const generatedId = useId()
  const id = idPrefix ?? generatedId
  const { fonts: rawSystemFonts, error: systemFontError } = useSystemFonts()

  // 按**正文**内置表去重（与界面字体那张表不是同一张，见 useSystemFonts 的说明）
  const bodySystemFonts = useMemo(
    () => newSystemFontsOnly(rawSystemFonts, BODY_FONT_OPTIONS.map((option) => option.cssFamily)),
    [rawSystemFonts],
  )

  const sizePreset = BODY_FONT_PX_PRESETS.find((preset) => preset.value === value.fontPx)
  // 兜底边距来自 font-settings 的单一来源（与 ui-test-editor.css 的
  // clamp(20px,4vw,48px) 由任务 12 的静态守卫绑在一起）。
  // marginX 为 null 时必须让滑块停在这个位置而不是 0 ——
  // 显示 0 会让用户以为边距被设成了 0，而正文其实还有 20–48px 的间距。
  const marginXShown = value.marginX ?? defaultBodyMarginXForViewport(
    typeof window === "undefined" ? 0 : window.innerWidth,
  )

  return (
    /*
     * 根节点用 interface-fields 而不是一个更"贴切"的新名字，是**必须的**：
     * 下面那些 ui-test-interface-row / ui-test-interface-size 的布局样式，
     * 在 CSS 里全部是 [data-ui="interface-fields"] 的后代选择器
     * （见 ui-test-tools.css —— row 的 grid、size 的 flex、以及 label/p/select/range 的样式）。
     * 用一个新名字会让这些类在设置页有效、在写作现场浮层里全部失效
     * （浮层挂在 preview-panel 的 Tailwind 容器下，没有那个祖先），
     * 而"两处入口共用同一套 UI"正是本任务存在的理由。
     * 所以：沿用这个 data-ui 值，两处都拿到同一套样式。改名之前先看这条注释。
     */
    <div data-ui="interface-fields">
      <div className="ui-test-interface-row">
        <div>
          <label htmlFor={`${id}-body-font`}>正文字体</label>
          {dense ? null : <p>只影响小说正文与书卷感衬线标题，与界面字体相互独立。</p>}
        </div>
        <select
          id={`${id}-body-font`}
          aria-label="正文字体"
          value={value.fontFamily}
          onChange={(event) => onChange("fontFamily", event.target.value as BodyFontFamily)}
        >
          <optgroup label="推荐">
            {BODY_FONT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </optgroup>
          {/*
            没有枚举结果时**不显示空分组** —— 一个空的 optgroup 会让用户
            以为自己机器上没装中文字体，而更常见的原因只是还没加载完。
          */}
          {bodySystemFonts.length > 0 && (
            <optgroup label="本机中文字体">
              {bodySystemFonts.map((font) => {
                const fontValue = systemFontValue(font.family)
                // sanitize 不通过的族名不进列表
                return fontValue ? <option key={fontValue} value={fontValue}>{font.display}</option> : null
              })}
            </optgroup>
          )}
        </select>
      </div>

      <div className="ui-test-interface-row">
        <div>
          <label htmlFor={`${id}-body-size-preset`}>正文字号</label>
          {dense ? null : <p>当前 {value.fontPx}px；绝对像素，不随界面字号变化。</p>}
        </div>
        <div className="ui-test-interface-size">
          <select
            id={`${id}-body-size-preset`}
            aria-label="正文字号预设"
            value={sizePreset ? String(sizePreset.value) : "custom"}
            onChange={(event) => onChange("fontPx", Number(event.target.value))}
          >
            {!sizePreset && <option value="custom" disabled>自定义 · {value.fontPx}px</option>}
            {BODY_FONT_PX_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label} · {preset.value}px</option>
            ))}
          </select>
          <input
            id={`${id}-body-size`}
            type="range"
            min={BODY_FONT_PX_MIN}
            max={BODY_FONT_PX_MAX}
            step={1}
            value={value.fontPx}
            aria-label="正文字号"
            onChange={(event) => onChange("fontPx", Number(event.target.value))}
          />
        </div>
      </div>

      <SliderRow
        id={`${id}-line-height`}
        label="行间距"
        hint="正文段落与列表的行距；标题与表格保持固定，避免被撑变形。"
        min={BODY_LINE_HEIGHT_MIN}
        max={BODY_LINE_HEIGHT_MAX}
        step={0.05}
        value={value.lineHeight}
        display={value.lineHeight.toFixed(2)}
        dense={dense}
        onChange={(next) => onChange("lineHeight", next)}
      />

      <SliderRow
        id={`${id}-letter-spacing`}
        label="字间距"
        hint="允许轻微负值：密排宋体收紧一点会更整齐。"
        min={BODY_LETTER_SPACING_MIN}
        max={BODY_LETTER_SPACING_MAX}
        step={0.5}
        value={value.letterSpacing}
        display={`${value.letterSpacing}px`}
        dense={dense}
        onChange={(next) => onChange("letterSpacing", next)}
      />

      <SliderRow
        id={`${id}-margin-x`}
        label="左右边距"
        /*
          陷阱：下面这句 hint 与按钮文案「改回跟随窗口」**都含「跟随窗口」四个字**。
          所以**不要**用 container 级的 `expect(container.textContent).not.toContain("跟随窗口")`
          去断言"这里显示的是像素值、不是跟随窗口" —— 那条断言在本组件里恒假，
          与实现是否正确无关（改按钮文案也救不了，hint 照样命中）。
          要断言显示值，请对准 [data-ui-typography-value="左右边距"] 那一个元素，
          像 body-typography-fields.spec.tsx 里那样。
        */
        hint="正文两侧留白；未调整时跟随窗口宽度，调整后固定。"
        min={BODY_MARGIN_X_MIN}
        max={BODY_MARGIN_X_MAX}
        step={2}
        value={marginXShown}
        display={value.marginX === null ? "跟随窗口" : `${value.marginX}px`}
        dense={dense}
        onChange={(next) => onChange("marginX", next)}
      />
      <div className="ui-test-interface-row">
        <div />
        <div className="ui-test-interface-size">
          <button
            type="button"
            aria-label="左右边距跟随窗口"
            disabled={value.marginX === null}
            onClick={() => onChange("marginX", null)}
          >
            {value.marginX === null ? "正在跟随窗口" : "改回跟随窗口"}
          </button>
        </div>
      </div>

      <SliderRow
        id={`${id}-safe-bottom`}
        label="底部安全距离"
        hint="滚到底时最后一行下方的留白；调大后当前行不再贴着窗口最下沿。"
        min={BODY_SAFE_BOTTOM_MIN}
        max={BODY_SAFE_BOTTOM_MAX}
        step={1}
        value={value.safeBottom}
        display={`${value.safeBottom}px`}
        dense={dense}
        onChange={(next) => onChange("safeBottom", next)}
      />

      {systemFontError && (
        <p role="status" className="ui-test-interface-description">
          未能读取本机字体（{systemFontError}），正文字体下拉只显示推荐的随包字体。
        </p>
      )}
    </div>
  )
}
