#!/usr/bin/env node
/**
 * 核对「被 git 跟踪的字体文件」是否都随附了许可原文。
 *
 * ── 为什么需要这个脚本 ──
 * `check-bundled-font-licenses.mjs` 只管 `src-tauri/fonts/` 那一处 —— 界面告知与随包清单
 * 是否一致。但**只要字体文件进了公开仓库，就是一次再分发**，OFL-1.1 要求
 * 「版权声明与本许可必须随字体副本一同提供」。仓库里还有别处放字体的地方
 * （例如 qmai-changelog 的 HTML 通过 @font-face 内嵌的三个字体文件），
 * 那些地方此前**没有任何检查**，于是出现「字体被跟踪、却没有许可文件」的静默不合规：
 * 不会编译失败、不会测试变红、界面上也看不出来。
 *
 * ── 判据来自字体自己，而不是一张手写表 ──
 * 逐个解析字体文件的 `name` 表，读出它**自己声明的许可**（name ID 13/14）。
 * 声明为 OFL 的，其所在目录树里必须能找到至少一份自称 OFL 的许可文件。
 * 这样新增字体不需要维护本脚本：字体自带声明就是判据，漏放许可会直接失败。
 *
 * ── 检查范围 ──
 * `git ls-files` 里的全部 `.ttf/.otf/.ttc/.woff/.woff2`。只跟踪文件才算分发；
 * `.gitignore` 掉的调研副本（`.font-research/`、`QDelete/` 等）不在范围内。
 *
 * 退出码：0 = 全部字体都有随附许可；1 = 有缺口（逐个打印缺哪一份、该放哪里）。
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const FONT_EXT = new Set([".ttf", ".otf", ".ttc", ".woff", ".woff2"])
const LICENSE_NAME_HINT = /licen|ofl|copying|notice/i

/** 解析 TTF/OTF 的 name 表，取出版权行与许可描述。非 sfnt（如 woff）返回 null。 */
function readEmbeddedLicense(file) {
  let b
  try {
    b = readFileSync(file)
  } catch {
    return null
  }
  if (b.length < 12 || b.toString("ascii", 0, 4) !== "\u0000\u0001\u0000\u0000") return null
  const numTables = b.readUInt16BE(4)
  let nameOff = -1
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (rec + 16 > b.length) break
    if (b.toString("ascii", rec, rec + 4) === "name") {
      nameOff = b.readUInt32BE(rec + 8)
      break
    }
  }
  if (nameOff < 0 || nameOff + 6 > b.length) return null
  const count = b.readUInt16BE(nameOff + 2)
  const strOff = nameOff + b.readUInt16BE(nameOff + 4)
  const out = {}
  for (let i = 0; i < count; i++) {
    const r = nameOff + 6 + i * 12
    if (r + 12 > b.length) break
    const platformID = b.readUInt16BE(r)
    const nameID = b.readUInt16BE(r + 6)
    const len = b.readUInt16BE(r + 8)
    const off = b.readUInt16BE(r + 10)
    if (nameID !== 0 && nameID !== 1 && nameID !== 13 && nameID !== 14) continue
    const raw = b.subarray(strOff + off, strOff + off + len)
    let text
    if (platformID === 3 || platformID === 0) {
      text = ""
      for (let k = 0; k + 1 < raw.length; k += 2) text += String.fromCharCode(raw.readUInt16BE(k))
    } else {
      text = raw.toString("latin1")
    }
    // 同 nameID 取最长的一条（中文/英文两套里信息更全的那个）
    if (!out[nameID] || text.length > out[nameID].length) out[nameID] = text
  }
  return out
}

function trackedFonts() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\u0000")
    .filter(Boolean)
    .filter((f) => FONT_EXT.has(extname(f).toLowerCase()))
  return out
}

