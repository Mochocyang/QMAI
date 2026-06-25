import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync, renameSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))

const releaseExe = resolve(root, "src-tauri/target/release/qmai-server.exe")
const outDir = resolve(root, "release-server")
const outExe = resolve(outDir, "QMaiWrite_Server.exe")
const outConfig = resolve(outDir, "qmai-server.toml")
const sourceConfig = resolve(root, "qmai-server.toml")
const manifest = resolve(outDir, "version-info.json")
const backupDir = resolve(root, "release-server-backup")

if (!existsSync(releaseExe)) {
  throw new Error(`未找到 qmai-server.exe，请先运行 npm run build:server：${releaseExe}`)
}

// 尝试安全清理输出目录
try {
  if (existsSync(backupDir)) {
    try {
      rmSync(backupDir, { recursive: true, force: true })
    } catch {}
  }

  if (existsSync(outDir)) {
    renameSync(outDir, backupDir)
    try {
      rmSync(backupDir, { recursive: true, force: true })
    } catch {}
  }
} catch {}

mkdirSync(outDir, { recursive: true })

// 复制 exe
try {
  if (existsSync(outExe)) {
    const backupExe = resolve(outDir, "QMaiWrite_Server-old.exe")
    try {
      if (existsSync(backupExe)) {
        rmSync(backupExe, { force: true })
      }
      renameSync(outExe, backupExe)
    } catch {}
  }
  cpSync(releaseExe, outExe)
} catch (e) {
  console.warn("警告：无法替换正在运行的 exe，保留旧版本")
}

// 复制配置文件
if (existsSync(sourceConfig)) {
  cpSync(sourceConfig, outConfig)
} else {
  // 如果项目根目录没有配置文件，写入默认配置
  writeFileSync(outConfig, `[server]
host = "127.0.0.1"
port = 5800

[app]
project_path = ""
open_browser = true
`, "utf8")
}

// 查找并复制运行时依赖 DLL
const releaseDir = resolve(root, "src-tauri/target/release")
const dllPatterns = ["pdfium.dll"]
for (const dll of dllPatterns) {
  // 在 release 根目录和 pdfium 子目录中查找
  const paths = [
    resolve(releaseDir, dll),
    resolve(releaseDir, "pdfium", dll),
  ]
  for (const src of paths) {
    if (existsSync(src)) {
      cpSync(src, resolve(outDir, dll))
      break
    }
  }
}

// 创建 ZIP 包
const zipName = `QMaiWrite_Server_${pkg.version}_windows_X64.zip`
const zipPath = resolve(root, zipName)

try {
  if (existsSync(zipPath)) {
    rmSync(zipPath, { force: true })
  }
  // 使用 PowerShell 创建 ZIP
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force"`,
    { stdio: "inherit" }
  )
} catch (e) {
  console.warn("警告：ZIP 打包失败，可手动压缩 release-server 目录")
}

// 写入版本信息
const exeStat = statSync(outExe)
writeFileSync(manifest, JSON.stringify({
  productName: "青幕AI写作服务端",
  version: pkg.version,
  builtAt: new Date().toISOString(),
  sourceExe: releaseExe,
  portableExe: outExe,
  exeBytes: exeStat.size,
  includesConfig: existsSync(outConfig),
  zipPath: existsSync(zipPath) ? zipPath : null,
}, null, 2), "utf8")

console.log(`服务端便携版已生成：${outExe}`)
if (existsSync(zipPath)) {
  console.log(`ZIP 包已生成：${zipPath}`)
}
console.log(`版本信息：${manifest}`)
