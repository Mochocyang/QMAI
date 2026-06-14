/**
 * 拆书 6 维度分析 - 角色名称归一对照表
 *
 * 输入：角色 + 全部 aliases
 * 输出：NameAliasMap（canonical + aliases）
 *
 * 规则：
 *  1. canonical 默认取 character.name
 *  2. 把 character.aliases 合并进去并去重
 *  3. 字符规范化（去除前后空格、合并全/半角问号句号）
 *  4. 长度过滤（< 20 字符才接受，避免把整句话当别名）
 */

import type { NameAliasMap } from "./types"

const MAX_ALIAS_LEN = 20

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, "")
}

function isValidAlias(s: string, canonical: string): boolean {
  if (!s) return false
  if (s === canonical) return false
  if (s.length > MAX_ALIAS_LEN) return false
  if (/^[\s\p{P}]+$/u.test(s)) return false
  return true
}

/**
 * 构造或补全 NameAliasMap
 */
export function buildNameAliasMap(
  name: string,
  aliases: readonly string[]
): NameAliasMap {
  const canonical = normalize(name)
  const merged = new Set<string>([canonical])
  for (const a of aliases) {
    const n = normalize(a)
    if (isValidAlias(n, canonical)) merged.add(n)
  }
  return {
    canonical,
    aliases: Array.from(merged).filter((a) => a !== canonical),
  }
}

/**
 * 给定一段语料 + NameAliasMap，把所有别名替换为规范名
 * 返回替换后的文本
 */
export function applyCanonicalNames(
  text: string,
  aliasMap: NameAliasMap
): string {
  let out = text
  for (const alias of aliasMap.aliases) {
    if (!alias) continue
    out = out.split(alias).join(aliasMap.canonical)
  }
  return out
}

/**
 * 检测一个字符串是否命中别名表（用于过滤只属于该角色的语料）
 */
export function matchesAnyAlias(text: string, aliasMap: NameAliasMap): boolean {
  if (text.includes(aliasMap.canonical)) return true
  for (const alias of aliasMap.aliases) {
    if (text.includes(alias)) return true
  }
  return false
}
