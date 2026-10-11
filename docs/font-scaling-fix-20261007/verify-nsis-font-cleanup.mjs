#!/usr/bin/env node
/**
 * 验证 NSIS 卸载器里「清理随包字体」那一段：**先编译，再真跑一遍**。
 *
 * ── 为什么需要这个脚本 ──
 * 卸载器是**装完就再也不会被测试**的那类代码：正常路径只走一次，
 * 而且只在用户卸载时走。它的错误还有一个恶劣性质 ——
 * NSIS 编译**错误**会被 Tauri 的打包步骤发现，但**逻辑**错误
 * （标签跳错、`${TrimNewlines}` 这种不存在的宏、寄存器被覆盖）
 * 只会在用户机器上表现为"字体没清掉"，而没人会为这个发 bug 报告。
 *
 * ── 两个阶段 ──
 *
 * ① **编译**：从**真实模板**里抽出那段代码（不是抄一份），用真正的 makensis
 *    编一遍，于是任何语法/宏名/标签错误都会当场失败。
 *
 *    ⚠️ 骨架必须是 `Section Uninstall`，**不能**是普通 `Section`。
 *    这条是本轮血泪教训：清理段在真实模板里位于卸载区，而 NSIS 禁止在卸载区
 *    `Call` 不以 `un.` 开头的函数。早先的骨架用的是普通 `Section`，
 *    于是 `${StrTrimNewLines}`（非 Un 变体）在这里"编译通过"，
 *    真实的安装包却因它**完全打不出来**（`Call must be used with function
 *    names starting with "un."`）。骨架不复现生产上下文，编译检查就是假绿。
 *
 * ② **执行**（`--e2e`，需要先构建过 Rust）：把同一段代码放进一个**一次性注册表键**
 *    与临时目录里真跑一遍，然后用 `reg query` / 文件系统核对结果。
 *
 *    只编译是不够的：编译通过完全不能证明 `FileRead` 读得对、
 *    `${StrTrimNewLines}` 剥得对、`DeleteRegValue` 删得掉。而这三件事任何一件
 *    错了，用户卸载后都会在字体库里留下垃圾 —— 且**没有任何报错**
 *    （NSIS 的 `Delete` 对不存在的路径静默成功）。
 *
 *    记录文件由 **Rust 的生产代码**写出（`write_uninstall_record`，
 *    经诊断测试 `诊断_写出卸载记录供NSIS端到端验证` 触发），
 *    绝不在本脚本里"照着格式再写一遍" —— 那样测的是"我以为的格式"。
 *
 * 用法：
 *   node docs/font-scaling-fix-20261007/verify-nsis-font-cleanup.mjs
 *   node docs/font-scaling-fix-20261007/verify-nsis-font-cleanup.mjs --e2e
 *
 * 退出码：0 = 通过；1 = 失败（并打印原始输出）。
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const templatePath = resolve(root, "src-tauri/windows/_tauri-installer-template.nsi")

/** 模板里那段代码的起止标记（起：注释标题行；止：最后那个标签）。 */
const START_MARKER = "; ── 清理随包字体（阶段 4）──"
const END_MARKER = "qmai_fonts_done:"

/** 安装段的切片标记（与上面的清理段对称）。 */
const INSTALL_START_MARKER = "; ── 随包字体：按用户安装（阶段 4）──"
const INSTALL_END_MARKER = "qmai_fonts_install_done:"

/**
 * 从模板里抠出一个 `!macro ... !macroend` 的完整定义。
 *
 * 抠不到时**必须**抛错：返回空串会让"宏里没问题"这类断言在空文本上通过，
 * 而那正是本项目反复强调的假绿。
 */
function extractMacro(src, name) {
  const start = src.indexOf(`!macro ${name} `)
  if (start < 0) throw new Error(`模板里找不到宏 !macro ${name} —— 宏名变了，验收脚本已失效`)
  const end = src.indexOf("!macroend", start)
  if (end < 0) throw new Error(`模板里的宏 ${name} 没有 !macroend 收尾`)
  return src.slice(start, end + "!macroend".length)
}

/**
 * 真实的字体键。**任何**验收步骤都不得写入它。
 *
 * ── 为什么这里要专门盯着它 ──
 * 写这个脚本时我自己踩过一次：临时脚手架里 `QMAIFONTKEY` 沿用了生产默认值，
 * 于是 11 个指向 %TEMP% 的悬空值被写进了**真实**字体键，把用户已装好的 11 个
 * 字体注册全部指向了不存在的文件。它不报错、不留日志，只会让字体"莫名消失"。
 * 所以下面用 before/after 快照把它钉死：一旦有步骤碰了真键，脚本立刻变红。
 */
const REAL_FONT_KEY = "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"

/**
 * 读出一个注册表键下的全部「值名 → 数据」，**与代码页无关**。
 *
 * ── 为什么不用 `reg query` 解析文本 ──
 * `reg query` 把 REG_SZ 按**控制台代码页**输出。本机是 936（GBK），所以
 * `用户李四` 会变成 GBK 字节；Node 若按 latin1/UTF-8 解码就是一个看起来
 * 完全错误、但其实**写入是对的**的字符串。这个坑在阶段三第一次跑时就命中了：
 * 断言报"注册表值指向错的文件"，实际是读取端解码错。
 * 拿它做相等比较会得到**假失败**，而拿它做"存在性"比较更糟 —— 会假绿。
 *
 * `reg export` 写出的是 **UTF-16LE** 的 .reg 文件（实测前两字节 `ff fe`），
 * 里面是原生 Unicode，与代码页无关。.reg 里反斜杠会被转义成 `\\`，所以要还原。
 */
