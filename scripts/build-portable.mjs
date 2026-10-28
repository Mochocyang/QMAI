import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync, renameSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { execSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))

let currentBranch = ""
try {
  currentBranch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim()
} catch {}
const isStorySimulationBranch = currentBranch === "feature-story-simulation"

const releaseExe = resolve(root, "src-tauri/target/release/qmai.exe")
const portableDevExe = resolve(root, "src-tauri/target/portable-dev/qmai.exe")
const sourceExe = existsSync(portableDevExe) ? portableDevExe : releaseExe
const outDir = resolve(root, "release-portable")
const outExe = resolve(outDir, isStorySimulationBranch ? "QMaiWrite-剧情推演版.exe" : "QMaiWrite.exe")
const outSkillDir = resolve(outDir, "skills")
const manifest = resolve(outDir, "version-info.json")
const backupDir = resolve(root, "release-portable-backup")

if (!existsSync(sourceExe)) {
  throw new Error(`未找到最新 EXE，请先运行 npm run tauri build：${sourceExe}`)
}

// 尝试安全清理输出目录
try {
  if (existsSync(backupDir)) {
    try {
      rmSync(backupDir, { recursive: true, force: true })
    } catch {}
  }
  
  if (existsSync(outDir)) {
    // 先尝试重命名而不是直接删除
    renameSync(outDir, backupDir)
    try {
      rmSync(backupDir, { recursive: true, force: true })
    } catch {}
  }
} catch {}

mkdirSync(outDir, { recursive: true })

// 复制 exe，处理被占用的情况
try {
  if (existsSync(outExe)) {
    const backupExe = resolve(outDir, "QMaiWrite-old.exe")
    try {
      if (existsSync(backupExe)) {
        rmSync(backupExe, { force: true })
      }
      renameSync(outExe, backupExe)
    } catch {}
  }
  cpSync(sourceExe, outExe)
} catch (e) {
  console.warn("警告：无法完全替换正在运行的 exe，保留旧版本，但已更新其他资源")
}

/*
 * 复制一个资源目录到便携版目录。
 *
 * 优先用 robocopy：比 cpSync 快两个数量级，且文件被占用时明确报错跳过
 * （cpSync 会无限重试挂死）。robocopy 成功退出码为 0–7，>=8 才是错误；
 * 命令不可用（如非 Windows）时回退到 cpSync。
 *
 * 抽成函数是因为现在要复制**两个**目录（skills 与 fonts）：
 * 字体合计上百 MB，用 cpSync 复制既有挂死风险又慢得多，
 * 而把这段逻辑抄第二遍正是"只修了一处"的经典来源。
 */
function copyResourceDir(sourceDir, destDir, label) {
  if (!existsSync(sourceDir)) {
    console.warn(`源目录不存在，跳过 ${label}：${sourceDir}`)
    return false
  }
  try {
    rmSync(destDir, { recursive: true, force: true })
  } catch {}
  mkdirSync(destDir, { recursive: true })
  let copied = false
  try {
    execSync(
      `robocopy "${sourceDir}" "${destDir}" /E /MT:16 /R:0 /W:0 /NFL /NDL /NJH /NJS /NP`,
      { stdio: "ignore" },
    )
    copied = true
  } catch (e) {
    const code = typeof e?.status === "number" ? e.status : 8
    if (code < 8) copied = true
    else console.warn(`robocopy 复制 ${label} 失败（exit=${code}），回退 cpSync`)
  }
  if (!copied) {
    try {
      cpSync(sourceDir, destDir, { recursive: true })
      copied = true
    } catch (e) {
      console.warn(`cpSync 复制 ${label} 失败：`, e?.message ?? e)
    }
  }
  return copied
}

copyResourceDir(resolve(root, "skills"), outSkillDir, "skills")

/*
 * 随包字体（阶段 4）。
 *
 * 便携版**没有安装器**，字体必须平铺在 exe 旁边，由应用启动时的
 * 「确保安装」把它装进用户字体目录（见 src-tauri/src/font_install.rs）。
 * 字体目录名必须是 `fonts`：Rust 侧按 `resource_dir()/fonts` 解析，
 * 而便携版的 resource_dir() 就是 exe 所在目录。
 */
const outFontDir = resolve(outDir, "fonts")
const includesFonts = copyResourceDir(resolve(root, "src-tauri/fonts"), outFontDir, "fonts")
if (includesFonts && !existsSync(resolve(outFontDir, "fonts-manifest.json"))) {
  // 没有清单 = Rust 侧会当作"本次构建不带字体"而静默跳过，
  // 用户看到的是"字体功能没生效"。必须显式报警，不能静默通过。
  console.warn(`警告：${outFontDir} 缺少 fonts-manifest.json，应用将不会安装这些字体`)
}

/*
 * 便携版没有安装器可做 WebView2 预检，所以把**在线引导安装器**放到 exe 旁边，
 * 供程序启动时的检测逻辑（src-tauri/src/webview2_check.rs）在同一目录取用 ——
 * 那里优先用同目录的 MicrosoftEdgeWebview2Setup.exe，没有才现下载；本机就是这样
 * 省掉一次 2 MB 下载。下载失败不算构建失败：程序自己会退回在线下载。
 */
const webview2SetupName = "MicrosoftEdgeWebview2Setup.exe"
const webview2SetupUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
const webview2SetupPath = resolve(outDir, webview2SetupName)
let includesWebview2Setup = false
try {
  const response = await fetch(webview2SetupUrl, { redirect: "follow" })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  // 官方引导器约 1.8 MB；明显偏小说明拿到的是错误页。
  if (bytes.length < 512 * 1024) throw new Error(`下载内容异常（${bytes.length} 字节）`)
  writeFileSync(webview2SetupPath, bytes)
  includesWebview2Setup = true
} catch (e) {
  console.warn(
    `警告：下载 ${webview2SetupName} 失败（${e?.message ?? e}）。` +
      "便携版仍可使用，但缺少 WebView2 的电脑需要联网由程序自行下载。",
  )
}

const exeStat = statSync(outExe)
writeFileSync(manifest, JSON.stringify({  productName: isStorySimulationBranch ? "青幕AI写作（剧情推演版）" : "青幕AI写作",
  version: pkg.version,
  builtAt: new Date().toISOString(),
  sourceExe,
  portableExe: outExe,
  exeBytes: exeStat.size,
  includesSkills: existsSync(outSkillDir),
  includesFonts,
  includesWebview2Setup,
  ...(isStorySimulationBranch ? { variant: "story-simulation", branch: currentBranch } : {}),
}, null, 2), "utf8")

console.log(`便携版已生成：${outExe}`)
console.log(`版本信息：${manifest}`)
if (isStorySimulationBranch) {
  console.log("注意：这是测试版，不可上传到 GitHub main 分支")
}
