/**
 * 设备签名密钥（客户端侧）：Ed25519 密钥对，用来给每个请求签名。
 *
 * ## 为什么需要
 *
 * 只有 `X-Device-Id` 时，攻击者拿到别人的卡，读出卡里明文 `dev`，把请求头填成那个值就能过。
 *
 * 现在的方案：
 *   - 客户端生成 Ed25519 密钥对
 *   - **公钥**上报给账号服务 → 签进网关卡（`dpk`）
 *   - **私钥**只留在本机
 *   - 每次请求用私钥签名，网关用卡里的公钥验签
 *
 * ## 私钥存哪（2026-11-03 起改为系统加密仓库）
 *
 * 此前明文存 localStorage，注释里的理由是「钥匙串需要额外的 Rust 命令与依赖」。
 * 那句话当时就不成立了（`secret_store.rs` 早就在用 DPAPI），而且留下了实质缺口：
 * 网关卡（10 年）与签名私钥**同在一处明文介质**，读到卡的进程必然同时读到私钥，
 * 于是它能合法地算出任何请求的签名 —— 「网关卡被抄走也用不了」的设计前提被
 * 自己的存储方式推翻了。
 *
 * 现在私钥走 DPAPI，与卡分开两个介质：拷走 WebView 数据目录只能拿到卡，
 * 拿不到签名能力。密钥是 JWK 形式（含私钥的 d 字段），只在本地读写。
 *
 * 边界同 session-store：DPAPI 防「文件被复制走」，不防同一 Windows 用户下
 * 的恶意进程（那种进程可以直接调 DPAPI 解密）。
 */

import { isTauri } from "@/lib/platform"

const KEY_STORAGE = "qmai.device.signing.key.v1"
/** 系统加密仓库里的键名。 */
const KEY_SECRET_NAME = "device-signing-key"

let cached: JsonWebKey | null | undefined

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import("@tauri-apps/api/core")
  return call<T>(command, args)
}

function isValidJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== "object") return false
  const jwk = value as JsonWebKey
  return jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.d === "string"
}

function parseJwk(raw: string | null): JsonWebKey | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isValidJwk(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 读私钥。Tauri 走 DPAPI；升级时把旧的明文 localStorage 搬过去再删掉。
 *
 * 迁移是「读一次、写一次、删一次」：失败也不抛，最坏结果是本次重新生成
 * 一对新密钥（重新登录时公钥会跟着更新，不影响功能）。
 */
async function readStored(): Promise<JsonWebKey | null> {
  if (cached !== undefined) return cached

  if (isTauri()) {
    try {
      const fromSecret = parseJwk(await invoke<string | null>("secret_get", { name: KEY_SECRET_NAME }))
      if (fromSecret) {
        cached = fromSecret
        return fromSecret
      }
      // 升级迁移：旧版本把私钥明文放在 localStorage。
      const legacy = parseJwk(readLegacyKey())
      if (legacy) {
        await invoke("secret_set", { name: KEY_SECRET_NAME, value: JSON.stringify(legacy) })
        removeLegacyKey()
        cached = legacy
        return legacy
      }
    } catch {
      // 仓库不可用：当作没有密钥（调用方会重新生成）。
    }
    cached = null
    return null
  }

  // 非 Tauri（浏览器预览 / 测试）：没有系统加密仓库可用。
  const legacy = parseJwk(readLegacyKey())
  cached = legacy
  return legacy
}

function readLegacyKey(): string | null {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(KEY_STORAGE)
  } catch {
    return null
  }
}

function removeLegacyKey(): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(KEY_STORAGE)
  } catch {
    // ignore
  }
}

async function writeStored(jwk: JsonWebKey): Promise<void> {
  cached = jwk
  if (isTauri()) {
    try {
      await invoke("secret_set", { name: KEY_SECRET_NAME, value: JSON.stringify(jwk) })
    } catch {
      // 存储不可用：本次会话仍可用（缓存在内存里），重启后会重新生成。
    }
    return
  }
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(jwk))
  } catch {
    // 同上。
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 从 JWK 取公钥的 base64url（32 字节 x 坐标）。 */
function publicKeyOf(jwk: JsonWebKey): string | null {
  if (typeof jwk.x !== "string" || !jwk.x) return null
  // WebCrypto 导出的 x 已经是 base64url（无 padding）
  return jwk.x.length === 43 ? jwk.x : null
}

/**
 * 确保本机有一对签名密钥。
 * @returns 公钥 base64url 与私钥 JWK；环境不支持 Ed25519 时返回 null。
 */
export async function ensureDeviceKey(): Promise<{ publicKey: string; privateKeyJwk: JsonWebKey } | null> {
  const existing = await readStored()
  if (existing) {
    const publicKey = publicKeyOf(existing)
    if (publicKey) return { publicKey, privateKeyJwk: existing }
  }

  try {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
    const publicKeyRaw = await crypto.subtle.exportKey("raw", pair.publicKey)
    const publicKey = bytesToBase64Url(new Uint8Array(publicKeyRaw))
    await writeStored(privateKeyJwk)
    return { publicKey, privateKeyJwk }
  } catch (error) {
    console.warn("[device] 生成签名密钥失败（环境可能不支持 Ed25519）：", error)
    return null
  }
}

/**
 * 给请求算签名。
 *
 * 规范串必须与网关一致：`method\npath\nts\nsha256(body)`。
 * 拿不到密钥时返回 null —— 网关在观察期会放行，强制期会 403。
 */
export async function signRequestHeaders(
  method: string,
  path: string,
  body: string,
): Promise<Record<string, string> | null> {
  const key = await readStored()
  if (!key) return null

  try {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const bodyHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))
    const bodyHash = [...new Uint8Array(bodyHashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("")
    const payload = `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`

    const privateKey = await crypto.subtle.importKey("jwk", key, { name: "Ed25519" }, false, ["sign"])
    const signature = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(payload))
    return {
      "X-Request-Ts": timestamp,
      "X-Request-Sig": bytesToBase64Url(new Uint8Array(signature)),
    }
  } catch {
    return null
  }
}

/** 测试用：清空缓存与存储。 */
export function resetDeviceKey(): void {
  cached = undefined
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(KEY_STORAGE)
    } catch {
      // ignore
    }
  }
}

export { base64UrlToBytes }
