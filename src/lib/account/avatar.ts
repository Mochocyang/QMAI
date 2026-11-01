/**
 * 头像图片处理：把用户选中的任意图片压成 512×512 的正方形 WebP。
 *
 * 服务端只接受 ≤64 KB 的 PNG/JPEG/WebP，这里先用 canvas 居中裁方，
 * 再按质量档位逐档下降，直到体积 ≤ 20 KB。头像在界面里最大只显示 44px
 * （.account-avatar-lg），512px 已远超 2x 屏所需，因此压小尺寸比保留像素更有价值：
 * 单张头像压到十几 KB，D1 里 BLOB 存储才不会随用户数线性膨胀。
 */

/** 头像边长（像素）。UI 最大显示 44px，512px 覆盖 2x/3x 屏仍有余量。 */
export const AVATAR_SIZE = 512

/**
 * 本机压缩的目标体积：压到 20 KB 以内即停止降质。
 *
 * 与服务端 MAX_AVATAR_BYTES（64 KB）分开：目标是「尽量小」，上限是「绝对不能超」。
 * 分两层是为了兼容旧客户端——它们没有这段逐档逻辑，仍按 256×256/0.85 上传
 * （通常 10–30 KB，复杂照片偶有超过 32 KB），服务端若不是 64 KB 就会让它们换头像失败。
 */
export const AVATAR_TARGET_BYTES = 20 * 1024

/**
 * 与服务端 MAX_AVATAR_BYTES 保持一致（64 KB）。
 *
 * 这个值在本机只做「编码结果明显异常」的兜底判定；正常路径靠 AVATAR_TARGET_BYTES
 * 把体积压到 20 KB 以内，根本到不了这里。
 */
export const MAX_AVATAR_BYTES = 64 * 1024

/**
 * 质量档位：从高到低尝试，命中 AVATAR_TARGET_BYTES 就停。
 *
 * 0.82 起手（人像目视无差），最差退到 0.5——头像最终只显示 44px，
 * 0.5 在这个尺寸上依然清晰，换来的是存储体积数量级的下降。
 */
const AVATAR_QUALITY_STEPS = [0.82, 0.72, 0.62, 0.5] as const

export class AvatarProcessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AvatarProcessError"
  }
}

/**
 * 把图片解码成可绘制源。
 *
 * 不用 `<img>` + blob:/data: URL：应用 CSP 的 `img-src` 不含这两个协议，
 * 图片会被静默拦掉（onerror），换头像 100% 失败；也不为了头像去放宽全局 CSP。
 * `createImageBitmap(Blob)` 由解码器直接处理字节，不受 `img-src` 约束。
 */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file)
    } catch {
      // 少数格式（如渐进式 JPEG）解码失败时再走图片元素兜底。
    }
  }
  return loadImageElement(await readAsDataUrl(file))
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === "string" && result.startsWith("data:")) {
        resolve(result)
      } else {
        reject(new AvatarProcessError("无法读取这张图片，请换一张试试。"))
      }
    }
    reader.onerror = () => reject(new AvatarProcessError("无法读取这张图片，请换一张试试。"))
    reader.onabort = () => reject(new AvatarProcessError("无法读取这张图片，请换一张试试。"))
    reader.readAsDataURL(file)
  })
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new AvatarProcessError("无法读取这张图片，请换一张试试。"))
    image.src = dataUrl
  })
}

/** 统一取出源图尺寸，兼容 ImageBitmap 与 HTMLImageElement。 */
function sourceSize(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  // 不用 instanceof：测试环境与跨 realm 下 HTMLImageElement 判断并不可靠，
  // 按 ImageBitmap 的独有字段判断更稳。
  const bitmap = source as ImageBitmap
  if (typeof bitmap.close === "function") {
    return { width: source.width, height: source.height }
  }
  const image = source as HTMLImageElement
  return { width: image.naturalWidth, height: image.naturalHeight }
}

function isImageBitmap(source: ImageBitmap | HTMLImageElement): source is ImageBitmap {
  return typeof (source as ImageBitmap).close === "function"
}

export interface ProcessedAvatar {
  data: ArrayBuffer
  mime: string
  /** 便于单测与界面上显示体积。 */
  bytes: number
}

/**
 * 把图片裁成居中的正方形，并按质量档位压到目标体积以内。
 * 浏览器不支持 WebP 编码时回退 JPEG（canvas.toBlob 返回 null 或类型不符）。
 */
