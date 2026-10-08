import bundledFontLicenses from "./bundled-font-licenses.json"

/**
 * 随包字体的许可信息（界面「第三方字体许可」告知的数据源）。
 *
 * ── 为什么需要这个告知 ──
 * 随包字体里有一款不是 OFL：鸿蒙黑体（HarmonyOS Sans SC）。它的许可
 * （HarmonyOS Sans Fonts License Agreement）第 2 条第 1 项是**强制**的：
 *
 *   `YOU shall make a prominent notice in the software to state that
 *    HarmonyOS Sans Fonts are used.`
 *
 * 也就是说"把许可证文件放进安装目录"**还不够** —— 这句话必须出现在软件界面上。
 * 同条第 4 项（保留版权声明与协议）由随包提供的 `fonts/licenses/` 满足。
 * 另外该许可不可转让、且**可被撤销**（`revocable`），产品层面需知悉。
 *
 * ── 为什么数据放 JSON 而不是写在这里 ──
 * `scripts/check-bundled-font-licenses.mjs` 要拿它跟
 * `src-tauri/fonts/fonts-manifest.json` 和许可证原文逐条核对。
 * 校验脚本是 .mjs，直接读 JSON 比解析 TS 稳得多（不必正则切源码）。
 *
 * ── 为什么必须核对 ──
 * 清单里增删一款字体而这里忘了改，后果是**告知不完整或与事实不符**：
 * 前者是许可不合规，后者是对用户的误导。两者都不会有任何测试失败来提醒，
 * 所以由校验脚本与 spec 一起钉住。
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
 * 鸿蒙黑体的显著声明。
 *
 * 由许可强制要求出现在界面上。单独导出（而不是让调用方自己写一句）是为了
 * 让"这句话存在"这件事只有一个来源 —— 校验脚本会断言它非空且点名 HarmonyOS Sans。
 */
export const HARMONYOS_PROMINENT_NOTICE: string = data.prominentNotice

/** 随包字体的许可列表（按清单顺序）。 */
export const BUNDLED_FONT_LICENSES: readonly BundledFontLicense[] = data.fonts

/** 许可证文件在安装目录下的相对位置（用于界面上告诉用户去哪找原文）。 */
export const BUNDLED_FONT_LICENSES_DIR: string = data.licensesDir