function readRegValues(key) {
  const tmp = join(mkdtempSync(join(tmpdir(), "qmai-reg-")), "k.reg")
  const map = new Map()
  try {
    execFileSync("reg.exe", ["export", key, tmp, "/y"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch {
    return map // 键不存在：合法的"没有值"
  }
  const buf = readFileSync(tmp)
  const text =
    buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString("utf16le") : buf.toString("latin1")
  for (const line of text.split(/\r?\n/)) {
    // 形如 "Source Han Sans SC (TrueType)"="C:\\...\\x.otf"
    const m = /^"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"\s*$/.exec(line.trim())
    if (!m) continue
    const unescape = (s) => s.replace(/\\(.)/g, "$1")
    map.set(unescape(m[1]), unescape(m[2]))
  }
  rmSync(dirname(tmp), { recursive: true, force: true })
  return map
}

/** 读取真实字体键下全部「值名 → 数据」；读不到时返回空 Map（键不存在是合法的）。 */
function snapshotRealFontKey() {
  return readRegValues(REAL_FONT_KEY)
}

/** 比较两份真键快照；返回人类可读的差异列表（空数组 = 完全一致）。 */
function diffRealFontKey(before, after) {
  const diffs = []
  for (const [k, v] of before) {
    if (!after.has(k)) diffs.push(`被删除：「${k}」`)
    else if (after.get(k) !== v) diffs.push(`被改写：「${k}」\n      原: ${v}\n      现: ${after.get(k)}`)
  }
  for (const [k, v] of after) {
    if (!before.has(k)) diffs.push(`被新增：「${k}」→ ${v}`)
  }
  return diffs
}

const realFontKeyBefore = snapshotRealFontKey()

/*
 * 预先清掉一次性测试键里可能残留的值。
 *
 * ── 为什么需要这一步 ──
 * 上一个版本的脚本在断言失败时直接 `process.exit(1)`，跳过了 finally，
 * 于是测试键（含前一次跑写入的值）留在了机器上；下一次跑的前置检查就会报
 * "测试键已有值"，把一个**真实断言失败**伪装成"环境脏"，掩盖真正的问题。
 * 这里在动手之前先把两个一次性键清干净，让前置检查只反映本次运行的状态。
 *
 * ⚠️ 只清这两个一次性键。真实字体键（REAL_FONT_KEY）**绝不允许**被写或被删，
 * 它的完整性由末尾的安全网逐值比对保证。
 */
for (const k of ["HKCU\\Software\\QMAI-NSIS-Font-Cleanup-E2E", "HKCU\\Software\\QMAI-NSIS-Font-Install-E2E"]) {
  try {
    execFileSync("reg.exe", ["delete", k, "/f"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  } catch {
    /* 键本来就不存在：正常 */
  }
}

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

// ── ①·b 同样抽出「安装」那一段与它的字体表宏 ──
const installStartIdx = template.indexOf(INSTALL_START_MARKER)
if (installStartIdx < 0) fail(`模板里找不到起始标记 ${INSTALL_START_MARKER}`)
const installEndIdx = template.indexOf(INSTALL_END_MARKER, installStartIdx)
if (installEndIdx < 0) fail(`模板里找不到结束标记 ${INSTALL_END_MARKER}`)
const installBlock = template.slice(installStartIdx, installEndIdx + INSTALL_END_MARKER.length)
if (!installBlock.includes("QMAI_FONT_TABLE")) {
  fail(`抽出来的安装段里没有 QMAI_FONT_TABLE —— 安装时不会装字体（切片失效或代码被改）`)
}
if (!installBlock.includes("FileOpen") || !installBlock.includes("QMAI_FONT_TABLE \"install\"")) {
  fail("抽出来的安装段不像安装代码（缺少 FileOpen 或 install 分支），编译它只会得到假绿")
}
// 字体表宏：安装与卸载**共用**这两个宏，所以只需要抠一次
const fontMacros =
  extractMacro(template, "QMAI_FONT_ENTRY") + "\n\n" + extractMacro(template, "QMAI_FONT_TABLE")

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
  // 必须是 Un 变体：清理段在 Section Uninstall 里，非 Un 变体会让 makensis 失败
  "${UnStrTrimNewLines}",
  "qmai_fonts_loop:",
  "qmai_fonts_close:",
  "qmai_fonts_done:",
  /*
   * 删文件前必须用 `$QMAIFONTDIR` 把**目录**补上。
   *
   * 记录文件第 2 行现在只是**纯文件名**（因为 NSIS 按 ANSI 解码 UTF-8 记录，
   * 非 ASCII 路径会读成乱码），所以少了这一步就会去删当前目录下的同名文件 ——
   * `Delete` 对不存在的路径静默成功，表现为"字体清不掉"且毫无报错。
   * 阶段二会在含中文的目录上再验一遍实际行为，这里只是让片段一眼看得出没漏。
   */
  'StrCpy $R3 "${QMAIFONTDIR}\\$R3"',
]
for (const token of REQUIRED_TOKENS) {
  if (!block.includes(token)) fail(`抽出的片段里缺少必需内容：${token}`)
}
/*
 * ── 值名必须原样使用，不得在这里再拼后缀 ──
 *
 * 记录文件第 1 行已经是**完整值名**（含 `(TrueType)` 与字重，如
 * `Source Han Serif SC Bold (TrueType)`）。NSIS 只需原样 `DeleteRegValue`。
 * 早期版本这里写 `StrCpy $R4 "$R2 (TrueType)"`，把拼名规则分散到了两处；
 * 加入字重后值名变成 `"<族名> Bold (TrueType)"`，两处规则必然有一天对不上，
 * 而 `DeleteRegValue` 对**不存在**的值是静默成功的 —— 卸载后会在
 * HKCU 里留下指向已删文件的悬空值，且没有任何报错。
 *
 * 因此这里反过来断言：那段代码**不得**再出现拼接后缀的写法。
 */
if (/\$R2\s*\(TrueType\)/.test(block)) {
  fail(
    "清理块里仍在拼接「 (TrueType)」后缀 —— 记录文件里已经是完整值名，" +
      "再拼一次会去删一个不存在的键（DeleteRegValue 对不存在的值静默成功），" +
      "卸载后会留下悬空注册表值。请直接删 $R2。",
  )
}
/*
 * ── 反向断言：不得使用 StrFunc 的非 `Un` 变体 ──
 *
 * `Section Uninstall` 里 `Call` 不以 `un.` 开头的函数会被 NSIS 拒绝：
 *   `Call must be used with function names starting with "un." in the uninstall section.`
 * 一旦用错，makensis 直接失败 —— 不是"清理不生效"，而是**整个安装包打不出来**。
 * 这个缺陷真实存在过（由 67153fb 引入），且因为骨架用的是普通 `Section` 而被藏住。
 *
 * 注意 `${StrTrimNewLines}` 是 `${UnStrTrimNewLines}` 的**子串**，
 * 所以必须带上 `${` 前缀来区分，不能用 includes。
 */
if (/\$\{Str(TrimNewLines|Case|Loc)\}/.test(block)) {
  fail(
    "清理块里用了 StrFunc 的非 `Un` 变体（如 ${StrTrimNewLines}）。" +
      "该块位于 `Section Uninstall`，NSIS 只允许 `Call un.*`；" +
      "用非 Un 变体会让 makensis 编译失败、整个安装包打不出来。" +
      "请改用 ${UnStrTrimNewLines} 这类 Un 变体。",
  )
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

/**
 * NSIS 里写路径用**反斜杠**。
 *
 * ── 这里曾经改成正斜杠，结果整段清理变成了空操作 ──
 * 起因是想"省掉转义"，就把路径统一换成正斜杠。后果是实测出来的：
 * `IfFileExists "$R0"` 对 `C:/…/RecordDir\installed-fonts.txt` 这种混用写法
 * **返回不存在**，于是代码直接跳到 `qmai_fonts_done`，
 * 一个文件也没删、一个注册表值也没注销 —— 而且编译、运行都"成功"。
 *
 * 注意：**插值进来的值不需要转义**。模板字面量里的 `\\` 只影响写在源码里的
 * 字面文本，`${变量}` 是按原样插入的。所以这里直接把 Windows 路径放进去即可。
 */
const nsiPath = (p) => p

/**
 * 拼出一个可编译、可执行的 NSIS 脚本。
 *
 * ── 为什么要覆盖 QMAIFONTKEY / QMAIFONTRECORDDIR ──
 * 这两个 define 在生产模板里分别指向真实的字体注册表键与 `$APPDATA\<bundle id>`。
 * 覆盖成一次性键与临时目录后，整段清理代码可以被**真跑一遍**而不碰用户环境。
 * 生产默认值由下面的静态断言钉住。
 */
function buildScaffold({ outExe, fontKey, fontDir, recordDir, uninstallerPath }) {
  return `Unicode true
; 自动化：不要 UI，也不要提权（提权会弹 UAC 把脚本挂死）
SilentInstall silent
; 卸载器也要静默，否则阶段二会卡在确认对话框上
SilentUnInstall silent
RequestExecutionLevel user
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "StrFunc.nsh"
\${StrCase}
\${StrLoc}
; 与生产模板一致：清理段在卸载区，用的是 Un 变体
\${UnStrTrimNewLines}

Name "qmai-font-cleanup-check"
; 绝对路径：OutFile 相对的是 **makensis 进程的 cwd**（下面为了找头文件把它设成了
; NSIS 安装目录），写成相对路径会把 check.exe 落到 NSIS 工具链目录里去。
OutFile "${nsiPath(outExe)}"
InstallDir "$TEMP\\qmai-font-check"
!define BUNDLEID "com.qingmuai.writer"
!define PRODUCTNAME "QMAI"
!define MAINBINARYNAME "qmai"
!define QMAIFONTKEY "${fontKey}"
!define QMAIFONTDIR "${nsiPath(fontDir)}"
!define QMAIFONTRECORDDIR "${nsiPath(recordDir)}"

Var UpdateMode
Var PassiveMode
; 注意：$R0–$R9 与 $0–$9 是 NSIS 内置寄存器，**不能** Var 声明
; （声明会报 "variable already declared"）。清理段用的正是 $R0–$R4。

; ── 字体表宏 ──
; 清理段在"记录文件不存在"时会走兜底表（!insertmacro QMAI_FONT_TABLE "uninstall"），
; 所以这个骨架也必须带上宏定义，否则 makensis 报 "macro named ... not found"。
; 宏从**真实模板**里原样抠出来（见 extractMacro），不是这里另写一份。
${fontMacros}

; ── 必须是 Section Uninstall，不能是普通 Section ──
; 这是本轮实测出来的关键点：同一段代码在**普通 Section** 里编译完全合法，
; 所以"抽出来编译一遍"曾给出假绿 —— 真实的模板里它在 Section Uninstall，
; 而 NSIS 禁止在卸载区 Call 不以 un. 开头的函数。
; 于是 \${StrTrimNewLines}（非 Un 变体）在普通 Section 里编得过、
; 在真实安装包里直接让 makensis 失败，**整个安装包都打不出来**。
; 骨架必须复现生产上下文，否则这类错误永远测不到。
; 另需一个普通 Section：只有 Section Uninstall 时 makensis 会报
; "invalid script: no sections specified"。
Section "placeholder"
${uninstallerPath ? `  ; 让阶段二能真正调到 Section Uninstall：清理段只在**卸载器**里执行，\n  ; 直接运行安装器 exe 是不会跑到的（这也是先前"编译通过"却从未真跑过的原因之一）。\n  WriteUninstaller "${nsiPath(uninstallerPath)}"` : ""}
SectionEnd

Section Uninstall
  StrCpy $UpdateMode 0
${block}
SectionEnd
`
}

/**
 * 同步等待若干毫秒。
 *
 * 放在模块作用域是因为阶段二与阶段三都要用；写成阶段二里的块级 `const` 时，
 * 阶段三会报 `sleep is not defined` —— 那个报错出现在阶段三**跑完之后**，
 * 所以前面的断言都已经通过了，很容易被误读成"安装逻辑有问题"。
 */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * 字重 → 注册表值名后缀。必须与 Rust 侧 `font_install::weight_style_suffix` 一致。
 *
 * 用 `Map` 而不是对象字面量：`400 → null` 表示"没有后缀"，而 `obj[400] ?? fallback`
 * 会把 `null` 当成"没这个键"从而退化成 `W400` —— 那种错误会让**所有** Regular
 * 的值名都带上后缀，与真实字体注册完全脱节，却只在值名比较时才会暴露。
 */
const WEIGHT_SUFFIX = new Map([
  [100, "Thin"],
  [200, "ExtraLight"],
  [300, "Light"],
  [350, "SemiLight"],
  [400, null],
  [500, "Medium"],
  [600, "SemiBold"],
  [700, "Bold"],
  [800, "ExtraBold"],
  [900, "Black"],
])

/** 复刻 Rust 的 `registry_value_name`。 */
function regValueName(family, weight) {
  const suffix = WEIGHT_SUFFIX.has(weight) ? WEIGHT_SUFFIX.get(weight) : `W${weight}`
  return suffix ? `${family} ${suffix} (TrueType)` : `${family} (TrueType)`
}

/**
 * 随包清单 —— 本阶段的**独立基准**。
 *
 * ── 为什么基准必须是清单，而不是模板里那张表 ──
 * 最初的写法是从模板的宏里正则抠出 `(文件, 值名)` 列表，再照它造源文件、照它断言。
 * 那样模板**既是被测对象又是自己的预期值**，于是下面两个变异全都测不出来（假绿）：
 *   · 表里漏掉一款字体  → 基准跟着少一条，"全都装上了"依然成立；
 *   · 文件名拼错        → 源文件就按错名字造，`CopyFiles` 照样成功。
 * 变异测试直接抓出了这两处。现在基准换成 `fonts-manifest.json`（独立事实来源），
 * 模板与它一旦不一致，无论哪边错都会红。
 */
const manifestPath = resolve(root, "src-tauri/fonts/fonts-manifest.json")
if (!existsSync(manifestPath)) fail(`找不到随包清单：${manifestPath}`)
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (!Array.isArray(manifest.fonts) || manifest.fonts.length < 8) {
  fail(`清单里只有 ${manifest.fonts?.length ?? 0} 款字体 —— 太少，本阶段失去意义`)
}
/** 期望值：清单里的每一款（文件名 + 由 family/weight 推导的值名）。 */
const expectedEntries = manifest.fonts
  .map((f) => ({ file: f.file, valueName: regValueName(f.family, f.weight) }))
  .sort((a, b) => a.file.localeCompare(b.file))

/**
 * 拼出「安装字体」用的骨架：把模板里 `QMAI_FONT_TABLE` 那两个宏**原样**抠出来用。
 *
 * ── 为什么必须抠真宏，而不是在脚本里另写一份等价逻辑 ──
 * 另写一份只能证明"脚本作者认为该怎么写"，证明不了模板里那份是对的。字体表
 * 与值名规则一旦在模板里写错（少个空格、漏掉 Bold 后缀），文件会照拷、注册表
 * 值也会写，但系统字体表里就是没有它 —— 界面上只表现为"这个字体选不到"。
 * 所以这里跑的就是 makensis 将要编译的那段源码。
 */
function buildInstallScaffold({ outExe, fontKey, fontDir, recordDir, installDir, installBlock }) {
  return `Unicode true
SilentInstall silent
RequestExecutionLevel user
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "StrFunc.nsh"
\${StrCase}
\${StrLoc}
\${UnStrTrimNewLines}

Name "qmai-font-install-check"
OutFile "${nsiPath(outExe)}"
InstallDir "${nsiPath(installDir)}"
!define BUNDLEID "com.qingmuai.writer"
!define PRODUCTNAME "QMAI"
!define MAINBINARYNAME "qmai"
!define QMAIFONTKEY "${fontKey}"
!define QMAIFONTDIR "${nsiPath(fontDir)}"
!define QMAIFONTRECORDDIR "${nsiPath(recordDir)}"

Var UpdateMode
Var PassiveMode

${fontMacros}

Section "install"
  ; 复现模板里的上下文：更新模式为 0，即正常安装
  StrCpy $UpdateMode 0
${installBlock}
SectionEnd
`
}

/** 用 makensis 编译一个脚本；失败时把原始输出交给调用方。 */
function compileNsi(scriptPath, workDir) {
  return execFileSync(makensis, ["/V2", scriptPath], {
    cwd: nsisDir ?? workDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

// ── ④ 编译（阶段一：语法） ──
const work = mkdtempSync(join(tmpdir(), "qmai-nsi-check-"))
const syntaxWork = join(work, "syntax")
mkdirSync(syntaxWork, { recursive: true })
const scriptPath = join(syntaxWork, "check.nsi")
// makensis 需要 UTF-8 **带 BOM** 才能正确读中文（与 Tauri 生成 installer.nsi 的做法一致）
writeFileSync(
  scriptPath,
  "\uFEFF" +
    buildScaffold({
      outExe: join(syntaxWork, "check.exe"),
      fontKey: "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
      fontDir: join(syntaxWork, "Fonts"),
      recordDir: join(syntaxWork, "record"),
    }),
  "utf8",
)

try {
  const out = compileNsi(scriptPath, syntaxWork)
  console.log("✓ 阶段一：NSIS 卸载字体清理段编译通过")
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
  try { rmSync(work, { recursive: true, force: true }) } catch {}
  process.exit(1)
}

// ── ⑤ 静态断言：生产模板的默认值必须与 Rust 侧一致（跨语言契约） ──
/*
 * 这三个值是 NSIS 与 Rust 之间的契约。任何一处改了而另一处没改，
 * 表现都是"字体装不上"或"卸载后清不掉" —— 而且只在用户机器上出现。
 * 与其等到那时，不如在这里直接比字符串。
 */
{
  const templateText = template
  const bindings = [
    {
      name: "QMAIFONTKEY",
      expected: "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
      // Rust: src-tauri/src/font_install.rs 的 FONT_KEY
      rustSource: resolve(root, "src-tauri/src/font_install.rs"),
      rustPattern: /FONT_KEY:\s*&str\s*=\s*r"([^"]+)"/,
      why: "NSIS 与 Rust 必须写/删同一个注册表键",
    },
    {
      /*
       * 字体安装目录。清理段现在**自己拼**这个目录（记录里只存纯文件名），
       * 所以它一旦与 Rust 的 `user_font_dir()` 漂移，卸载就会去删一个
       * 根本不存在的目录 —— 而 `Delete` 对不存在的路径静默成功，
       * 表现为"字体清不掉"且毫无报错。
       */
      name: "QMAIFONTDIR",
      expected: "$LOCALAPPDATA\\Microsoft\\Windows\\Fonts",
      why: "必须与 Rust 的 user_font_dir() 指向同一个目录",
    },
    {
      name: "QMAIFONTRECORDDIR",
      expected: "$APPDATA\\${BUNDLEID}",
      rustSource: resolve(root, "src-tauri/src/font_install.rs"),
      rustPattern: /UNINSTALL_RECORD_FILE:\s*&str\s*=\s*"([^"]+)"/,
      // 这条只在下面单独检查文件名部分，见 checkRecordFileName
      why: "NSIS 读的记录文件必须就是 Rust 写的那一个",
    },
  ]
  const problems = []
  for (const b of bindings) {
    const m = new RegExp(`!define\\s+${b.name}\\s+"([^"]*)"`).exec(templateText)
    if (!m) {
      problems.push(`模板里找不到 !define ${b.name}（${b.why}）`)
      continue
    }
    if (m[1] !== b.expected) {
      problems.push(`!define ${b.name} 是 "${m[1]}"，期望 "${b.expected}"（${b.why}）`)
    }
  }
  // 记录文件名：Rust 的常量必须就是 NSIS 读的那个文件名
  const rustText = readFileSync(resolve(root, "src-tauri/src/font_install.rs"), "utf8")
  const recName = /UNINSTALL_RECORD_FILE:\s*&str\s*=\s*"([^"]+)"/.exec(rustText)
  if (!recName) problems.push("Rust 里找不到 UNINSTALL_RECORD_FILE 常量")
  else if (!templateText.includes(`${recName[1]}"`)) {
    problems.push(`NSIS 读的文件名与 Rust 常量 ${recName[1]} 不一致`)
  }
  // 注册表键：Rust 的 FONT_KEY 必须与模板 define 相同
  const rustKey = /FONT_KEY:\s*&str\s*=\s*r"([^"]+)"/.exec(rustText)
  if (!rustKey) problems.push("Rust 里找不到 FONT_KEY 常量")
  else if (rustKey[1] !== "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts") {
    problems.push(`Rust 的 FONT_KEY 是 ${JSON.stringify(rustKey[1])}，与预期不符`)
  }
  /*
   * 字体目录：Rust 的 user_font_dir() 必须真的拼出
   * `%LOCALAPPDATA%\Microsoft\Windows\Fonts`。清理段现在自己拼目录
   * （记录里只存文件名），两边漂移就会静默删不掉。
   */
  const rustFontDir = /"LOCALAPPDATA"[\s\S]{0,400}?join\("Microsoft"\)\s*\.join\("Windows"\)\s*\.join\("Fonts"\)/.exec(rustText)
  if (!rustFontDir) {
    problems.push(
      "Rust 的 user_font_dir() 不再拼 %LOCALAPPDATA%\\Microsoft\\Windows\\Fonts，" +
        "与 NSIS 的 QMAIFONTDIR 漂移（卸载会静默删不掉字体）",
    )
  }
  if (problems.length) {
    console.error("✗ 静态契约检查失败（NSIS ↔ Rust 不一致）：")
    for (const p of problems) console.error(`  · ${p}`)
    try { rmSync(work, { recursive: true, force: true }) } catch {}
    process.exit(1)
  }
  console.log("✓ 阶段一·补：NSIS ↔ Rust 的键名/文件名契约一致")
}

