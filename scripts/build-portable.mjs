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

// 复制 skills 文件夹到便携版目录
const sourceSkillDir = resolve(root, "skills")
if (existsSync(sourceSkillDir)) {
  try {
    rmSync(outSkillDir, { recursive: true, force: true })
  } catch {}
  mkdirSync(outSkillDir, { recursive: true })
  cpSync(sourceSkillDir, outSkillDir, { recursive: true })
}

const exeStat = statSync(outExe)
writeFileSync(manifest, JSON.stringify({
  productName: isStorySimulationBranch ? "青幕AI写作（剧情推演版）" : "青幕AI写作",
  version: pkg.version,
  builtAt: new Date().toISOString(),
  sourceExe,
  portableExe: outExe,
  exeBytes: exeStat.size,
  includesSkills: existsSync(outSkillDir),
  ...(isStorySimulationBranch ? { variant: "story-simulation", branch: currentBranch } : {}),
}, null, 2), "utf8")

console.log(`便携版已生成：${outExe}`)
console.log(`版本信息：${manifest}`)
if (isStorySimulationBranch) {
  console.log("注意：这是测试版，不可上传到 GitHub main 分支")
}
