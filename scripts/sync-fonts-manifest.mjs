#!/usr/bin/env node
/**
 * 从 `docs/font-scaling-fix-20261007/bundled-fonts.json`（来源与哈希的**唯一真相**）
 * 生成运行期清单 `src-tauri/fonts/fonts-manifest.json`（Rust 侧读取的那一份）。
 *
 * ── 为什么要有两份、且由脚本生成 ──
 * 两份的**用途**不同，不该合并：
 *   · `bundled-fonts.json`：给人和发布门禁用。含 sourceRepo/sourceTag/sourceUrl，
 *     回答"这个字节是从哪来的、许可是什么"。它是**证据**。
 *   · `fonts-manifest.json`：给运行期用。只需 id/file/sizeBytes/sha256/family，
 *     会被打进安装包，每个字节都算体积；而且它**不含 URL**——把一个下载地址
 *     塞进安装包没有意义，还会随上游变化而失真。
 * 手工维护两份必然漂移，所以运行期那份一律由这份脚本生成，
 * 并由 `--check` 模式在门禁里核对"生成结果与磁盘现状一致"。
 *
 * 用法：
 *   node scripts/sync-fonts-manifest.mjs           # 写入运行期清单
 *   node scripts/sync-fonts-manifest.mjs --check   # 只校验，不一致则退出 1
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourcePath = resolve(root, "docs/font-scaling-fix-20261007/bundled-fonts.json")
const fontsDir = resolve(root, "src-tauri/fonts")
const outPath = resolve(fontsDir, "fonts-manifest.json")
const checkOnly = process.argv.includes("--check")

function die(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!existsSync(sourcePath)) die(`找不到来源清单：${sourcePath}`)
const source = JSON.parse(readFileSync(sourcePath, "utf8"))
if (!Array.isArray(source.fonts) || source.fonts.length === 0) {
  die("来源清单里没有 fonts 数组或为空")
}

const REQUIRED = ["id", "display", "family", "file", "sizeBytes", "sha256", "licenseFile"]

/*
 * 曾纳入、后经实测排除的字体（`excludedAfterProbe`）。
 *
 * 保留它们的来源与哈希是为了**留痕**：日后有人问"芫荽为什么没随包"，
 * 答案（许可是好的，但它过不了中文判据）与它是从哪一版取的，都在这里。
 *
 * 但绝不能出现在磁盘上：资源目录是整目录递归打包的，文件在就会被装进
 * 安装包（哪怕不在清单里、永远不会被安装），白占用户的下载体积。
 */
const excluded = Array.isArray(source.excludedAfterProbe) ? source.excludedAfterProbe : []
for (const font of excluded) {
  for (const key of ["id", "file", "excludedReason"]) {
    if (!font[key]) die(`excludedAfterProbe 里的条目缺少 ${key}`)
  }
  const stray = resolve(fontsDir, font.file)
  if (existsSync(stray)) {
    die(
      `${font.id} 已被排除（${font.excludedReason.slice(0, 40)}…），` +
        `但文件仍在 fonts/ 里：${stray}\n` +
        `  资源目录是整目录打包的 —— 留着它会让安装包白白多出 ` +
        `${(font.sizeBytes / 1024 / 1024).toFixed(2)} MiB。请删除该文件（与其许可证）。`,
    )
  }
  const strayLicense = font.licenseFile ? resolve(fontsDir, font.licenseFile) : null
  if (strayLicense && existsSync(strayLicense)) {
    die(`${font.id} 已被排除，但许可证文件仍在：${strayLicense}。请一并删除。`)
  }
}

