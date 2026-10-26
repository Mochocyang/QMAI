/**
 * 本地历史版本库的「命名与目录」规则。
 *
 * 职责边界：本模块只回答两个问题——某个版本该落到哪个目录、该叫什么文件名，
 * 以及如何把文件名还原成可排序的时间。真正的读写（扫描、写入、清理、对比）
 * 依赖 Tauri 的 fs API，放在后续任务里补，这样这里能保持纯函数、可单测。
 *
 * 时间戳一律按本地时间编码：用户看到的是自己电脑上的钟，
 * 若按 UTC 编码，晚上保存的版本在界面上会莫名早/晚几个小时。
 */

import { normalizePath } from "@/lib/path-utils"
import { createDirectory, deleteFile, listDirectory, readFile, writeFile } from "@/commands/fs"

/** 版本库相对书根目录的位置；集中定义避免调用方各自拼字符串拼错。 */
export const VERSIONS_DIR = ".qmai/versions"

export type VersionKind = "chapter" | "outline"

export interface ParsedVersionName {
  /** 文件名里的本地时间，已还原成 Date（按本机时区解释）。 */
  at: Date
  /** 4 位小写十六进制内容哈希。 */
  hash: string
}

/** 章节没有编号时用的占位目录名，语义比 "null"/"0" 更清楚。 */
const UNNUMBERED_DIR = "unnumbered"

const VERSION_NAME_PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-([0-9a-f]{4})\.md$/

/**
 * FNV-1a 32 位哈希，取低 16 位输出 4 位十六进制。
 *
 * 不能用 node:crypto：Tauri 前端跑在浏览器环境里没有 Node 运行时，
 * 引 Node 内置模块会在打包后直接炸。这里只需要「同一内容稳定同结果、
 * 不同内容大概率不同」，用来避免同一秒内多次保存互相覆盖，FNV-1a 足够。
 */
export function shortHash(content: string): string {
  let hash = 0x811c9dc5
  // 按 UTF-16 code unit 迭代：中文内容同样能稳定哈希，且不依赖 TextEncoder。
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    // 乘 16777619 会超出 32 位精度，用移位分解成等价运算并保持在 int32。
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) & 0xffff).toString(16).padStart(4, "0")
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * 生成 `{YYYYMMDD}-{HHmmss}-{哈希4位}.md`。
 * 各段定长且补零，字典序即时间序，后续列表排序不必再解析时间。
 */
export function buildVersionFileName(at: Date, content: string): string {
  const date = `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}`
  const time = `${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`
  return `${date}-${time}-${shortHash(content)}.md`
}

/**
 * 严格反解版本文件名；格式不符返回 null。
 *
 * 目录里可能混入用户手放的文件或旧格式残留，调用方（列表渲染）
 * 不该为此崩溃，所以这里用 null 表示「不是版本文件」而不是抛异常。
 */
export function parseVersionFileName(name: string): ParsedVersionName | null {
  const match = VERSION_NAME_PATTERN.exec(name)
  if (!match) return null

  const [, year, month, day, hour, minute, second, hash] = match
  const at = new Date(
    Number(year),
    Number(month) - 1, // Date 的月份从 0 开始
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )

  // 20261332 这类数字合法但日期不存在的输入会被 Date 静默滚动到别的日子，
  // 反查各字段确认没有发生滚动，否则宁可视作不认识的垃圾文件名。
  if (
    at.getFullYear() !== Number(year) ||
    at.getMonth() !== Number(month) - 1 ||
    at.getDate() !== Number(day) ||
    at.getHours() !== Number(hour) ||
    at.getMinutes() !== Number(minute) ||
    at.getSeconds() !== Number(second)
  ) {
    return null
  }

  return { at, hash }
}

/**
 * 清洗大纲 key：它是文件名（去扩展名后）派生的，可能带路径分隔符或 `..`。
 * 不清洗的话 `../x` 会让版本写到版本库外面去。
 */
function sanitizeKey(key: string): string {
  return key
    .replace(/[\\/]/g, "_")
    .replace(/\.{2,}/g, "_")
    .trim() || "unnamed"
}