// ── ⑥ 阶段二：把清理段**真跑一遍**（需 --e2e） ──
/*
 * 编译通过只证明语法对。真正会出问题的是运行时行为：
 *   · `FileRead` 是否把 UTF-8（**无 BOM**）的记录读对，中文路径是否还原正确；
 *   · `${StrTrimNewLines}` 是否真把行尾 CRLF 剥掉（没剥掉的话值名会带 \r，
 *     `DeleteRegValue` 就会去删一个**不存在**的值，并静默"成功"）；
 *   · `DeleteRegValue` 用的值名是否就是记录里的那一整串。
 * 这三件事任何一件错了，用户卸载后都会留下垃圾，而且**没有任何报错**。
 */
if (!process.argv.includes("--e2e")) {
  console.log("")
  console.log("ⓘ 未加 --e2e，只做了编译检查。")
  console.log("  运行时行为检查需要先构建过 Rust：")
  console.log("    node docs/font-scaling-fix-20261007/verify-nsis-font-cleanup.mjs --e2e")
  try { rmSync(work, { recursive: true, force: true }) } catch {}
  process.exit(0)
}

const e2eWork = join(work, "e2e")
/*
 * ── 这个中文目录名是整个测试的重点，别"顺手改成英文" ──
 *
 * 真实清单里的族名与文件名全是 ASCII（有测试钉住），所以记录文件里唯一
 * 可能带非 ASCII 的就是路径前缀 `%LOCALAPPDATA%` —— 中文 Windows 用户名会
 * 让它变成 `C:\Users\张三\AppData\Local`。
 *
 * NSIS 的 `FileRead` 是按**系统 ANSI 代码页**解码的（实测：UTF-8 无 BOM 与
 * ANSI 字节相同才正确、UTF-8 BOM 会多出一个 U+FEFF、UTF-16LE 直接读断），
 * 而 Rust 写的是 UTF-8。所以路径里一旦出现非 ASCII，卸载器就会拿到乱码路径，
 * `Delete` 静默"成功"、字体永久残留 —— 且不会有任何报错。
 *
 * 把字体目录建成中文名，才能让这个测试在"记录里存绝对路径"的实现上**失败**。
 */
