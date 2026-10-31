/**
 * 网关卡（net card）：与账号绑定的**长期** EdDSA 凭证，供自建中转站验签。
 *
 * ## 为什么不是"票据"
 *
 * 之前的设计是「30 分钟票据」：每次过期，客户端要重新换一张。用户登录后不会主动
 * 打开设置页，于是写着写着就 401 —— 这是把**认证状态**当**配置数据**在同步，天生脆。
 *
 * 网关卡换了个模型：
 *   - 它与 `sessions` 表里的一行绑定，**是身份，不是通行证**；
 *   - 没有短过期时间 —— 只要账号存在且这张卡未被吊销，就永久可用；
 *   - 吊销是主动的（改密 / 封号 / 退出所有设备），不是等它自然过期。
 *
 * ## 为什么用 EdDSA 而不是复用 accessToken 的 HS256
 *
 * HS256 是对称的：网关要验签就得持有签名密钥，等于把「伪造任何用户登录态」的能力
 * 交出去。EdDSA 只用公钥验签，网关被攻破也伪造不出任何人的卡。
 *
 * ## claims 说明
 *
 * | 字段 | 含义 |
 * |---|---|
 * | iss | 固定 `qmai-account` |
 * | sub | 用户 id |
 * | sid | sessions 表里的会话 id —— 网关据此查吊销状态 |
 * | iat | 签发时间 |
 * | exp | 很远的将来（10 年），只是形式上的上限 |
 *
 * 真正的失效靠 `sid` + 吊销名单，不靠 exp。
 */

import { jsonSuccess } from "./http"
import type { Env } from "./types"

const NET_CARD_ISSUER = "qmai-account"
/** 形式上给一个远期上限（10 年）。它不是"有效期机制"，只是防止 token 永久无界。 */
const NET_CARD_EXP_SECONDS = 10 * 365 * 24 * 60 * 60

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlEncodeString(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "")
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface NetCardClaims {
  iss: string
  /** 用户 id（字符串形式，JWT 惯例）。 */
  sub: string
  /** sessions 表里的会话 id —— 网关用它对吊销。 */
  sid: string
  /**
   * 设备指纹摘要（32 位十六进制）。
   *
   * 网关校验时必须与请求头 X-Device-Id 一致，否则 403。
   * 这样卡被复制到别的机器就立刻失效 —— 反代理、抄卡、扒包都挡在这一层。
   * 老卡没有这个字段，网关按「首次校验时补绑」处理（见 gateway 的 auth.ts）。
   */
  dev?: string
  iat: number
  exp: number
}

/**
 * 签一张网关卡。
 *
 * 私钥放在 secret `NETCARD_PRIVATE_KEY`（Ed25519，PKCS#8 base64）。
 * 与 `RELAY_JWT_PRIVATE_KEY` 分开是刻意的：换密钥、分权限时互不影响。
 */
export async function signNetCard(
  env: Env,
  userId: number,
  sessionId: string,
  nowSeconds: number,
  /** 设备指纹摘要；有值时写进卡里做设备绑定。 */
  deviceHash?: string | null,
): Promise<{ token: string; issuedAt: number }> {
  const privateKeyPkcs8 = env.NETCARD_PRIVATE_KEY
  if (!privateKeyPkcs8) throw new Error("NETCARD_PRIVATE_KEY is not configured")

  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKeyPkcs8),
    { name: "Ed25519" },
    false,
    ["sign"],
  )

  const header = { alg: "EdDSA", typ: "JWT" }
  const claims: NetCardClaims = {
    iss: NET_CARD_ISSUER,
    sub: String(userId),
    sid: sessionId,
    iat: nowSeconds,
    exp: nowSeconds + NET_CARD_EXP_SECONDS,
    // 只在格式正确时写入，避免把脏数据签进卡里（签出去就收不回）。
    ...(deviceHash && /^[0-9a-f]{32}$/.test(deviceHash) ? { dev: deviceHash } : {}),
  }

  const data = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(claims))}`
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(data))

  return { token: `${data}.${bytesToBase64Url(new Uint8Array(signature))}`, issuedAt: nowSeconds }
}

/**
 * `POST /v1/netcard`：用当前登录态换一张网关卡。
 *
 * 为什么需要这个接口：老用户升级到新版本时，本地没有卡；重新登录又太重。
 * 拿着有效的 accessToken 来换一次即可 —— 换完之后**永久不用再换**。
 *
 * 注意：这不是"续期接口"。它签发的是与当前 session 绑定的长期卡，
 * 同一个 session 重复调用得到的是**内容相同（除了 iat）**的卡。
 */
export async function issueNetCardForSession(
  env: Env,
  userId: number,
  sessionId: string,
  nowSeconds: number,
): Promise<Response> {
  try {
    const { token } = await signNetCard(env, userId, sessionId, nowSeconds)
    return jsonSuccess({ netcard: token })
  } catch {
    // 缺私钥或密钥损坏：失败关闭，绝不下发无效卡。
    return jsonSuccess({ netcard: null })
  }
}

/** 供其它模块复用：读取客户端地址时用到。 */
export const NETCARD_SIGNED_KEY_ENV = "NETCARD_PRIVATE_KEY" as const