/**
 * 版本文件应存放的目录。
 *
 * 章节按三位编号分目录，补零是为了让目录名在资源管理器里也是自然顺序；
 * 编号由界面传入且可能缺失（新建未编号章节），用固定占位目录兜底。
 */
export function buildVersionDir(
  projectPath: string,
  kind: VersionKind,
  key: number | string | null,
): string {
  const root = `${normalizePath(projectPath).replace(/\/+$/, "")}/${VERSIONS_DIR}`

  if (kind === "chapter") {
    const number = typeof key === "number" && Number.isFinite(key) ? Math.trunc(key) : null
    if (number === null || number <= 0) {
      return `${root}/chapters/${UNNUMBERED_DIR}`
    }
    return `${root}/chapters/${String(number).padStart(3, "0")}`
  }

  const rawKey = key === null ? "" : String(key)
  return `${root}/outlines/${sanitizeKey(rawKey)}`
}

/**
 * 合并窗口：同一份内容在这个时间内的连续保存只保留最后一条。
 *
 * 为什么需要：用户改稿时习惯性连按 Ctrl+S，或者编辑器自动保存，
 * 几十秒内可能刷出十几条几乎一样的版本，历史列表会被垃圾淹没，
 * 真正想回退的那一版反而找不到了。30 秒大致是「一次连续思考」
 * 的编辑节奏，既能把抖动合并掉，又不会把两个不同的编辑阶段并成一条。
 */
export const MERGE_WINDOW_MS = 30_000

export interface SaveVersionInput {
  projectPath: string
  kind: VersionKind
  key: number | string | null
  content: string
  /** 版本时间，默认当前时间；显式传入便于测试与回溯导入。 */
  at?: Date
}

export interface SaveVersionOutcome {
  saved: boolean
  path?: string
  /** 被合并掉的旧版本文件名（合并时才有）。 */
  replaced?: string
}

/** 每个对象（章节 / 大纲）最多保留的版本条数。 */
export const MAX_VERSIONS_PER_ITEM = 50

/** 版本最长保留天数。 */
export const MAX_VERSION_AGE_DAYS = 90

export interface VersionEntry {
  fileName: string
  path: string
  at: Date
  hash: string
  content: string
}

/**
 * 列出一个版本目录里的全部有效版本，按时间倒序（最新在前）。
 *
 * 容错策略是「尽力而为」而不是「全有或全无」：
 * - 目录不存在（还没存过版本）视为没有任何版本，而不是报错——这是最常见的场景；
 * - 单个文件读失败（被用户删掉、正在被同步工具占用）就跳过它，
 *   不能因为一个坏文件让整个历史列表 / 保存流程失败；
 * - 不认识的文件名（用户手放的笔记、旧格式残留）同样跳过，且绝不参与后续删除。
 */
