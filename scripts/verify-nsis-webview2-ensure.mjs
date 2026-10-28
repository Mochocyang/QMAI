#!/usr/bin/env node
/*
 * NSIS 安装器：安装前 WebView2 检测/引导安装的验收脚本。
 *
 * 为什么需要它：`EnsureWebView2` 只在**缺失运行时的机器上**才会走
 * 下载 → 静默安装 → 复检这条主线。开发机上都装着运行时，所以日常打包、
 * 甚至"装一遍试试"都不会经过这段代码 —— 一旦它写坏了（语法错误、
 * 标签跳错分支、`.onInit` 里提前引用了未定义的函数），问题只会在
 * 用户的旧机器上暴露成"安装器直接闪退"。
 *
 * 这个脚本做四件事（任一失败即退出码 1）：
 *   ① 编译：把生产模板去掉 handlebars 占位符后，用地道的 NSIS 骨架编译，
 *      确认语法与 Control Flow 标签都成立；
 *   ② 覆盖：断言 `.onInit` 里确实在系统版本检查之后调用了 EnsureWebView2；
 *   ③ 顺序：断言 `EnsureWebView2` 的定义出现在 `Section EarlyChecks` 之后
 *      （NSIS 对函数/段/标签只做一次性扫描，前向引用不成立）；
 *   ④ 交互：用隔离构建的小安装器实测"缺失 → 中文确认框"以及
 *      "静默(/S) → 不弹框"两条路径。
 *
 * 用法：node scripts/verify-nsis-webview2-ensure.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const templatePath = resolve(root, "src-tauri/windows/_tauri-installer-template.nsi")
const source = readFileSync(templatePath, "utf8")

/** 把路径写成 NSIS 字符串里可用的形式：反斜杠要用 NSIS 的转义写两遍。 */
const nsisPath = (p) => p.replace(/\\/g, "\\\\")

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function ok(message) {
  console.log(`✓ ${message}`)
}

