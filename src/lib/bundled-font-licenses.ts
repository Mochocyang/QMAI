import bundledFontLicenses from "./bundled-font-licenses.json"

/**
 * 随包字体的许可信息（界面「第三方字体许可」告知的数据源）。
 *
 * ── 为什么需要这个告知 ──
 * 随包字体的许可**不都是 OFL**：非 OFL 字体的许可通常带有
 * "在软件中显著注明使用了该字体"这类义务（本仓库曾经随包过这样一款字体，
 * 它的许可原文是 `YOU shall make a prominent notice in the software to state
 * that ... are used.`，关键词是 **in the software**）。
 * 也就是说"把许可证文件放进安装目录"**还不够** —— 那句话必须出现在软件界面上
 * 才满足该义务；同类的"保留版权声明与协议全文"则由随包提供的
 * `fonts/licenses/` 满足。专有许可往往还带"不可转让/可撤销"等产品层面的约束。
 *
 * ── 当前状态 ──
 * 随包字体**全部为 OFL-1.1**，所以 `prominentNotice` 是空字符串、
 * 界面上不渲染显著声明。这条机制保留着：日后一旦引入非 OFL 字体，
 * 只需把 `prominentNotice` 填上（并点名该字体），界面与校验脚本都会自动生效。
 *
 * ── 为什么数据放 JSON 而不是写在这里 ──
 * `scripts/check-bundled-font-licenses.mjs` 要拿它跟
 * `src-tauri/fonts/fonts-manifest.json` 和许可证原文逐条核对。
 * 校验脚本是 .mjs，直接读 JSON 比解析 TS 稳得多（不必正则切源码）。
 *
 * ── 为什么必须核对 ──
 * 清单里增删一款字体而这里忘了改，后果是**告知不完整或与事实不符**：
 * 前者是许可不合规，后者是对用户的误导。两者都不会有任何测试失败来提醒，
 * 所以由校验脚本与 spec 一起钉住（两侧都按"非 OFL 集合 ⟺ 声明非空且点名"
 * 这条通用规则判，不硬编码任何字体名）。
 */
export interface BundledFontLicense {
  /** 字体文件的族名（与 fonts-manifest.json 的 `family` 一致）。 */
  family: string
  /** 面向用户的中文名。 */
  display: string
  /** 许可名称。 */
  license: string
  /** `src-tauri/fonts/licenses/` 下的文件名。 */
  licenseFile: string
  /** 该字体的版权行（许可要求保留的那一行）。 */
  copyright: string
}

interface BundledFontLicensesFile {
  prominentNotice: string
  licensesDir: string
  fonts: BundledFontLicense[]
}

const data = bundledFontLicenses as BundledFontLicensesFile

/**
 * 显著声明（非 OFL 字体的许可义务）。
 *
 * 由许可要求出现在界面上，所以单独导出（而不是让调用方自己写一句）：
 * 让"这句话存在"这件事只有一个来源。值来自 `bundled-font-licenses.json`，
 * 校验脚本按通用规则断言它：**非 OFL 集合非空 ⇒ 这里必须非空且逐个点名**；
 * **非 OFL 集合为空 ⇒ 这里必须为空**（否则界面上会出现一句与事实不符的告知）。
 * 当前随包字体全部为 OFL-1.1，故它是空字符串，界面据此不渲染该声明。
 */
export const PROMINENT_FONT_NOTICE: string = data.prominentNotice

/** 随包字体的许可列表（按清单顺序）。 */
export const BUNDLED_FONT_LICENSES: readonly BundledFontLicense[] = data.fonts

/** 许可证文件在安装目录下的相对位置（用于界面上告诉用户去哪找原文）。 */
export const BUNDLED_FONT_LICENSES_DIR: string = data.licensesDir
