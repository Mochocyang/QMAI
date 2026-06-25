/**
 * API 密钥加密工具（基于设备指纹 + Web Crypto API）
 *
 * 方案A：设备标识绑定
 * - 密钥派生：设备指纹（机器名 + 用户名 + OS）经过 SHA-256 派生
 * - 加密算法：AES-256-GCM（带认证标签，防篡改）
 * - 存储格式：enc::v1::<base64(nonce + ciphertext + tag)>
 */

const ENCRYPTED_PREFIX = "enc::v1::"

// 缓存设备密钥，避免每次都重新派生
let cachedKey: CryptoKey | null = null
let cachedFingerprint: string | null = null

/**
 * 获取设备指纹（从 Rust 后端获取）
 */
export async function getDeviceFingerprint(): Promise<string> {
  if (cachedFingerprint) return cachedFingerprint

  try {
    // @ts-ignore - Tauri 命令
    const fp = await window.__TAURI__?.invoke("get_device_fingerprint_cmd")
    cachedFingerprint = fp as string
    return cachedFingerprint
  } catch (e) {
    console.warn("[crypto] 获取设备指纹失败，使用降级方案:", e)
    // 降级：使用 localStorage 存储一个随机指纹（不绑定设备，但至少加密存储）
    let fallback = localStorage.getItem("qmai_fallback_fingerprint")
    if (!fallback) {
      const buf = new Uint8Array(32)
      crypto.getRandomValues(buf)
      fallback = Array.from(buf, b => b.toString(16).padStart(2, "0")).join("")
      localStorage.setItem("qmai_fallback_fingerprint", fallback)
    }
    cachedFingerprint = fallback
    return fallback
  }
}

/**
 * 从设备指纹派生 AES-256 密钥
 */
async function getDeviceKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey

  const fingerprint = await getDeviceFingerprint()

  // 将指纹 hex 字符串转为字节
  const keyMaterial = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    keyMaterial[i] = parseInt(fingerprint.slice(i * 2, i * 2 + 2), 16)
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )

  cachedKey = key
  return key
}

/**
 * 判断字符串是否是加密格式
 */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX)
}

/**
 * 使用设备密钥加密字符串
 * @param plaintext 明文
 * @returns 加密后的字符串（带前缀）
 */
export async function encryptString(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext
  if (isEncrypted(plaintext)) return plaintext // 已经是加密的，不重复加密

  const key = await getDeviceKey()

  // 生成 12 字节随机 nonce（GCM 推荐）
  const nonce = new Uint8Array(12)
  crypto.getRandomValues(nonce)

  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    encoded,
  )

  // 组合：nonce(12) + ciphertext+tag
  const combined = new Uint8Array(nonce.length + ciphertext.byteLength)
  combined.set(nonce, 0)
  combined.set(new Uint8Array(ciphertext), nonce.length)

  // Base64 编码
  const b64 = btoa(String.fromCharCode(...combined))
  return ENCRYPTED_PREFIX + b64
}

/**
 * 使用设备密钥解密字符串
 * @param ciphertext 加密后的字符串（带前缀）
 * @returns 明文
 */
export async function decryptString(ciphertext: string): Promise<string> {
  if (!ciphertext) return ciphertext
  if (!isEncrypted(ciphertext)) {
    // 未加密的明文，直接返回（向后兼容）
    return ciphertext
  }

  const data = ciphertext.slice(ENCRYPTED_PREFIX.length)
  const binary = Uint8Array.from(atob(data), c => c.charCodeAt(0))

  if (binary.length < 12) {
    throw new Error("密文数据过短")
  }

  const key = await getDeviceKey()
  const nonce = binary.slice(0, 12)
  const cipherData = binary.slice(12)

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    cipherData,
  )

  return new TextDecoder().decode(plaintext)
}

/**
 * 加密 API 密钥（带错误处理，失败则返回原值）
 */
export async function safeEncryptApiKey(plaintext: string): Promise<string> {
  try {
    return await encryptString(plaintext)
  } catch (e) {
    console.warn("[crypto] 加密失败，保留明文:", e)
    return plaintext
  }
}

/**
 * 解密 API 密钥（带错误处理，失败则返回原值）
 */
export async function safeDecryptApiKey(ciphertext: string): Promise<string> {
  try {
    return await decryptString(ciphertext)
  } catch (e) {
    console.warn("[crypto] 解密失败，可能密钥不匹配:", e)
    // 解密失败，可能是换设备了，返回空让用户重新输入
    return ""
  }
}

// ── 对象级递归加解密工具 ──────────────────────────────────────────────

const API_KEY_FIELD_PATTERN = /api[_-]?key/i

/**
 * 递归加密对象中所有 API key 字段
 * 匹配字段名：apiKey, api_key, api-key, API_KEY 等
 */
export async function encryptApiKeysInObject<T = unknown>(obj: T): Promise<T> {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") return obj
  if (typeof obj !== "object") return obj

  // 数组
  if (Array.isArray(obj)) {
    const results = await Promise.all(obj.map(item => encryptApiKeysInObject(item)))
    return results as unknown as T
  }

  // 普通对象
  const result: Record<string, unknown> = { ...(obj as Record<string, unknown>) }
  for (const [key, value] of Object.entries(result)) {
    if (API_KEY_FIELD_PATTERN.test(key) && typeof value === "string" && value) {
      result[key] = await safeEncryptApiKey(value)
    } else if (typeof value === "object" && value !== null) {
      result[key] = await encryptApiKeysInObject(value)
    }
  }
  return result as T
}

/**
 * 递归解密对象中所有 API key 字段
 */
export async function decryptApiKeysInObject<T = unknown>(obj: T): Promise<T> {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") return obj
  if (typeof obj !== "object") return obj

  // 数组
  if (Array.isArray(obj)) {
    const results = await Promise.all(obj.map(item => decryptApiKeysInObject(item)))
    return results as unknown as T
  }

  // 普通对象
  const result: Record<string, unknown> = { ...(obj as Record<string, unknown>) }
  for (const [key, value] of Object.entries(result)) {
    if (API_KEY_FIELD_PATTERN.test(key) && typeof value === "string" && value) {
      result[key] = await safeDecryptApiKey(value)
    } else if (typeof value === "object" && value !== null) {
      result[key] = await decryptApiKeysInObject(value)
    }
  }
  return result as T
}

// ── 加密状态统计与迁移 ────────────────────────────────────────────────

/**
 * 统计对象中有多少 API key 字段是明文/已加密的
 */
export function countApiKeyStatus(obj: unknown): { total: number; encrypted: number; plaintext: number } {
  let total = 0
  let encrypted = 0
  let plaintext = 0

  function walk(value: unknown) {
    if (value === null || value === undefined) return
    if (typeof value === "string") return
    if (typeof value !== "object") return

    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }

    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (API_KEY_FIELD_PATTERN.test(key) && typeof val === "string") {
        if (val) {
          total++
          if (isEncrypted(val)) {
            encrypted++
          } else {
            plaintext++
          }
        }
      } else if (typeof val === "object" && val !== null) {
        walk(val)
      }
    }
  }

  walk(obj)
  return { total, encrypted, plaintext }
}
