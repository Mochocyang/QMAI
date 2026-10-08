#!/usr/bin/env node
/**
 * 核对界面上的「第三方字体许可」告知与**事实**是否一致。
 *
 * ── 为什么需要这个脚本 ──
 * 随包的 9 款族里有一款不是 OFL：鸿蒙黑体。它的许可**强制**要求
 * "在软件中显著注明使用了 HarmonyOS Sans"。界面上那句告知一旦与随包清单脱节，
 * 后果是两选一，且都不会有任何测试失败来提醒：
 *   · 清单加了字体而告知没跟上 → **告知不完整**（许可不合规）；
 *   · 清单删了字体而告知还留着 → **告知与事实不符**（对用户误导）。
 * 文件级的东西（`fonts/licenses/*`）有 `verify-bundle-licenses.mjs` 管，
 * 但"界面上说了什么"没有任何东西管 —— 这就是本脚本要补的缺口。
 *
 * ── 四类断言 ──
 *   ① 族名集合必须与 `src-tauri/fonts/fonts-manifest.json` **完全一致**（双向）；
 *   ② 每个 `licenseFile` 必须真实存在；
 *   ③ 每个 `copyright` 必须真的出现在对应许可证文件里（归一化空白后比较，
 *      因为许可原文里的版权行常常折行，而数据里写的是一行）；
 *   ④ 声明的许可名称必须与文件内容自洽：
 *        声明 OFL-1.1  → 文件必须含 "SIL OPEN FONT LICENSE Version 1.1"
 *        声明非 OFL    → 文件**不得**自称 OFL（否则声明写错了）
 *
 * 退出码：0 = 一致；1 = 不一致（打印每一处差异与修法）。
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const DATA_PATH = join(root, "src/lib/bundled-font-licenses.json")
const MANIFEST_PATH = join(root, "src-tauri/fonts/fonts-manifest.json")
const LICENSES_DIR = join(root, "src-tauri/fonts/licenses")

const problems = []
const fail = (msg) => problems.push(msg)

/** 把空白（含换行与折行缩进）压成单个空格，便于"数据里一行 vs 原文折行"的比较。 */
const normalize = (s) => String(s).replace(/\s+/g, " ").trim()

// ── 读入 ──
for (const p of [DATA_PATH, MANIFEST_PATH]) {
  if (!existsSync(p)) {
    console.error(`✗ 找不到文件：${p}`)
    process.exit(1)
  }
}
const data = JSON.parse(readFileSync(DATA_PATH, "utf8"))
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))

const declared = data.fonts ?? []
const manifestFonts = manifest.fonts ?? []
if (declared.length === 0) fail("bundled-font-licenses.json 里没有任何字体条目")
if (manifestFonts.length === 0) fail("fonts-manifest.json 里没有任何字体条目")

// ── ① 族名集合双向一致 ──
const declaredFamilies = new Set(declared.map((f) => f.family))
const manifestFamilies = new Set(manifestFonts.map((f) => f.family))

for (const fam of manifestFamilies) {
  if (!declaredFamilies.has(fam)) {
    fail(
      `随包清单里有族「${fam}」，但界面告知里没有 —— 告知不完整。` +
        `请在 src/lib/bundled-font-licenses.json 补一条。`,
    )
  }
}
for (const fam of declaredFamilies) {
  if (!manifestFamilies.has(fam)) {
    fail(
      `界面告知里有族「${fam}」，但它已不在随包清单里 —— 告知与事实不符。` +
        `请从 src/lib/bundled-font-licenses.json 删除该条。`,
    )
  }
}
// 清单里同一族可能有多个字重（如思源宋体 Regular + Bold），
// 告知只需一款族一条，所以这里比的是**集合**而不是条数。
const multiWeight = manifestFonts.length - manifestFamilies.size
console.log(
  `  清单 ${manifestFonts.length} 个文件 / ${manifestFamilies.size} 个族` +
    (multiWeight > 0 ? `（${multiWeight} 个是同族的额外字重，告知按族合并）` : ""),
)