export async function listVersions(
  projectPath: string,
  kind: VersionKind,
  key: number | string | null,
): Promise<VersionEntry[]> {
  const dir = buildVersionDir(projectPath, kind, key)

  let nodes: Awaited<ReturnType<typeof listDirectory>>
  try {
    nodes = await listDirectory(dir)
  } catch {
    return []
  }

  // 目录项也要跳过：理论上版本目录下不会有子目录，但用户的同步工具
  // 或手动整理可能塞进来，按文件去读它会直接失败。
  const fileNodes = nodes.filter((node) => !node.is_dir)
  const entries = await Promise.all(
    fileNodes.map(async (node): Promise<VersionEntry | null> => {
      const parsed = parseVersionFileName(node.name)
      if (!parsed) return null
      // 路径按「目录 + 文件名」重算，而不是照抄 node.path：读、展示、删除
      // 都用同一条可预测的路径，不必依赖底层返回的写法（分隔符风格、是否带
      // 前缀都随平台变），也能保证清理时只删到版本库里的文件。
      const path = `${dir}/${node.name}`
      try {
        const content = await readFile(path)
        return { fileName: node.name, path, at: parsed.at, hash: parsed.hash, content }
      } catch {
        return null
      }
    }),
  )

  return entries
    .filter((entry): entry is VersionEntry => entry !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}

/**
 * 清理过期版本，返回真正删掉的数量。
 *
 * 保留策略是「最近 MAX_VERSIONS_PER_ITEM 个」与「MAX_VERSION_AGE_DAYS 天内」的**交集**：
 * 两个条件都满足才留下（索引在前 50 之内，且时间没超过 90 天）。
 * 反过来看也可以理解为「超出前 50 个的」与「超过 90 天的」两批待删项的并集。
 * 为什么不让任一条单独兜底：只按条数留，一本长期断更的书会一直躺着几十条
 * 一年前的版本，磁盘和列表都被占着；只按时间留，一天猛改上百次的书
 * 会把版本目录撑到几千个文件，扫描变慢。取交集能同时压住「量」和「旧」。
 *
 * 删除失败只跳过、继续删下一条：一个文件正被别的程序占用（Windows 上很常见）
 * 不该让整次清理中断，否则后面的过期文件永远等不到清理；但没删掉就不能
 * 计进返回值，否则调用方会以为目录已经变干净。
 */
export async function pruneVersions(
  projectPath: string,
  kind: VersionKind,
  key: number | string | null,
  now: Date = new Date(),
): Promise<number> {
  const entries = await listVersions(projectPath, kind, key)
  const cutoff = now.getTime() - MAX_VERSION_AGE_DAYS * 24 * 60 * 60 * 1000

  let removed = 0
  // entries 已按时间倒序，索引天然就是「从新到旧」的名次。
  for (const [index, entry] of entries.entries()) {
    const keepByCount = index < MAX_VERSIONS_PER_ITEM
    const keepByAge = entry.at.getTime() >= cutoff
    if (keepByCount && keepByAge) continue

    try {
      await deleteFile(entry.path)
      removed += 1
    } catch (error) {
      console.warn("清理历史版本时删除失败，已跳过：", entry.path, error)
    }
  }

  return removed
}

/**
 * 保存一条历史版本。
 *
 * 三种「不写」的情形共用同一个结果 `{ saved: false }`：调用方（保存流程）
 * 只关心有没有产生新版本，不需要区分原因。
 */
export async function saveVersion(input: SaveVersionInput): Promise<SaveVersionOutcome> {
  const { projectPath, kind, key, content } = input
  const at = input.at ?? new Date()

  // 空白内容不落版本：新建章节第一次保存内容往往是空的，
  // 存下来只会让列表里多出一条「点开是空白的」历史，纯属污染。
  if (content.trim() === "") {
    return { saved: false }
  }

  const dir = buildVersionDir(projectPath, kind, key)
  // 复用 listVersions 而不是再写一套扫描：去重 / 合并判断和界面的历史列表
  // 必须看到同一批版本，两套逻辑一旦漂移，就会出现「列表里有但合并看不到」
  // 这种难查的错位。
  const existing = await listVersions(projectPath, kind, key)

  // 内容一模一样就不重复记录：编辑器失焦刷新、手动再按一次保存，
  // 都会以「同样内容、不同时间」的形式重复触发，这里拦掉。
  if (existing.some((version) => version.content === content)) {
    return { saved: false }
  }

  await createDirectory(dir)

  const fileName = buildVersionFileName(at, content)
  const path = `${dir}/${fileName}`
  await writeFile(path, content)

  // 合并：只认「过去的 30 秒内」的版本。`<= at` 这个上界很重要，
  // 否则用户把系统时间往回调（或手工导入旧版本）时，会把将来的版本当成
  // 「刚才那次保存」删掉。
  const windowStart = at.getTime() - MERGE_WINDOW_MS
  const mergeTarget = existing
    .filter((version) => version.at.getTime() >= windowStart && version.at.getTime() <= at.getTime())
    // 多个命中时合并最新的那一个：它就是紧挨着本次保存的上一条记录。
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0]

  if (!mergeTarget) {
    return { saved: true, path }
  }

  const replacedPath = `${dir}/${mergeTarget.fileName}`
  try {
    await deleteFile(replacedPath)
  } catch (error) {
    // 删旧版失败不影响本次保存成功：历史里多留一份只是冗余，
    // 而让保存流程失败会让用户以为正文没存上，代价大得多。
    console.warn("合并历史版本时删除旧版本失败：", replacedPath, error)
    // 没真正删掉就不能声称「已替换」，否则界面会显示一条并不存在的合并。
    return { saved: true, path }
  }

  return { saved: true, path, replaced: mergeTarget.fileName }
}