const e2eFonts = join(e2eWork, "用户张三", "AppData", "Local", "Microsoft", "Windows", "Fonts")
const e2eRecordDir = join(e2eWork, "RecordDir")
mkdirSync(e2eFonts, { recursive: true })
mkdirSync(e2eRecordDir, { recursive: true })

// 一次性注册表键：绝不碰真实的字体键
const TEST_KEY = "HKCU\\Software\\QMAI-NSIS-Font-Cleanup-E2E"
/** 留在同一个键里、**不在**记录中的值 —— 用来证明清理段不会误删无关项。 */
const CANARY_NAME = "QMAI Canary (TrueType)"
const CANARY_DATA = "C:\\definitely\\not\\in\\the\\record\\canary.ttf"

const reg = (args) =>
  execFileSync("reg.exe", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })

/**
 * 判断某个值是否存在 —— 用 `reg query /v <名>` 的**退出码**，不解析输出文本。
 *
 * ── 为什么不能用文本匹配 ──
 * `reg.exe` 按**控制台代码页**输出。本机是 936（GBK），而 Node 默认按 UTF-8
 * 解码 → 中文值名变成乱码 → 匹配失败，于是"值不存在"这种**假失败**会出现在
 * 一个完全正确的实现上。反过来更危险：如果拿它去判断"值已被删除"，
 * 乱码会让它永远报"不存在"，假绿。
 *
 * 退出码没有这个问题：值名通过 argv 传进去（Windows 内部是 UTF-16），
 * 与代码页无关；实测存在 = 0、不存在 = 1，含空格与正则元字符的名字同样准确。
 */
