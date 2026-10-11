/**
 * 共享的 changelog 条目解析器。
 *
 * 为什么必须共享：条目有两个来源（已校验的草稿文件、真正发布的 changelog.ts），
 * 两者行尾符不同 —— changelog.ts 是 CRLF，草稿是 LF。
 * 两个脚本各写一份解析、各自漏掉 `\r`，就会出现"一边解析出 14 条、
 * 另一边解析出 0 条"这种看起来像内容不一致、实际是解析器问题的假失败。
 * 我第一版就踩了这个坑（正则 `$` 匹配不到 CRLF 行尾）。
 *
 * 统一在入口处把 `\r\n` 归一成 `\n`，解析逻辑就只有一份。
 */

/** 把 CRLF 归一为 LF。所有解析入口都必须先过这一步。 */
export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n")
}

/**
 * 从 `key: [ ... ],` 块中取出字符串字面量数组。
 * 容忍 CRLF、容忍行尾空白。
 */
export function extractArray(text, key) {
  const src = normalizeNewlines(text)
  const start = src.indexOf(`${key}: [`)
  if (start < 0) throw new Error(`找不到 ${key} 数组`)
  const open = src.indexOf("[", start)
  const close = src.indexOf("\n    ],", open)
  if (close < 0) throw new Error(`${key} 数组没有正常结束`)
  const block = src.slice(open + 1, close)

  const out = []
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trimEnd()
    const match = /^\s*"((?:[^"\\]|\\.)*)",?$/.exec(line)
    if (match) out.push(JSON.parse(`"${match[1]}"`))
  }
  return out
}
