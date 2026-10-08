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
function buildScaffold({ outExe, fontKey, fontDir, recordDir }) {
  return `Unicode true
; 自动化：不要 UI，也不要提权（提权会弹 UAC 把脚本挂死）
SilentInstall silent
RequestExecutionLevel user
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "StrFunc.nsh"
\${StrCase}
\${StrLoc}
\${StrTrimNewLines}

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

Section
  StrCpy $UpdateMode 0
${block}
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

  // 4) 编译并运行清理段
  const e2eScaffold = join(e2eWork, "e2e.nsi")
  const e2eExe = join(e2eWork, "e2e.exe")
  writeFileSync(
    e2eScaffold,
    "\uFEFF" +
      buildScaffold({
        outExe: e2eExe,
        fontKey: TEST_KEY.replace(/^HKCU\\/i, ""),
        // 指向**含中文的目录**：这是本测试的核心（复现"中文用户名"）
        fontDir: e2eFonts,
        recordDir: e2eRecordDir,
      }),
    "utf8",
  )
  compileNsi(e2eScaffold, e2eWork)
  if (!existsSync(e2eExe)) throw new Error(`makensis 没有产出 ${e2eExe}`)

  const runExe = () => {
    try {
      execFileSync(e2eExe, [], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    } catch (e) {
      // NSIS 的 Section 即使出错也常返回 0；这里只报告异常，判定交给下面的实际状态
      console.log(`  ⓘ 安装器返回非 0（${e?.status ?? "?"}），继续按实际状态判定`)
    }
  }
  runExe()
  console.log("  已执行清理段")

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

  // 6) 幂等：再跑一次不应出错，也不应删掉别的什么
  //    卸载器可能被连跑两次（用户重复点卸载、或先卸载再更新）
  runExe()
  for (const e of expected) {
    if (existsSync(e.dest)) failE2e(`第二次执行后又出现了文件（不应发生）：${e.dest}`)
  }
  if (!valueExists(TEST_KEY, CANARY_NAME)) failE2e("第二次执行把 canary 值删了")
  if (!e2eFailed) console.log("  ✓ 重复执行是幂等的（第二次仍不误删）")
} catch (e) {
  failE2e(`阶段二异常：${e?.message ?? e}`)
  if (e?.stdout) console.error(String(e.stdout).trim())
  if (e?.stderr) console.error(String(e.stderr).trim())
} finally {
  // 无论成败都要清掉一次性键，别在用户机器上留垃圾
  try { reg(["delete", TEST_KEY, "/f"]) } catch {}
  try { rmSync(work, { recursive: true, force: true }) } catch {}
}

if (e2eFailed) {
  console.error("")
  console.error("✗ 阶段二失败 —— 卸载时的字体清理有运行时缺陷")
  process.exit(1)
}
console.log("")
console.log("✓ 两阶段全部通过（编译 + 真实执行）")
