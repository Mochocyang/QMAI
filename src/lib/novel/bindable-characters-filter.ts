import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

/** 每个作品独立保存的「可绑定角色忽略表」文件名，落在 <项目>/.qmai/ 下 */
export const BINDABLE_IGNORE_FILE = "bindable-characters-ignore.json"

/** 转义正则元字符，避免实体名里的特殊字符破坏规则 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 整词即非角色名的强特征（只有完全相等才算命中） */
const EXACT_NON_CHARACTER_NAMES = ["用途说明", "关键任务卡", "一句话总结", "冲突点", "当前状态"]

/** 结尾即非角色名的强特征（正常人名不会以此结尾） */
const NON_CHARACTER_NAME_SUFFIXES = [
  "通用手段",
  "执行群",
  "坏路径",
  "总览",
  "关系图",
  "当前状态",
  "进度",
]

/**
 * 内置强特征规则：只收录「不可能是真人名」的词形，
 * 宁缺毋滥——误杀真实角色比漏过滤更严重。
 */
export const NON_CHARACTER_NAME_PATTERNS: readonly RegExp[] = [
  ...EXACT_NON_CHARACTER_NAMES.map((name) => new RegExp(`^${escapeRegExp(name)}$`)),
  ...NON_CHARACTER_NAME_SUFFIXES.map((suffix) => new RegExp(`${escapeRegExp(suffix)}$`)),
]

/** 判断一个名字是否命中内置强特征规则；空字符串一律返回 false */
export function isLikelyNonCharacterName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return NON_CHARACTER_NAME_PATTERNS.some((pattern) => pattern.test(trimmed))
}

/** 忽略表落盘路径：<项目>/.qmai/bindable-characters-ignore.json */
export function bindableIgnoreListPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/${BINDABLE_IGNORE_FILE}`
}

/** 清洗原始数组：只保留非空字符串、trim、去重并保序 */
function sanitizeIgnoreList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const name = item.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

/** 读取忽略表；文件缺失、JSON 损坏或结构不对时一律返回空表 */
export async function readBindableIgnoreList(projectPath: string): Promise<string[]> {
  try {
    return sanitizeIgnoreList(JSON.parse(await readFile(bindableIgnoreListPath(projectPath))))
  } catch {
    return []
  }
}

async function saveBindableIgnoreList(projectPath: string, list: string[]): Promise<void> {
  await createDirectory(`${normalizePath(projectPath)}/.qmai`)
  await writeFileAtomic(bindableIgnoreListPath(projectPath), JSON.stringify(list, null, 2))
}

/** 追加一个忽略项（幂等，已存在则不重复写入），返回写入后的完整列表 */
export async function addBindableIgnore(projectPath: string, name: string): Promise<string[]> {
  const list = await readBindableIgnoreList(projectPath)
  const trimmed = name.trim()
  if (trimmed && !list.includes(trimmed)) list.push(trimmed)
  await saveBindableIgnoreList(projectPath, list)
  return list
}

/** 删除一个忽略项（按 trim 后比较，不存在则是空操作），返回删除后的完整列表 */
export async function removeBindableIgnore(projectPath: string, name: string): Promise<string[]> {
  const list = await readBindableIgnoreList(projectPath)
  const trimmed = name.trim()
  const next = list.filter((item) => item !== trimmed)
  await saveBindableIgnoreList(projectPath, next)
  return next
}

/**
 * 过滤候选角色名：命中内置规则或忽略表的名字会被丢弃，
 * 保序去重（同一个身份只保留第一次出现的写法）。
 *
 * `alwaysKeep` 是安全阀：已经绑定过角色灵魂的名字必须始终保留，
 * 否则已绑定的角色会从选择器里悄悄消失。
 */
export function filterBindableCharacters(
  names: readonly string[],
  ignoreList: readonly string[],
  alwaysKeep?: Iterable<string>,
): string[] {
  const ignored = new Set(ignoreList.map((name) => name.trim()).filter(Boolean))
  const protectedNames = new Set<string>()
  if (alwaysKeep) {
    for (const name of alwaysKeep) {
      const trimmed = name.trim()
      if (trimmed) protectedNames.add(trimmed)
    }
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    if (!protectedNames.has(name) && (ignored.has(name) || isLikelyNonCharacterName(name))) continue
    result.push(name)
  }
  return result
}
