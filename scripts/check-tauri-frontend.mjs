import { readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, resolve, win32 } from "node:path"
import { fileURLToPath } from "node:url"

/** 本地安装包只接受相对目录；Windows盘符会被Tauri优先解析成URL，导致不内嵌资源。 */
export function validateTauriFrontendDist(config, tauriDir) {
  const value = config.build?.frontendDist
  if (typeof value !== "string" || !value.trim() || /^[a-z][a-z0-9+.-]*:/i.test(value) || isAbsolute(value) || win32.isAbsolute(value)) {
    throw new Error("本地打包的 frontendDist 必须使用相对于 src-tauri 的目录相对路径，不能使用盘符绝对路径或网址。")
  }
  const directory = resolve(tauriDir, value)
  const index = resolve(directory, "index.html")
  let html
  try { html = readFileSync(index, "utf8") } catch {
    throw new Error(`前端首页 index.html 不存在或不可读：${index}`)
  }
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => match[1].split(/[?#]/)[0])
    .filter((asset) => /\.(?:js|css)$/i.test(asset))
  if (!assets.length) throw new Error("前端首页没有引用构建资源，请先完成前端构建。")
  for (const asset of assets) {
    const filename = resolve(directory, asset.replace(/^\//, ""))
    try {
      if (!statSync(filename).isFile()) throw new Error("不是文件")
    } catch {
      throw new Error(`前端首页引用的构建资源不存在：${asset}`)
    }
  }
  return directory
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error("请传入本轮 Tauri 打包配置文件。")
    const config = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8").replace(/^\uFEFF/, ""))
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
    const directory = validateTauriFrontendDist(config, resolve(root, "src-tauri"))
    console.log(`前端资源检查通过，将内嵌目录：首页及构建资源完整。\n${directory}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
