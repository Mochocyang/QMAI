// @vitest-environment node
/**
 * 随包字体的第三方许可**告知**必须与事实一致。
 *
 * ── 为什么这个 spec 必须存在（而不是只靠 scripts/check-bundled-font-licenses.mjs）──
 * 那个 .mjs 脚本做得更多（它读许可证原文并归一化比较），但它**要人手动跑**。
 * 本 spec 在测试套件里**自动**跑，所以"告知与随包清单脱节"这件事不会因为
 * 忘了跑脚本而漏过去。两者职责相同、触发时机不同，是互补而非重复。
 *
 * ── 漏掉会怎样 ──
 * 随包的 9 款族里有 1 款不是 OFL：鸿蒙黑体。它的许可**强制**要求
 * "在软件中显著注明使用了 HarmonyOS Sans"。所以：
 *   · 清单加了字体、告知没跟上 → **告知不完整**（许可不合规，且可被撤销）；
 *   · 清单删了字体、告知还留着 → **告知与事实不符**（对用户误导）。
 * 两种都不会有任何东西报错 —— 界面照样渲染，只是内容是错的。
 *
 * 本 spec 直接读 `src-tauri/fonts/` 的真实文件，所以它是拿"事实"当基准，
 * 而不是拿"另一份手抄的期望值"当基准（后者会跟着一起错）。
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  BUNDLED_FONT_LICENSES,
  BUNDLED_FONT_LICENSES_DIR,
  HARMONYOS_PROMINENT_NOTICE,
} from "@/lib/bundled-font-licenses"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const fontsDir = join(repoRoot, "src-tauri/fonts")
const licensesDir = join(fontsDir, "licenses")

const manifest = JSON.parse(readFileSync(join(fontsDir, "fonts-manifest.json"), "utf8")) as {
  fonts: { id: string; display: string; family: string; file: string; licenseFile: string }[]
}

/** 与校验脚本一致：把空白（含换行与折行缩进）压成单个空格再比较。 */
const normalize = (s: string) => s.replace(/\s+/g, " ").trim()

describe("随包字体许可告知：与随包清单一致", () => {
  it("族名集合与 fonts-manifest.json 完全一致（双向，防多也防少）", () => {
    const declared = new Set(BUNDLED_FONT_LICENSES.map((f) => f.family))
    const actual = new Set(manifest.fonts.map((f) => f.family))

    // 少一条 = 告知不完整（许可不合规）
    const missing = [...actual].filter((f) => !declared.has(f))
    expect(missing, `随包清单里有但告知里缺的族：${missing.join(", ")}`).toEqual([])

    // 多一条 = 告知与事实不符（误导用户）
    const extra = [...declared].filter((f) => !actual.has(f))
    expect(extra, `告知里有但已不在随包清单里的族：${extra.join(", ")}`).toEqual([])

    // 反向自检：这条断言不能是"两边都是空集"式的假绿
    expect(actual.size).toBeGreaterThanOrEqual(9)
    expect(declared.size).toBe(actual.size)
  })

  it("告知按族合并，不随字重条数膨胀（思源宋体/黑体各 2 个字重）", () => {
    // 清单 11 个文件 / 9 个族：告知只需 9 条，否则同族会重复列出同一份许可
    expect(manifest.fonts.length).toBeGreaterThan(BUNDLED_FONT_LICENSES.length)
    const families = BUNDLED_FONT_LICENSES.map((f) => f.family)
    expect(new Set(families).size, "告知里出现了重复族名").toBe(families.length)
  })

  it("每条都有非空的显示名、许可名、许可证文件名、版权行", () => {
    for (const f of BUNDLED_FONT_LICENSES) {
      expect(f.display.trim(), `${f.family} 的 display 为空`).not.toBe("")
      expect(f.license.trim(), `${f.family} 的 license 为空`).not.toBe("")
      expect(f.licenseFile.trim(), `${f.family} 的 licenseFile 为空`).not.toBe("")
      expect(f.copyright.trim(), `${f.family} 的 copyright 为空`).not.toBe("")
    }
  })
})

describe("随包字体许可告知：与许可证原文一致", () => {
  it("每个 licenseFile 都真实存在", () => {
    for (const f of BUNDLED_FONT_LICENSES) {
      const p = join(licensesDir, f.licenseFile)
      expect(existsSync(p), `许可证文件不存在：${f.licenseFile}`).toBe(true)
    }
  })

  it("每条版权行都能在对应许可证原文里逐字找到", () => {
    /*
     * 版权行写错 = 署名错误，而署名是许可的核心义务之一。
     * 用"归一化空白后再包含"来比较：许可原文里的版权行常常折行，
     * 而数据里写的是一行；直接比较会因为换行位置不同而假失败。
     */
    for (const f of BUNDLED_FONT_LICENSES) {
      const text = normalize(readFileSync(join(licensesDir, f.licenseFile), "utf8"))
      expect(
        text.includes(normalize(f.copyright)),
        `${f.family} 的版权行在 ${f.licenseFile} 里找不到：\n  声明: ${f.copyright}`,
      ).toBe(true)
    }
  })

  it("声明 OFL-1.1 的，许可证原文必须自称 OFL-1.1；声明非 OFL 的不得自称 OFL", () => {
    /*
     * 两个方向都要查：
     *  · 声明 OFL 而原文不是 → 告知里的许可名是错的；
     *  · 声明非 OFL 而原文自称 OFL → 要么许可名写错，要么把 OFL 文件配错了字体。
     * 措辞实测有两种（"SIL OPEN FONT LICENSE Version 1.1" 与
     * "SIL Open Font License, Version 1.1"），所以大小写与标点都要放宽。
     */
    const oflV11 = /SIL\s+OPEN\s+FONT\s+LICENSE[^A-Za-z0-9]{0,10}(?:Version\s+1\.1|v1\.1)/i

    for (const f of BUNDLED_FONT_LICENSES) {
      const text = normalize(readFileSync(join(licensesDir, f.licenseFile), "utf8"))
      const claimsOfl = oflV11.test(text)
      const declaredOfl = /^OFL-1\.1$/i.test(f.license.trim())
      expect(
        declaredOfl,
        `${f.family} 声明「${f.license}」但 ${f.licenseFile} 自称 OFL=${claimsOfl}，两者不一致`,
      ).toBe(claimsOfl)
    }
  })

  it("恰好有一款不是 OFL，且它必须是被点名的那款（防止悄悄换成别的专有字体）", () => {
    const nonOfl = BUNDLED_FONT_LICENSES.filter((f) => !/^OFL-1\.1$/i.test(f.license.trim()))
    expect(nonOfl.map((f) => f.family)).toEqual(["HarmonyOS Sans SC"])
  })
})

describe("鸿蒙黑体的显著声明（许可强制义务）", () => {
  it("声明非空且点名 HarmonyOS Sans", () => {
    /*
     * HarmonyOS Sans Fonts License Agreement 第 2 条第 1 项原文：
     *   `YOU shall make a prominent notice in the software to state that
     *    HarmonyOS Sans Fonts are used.`
     * "in the software" 是关键：只把许可证文本放到安装目录**不满足**这一条。
     */
    expect(HARMONYOS_PROMINENT_NOTICE.trim()).not.toBe("")
    expect(HARMONYOS_PROMINENT_NOTICE).toMatch(/HarmonyOS Sans/i)
  })

  it("指出许可证原文所在目录，且该目录名与随包资源一致", () => {
    expect(BUNDLED_FONT_LICENSES_DIR).toBe("fonts/licenses")
  })
})
