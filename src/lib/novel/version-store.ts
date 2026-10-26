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
