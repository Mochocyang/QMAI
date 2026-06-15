// content-fingerprint.ts
/**
 * 内容指纹模块（feature/book-analysis-reuse）
 * 用 64-bit FNV-1a 哈希文本或文件采样，避开 Node crypto（浏览器不可用）
 */

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const SAMPLE_BYTES = 1024 * 1024 // 1MB

function fnv1a64(input: string | Uint8Array): bigint {
  let hash = FNV_OFFSET
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i])
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn
  }
  return hash
}

function toHex16(value: bigint): string {
  return value.toString(16).padStart(16, "0")
}

export function fingerprintText(text: string): string {
  return toHex16(fnv1a64(text))
}

export function fingerprintFileSample(content: string, sampleBytes: number = SAMPLE_BYTES): string {
  const size = content.length
  const head = content.slice(0, sampleBytes)
  const tail = size > sampleBytes ? content.slice(-sampleBytes) : ""
  // 组合：size | head | tail，避免大文件改中间不触发
  return toHex16(fnv1a64(`${size}|${head}|${tail}`))
}