export async function processAvatarImage(file: File): Promise<ProcessedAvatar> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarProcessError("请选择图片文件。")
  }

  const image = await decodeImage(file)
  const { width, height } = sourceSize(image)
  const side = Math.min(width, height)
  if (!Number.isFinite(side) || side <= 0) {
    throw new AvatarProcessError("无法读取这张图片，请换一张试试。")
  }

  const canvas = document.createElement("canvas")
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext("2d")
  if (!context) throw new AvatarProcessError("当前环境无法处理图片。")

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"

  // 居中裁出正方形区域再缩放，避免人像被拉伸。
  const sourceX = (width - side) / 2
  const sourceY = (height - side) / 2
  context.drawImage(
    image as CanvasImageSource,
    sourceX,
    sourceY,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  )

  // ImageBitmap 占显存，用完主动释放。
  if (isImageBitmap(image)) image.close()

  const blob = await encode(canvas)

  if (blob.size > MAX_AVATAR_BYTES) {
    throw new AvatarProcessError("图片压缩后仍然过大，请换一张更简单的图片。")
  }

  return {
    data: await blob.arrayBuffer(),
    mime: blob.type,
    bytes: blob.size,
  }
}

/** toBlob 在少数 WebView 下回调可能永不触发，超时后走同步兜底。 */
const TO_BLOB_TIMEOUT_MS = 5000

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (blob: Blob | null) => {
      if (settled) return
      settled = true
      resolve(blob)
    }

    const timer = setTimeout(() => finish(null), TO_BLOB_TIMEOUT_MS)

    try {
      canvas.toBlob((blob) => {
        clearTimeout(timer)
        finish(blob)
      }, mime, quality)
    } catch {
      clearTimeout(timer)
      finish(null)
    }
  })
}

/** 同步兜底：toDataURL 在所有环境都可用，即使编码质量略差也能出图。 */
function fromDataUrl(canvas: HTMLCanvasElement, mime: string, quality: number): Blob | null {
  try {
    const url = canvas.toDataURL(mime, quality)
    const comma = url.indexOf(",")
    if (comma < 0) return null

    const header = url.slice(0, comma)
    const base64 = url.slice(comma + 1)
    // toDataURL 在编码失败时会静默回退成 image/png，这里按真实头部判定。
    const actualMime = /^data:([^;]+)/.exec(header)?.[1] ?? ""
    if (!actualMime.startsWith("image/")) return null

    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: actualMime })
  } catch {
    return null
  }
}

/**
 * 按质量档位逐档压缩，命中目标体积即停。
 *
 * 为什么要「逐档」而不是固定一档：头像内容差异极大（纯色图标 vs 复杂照片同体积能差 10 倍），
 * 固定质量要么浪费存储、要么让小图被多余地压糊。从高质量往下试，第一个 ≤ 目标的档位就是
 * 「在目标体积内能拿到的最高画质」。
 *
 * 两条关键取舍：
 * 1. `toBlob` 返回 null（少数 WebView 下回调永不触发，每档要等 5 秒超时）时，
 *    **立刻放弃整条 toBlob 通道**，不再消耗后续档位的超时——否则档位越多、
 *    恶劣环境下用户就等得越久（4 档 × 2 种格式 = 40 秒）。
 * 2. WebP 各档都不达标时才退 JPEG（老 WebView 可能不产 WebP）；
 *    若连最低档仍超标，返回体积最小的那个，由调用方按 MAX_AVATAR_BYTES 兜底判定。
 */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  let smallest: Blob | null = null

  const remember = (blob: Blob | null): Blob | null => {
    if (!blob || !blob.type.startsWith("image/") || blob.size === 0) return null
    if (!smallest || blob.size < smallest.size) smallest = blob
    return blob.size <= AVATAR_TARGET_BYTES ? blob : null
  }

  /** 某条通道是否还可信；一旦某档返回 null 就置 false，跳过剩余档位。 */
  let toBlobUsable = true

  const tryQuality = async (mime: string, quality: number): Promise<Blob | null> => {
    if (!toBlobUsable) return null
    const blob = await toBlob(canvas, mime, quality)
    if (!blob) {
      // 通道失效：后续档位同样会等到超时，直接整体降级到 toDataURL。
      toBlobUsable = false
      return null
    }
    return remember(blob)
  }

  // 先走 WebP（同画质体积最小），逐档降质直到进目标体积。
  for (const quality of AVATAR_QUALITY_STEPS) {
    const hit = await tryQuality("image/webp", quality)
    if (hit) return hit
  }

  // WebP 不可用或始终超标：退 JPEG，同样逐档尝试。
  for (const quality of AVATAR_QUALITY_STEPS) {
    const hit = await tryQuality("image/jpeg", quality)
    if (hit) return hit
  }

  // toBlob 通道不可用或全部超标：用同步 toDataURL 兜底，从最低质量起试（体积优先）。
  for (const quality of [...AVATAR_QUALITY_STEPS].reverse()) {
    for (const mime of ["image/webp", "image/jpeg"]) {
      const hit = remember(fromDataUrl(canvas, mime, quality))
      if (hit) return hit
    }
  }

  // 所有档位都超过目标体积：交出体积最小的那份，让上层按硬上限判定是否可接受。
  if (smallest) return smallest

  throw new AvatarProcessError("当前环境无法压缩图片。")
}
