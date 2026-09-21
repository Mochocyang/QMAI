import { statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** 使用已构建的前端目录；不能传盘符绝对路径，否则 Tauri 会优先将其解释为外部 URL。 */
export function prepareLocalTauriConfig(tauriDirectory, frontendDirectory) {
  const frontend = path.resolve(frontendDirectory)
  const relative = path.relative(path.resolve(tauriDirectory), frontend)
  if (path.isAbsolute(relative) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(relative)) {
    throw new Error("前端目录必须与 src-tauri 位于同一磁盘，不能使用盘符 URL 打包")
  }
  const entry = path.join(frontend, "index.html")
  try {
    if (!statSync(entry).isFile()) throw new Error("不是文件")
  } catch {
    throw new Error(`前端构建缺少 index.html，请先完成 Vite 构建：${entry}`)
  }
  const normalized = relative.split(path.sep).join("/")
  const frontendDist = normalized.startsWith(".") ? normalized : `./${normalized}`
  return {
    build: {
      beforeBuildCommand: 'node -e "process.exit(0)"',
      frontendDist,
    },
    bundle: { targets: ["nsis"] },
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [frontendDirectory, outputFile] = process.argv.slice(2)
    if (!frontendDirectory || !outputFile) {
      throw new Error("用法：node scripts/prepare-local-tauri-config.mjs <前端构建目录> <新的配置文件路径>")
    }
    const tauriDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src-tauri")
    const config = prepareLocalTauriConfig(tauriDirectory, frontendDirectory)
    writeFileSync(outputFile, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", flag: "wx" })
    console.log(`已生成本地打包配置，内嵌前端目录：${config.build.frontendDist}`)
  } catch (error) {
    console.error(`生成本地打包配置失败（不会覆盖已有文件）：${error.message}`)
    process.exitCode = 1
  }
}