const entries = []
for (const font of source.fonts) {
  for (const key of REQUIRED) {
    if (font[key] === undefined || font[key] === null || font[key] === "") {
      die(`${font.id ?? "(无 id)"} 缺少必需字段 ${key}`)
    }
  }
  const filePath = resolve(fontsDir, font.file)
  if (!existsSync(filePath)) die(`${font.id}：字体文件不存在 ${filePath}`)

  /*
   * 每次生成都**重新算哈希与大小**，而不是照抄来源清单。
   * 理由：来源清单是证据文件、可能过期；运行期清单必须反映磁盘上真实的字节。
   * 若照抄，一个被替换过（或截断）的字体文件会带着旧哈希被打进安装包，
   * 而没有任何环节会发现。
   */
  const bytes = readFileSync(filePath)
  const actualSha = createHash("sha256").update(bytes).digest("hex")
  const actualSize = statSync(filePath).size
  if (actualSize !== font.sizeBytes) {
    die(`${font.id}：大小不符 —— 来源清单 ${font.sizeBytes}，磁盘 ${actualSize}`)
  }
  if (actualSha !== font.sha256.toLowerCase()) {
    die(
      `${font.id}：SHA-256 不符 —— 来源清单 ${font.sha256.slice(0, 16)}…，` +
        `磁盘 ${actualSha.slice(0, 16)}…。字体文件被改动过，必须重新核对许可证。`,
    )
  }
  // 许可证文件也必须真的在（否则打包后会缺许可证，是 OFL 的合规问题）
  const licensePath = resolve(fontsDir, font.licenseFile)
  if (!existsSync(licensePath)) die(`${font.id}：许可证文件不存在 ${licensePath}`)

  entries.push({
    id: font.id,
    display: font.display,
    family: font.family,
    file: font.file,
    sizeBytes: actualSize,
    sha256: actualSha,
    licenseFile: font.licenseFile,
  })
}

/*
 * 孤儿检查：`src-tauri/fonts/` 里不允许有清单未列出的字体文件。
 * 它们会被一起打进安装包（资源是整目录递归的），却不会被安装、不会被计费、
 * 也可能许可证不明 —— 典型的"看得见但没人管"的风险。
 */
const listed = new Set(entries.map((e) => e.file))
const onDisk = readdirSync(fontsDir, { withFileTypes: true })
  .filter((d) => d.isFile() && /\.(ttf|otf|ttc)$/i.test(d.name))
  .map((d) => d.name)
const orphans = onDisk.filter((name) => !listed.has(name))
if (orphans.length > 0) {
  die(`fonts/ 里有清单未列出的字体文件（会被打进包但不会安装）：${orphans.join(", ")}`)
}
const missing = [...listed].filter((name) => !onDisk.includes(name))
if (missing.length > 0) die(`清单列出但磁盘上没有：${missing.join(", ")}`)

const payload = {
  manifestVersion: source.manifestVersion ?? 1,
  note:
    "本文件由 scripts/sync-fonts-manifest.mjs 从 docs/font-scaling-fix-20261007/bundled-fonts.json 生成，" +
    "请勿手工编辑。它被打进安装包，供应用启动时把随包字体安装到本用户。",
  fonts: entries,
}
// 末尾换行便于 diff；UTF-8 无 BOM（Rust 侧按 UTF-8 读）
const text = JSON.stringify(payload, null, 2) + "\n"

if (checkOnly) {
  if (!existsSync(outPath)) die(`运行期清单不存在，请先运行不带 --check 的版本：${outPath}`)
  /*
   * 比较前必须把行尾归一化。
   *
   * 本仓库 `core.autocrlf=true`，且没有 .gitattributes 覆盖：
   * 索引里存的是 LF，而**全新克隆**出来的工作区文件是 CRLF。
   * 若按原始字节比较，这份脚本在克隆出来的机器上会永远报"不一致"，
   * 而文件内容其实完全正确 —— 那种假失败最终会让人干脆不用这个检查。
   * 比的是**内容**，不是行尾风格。
   */
  const normalize = (s) => s.replace(/\r\n/g, "\n")
  const current = normalize(readFileSync(outPath, "utf8"))
  if (current !== normalize(text)) {
    die("运行期清单与来源清单/磁盘现状不一致，请重新生成（去掉 --check）")
  }
  console.log(`✓ 运行期清单与磁盘一致（${entries.length} 款）`)
} else {
  writeFileSync(outPath, text, "utf8")
  const total = entries.reduce((sum, e) => sum + e.sizeBytes, 0)
  console.log(`✓ 已写入 ${outPath}`)
  console.log(`  ${entries.length} 款，合计 ${total} 字节（${(total / 1024 / 1024).toFixed(2)} MiB）`)
}
