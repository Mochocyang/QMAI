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

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new AvatarProcessError("无法读取这张图片，请换一张试试。"))
    }
    image.src = url
  })
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

  const image = await loadImage(file)
  const side = Math.min(image.naturalWidth, image.naturalHeight)
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
  const sourceX = (image.naturalWidth - side) / 2
  const sourceY = (image.naturalHeight - side) / 2
  context.drawImage(
    image,
    sourceX,
    sourceY,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  )

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

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality)
  })
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", AVATAR_QUALITY)
  // 少数环境（旧 Safari / 精简 WebView）不返回 WebP，退回 JPEG。
  if (webp && webp.type === "image/webp") return webp

  const jpeg = await toBlob(canvas, "image/jpeg", AVATAR_QUALITY)
  if (jpeg && jpeg.type === "image/jpeg") return jpeg

  throw new AvatarProcessError("当前环境无法压缩图片。")
}
