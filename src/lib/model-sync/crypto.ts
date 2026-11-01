/**
 * 模型配置同步的加密层（端到端加密，服务端零知识）。
 *
 * 约定：
 * - 密钥由「同步密码」派生（PBKDF2-SHA256 + 随机盐），与登录密码无关；
 *   账号支持邮箱验证码登录，那时根本没有密码可用于解密，所以同步密码必须独立。
 * - 载荷用 AES-256-GCM 加密，AAD 固定为 qmai:model-config:v1，防止跨用途复用密文。
 * - 服务端只拿到 { v, kdf, iter, salt, iv, ct }，看不到任何明文字段。
 *
 * 代价要说清：忘记同步密码 = 云端密文永久解不开。产品侧必须提供
 * 「用旧密码重设」与「清空云端重新上传」两条出路，不能静默覆盖。
 */

export const SYNC_ENVELOPE_VERSION = 2
export const SYNC_KDF = "pbkdf2-sha256"
/** 压缩算法标记。信封里带它就说明 ct 是「压缩后再加密」的。 */
export const SYNC_ZIP = "deflate-raw"
/** 60 万次：WebView2 上约 200–400ms，只在「解锁」时算一次。 */
export const DEFAULT_KDF_ITERATIONS = 600_000
export const MIN_KDF_ITERATIONS = 1_000

const SALT_BYTES = 16
const IV_BYTES = 12
const AAD = "qmai:model-config:v1"

/** 上传给服务端的信封（服务端只做形状校验）。 */
export interface ModelConfigEnvelope {
  v: number
  kdf: string
  iter: number
  salt: string
  iv: string
  ct: string
  /**
   * 压缩标记：存在表示「明文先 deflate-raw 压缩，再 AES-GCM」。
   *
   * 为什么必须压缩：载荷是整份模型配置（含每个 provider 的 savedModels），
   * 明文 JSON 直接加密再 base64 会膨胀 ~33%，重配置轻松逼近原来的 60 000 字符
   * 上限。JSON 的压缩比通常 6–10×，压完再加密，同样的配置只占 1/8。
   *
   * v1 的旧记录没有这个字段，解密时按「未压缩」处理 —— 向后兼容。
   */
  zip?: string
}

/** 同步密码不对 / 密文被篡改：两者在 GCM 校验里无法区分，文案合并处理。 */
export class SyncPasswordError extends Error {
  constructor(message = "同步密码不正确，或云端配置已损坏。") {
    super(message)
    this.name = "SyncPasswordError"
  }
}

/** 环境是否支持 Compression Streams（Node 18+ / Chromium 均有）。 */
function hasCompressionStreams(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined"
}

/**
 * deflate-raw 压缩。不支持或失败时返回 null，调用方退回「不压缩」，
 * 这样旧环境仍然可用，只是密文更大。
 */
async function compressBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!hasCompressionStreams()) return null
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(SYNC_ZIP as CompressionFormat))
    const packed = await new Response(stream).arrayBuffer()
    return new Uint8Array(packed)
  } catch {
    return null
  }
}

/** 解压；失败按「配置损坏」处理（与密码错误的文案区分开）。 */
async function decompressBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!hasCompressionStreams()) {
    throw new SyncPasswordError("当前环境不支持解压云端配置，请升级客户端后再试。")
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(SYNC_ZIP as CompressionFormat))
    const plain = await new Response(stream).arrayBuffer()
    return new Uint8Array(plain)
  } catch {
    throw new SyncPasswordError("云端配置无法解压，可能已损坏，请重新上传一次。")
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** 解码出 Uint8Array<ArrayBuffer>：WebCrypto 的 BufferSource 参数不接受 ArrayBufferLike。 */
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * UTF-8 编码成 Uint8Array<ArrayBuffer>。
 * 直接写 new TextEncoder().encode() 得到的是 Uint8Array<ArrayBufferLike>，
 * 在 WebCrypto 的 BufferSource 参数上会类型不匹配，这里统一走一次拷贝。
 */
function utf8(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text)
  const copy = new Uint8Array(new ArrayBuffer(encoded.length))
  copy.set(encoded)
  return copy
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/** 生成新的随机盐（base64），随信封一起上传 —— 盐不是秘密。 */
export function createSyncSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))
}

async function deriveSyncKey(
  password: string,
  saltBase64: string,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, [
    "deriveKey",
  ])
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(saltBase64), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

/**
 * 加密模型配置，返回可直接上传的信封 JSON 字符串。
 *
 * @param plaintext 待加密的配置 JSON（由调用方序列化，建议用 canonicalJson）
 * @param password 同步密码
 * @param options.salt 复用已有盐（同一密码重加密时用，避免每次换盐）
 * @param options.iterations 测试时可传小值加速；生产一律用默认值
 */
export async function encryptModelConfig(
  plaintext: string,
  password: string,
  options: { salt?: string; iterations?: number; compress?: boolean } = {},
): Promise<string> {
  const iterations = Math.max(
    MIN_KDF_ITERATIONS,
    Math.floor(options.iterations ?? DEFAULT_KDF_ITERATIONS),
  )
  const salt = options.salt ?? createSyncSalt()
  const key = await deriveSyncKey(password, salt, iterations)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  // 先压缩再加密：JSON 压缩比通常 6–10×，直接决定密文能不能塞进服务端上限。
  const compressed = options.compress === false ? null : await compressBytes(utf8(plaintext))
  const body = compressed ?? utf8(plaintext)
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8(AAD) },
    key,
    body,
  )

  const envelope: ModelConfigEnvelope = {
    v: SYNC_ENVELOPE_VERSION,
    kdf: SYNC_KDF,
    iter: iterations,
    salt,
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(cipher)),
    // 只有真的压缩成功才标 zip：旧环境降级时保持 envelope 与 v1 同形。
    ...(compressed ? { zip: SYNC_ZIP } : {}),
  }
  return JSON.stringify(envelope)
}

function readEnvelope(raw: string): ModelConfigEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SyncPasswordError("云端配置格式无法识别，请重新上传一次。")
  }
  const record = parsed as Partial<ModelConfigEnvelope> | null
  if (
    !record ||
    typeof record.salt !== "string" ||
    typeof record.iv !== "string" ||
    typeof record.ct !== "string" ||
    typeof record.iter !== "number" ||
    !Number.isFinite(record.iter) ||
    record.iter < MIN_KDF_ITERATIONS
  ) {
    throw new SyncPasswordError("云端配置格式无法识别，请重新上传一次。")
  }
  return record as ModelConfigEnvelope
}

/** 解密云端信封，返回原始配置 JSON 字符串；密码不对会抛 SyncPasswordError。 */
export async function decryptModelConfig(envelope: string, password: string): Promise<string> {
  const record = readEnvelope(envelope)
  const key = await deriveSyncKey(password, record.salt, Math.floor(record.iter))

  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(record.iv), additionalData: utf8(AAD) },
      key,
      fromBase64(record.ct),
    )
  } catch {
    // GCM 的认证标签校验失败：密码错或密文被篡改，二者无法区分。
    throw new SyncPasswordError()
  }

  const bytes = new Uint8Array(plain)
  // v1 记录没有 zip → 未压缩，直接按 UTF-8 解。
  if (record.zip !== SYNC_ZIP) return new TextDecoder().decode(bytes)
  return new TextDecoder().decode(await decompressBytes(bytes))
}

/** 内容指纹：判断「本地与云端是否完全一致」，一致就静默通过、不打扰用户。 */
export async function fingerprintModelConfig(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(plaintext))
  return toHex(digest)
}
