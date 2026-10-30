/**
 * 中转票据签发：`POST /v1/relay/token`
 *
 * 把「账号登录态」换成一张给自建中转站用的 30 分钟票据。
 *
 * 为什么单独一套密钥而不复用账号的 HS256 accessToken：
 * - HS256 是对称的，密钥既要签又要验。把同一把密钥给到中转站，等于把
 *   「能伪造任何用户登录态」的能力交出去，中转被入侵就全线沦陷。
 * - Ed25519 是非对称的：本 Worker 持私钥签发，中转站只持公钥验签，无法反向伪造。
 *
 * 票据是**短期**的（30 分钟），且不携带 email 等业务信息 —— 中转站只需要知道「这是谁」。
 *
 * 责任边界：本接口只证明「你是谁」（签发），不判断「你能不能使用中转」——
 * 那个名单在中转站的 `ALLOWED_USER_IDS` 里，改名单不用重新部署本 Worker。
 */

import { authenticate } from "./auth"
import { jsonSuccess, failure } from "./http"
import type { Env } from "./types"

export const RELAY_TOKEN_TTL_SECONDS = 30 * 60
const RELAY_JWT_ISSUER = "qmai-account"

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlEncodeString(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

/** 私钥以 PKCS#8 base64 存放（wrangler secret put 传文本最方便，Node 一条命令即可生成）。 */
function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "")
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface SignedRelayToken {
  token: string
  expiresAt: number
}

/** 签一张给中转站用的票据。缺私钥时抛错，由调用方转成 503 —— 绝不下发无效票据。 */
export async function signRelayToken(
  env: Env,
  userId: number,
  nowSeconds: number,
): Promise<SignedRelayToken> {
  const privateKeyPkcs8 = env.RELAY_JWT_PRIVATE_KEY
  if (!privateKeyPkcs8) throw new Error("RELAY_JWT_PRIVATE_KEY is not configured")

  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKeyPkcs8),
    { name: "Ed25519" },
    false,
    ["sign"],
  )

  const header = { alg: "EdDSA", typ: "JWT" }
  const claims = {
    iss: RELAY_JWT_ISSUER,
    sub: String(userId),
    iat: nowSeconds,
    exp: nowSeconds + RELAY_TOKEN_TTL_SECONDS,
  }

  const data = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(claims))}`
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(data))

  return { token: `${data}.${bytesToBase64Url(new Uint8Array(signature))}`, expiresAt: claims.exp }
}

/** `POST /v1/relay/token`：需要有效的账号登录态。 */
export async function handleRelayToken(
  request: Request,
  env: Env,
  now: number,
): Promise<Response> {
  const auth = await authenticate(request, env, now)
  if (!auth.ok) return auth.response

  let signed: SignedRelayToken
  try {
    signed = await signRelayToken(env, auth.user.id, now)
  } catch {
    // 缺私钥或密钥损坏一律关闭服务，绝不下发无效票据让客户端误以为能用。
    return failure("SERVER_ERROR", "中转服务尚未配置，请联系管理员。")
  }

  return jsonSuccess({ token: signed.token, expiresAt: signed.expiresAt })
}
