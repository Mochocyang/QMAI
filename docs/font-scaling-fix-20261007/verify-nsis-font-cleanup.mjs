#!/usr/bin/env node
/**
 * 编译验证 NSIS 卸载器里「清理随包字体」那一段的语法。
 *
 * ── 为什么需要这个脚本 ──
 * 卸载器是**装完就再也不会被测试**的那类代码：正常路径只走一次，
 * 而且只在用户卸载时走。它的错误还有一个恶劣性质 ——
 * NSIS 编译**错误**会被 Tauri 的打包步骤发现，但**逻辑**错误
 * （标签跳错、`${TrimNewlines}` 这种不存在的宏、寄存器被覆盖）
 * 只会在用户机器上表现为"字体没清掉"，而没人会为这个发 bug 报告。
 *
 * 这个脚本做两件事：
 *   ① 从**真实模板**里抽出那段代码（不是抄一份），保证测的就是要打包的东西；
 *   ② 用真正的 makensis 把它编译一遍，于是任何语法/宏名/标签错误都会当场失败。
 *
 * ── 为什么不是"编译整个 installer.nsi" ──
 * 那需要先跑一次完整的 `tauri build`（几分钟到几十分钟），于是这个检查实际上
 * 永远不会被跑。这里用一个最小骨架 + 模板原文片段，几百毫秒就能给出结论。
 * 代价是它**不**验证与模板其余部分的交互（寄存器冲突等）——
 * 那由"真的构建一次安装包"覆盖，见 README 里的说明。
 *
 * 退出码：0 = 编译通过；1 = 失败（并打印 makensis 的原始输出）。
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const templatePath = resolve(root, "src-tauri/windows/_tauri-installer-template.nsi")

/** 模板里那段代码的起止标记（起：注释标题行；止：最后那个标签）。 */
const START_MARKER = "; ── 清理随包字体（阶段 4）──"
const END_MARKER = "qmai_fonts_done:"

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!existsSync(templatePath)) fail(`找不到模板：${templatePath}`)
const template = readFileSync(templatePath, "utf8")

// ── ① 从真实模板里抽出那段代码 ──
const startIdx = template.indexOf(START_MARKER)
if (startIdx < 0) fail(`模板里找不到起始标记 ${START_MARKER} —— 那段代码被删了或改了注释？`)
const endIdx = template.indexOf(END_MARKER, startIdx)
if (endIdx < 0) fail(`模板里找不到结束标记 ${END_MARKER}`)
const block = template.slice(startIdx, endIdx + END_MARKER.length)

/*
 * 抽出来的片段必须**看起来像**那段代码，否则后面"编译通过"就是假绿：
 * 若标记之间的内容其实是空的（例如被重构成宏调用），
 * 这里编译一个空块也会成功，而这个脚本会宣称"卸载清理语法正确"。
 */
const REQUIRED_TOKENS = [
  "FileOpen",
  "FileRead",
  "DeleteRegValue",
  "Delete /REBOOTOK",
  "${StrTrimNewLines}",
  "qmai_fonts_loop:",
  "qmai_fonts_close:",
  "qmai_fonts_done:",
]
for (const token of REQUIRED_TOKENS) {
  if (!block.includes(token)) fail(`抽出的片段里缺少必需内容：${token}`)
}
// 行数下限：一个能真正干活的清理块不可能只有几行
const blockLines = block.split(/\r?\n/).length
if (blockLines < 25) fail(`抽出的片段只有 ${blockLines} 行，太短，不像完整的清理块`)

// ── ② 找出 makensis ──
const candidates = [
  process.env.MAKENSIS,
  resolve(process.env.LOCALAPPDATA ?? "", "tauri/NSIS/makensis.exe"),
  "C:/Program Files (x86)/NSIS/makensis.exe",
  "C:/Program Files/NSIS/makensis.exe",
  "makensis",
].filter(Boolean)
const makensis = candidates.find((c) => c === "makensis" || existsSync(c))
if (!makensis) {
  fail(
    "找不到 makensis。Tauri 打包时会自动下载到 %LOCALAPPDATA%\\tauri\\NSIS；" +
      "请先跑一次 `npm run tauri build`，或用 MAKENSIS 环境变量指定路径。" +
      "（**不**降级为「跳过」：静默跳过会让这个检查永远假绿）",
  )
}

// ── ③ 组装最小骨架 ──
const nsisDir = makensis === "makensis" ? undefined : dirname(makensis)
const scaffold = `Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "StrFunc.nsh"
\${StrCase}
\${StrLoc}
\${StrTrimNewLines}

Name "qmai-font-cleanup-syntax-check"
OutFile "syntax-check.exe"
InstallDir "$TEMP\\qmai-syntax-check"
!define BUNDLEID "com.qingmuai.writer"
!define PRODUCTNAME "QMAI"
!define MAINBINARYNAME "qmai"

Var UpdateMode
Var PassiveMode
; 注意：$R0–$R9 与 $0–$9 是 NSIS 内置寄存器，**不能** Var 声明
; （声明会报 "variable already declared"）。清理段用的正是 $R0–$R4。

Section
  StrCpy $UpdateMode 0
${block}
SectionEnd
`

const work = mkdtempSync(join(tmpdir(), "qmai-nsi-check-"))
const scriptPath = join(work, "check.nsi")
// makensis 需要 UTF-8 **带 BOM** 才能正确读中文（与 Tauri 生成 installer.nsi 的做法一致）
writeFileSync(scriptPath, "\uFEFF" + scaffold, "utf8")

// ── ④ 编译 ──
try {
  const out = execFileSync(makensis, ["/V2", scriptPath], {
    cwd: nsisDir ?? work,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  console.log("✓ NSIS 卸载字体清理段编译通过")
  console.log(`  模板片段：${blockLines} 行`)
  console.log(`  makensis：${makensis}`)
  const tail = out.trim().split(/\r?\n/).slice(-4).filter(Boolean)
  for (const line of tail) console.log(`  ${line}`)
} catch (e) {
  console.error("✗ NSIS 编译失败 —— 卸载时的字体清理不会生效")
  console.error(`  makensis：${makensis}`)
  console.error(`  脚本：${scriptPath}`)
  console.error(String(e?.stdout ?? "").trim())
  console.error(String(e?.stderr ?? "").trim())
  process.exit(1)
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {}
}
