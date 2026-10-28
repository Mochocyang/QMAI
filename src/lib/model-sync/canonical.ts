/**
 * 稳定的 JSON 序列化：对象键递归排序。
 *
 * 用途有两个，缺一不可：
 * 1) 内容指纹：同一份配置不管键序如何，算出来的哈希必须一致；
 * 2) 合并比较：判断「同一 provider 两边内容是否相同」。
 */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/**
 * 内容指纹（64 位 FNV-1a，输出 16 位十六进制）。
 *
 * ⚠️ 这里**只用来判断内容有没有变**，不能当安全哈希用——市面上任何 API Key
 * 都很短时，哈希本身也会泄一点信息，所以它只存在本机的同步状态里，用于比快照。
 * 用同步实现（不是 crypto.subtle）是因为 `buildLocalEntries` 是同步调用。
 */
export function fingerprint(text: string): string {
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193)
}

function fnv1a(text: string, basis: number): string {
  let hash = basis >>> 0
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    // hash *= 16777619（用移位避免浮点精度问题）
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/** 判断一个值是不是我们写进去的指纹（用于清洗历史版本留下的完整 JSON 快照）。 */
export function isFingerprint(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      // undefined 在 JSON 里会被丢掉，这里显式跳过，避免 "{}" 与 "{}" 不等。
      if (source[key] === undefined) continue
      sorted[key] = canonicalize(source[key])
    }
    return sorted
  }
  return value
}
