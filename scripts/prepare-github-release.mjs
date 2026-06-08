import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildCurrentReleaseNotes } from "./release-notes.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
const releaseNotes = await buildCurrentReleaseNotes(root)
const bundleDir = resolve(root, "src-tauri/target/release/bundle/nsis")
const outDir = resolve(root, "release-github")
const portableExe = resolve(root, "release-portable/QMaiWrite.exe")

if (!existsSync(bundleDir)) {
  throw new Error(`未找到安装包目录：${bundleDir}`)
}

const bundleFiles = readdirSync(bundleDir)
const updaterAssetName = bundleFiles
  .filter((name) => {
  if (name.endsWith(".sig")) return false
    return [".exe", ".msi", ".zip"].includes(extname(name).toLowerCase())
  })
  .sort((left, right) => statSync(resolve(bundleDir, right)).mtimeMs - statSync(resolve(bundleDir, left)).mtimeMs)[0]

if (!updaterAssetName) {
  throw new Error("未找到 updater 安装包，请先执行 npm run build:github-release")
}

const updaterAssetPath = resolve(bundleDir, updaterAssetName)
const releaseAssetName = `QMaiWrite_${pkg.version}_windows_X64${extname(updaterAssetName)}`
const releaseAssetPath = resolve(outDir, releaseAssetName)
const releaseSignaturePath = `${releaseAssetPath}.sig`

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(updaterAssetPath, releaseAssetPath)

const privateKeyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || resolve(process.env.USERPROFILE ?? "", ".tauri/qmai-updater.key")
if (!existsSync(privateKeyPath)) {
  throw new Error(`未找到 updater 签名私钥：${privateKeyPath}`)
}
const tauriCli = resolve(root, "node_modules/@tauri-apps/cli/tauri.js")
const result = spawnSync(process.execPath, [
  tauriCli,
  "signer",
  "sign",
  "--private-key-path",
  privateKeyPath,
  `--password=${process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? ""}`,
  releaseAssetPath,
], { stdio: "inherit" })
if (result.status !== 0) {
  throw new Error("生成 updater 签名文件失败")
}

if (existsSync(portableExe)) {
  cpSync(portableExe, resolve(outDir, "QMaiWrite-portable.exe"))
}

const signature = readFileSync(releaseSignaturePath, "utf8").trim()
const latest = {
  version: pkg.version,
  notes: `QMAI ${pkg.version} 发布版本`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/Mochocyang/QMAI/releases/latest/download/${releaseAssetName}`,
    },
  },
}

latest.notes = releaseNotes
writeFileSync(resolve(outDir, "latest.json"), JSON.stringify(latest, null, 2), "utf8")
writeFileSync(resolve(outDir, "release-notes.txt"), releaseNotes, "utf8")

console.log(`GitHub Release 产物已生成：${outDir}`)
console.log(`更新包：${releaseAssetName}`)
console.log(`签名文件：${releaseAssetName}.sig`)