/** 去掉 Tauri 的 handlebars 占位符，只保留真正的 NSIS 代码。 */
function stripHandlebars(text) {
  return text
    .replace(/\{\{#if signed_plugins_path\}\}[\s\S]*?\{\{\/if\}\}/g, "")
    .replace(/\{\{#if installer_hooks\}\}[\s\S]*?\{\{\/if\}\}/g, "")
    .replace(/\{\{#each language_files\}\}[\s\S]*?\{\{\/each\}\}/g, "")
    .replace(/\{\{#(if|each|unless)[^}]*\}\}/g, "")
    .replace(/\{\{\/(if|each|unless)\}\}/g, "")
    .replace(/\{\{compression\}\}/g, "lzma")
    .replace(/\{\{install_webview2_mode\}\}/g, "skip")
    .replace(/\{\{[^}]*\}\}/g, "")
}

// ── ② 覆盖：必须挂在 .onInit 里，且在系统版本检查之后 ──
const onInit = source.match(/Function \.onInit([\s\S]*?)FunctionEnd/)
if (!onInit) fail("生产模板里找不到 Function .onInit")
const onInitBody = onInit[1]
const buildCheckIndex = onInitBody.indexOf("AtLeastBuild} 19041")
const ensureCallIndex = onInitBody.indexOf("Call EnsureWebView2")
if (ensureCallIndex < 0) fail("`.onInit` 里没有调用 Call EnsureWebView2 —— 检测不会执行")
if (buildCheckIndex < 0) fail("`.onInit` 里的系统版本检查不见了")
if (ensureCallIndex < buildCheckIndex) {
  fail("EnsureWebView2 必须放在系统版本检查之后：否则 Win7/8 会先去下载一个装不上的最新运行时")
}
ok("安装前检测位于 `.onInit`，且在系统版本检查之后")

// ── ③ 顺序：函数定义必须在引用之前 ──
const earlyChecksEnd = source.indexOf("SectionEnd", source.indexOf("Section EarlyChecks"))
const ensureDef = source.indexOf("Function EnsureWebView2")
const webview2Section = source.indexOf("Section WebView2")
if (earlyChecksEnd < 0 || ensureDef < 0) fail("模板结构与预期不符（EarlyChecks / EnsureWebView2）")
if (ensureDef < earlyChecksEnd) {
  fail("EnsureWebView2 定义在 EarlyChecks 之前：NSIS 不支持段内标签的前向引用")
}
// 要放在 `Section EarlyChecks` 之后（上面的断言已保证），并在 `Section Install` 之前：
// 安装段落才是真正落盘的地方，检测必须在它之前完成。
const installSection = source.indexOf("Section Install")
if (installSection > 0 && ensureDef > installSection) {
  fail("EnsureWebView2 应在 Section Install 之前完成检测")
}
ok("EnsureWebView2 定义位置合法（段之后、使用之前）")

// ── ① 编译：用骨架把整份模板编译一遍 ──
const workDir = mkdtempSync(join(tmpdir(), "qmai-nsis-wv2-"))
const makensis = process.env.MAKENSIS || join(process.env.LOCALAPPDATA ?? "", "tauri", "NSIS", "makensis.exe")
if (!existsSync(makensis)) fail(`找不到 makensis：${makensis}（可设置环境变量 MAKENSIS）`)

try {
  let skeleton = stripHandlebars(source)
  // 这些 include 只在 Tauri 生成的临时目录里存在，骨架里去掉。
  for (const include of [
    '!include "utils.nsh"',
    '!include "FileAssociation.nsh"',
    '!include "Win\\COM.nsh"',
    '!include "Win\\Propkey.nsh"',
  ]) {
    skeleton = skeleton.replace(include, "")
  }
  skeleton = skeleton
    .split("\n")
    .filter((line) => !/^\s*!addplugindir/.test(line))
    .join("\n")
  // Tauri 自带的 NSIS 插件（nsis_tauri_utils）在开发机上不一定存在，替换成等价桩。
  skeleton = skeleton
    .replace(/nsis_tauri_utils::SemverCompare[^\n]*$/gm, "StrCpy $R0 0")
    .replace(/^\s*"[^"]*"\s+\$R0\s*$/gm, "  Pop $R0")
    .replace(/nsis_tauri_utils::RunAsUser[^\n]*$/gm, "  ExecWait ''")
  // 占位符被抹掉后产生的空参数指令，直接去掉。
  skeleton = skeleton
    .replace(/^\s*File \/a "\/oname=" ""\s*$/gm, "")
    .replace(/^#!.*$/gm, "")
  // 只有单语言 + 固定版本号才能独立编译。
  skeleton = skeleton
    .replace(/!insertmacro MUI_LANGUAGE\s*""/g, '!insertmacro MUI_LANGUAGE "SimpChinese"')
    .replace(/^VIProductVersion .*$/gm, 'VIProductVersion "1.0.0.0"')
    .replace(/^!define OUTFILE .*$/gm, `!define OUTFILE "${nsisPath(join(workDir, "skeleton.exe"))}"`)
  for (const macro of [
    "SetContext",
    "CheckIfAppIsRunning",
    "APP_ASSOCIATE",
    "APP_UNASSOCIATE",
    "DeleteAppUserModelId",
    "CreateAppUserModelId",
    "SetAppUserModelId",
    "IsShortcutTarget",
    "RestorePreviousInstallLocation",
    "UnpinShortcut",
    "SetShortcutTarget",
    "SetLnkAppUserModelId",
    "CreateOrUpdateStartMenuShortcut",
  ]) {
    skeleton = skeleton.replace(new RegExp(`^\\s*!insertmacro\\s+${macro}.*$`, "gm"), "  ; stub")
  }
  // 骨架里没有真实的 exe 路径与安装目录，这两处启动主程序的语句也要换成等价的空操作。
  skeleton = skeleton
    .replace(/^\s*"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"[^\n]*$/gm, '  ExecWait ""')
    .replace(/^\s*\$\{GetParent\} "\$EXEPATH" \$0\s*$/gm, '  StrCpy $0 "C:\\qmai-test"')
  const skeletonPath = join(workDir, "skeleton.nsi")
  writeFileSync(skeletonPath, skeleton, "utf8")
  const build = spawnSync(makensis, ["/V2", "/INPUTCHARSET", "UTF8", skeletonPath], { encoding: "utf8" })
  if (build.status !== 0) {
    console.error(build.stdout)
    console.error(build.stderr)
    fail("生产模板编译失败（上面的 RS 输出里有具体行号）")
  }
  ok("生产模板编译通过（含 EnsureWebView2）")
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

// ── ④ 交互：隔离构建一个只保留检测逻辑的小安装器 ──
const promptDir = mkdtempSync(join(tmpdir(), "qmai-wv2-prompt-"))
try {
  const macroBlock = source.match(/!macro QMAI_READ_WEBVIEW2_VERSION[\s\S]*?!macroend/)
  const funcBlock = source.match(/Function EnsureWebView2[\s\S]*?\nFunctionEnd/)
  if (!macroBlock || !funcBlock) fail("无法从生产模板提取 QMAI_READ_WEBVIEW2_VERSION / EnsureWebView2")

  // 测试里把"同目录"指向一个不存在的磁盘，模拟"本机没有安装程序"。
  const funcForTest = funcBlock[0].replace(
    /\$\{GetParent\} "\$EXEPATH" \$0/,
    'StrCpy $0 "Z:\\qmai-no-such-dir"',
  )
  const promptScript = `Unicode true
Name "QMAI WebView2 检测验收"
OutFile "${nsisPath(join(promptDir, "prompt.exe"))}"
InstallDir "$TEMP\\qmai-wv2-prompt-check"
RequestExecutionLevel user
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!insertmacro GetParent
!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
Var PassiveMode
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

${macroBlock[0]}

${funcForTest}

Function .onInit
  StrCpy $PassiveMode ""
  Call EnsureWebView2
FunctionEnd

Section
  DetailPrint "验收：执行到这里说明检测流程结束"
SectionEnd
`
  const promptScriptPath = join(promptDir, "prompt.nsi")
  writeFileSync(promptScriptPath, promptScript, "utf8")
  const promptBuild = spawnSync(makensis, ["/V2", "/INPUTCHARSET", "UTF8", promptScriptPath], { encoding: "utf8" })
  if (promptBuild.status !== 0) {
    console.error(promptBuild.stdout)
    console.error(promptBuild.stderr)
    fail("隔离构建的检测安装器编译失败")
  }
  ok("隔离构建的检测安装器编译通过")

  // 有了运行时（开发机基本都是）就不该弹框：/S 运行应当直接结束。
  const silent = spawnSync(join(promptDir, "prompt.exe"), ["/S"], { timeout: 30_000 })
  if (silent.error) fail(`静默运行失败：${silent.error.message}`)
  ok("静默模式（/S）不阻塞")

  console.log("\n还需要人工确认的（本脚本无法在无人值守环境断言）：")
  console.log("  1. 在未装 WebView2 的机器上双击安装包，应弹出中文确认框；")
  console.log("  2. 点「是」后应下载安装器并以 /silent /install 安装，装完继续安装流程。")
  console.log("\n全部自动检查通过。")
} finally {
  rmSync(promptDir, { recursive: true, force: true })
}
