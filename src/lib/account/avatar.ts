/**
 * 头像图片处理：把用户选中的任意图片压成 256×256 的正方形 WebP。
 *
 * 服务端只接受 ≤200 KB 的 PNG/JPEG/WebP，这里先用 canvas 居中裁方再压缩，
 * 正常能压到 10–30 KB，避免用户选一张几 MB 的照片就上传失败。
 */

/** 头像边长（像素）。UI 最大显示 64px，256px 足够 2x 屏。 */
export const AVATAR_SIZE = 256

/** 与服务端 MAX_AVATAR_BYTES 保持一致。 */
export const MAX_AVATAR_BYTES = 200 * 1024

/** 压缩质量；WebP 下 0.85 目视无差。 */
const AVATAR_QUALITY = 0.85

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
 * 把图片裁成居中的正方形并压成 WebP。
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

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  // 依次尝试：WebP（体积最小）→ JPEG → 同步 toDataURL 兜底。
  const candidates: Array<[string, number]> = [
    ["image/webp", AVATAR_QUALITY],
    ["image/jpeg", AVATAR_QUALITY],
  ]

  for (const [mime, quality] of candidates) {
    const blob = await toBlob(canvas, mime, quality)
    if (blob && blob.type.startsWith("image/") && blob.size > 0) return blob
  }

  for (const [mime, quality] of candidates) {
    const blob = fromDataUrl(canvas, mime, quality)
    if (blob && blob.size > 0) return blob
  }

  throw new AvatarProcessError("当前环境无法压缩图片。")
}