/** 在字体所在目录、其 licenses 子目录、以及上级目录的 licenses 子目录里找许可文件。 */
function licenseFilesNear(fontAbs) {
  const dir = dirname(fontAbs)
  const searchDirs = [dir, join(dir, "licenses"), join(dir, "..", "licenses")]
  const found = []
  for (const d of searchDirs) {
    if (!existsSync(d)) continue
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isFile()) continue
      if (!LICENSE_NAME_HINT.test(e.name)) continue
      const p = join(d, e.name)
      if (statSync(p).size > 200_000) continue
      found.push(p)
    }
  }
  return [...new Set(found)]
}

const fonts = trackedFonts()
if (fonts.length === 0) {
  console.log("ⓘ 仓库里没有被 git 跟踪的字体文件，无需检查")
  process.exit(0)
}

console.log(`检查 ${fonts.length} 个被 git 跟踪的字体文件是否随附许可…\n`)
const problems = []
let checked = 0

for (const rel of fonts) {
  const abs = join(root, rel)
  const info = readEmbeddedLicense(abs)
  /*
   * 三种状态必须分开，「没声明许可」不等于「声明了非 OFL」。
   * Sarasa Gothic 的 name 表里没有 name ID 13/14（许可只以随附文件形式给出），
   * 若把"缺失"当成"非 OFL"，就会误报成"许可配错了字体" —— 本脚本第一版正是如此。
   */
  const declaredText = info ? `${info[13] ?? ""} ${info[14] ?? ""}`.trim() : ""
  const declaresOfl = declaredText === "" ? null : /open font license|\bofl\b/i.test(declaredText)
  const family = (info?.[1] ?? "").trim()
  const licenses = licenseFilesNear(abs)

  if (licenses.length === 0) {
    problems.push({ rel, reason: "目录树里找不到任何许可文件" })
    console.log(`  ★ ${rel}`)
    console.log(`      ${family ? `族名「${family}」；` : ""}没有任何随附许可文件`)
    continue
  }

  if (declaresOfl === true) {
    const oflFiles = licenses.filter((p) => /SIL Open Font License/i.test(readFileSync(p, "utf8")))
    if (oflFiles.length === 0) {
      problems.push({ rel, reason: "字体自称 OFL，但随附的许可文件都不是 OFL 原文" })
      console.log(`  ★ ${rel}`)
      console.log(`      字体内嵌声明为 OFL，但 ${licenses.length} 份随附许可里没有一份自称 OFL`)
      continue
    }
    checked++
    console.log(`  ✓ ${rel}`)
    console.log(`      ${family || "(无族名)"} · 自称 OFL-1.1 · 随附 OFL 许可 ${oflFiles.length} 份`)
    continue
  }

  if (declaresOfl === false) {
    // 非 OFL（例如华为那类专有许可）：字号许可文件必须存在，且**不能**自称 OFL
    const oflFiles = licenses.filter((p) => /SIL Open Font License/i.test(readFileSync(p, "utf8")))
    if (oflFiles.length === licenses.length) {
      problems.push({ rel, reason: "字体自称非 OFL，随附的却全是 OFL 原文（许可可能配错）" })
      console.log(`  ★ ${rel}`)
      console.log("      字体内嵌声明非 OFL，但随附许可全是 OFL 原文 —— 许可文件可能配错了字体")
      continue
    }
    checked++
    console.log(`  ✓ ${rel}  （非 OFL，随附许可 ${licenses.length} 份，含非 OFL 原文）`)
    continue
  }

  // 读不出内嵌声明（woff、或如 Sarasa Gothic 那样 name 表里没写许可）：只要求存在许可文件
  checked++
  console.log(
    `  ✓ ${rel}  （内嵌未声明许可${family ? `，族名「${family}」` : ""}，已确认随附许可 ${licenses.length} 份）`,
  )
}

console.log()
if (problems.length === 0) {
  console.log(`结果：${checked} 个字体全部随附了许可 ✓`)
  process.exit(0)
}
console.log(`结果：${problems.length} 个字体缺少合规的随附许可 ✗`)
for (const p of problems) console.log(`  · ${p.rel} —— ${p.reason}`)
console.log("\n修法：把该字体上游的许可原文（OFL.txt 等）放到字体同目录或 licenses/ 子目录，")
console.log("      文件名带上 licen/ofl 等字样，本脚本即可识别。")
process.exit(1)