// ── 显著声明必须存在且点名 HarmonyOS Sans ──
const notice = normalize(data.prominentNotice ?? "")
if (!notice) {
  fail(
    "prominentNotice 为空 —— 鸿蒙黑体的许可**强制**要求在软件中显著注明使用了 " +
      "HarmonyOS Sans（HarmonyOS Sans Fonts License Agreement 第 2 条第 1 项）。",
  )
} else if (!/HarmonyOS Sans/i.test(notice)) {
  fail(`prominentNotice 没有点名 "HarmonyOS Sans"，不满足许可的注明要求：${JSON.stringify(notice)}`)
}

// ── ②③④ 逐条核对许可文件 ──
for (const entry of declared) {
  const label = `「${entry.display}」(${entry.family})`
  if (!entry.licenseFile) {
    fail(`${label} 缺 licenseFile 字段`)
    continue
  }
  const filePath = join(LICENSES_DIR, entry.licenseFile)
  if (!existsSync(filePath)) {
    fail(`${label} 声明的许可证文件不存在：${entry.licenseFile}`)
    continue
  }
  const text = readFileSync(filePath, "utf8")
  const flat = normalize(text)

  // ③ 版权行必须真的在原文里
  const cr = normalize(entry.copyright ?? "")
  if (!cr) {
    fail(`${label} 的 copyright 为空 —— 许可要求保留版权声明`)
  } else if (!flat.includes(cr)) {
    fail(
      `${label} 的版权行在 ${entry.licenseFile} 里找不到：\n` +
        `      声明: ${cr}\n` +
        `      含义: 界面告知里的版权行与许可原文不一致（版权行写错即为署名错误）`,
    )
  }

  /*
   * ④ 许可名称必须与文件内容自洽。
   *
   * 措辞在不同项目里不统一，实测两种：
   *   规范全大写  `SIL OPEN FONT LICENSE Version 1.1`
   *   标题式+逗号 `SIL Open Font License, Version 1.1`（更纱黑体就是这样）
   * 所以匹配要容大小写与 "LICENSE" 和版本号之间的标点，
   * 但不能松到「只要出现 OFL 字样就算」—— 那会让声明的许可名形同虚设。
   */
  const fileClaimsOfl = /SIL\s+OPEN\s+FONT\s+LICENSE[^A-Za-z0-9]{0,10}(?:Version\s+1\.1|v1\.1)/i.test(flat)
  const declaredOfl = /^OFL-1\.1$/i.test(String(entry.license).trim())
  if (declaredOfl && !fileClaimsOfl) {
    fail(`${label} 声明为 OFL-1.1，但 ${entry.licenseFile} 里没有 SIL OPEN FONT LICENSE Version 1.1`)
  }
  if (!declaredOfl && fileClaimsOfl) {
    fail(
      `${label} 声明为「${entry.license}」，但 ${entry.licenseFile} 自称 OFL-1.1 —— ` +
        `两者只能有一个对，请核对。`,
    )
  }
}

// ── 打印 ──
const bundled = declared.length
if (problems.length) {
  console.error("")
  console.error(`✗ 界面字体许可告知与事实不一致（${problems.length} 处）：`)
  for (const p of problems) console.error(`  · ${p}`)
  console.error("")
  console.error("  修法：改 src/lib/bundled-font-licenses.json，然后重跑本脚本。")
  process.exit(1)
}

const bytes = declared.length
console.log(`  ✓ 界面告知覆盖全部 ${manifestFamilies.size} 个随包字体族（${bundled} 条）`)
console.log(`  ✓ 每条版权行都能在对应许可证原文里找到`)
console.log(`  ✓ 许可名称与文件内容自洽（OFL-1.1 与非 OFL 未混淆）`)
console.log(`  ✓ 显著声明存在且点名 HarmonyOS Sans`)
console.log(`  许可证目录：${data.licensesDir}（随安装包提供原文）`)
