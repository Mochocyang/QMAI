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
 * 攻击者读到公钥毫无用处 —— 他算不出私钥签名。
 *
 * ## 私钥存哪
 *
 * 存 localStorage（与账号会话同一层）。之所以不存系统钥匙串：
 * 钥匙串需要额外的 Rust 命令与依赖，而私钥本身**只在签名时用、从不外发**，
 * 即便本机被拿到也能从卡里吊销（重新登录会生成新密钥对）。
 *
 * 密钥是 JWK 形式（含私钥的 d 字段），只在本地读写。
 */

const KEY_STORAGE = "qmai.device.signing.key.v1"

let cached: JsonWebKey | null | undefined

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

function readStored(): JsonWebKey | null {
  if (cached !== undefined) return cached
  if (typeof localStorage === "undefined") {
    cached = null
    return null
  }
  try {
    const raw = localStorage.getItem(KEY_STORAGE)
    if (!raw) {
      cached = null
      return null
    }
    const parsed = JSON.parse(raw) as JsonWebKey
    if (parsed.kty !== "OKP" || parsed.crv !== "Ed25519" || typeof parsed.d !== "string") {
      cached = null
      return null
    }
    cached = parsed
    return parsed
  } catch {
    cached = null
    return null
  }
}

function writeStored(jwk: JsonWebKey): void {
  cached = jwk
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(jwk))
  } catch {
    // 存储不可用：本次会话仍可用（缓存在内存里），重启后会重新生成
  }
}

/**
 * 确保本机有一对签名密钥。
 * @returns 公钥 base64url 与私钥 JWK；环境不支持 Ed25519 时返回 null。
 */
export async function ensureDeviceKey(): Promise<{ publicKey: string; privateKeyJwk: JsonWebKey } | null> {
  const existing = readStored()
  if (existing) {
    const publicKey = publicKeyOf(existing)
    if (publicKey) return { publicKey, privateKeyJwk: existing }
  }

  try {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
    const publicKeyRaw = await crypto.subtle.exportKey("raw", pair.publicKey)
    const publicKey = bytesToBase64Url(new Uint8Array(publicKeyRaw))
    writeStored(privateKeyJwk)
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
  const key = readStored()
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
