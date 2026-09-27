import { readdir, rm, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const debugDir = join(root, "src-tauri/target/debug")
const depsDir = join(debugDir, "deps")
const incrementalDir = join(debugDir, "incremental")

const QMAI_BIN = /^qmai-([0-9a-f]{16})(?:\.exe)?$/
const QMAI_ARTIFACT = /^qmai-([0-9a-f]{16})(?:\.|$)/
const LANCE_ARTIFACT = /^liblance-([0-9a-f]{16})\.(rlib|rmeta)$/

let removed = 0
let freed = 0

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function pathSize(path) {
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  let total = 0
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    total += await pathSize(join(path, entry.name))
  }
  return total
}

async function removePath(path) {
  try {
    const size = await pathSize(path)
    await rm(path, { recursive: true, force: true })
    removed += 1
    freed += size
  } catch (error) {
    if (error?.code === "ENOENT") return
    console.warn(`跳过无法删除的编译产物 ${path}: ${error.message}`)
  }
}

function newestHash(groups) {
  let bestHash = null
  let bestMtime = -1
  for (const [hash, info] of groups) {
    if (info.mtime > bestMtime) {
      bestHash = hash
      bestMtime = info.mtime
    }
  }
  return bestHash
}

async function gcQmaiBins() {
  if (!(await pathExists(depsDir))) return
  const entries = await readdir(depsDir)
  const bins = new Map()
  for (const name of entries) {
    const match = QMAI_BIN.exec(name)
    if (!match) continue
    const info = await stat(join(depsDir, name))
    if (!info.isFile()) continue
    const current = bins.get(match[1])
    if (!current || info.mtimeMs > current.mtime) {
      bins.set(match[1], { mtime: info.mtimeMs })
    }
  }
  if (bins.size === 0) return
  const keep = newestHash(bins)
  for (const name of entries) {
    const match = QMAI_ARTIFACT.exec(name)
    if (!match || match[1] === keep) continue
    await removePath(join(depsDir, name))
  }
}

async function gcLance() {
  if (!(await pathExists(depsDir))) return
  const entries = await readdir(depsDir)
  const groups = new Map()
  for (const name of entries) {
    const match = LANCE_ARTIFACT.exec(name)
    if (!match) continue
    const info = await stat(join(depsDir, name))
    const current = groups.get(match[1])
    if (!current || info.mtimeMs > current.mtime) {
      groups.set(match[1], { mtime: info.mtimeMs })
    }
  }
  if (groups.size === 0) return
  const keep = newestHash(groups)
  for (const name of entries) {
    const match = LANCE_ARTIFACT.exec(name)
    if (!match || match[1] === keep) continue
    await removePath(join(depsDir, name))
  }
}

async function gcIncremental() {
  if (!(await pathExists(incrementalDir))) return
  const entries = await readdir(incrementalDir, { withFileTypes: true })
  const groups = new Map()
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("qmai-")) continue
    const info = await stat(join(incrementalDir, entry.name))
    groups.set(entry.name, { mtime: info.mtimeMs })
  }
  if (groups.size === 0) return
  const keep = newestHash(groups)
  for (const name of groups.keys()) {
    if (name === keep) continue
    await removePath(join(incrementalDir, name))
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${bytes} B`
}

if (await pathExists(debugDir)) {
  await gcQmaiBins()
  await gcLance()
  await gcIncremental()
  if (removed > 0) {
    console.log(`已清理历史 debug 编译：${removed} 项，释放 ${formatBytes(freed)}`)
  }
}