const valueExists = (key, name) => {
  try {
    execFileSync("reg.exe", ["query", key, "/v", name], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return true
  } catch (e) {
    // 1 = 找不到该项/值；其它退出码是真错误，必须抛出来而不是当成"不存在"
    if (e?.status === 1) return false
    throw new Error(`reg query ${key} /v ${name} 失败（退出码 ${e?.status}）`)
  }
}

let e2eFailed = false
const failE2e = (msg) => {
  console.error(`  ✗ ${msg}`)
  e2eFailed = true
}

try {
  console.log("")
  console.log("  ══ 阶段二：真跑一遍清理段 ══")

  // 1) 让 Rust 的生产代码写出记录（含中文值名与中文文件名）
  const env = {
    ...process.env,
    QMAI_FONT_E2E_DIR: e2eRecordDir,
    QMAI_FONT_E2E_FONTS_DIR: e2eFonts,
  }
  execFileSync(
    "cargo",
    ["test", "--offline", "--lib", "诊断_写出卸载记录供NSIS端到端验证", "--", "--ignored", "--nocapture"],
    { cwd: resolve(root, "src-tauri"), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
  const expected = JSON.parse(readFileSync(join(e2eRecordDir, "expected.json"), "utf8")).expected
  const recordPath = join(e2eRecordDir, "installed-fonts.txt")
  if (!existsSync(recordPath)) throw new Error(`Rust 没有写出记录文件：${recordPath}`)
  if (expected.length < 2) throw new Error(`记录里只有 ${expected.length} 条，至少要 2 条才检验得动`)
  console.log(`  记录文件由 Rust 生产代码写出：${recordPath}`)
  console.log(`  条目 ${expected.length} 个`)

  /*
   * 记录本身必须是**纯 ASCII**。
   * 这是修复的核心：NSIS 按 ANSI 解码，只有内容全 ASCII 时 UTF-8 与 ANSI 字节才相同。
   * 一旦这里出现非 ASCII（例如有人把绝对路径又写回记录），中文用户名的机器上
   * 卸载清理就会静默失效 —— 所以在这里直接把不变量钉死。
   */
  const recordBytes = readFileSync(recordPath)
  const recordText = recordBytes.toString("utf8")
  const nonAscii = [...recordText].filter(
    (c) => c.charCodeAt(0) > 0x7e || (c.charCodeAt(0) < 0x20 && !"\r\n".includes(c)),
  )
  if (nonAscii.length) {
    failE2e(
      `记录文件含非 ASCII 字符 ${JSON.stringify(nonAscii.slice(0, 8).join(""))} —— ` +
        "NSIS 会按 ANSI 解码而读错（中文用户名下卸载清理会静默失效）",
    )
  } else {
    console.log("  ✓ 记录文件是纯 ASCII（NSIS 的 ANSI 解码不再有歧义）")
  }

  // 2) 建测试注册表键：每个记录条目一个值 + 一个 canary
  try { reg(["delete", TEST_KEY, "/f"]) } catch {}
  for (const e of expected) {
    reg(["add", TEST_KEY, "/v", e.valueName, "/t", "REG_SZ", "/d", e.dest, "/f"])
  }
  reg(["add", TEST_KEY, "/v", CANARY_NAME, "/t", "REG_SZ", "/d", CANARY_DATA, "/f"])

  // 3) 前置条件断言：文件与值都真的存在
  //    不先断言"存在"，后面的"已被删除"在什么都没建起来时也会通过（假绿）
  for (const e of expected) {
    if (!existsSync(e.dest)) throw new Error(`假字体文件没建出来：${e.dest}`)
    if (!valueExists(TEST_KEY, e.valueName)) throw new Error(`测试注册表值没建出来：${e.valueName}`)
  }
  if (!valueExists(TEST_KEY, CANARY_NAME)) throw new Error("canary 值没建出来")
  console.log(`  前置条件已确认：${expected.length} 个文件 + ${expected.length + 1} 个注册表值都在`)

  // 4) 编译，并**真正执行卸载器**里的清理段
  const e2eScaffold = join(e2eWork, "e2e.nsi")
  const e2eExe = join(e2eWork, "e2e.exe")
  const e2eUninst = join(e2eWork, "e2e-uninst.exe")
  writeFileSync(
    e2eScaffold,
    "\uFEFF" +
      buildScaffold({
        outExe: e2eExe,
        fontKey: TEST_KEY.replace(/^HKCU\\/i, ""),
        // 指向**含中文的目录**：这是本测试的核心（复现"中文用户名"）
        fontDir: e2eFonts,
        recordDir: e2eRecordDir,
        uninstallerPath: e2eUninst,
      }),
    "utf8",
  )
  compileNsi(e2eScaffold, e2eWork)
  if (!existsSync(e2eExe)) throw new Error(`makensis 没有产出 ${e2eExe}`)

  // sleep 已提升到模块作用域：阶段二与阶段三都要用（块级 const 出不了 try 块）

  /**
   * 跑一次卸载器。
   *
   * ── 为什么要走卸载器，而不是直接跑安装器 exe ──
   * 清理段位于 `Section Uninstall`，**只有卸载器**会执行它；直接跑安装器
   * 只会跑普通 Section。"编译通过"曾长期掩盖这一点：片段在普通 Section 里
   * 编译合法，于是看起来一切正常。
   *
   * 先跑安装器让它 `WriteUninstaller` 落盘，再跑卸载器（`/S` 静默）。
   * 卸载器会把自己复制到 %TEMP% 再重启，因此**不能在返回后立刻断言** ——
   * 下面用轮询等待实际状态，而不是盲目 sleep 一个魔法值。
   */
  const runUninstaller = () => {
    try {
      execFileSync(e2eExe, [], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    } catch (e) {
      console.log(`  ⓘ 安装器返回非 0（${e?.status ?? "?"}），继续`)
    }
    if (!existsSync(e2eUninst)) throw new Error(`安装器没有写出卸载器：${e2eUninst}`)
    try {
      execFileSync(e2eUninst, ["/S"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    } catch (e) {
      // NSIS 的 Section 即使出错也常返回 0；判定一律交给下面的实际状态
      console.log(`  ⓘ 卸载器返回非 0（${e?.status ?? "?"}），继续按实际状态判定`)
    }
  }

  /** 等到所有目标文件与注册表值都消失（或超时）。返回是否在时限内达成。 */
  const waitForCleanup = (timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const filesGone = expected.every((e) => !existsSync(e.dest))
      const valuesGone = expected.every((e) => !valueExists(TEST_KEY, e.valueName))
      if (filesGone && valuesGone) return true
      if (Date.now() > deadline) return false
      sleep(200)
    }
  }

  runUninstaller()
  const cleaned = waitForCleanup()
  console.log(cleaned ? "  已执行卸载器，清理段生效" : "  已执行卸载器，但等待超时")

  // 5) 核对：文件没了、值没了、canary 还在
  for (const e of expected) {
    if (existsSync(e.dest)) failE2e(`文件没被删掉：${e.dest}`)
  }
  for (const e of expected) {
    if (valueExists(TEST_KEY, e.valueName)) {
      failE2e(`注册表值没被删掉：「${e.valueName}」`)
    }
  }
  if (!valueExists(TEST_KEY, CANARY_NAME)) {
    failE2e(`canary 值被误删了 —— 清理段删了记录之外的东西（键：${TEST_KEY}）`)
  }
  if (!e2eFailed) {
    console.log(`  ✓ ${expected.length} 个文件已删除（路径含中文，模拟中文用户名）`)
    console.log(`  ✓ ${expected.length} 个注册表值已删除（值名含空格与 (TrueType) 后缀）`)
    console.log("  ✓ 记录之外的 canary 值未被误删")
  }

  /*
   * 6) 幂等与两个"记录状态"分支。
   *
   * 卸载器可能被连跑两次（用户重复点卸载、卸载后重装再卸载），而记录文件
   * 只有两种状态，两个分支都要真跑一遍：
   *   (a) 记录还在、目标已消失 —— 第一次跑完的真实状态（NSIS 侧只删字体文件与
   *       注册表值，**不删记录文件**；记录由 Rust 的 remove_installed_fonts 删）。
   *       必须不报错、不误删。
   *   (b) 记录已不在 —— 再跑一次前先删掉记录，走 IfFileExists 的跳过分支。
   *       必须不报错、不误删。
   *
   * 两轮都要盯 canary：它是"清理段删了记录之外的东西"的唯一探测器。
   */
  runUninstaller()
  sleep(1000)
  for (const e of expected) {
    if (existsSync(e.dest)) failE2e(`(a) 记录仍在时重跑又出现了文件：${e.dest}`)
  }
  if (!valueExists(TEST_KEY, CANARY_NAME)) failE2e("(a) 记录仍在时重跑把 canary 值删了")
  if (!e2eFailed) console.log("  ✓ (a) 记录仍在时重跑：不报错、不误删")

  rmSync(recordPath, { force: true })
  if (existsSync(recordPath)) throw new Error("没能删掉记录文件，无法测 (b) 分支")
  runUninstaller()
  sleep(1000)
  if (!valueExists(TEST_KEY, CANARY_NAME)) failE2e("(b) 记录不存在时把 canary 值删了")
  for (const e of expected) {
    if (existsSync(e.dest)) failE2e(`(b) 记录不存在时出现了文件：${e.dest}`)
  }
  if (!e2eFailed) console.log("  ✓ (b) 记录不存在时：直接跳过，且不误删")
} catch (e) {
  failE2e(`阶段二异常：${e?.message ?? e}`)
  if (e?.stdout) console.error(String(e.stdout).trim())
  if (e?.stderr) console.error(String(e.stderr).trim())
} finally {
  // 无论成败都要清掉一次性键，别在用户机器上留垃圾
  try { reg(["delete", TEST_KEY, "/f"]) } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段三：真跑一遍「安装字体」
// ═══════════════════════════════════════════════════════════════════════════
//
// 阶段二证明"装完能卸干净"，本阶段证明"装的时候真的装上了"。
// 二者缺一不可：只在启动时装（Rust 路径）会让"装完从未启动过"的用户没有字体；
// 只在安装器里装则没有自愈能力。这里跑的是模板里那段真代码。
//
// 用一次性注册表键：**绝不**碰真实字体键（见上面 REAL_FONT_KEY 的说明）。
const INSTALL_TEST_KEY = "HKCU\\Software\\QMAI-NSIS-Font-Install-E2E"

try {
  console.log("")
  console.log("  ══ 阶段三：真跑一遍安装段 ══")

  /*
   * 阶段内**必须抛错**，不能走外层的 `fail()` —— 那个函数直接 `process.exit(1)`，
   * 会跳过本阶段的 `finally`，把一次性测试键留在用户机器上。
   * 这个坑第一次跑就踩到了：断言失败 → 立即退出 → 键残留 → 下一次跑
   * 前置检查就报"测试键已有值"，把一个真实断言失败伪装成环境脏。
   * 块级 `const` 遮蔽即可覆盖本段内全部 `fail(...)` 调用点。
   */
  const fail = (msg) => { throw new Error(msg) }

  const iWork = join(work, "installE2E")
  const iFontsSrc = join(iWork, "INSTDIR", "fonts") // 模拟 $INSTDIR\fonts
  const iFontsDst = join(iWork, "用户李四", "Fonts") // 模拟 %LOCALAPPDATA%\...\Fonts
  const iRecordDir = join(iWork, "RecordDir")
  mkdirSync(iFontsSrc, { recursive: true })
  mkdirSync(iRecordDir, { recursive: true })

  /*
   * 造出**清单里**声明的每一个源文件。
   * 内容用「文件名」当标记：后面按内容核对，能抓出"拷错了文件"这种错
   * （只比文件名的话，把 A 拷成 B 的名字是查不出来的）。
   * 不拷真实字体（200MB）—— 这一段测的是搬运与登记逻辑，与字体内容无关。
   */
  const tableEntries = [...fontMacros.matchAll(/"([A-Za-z0-9._-]+\.(?:ttf|otf))"\s+"([^"]+)"/g)].map(
    (m) => ({ file: m[1], valueName: m[2] }),
  )
  if (tableEntries.length < 8) {
    fail(`从宏里只解析出 ${tableEntries.length} 个字体条目 —— 正则或表格式变了，验收脚本已失效`)
  }

  /*
   * 第一道：模板里那张表必须与清单**逐条一致**（双向）。
   * 这是"安装的字体与随包的字体是同一批"的直接证明，也是下面按清单造源文件的前提。
   */
  {
    const tpl = new Map(tableEntries.map((e) => [e.file, e.valueName]))
    const want = new Map(expectedEntries.map((e) => [e.file, e.valueName]))
    const missing = expectedEntries.filter((e) => !tpl.has(e.file))
    const extra = tableEntries.filter((e) => !want.has(e.file))
    const mismatched = expectedEntries.filter(
      (e) => tpl.has(e.file) && tpl.get(e.file) !== e.valueName,
    )
    if (missing.length) {
      fail(
        `模板字体表漏了清单里的字体（装完机器上就没有它）：${missing
          .map((e) => `${e.file} / ${e.valueName}`)
          .join("、")}`,
      )
    }
    if (extra.length) {
      fail(
        `模板字体表里有清单没有的字体（源文件不存在，CopyFiles 会静默失败）：${extra
          .map((e) => e.file)
          .join("、")}`,
      )
    }
    if (mismatched.length) {
      fail(
        `模板字体表的值名与清单推导不一致（字体文件在、但系统字体表里没有它）：\n` +
          mismatched
            .map((e) => `      ${e.file}\n        模板: ${tpl.get(e.file)}\n        应为: ${e.valueName}`)
            .join("\n"),
      )
    }
  }

  for (const e of expectedEntries) writeFileSync(join(iFontsSrc, e.file), `FAKE:${e.file}`, "utf8")

  // 前置：目标目录与键都必须是干净的，否则"装上了"无从判断
  for (const e of expectedEntries) {
    if (existsSync(join(iFontsDst, e.file))) throw new Error(`前置失败：目标已有 ${e.file}`)
    if (valueExists(INSTALL_TEST_KEY, e.valueName)) throw new Error(`前置失败：测试键已有 ${e.valueName}`)
  }

  const iScaffold = join(iWork, "install.nsi")
  const iExe = join(iWork, "install.exe")
  writeFileSync(
    iScaffold,
    "\uFEFF" +
      buildInstallScaffold({
        outExe: iExe,
        // 去掉 HKCU\ 前缀：模板里的 Key 参数是相对 HKCU 的
        fontKey: INSTALL_TEST_KEY.replace(/^HKCU\\/i, ""),
        fontDir: iFontsDst,
        recordDir: iRecordDir,
        installDir: join(iWork, "INSTDIR"),
        installBlock,
      }),
    "utf8",
  )
  compileNsi(iScaffold, iWork)
  if (!existsSync(iExe)) throw new Error(`makensis 没有产出 ${iExe}`)
  execFileSync(iExe, [], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })

  // 1) 每个字体文件都拷到位、且内容是**它自己**那一份
  const missingFiles = expectedEntries.filter((e) => !existsSync(join(iFontsDst, e.file)))
  const wrongContent = expectedEntries.filter((e) => {
    const p = join(iFontsDst, e.file)
    if (!existsSync(p)) return false
    return readFileSync(p, "utf8") !== `FAKE:${e.file}`
  })
  if (missingFiles.length) fail(`安装后缺少字体文件：${missingFiles.map((e) => e.file).join("、")}`)
  if (wrongContent.length) fail(`字体文件内容不对（拷错了源文件）：${wrongContent.map((e) => e.file).join("、")}`)

  // 2) 每个注册表值都在，且**数据指向刚拷进去的那个文件**
  const missingValues = expectedEntries.filter((e) => !valueExists(INSTALL_TEST_KEY, e.valueName))
  if (missingValues.length) {
    fail(`安装后缺少注册表值：${missingValues.map((e) => e.valueName).join("、")}`)
  }
  // 读回数据核对：值名对了但指向错的文件同样是缺陷（字体加载不出来）
  // 用 reg export（UTF-16LE）而不是 reg query，理由见 readRegValues 的注释。
  const actualData = readRegValues(INSTALL_TEST_KEY)
  for (const e of expectedEntries) {
    const want = join(iFontsDst, e.file)
    const got = actualData.get(e.valueName)
    if (got === undefined) fail(`注册表值读不回来：「${e.valueName}」`)
    else if (got !== want) fail(`注册表值指向错的文件：「${e.valueName}」\n      期望: ${want}\n      实际: ${got}`)
  }

  // 3) 卸载记录文件：交替两行、纯 ASCII、与**清单**逐字对应
  const iRecordPath = join(iRecordDir, "installed-fonts.txt")
  if (!existsSync(iRecordPath)) throw new Error(`安装器没有写出卸载记录：${iRecordPath}`)
  const iRecordBytes = readFileSync(iRecordPath)
  if (iRecordBytes.some((b) => b > 0x7e || (b < 0x20 && b !== 0x0d && b !== 0x0a))) {
    fail("安装器写的记录文件含非 ASCII —— NSIS 按 ANSI 读会乱码，中文用户名下清理会静默失效")
  }
  const recordLines = iRecordBytes.toString("latin1").split("\r\n").filter((l) => l.length)
  if (recordLines.length !== expectedEntries.length * 2) {
    fail(`记录文件行数是 ${recordLines.length}，期望 ${expectedEntries.length * 2}（每款两行）`)
  } else {
    for (let i = 0; i < expectedEntries.length; i++) {
      const valueName = recordLines[i * 2]
      const fileName = recordLines[i * 2 + 1]
      const hit = expectedEntries.find((e) => e.valueName === valueName)
      if (!hit) fail(`记录第 ${i * 2 + 1} 行的值名不在随包清单里：「${valueName}」`)
      else if (hit.file !== fileName) {
        fail(`记录第 ${i * 2 + 2} 行应与值名配对，实际「${fileName}」应为「${hit.file}」`)
      }
      // 第二行必须是**纯文件名**：带目录就会在中文用户名下被 ANSI 读成乱码
      if (fileName.includes("\\") || fileName.includes("/")) {
        fail(`记录第二行必须是纯文件名，实际含路径分隔符：「${fileName}」`)
      }
    }
  }
  if (!e2eFailed) {
    console.log(`  ✓ ${expectedEntries.length} 个字体文件已按用户安装到 ${iFontsDst}`)
    console.log(`  ✓ ${expectedEntries.length} 个 HKCU 注册表值已写入，且都指向刚拷入的文件`)
    console.log(`  ✓ 卸载记录已写出：${recordLines.length} 行、纯 ASCII、值名与文件名交替配对`)
    console.log("  ✓ 模板字体表与随包清单逐条一致（文件名与注册表值名双向核对）")
  }

  /*
   * 4) 「装完从未启动过应用」的卸载兜底。
   *
   * 这是安装器的**独有**场景：记录文件由 Rust 在启动时才写，所以"装完没启动过"
   * 时记录不在。此时若卸载段只依赖记录，字体会永久残留在用户字体库里 ——
   * 且不会有任何报错。下面删掉记录再跑一次卸载，证明兜底表真的生效。
   */
  rmSync(iRecordPath, { force: true })
  if (existsSync(iRecordPath)) throw new Error("没能删掉记录文件，无法测兜底分支")

  const iUninst = join(iWork, "uninst.exe")
  const uScaffold = join(iWork, "uninst.nsi")
  writeFileSync(
    uScaffold,
    "\uFEFF" +
      buildScaffold({
        outExe: join(iWork, "uninst-gen.exe"),
        fontKey: INSTALL_TEST_KEY.replace(/^HKCU\\/i, ""),
        fontDir: iFontsDst,
        recordDir: iRecordDir,
        uninstallerPath: iUninst,
      }),
    "utf8",
  )
  compileNsi(uScaffold, iWork)
  // 先跑安装器 exe（它只 WriteUninstaller），再跑卸载器（它执行 Section Uninstall）
  const genExe = join(iWork, "uninst-gen.exe")
  execFileSync(genExe, [], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  if (!existsSync(iUninst)) throw new Error(`没有产出卸载器：${iUninst}`)
  execFileSync(iUninst, ["/S"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })

  const deadline = Date.now() + 20000
  let relieved = false
  while (Date.now() < deadline) {
    const filesGone = expectedEntries.every((e) => !existsSync(join(iFontsDst, e.file)))
    const valuesGone = expectedEntries.every((e) => !valueExists(INSTALL_TEST_KEY, e.valueName))
    if (filesGone && valuesGone) { relieved = true; break }
    sleep(200)
  }
  const stuckFiles = expectedEntries.filter((e) => existsSync(join(iFontsDst, e.file)))
  const stuckValues = expectedEntries.filter((e) => valueExists(INSTALL_TEST_KEY, e.valueName))
  if (stuckFiles.length) fail(`兜底清理没删掉文件：${stuckFiles.map((e) => e.file).join("、")}`)
  if (stuckValues.length) fail(`兜底清理没删掉注册表值：${stuckValues.map((e) => e.valueName).join("、")}`)
  if (relieved && !e2eFailed) {
    console.log("  ✓ 记录不存在时（装完从未启动过应用），卸载仍按兜底表清理干净")
  }
} catch (e) {
  failE2e(`阶段三异常：${e?.message ?? e}`)
  if (e?.stdout) console.error(String(e.stdout).trim())
  if (e?.stderr) console.error(String(e.stderr).trim())
} finally {
  try { reg(["delete", INSTALL_TEST_KEY, "/f"]) } catch {}
}

/*
 * ── 安全网：真实字体键必须一个字节都没变 ──
 *
 * 这一段是本次事故的直接产物：脚本曾经的缩略实现把 11 个指向 %TEMP% 的值
 * 写进了真键，悄悄改掉了用户已装好的字体注册。任何验收步骤都不该碰真键，
 * 所以这里做 before/after 快照对比 —— 一旦有人再犯，脚本立刻红，
 * 而不是等到用户发现"字体不见了"。
 */
try {
  const diffs = diffRealFontKey(realFontKeyBefore, snapshotRealFontKey())
  if (diffs.length) {
    failE2e(
      `真实字体键被改动了 ${diffs.length} 处（验收脚本本不该碰它，请检查各脚手架里 QMAIFONTKEY 的覆盖值）：\n    ` +
        diffs.join("\n    "),
    )
  } else {
    console.log(`  ✓ 真实字体键未被触碰（${realFontKeyBefore.size} 个值逐一比对一致）`)
  }
} catch (e) {
  failE2e(`安全网自检异常：${e?.message ?? e}`)
}

try { rmSync(work, { recursive: true, force: true }) } catch {}

if (e2eFailed) {
  console.error("")
  console.error("✗ 阶段二/三失败 —— 安装或卸载字体存在运行时缺陷")
  process.exit(1)
}
console.log("")
console.log("✓ 三阶段全部通过（编译 + 安装 + 卸载）")
