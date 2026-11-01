// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AVATAR_SIZE,
  AVATAR_TARGET_BYTES,
  AvatarProcessError,
  MAX_AVATAR_BYTES,
  processAvatarImage,
} from "./avatar"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

/**
 * 图片现在通过 FileReader 读成 data: URL，而不是 blob: URL。
 * Tauri 的 tauri.localhost 下 blob: URL 无法被 <img> 加载，这条测试在旧实现上会失败。
 */
function stubFileReader(result: string | null = PNG_DATA_URL) {
  class FakeFileReader {
    result: string | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    readAsDataURL(_blob: Blob) {
      this.result = result
      queueMicrotask(() => (result === null ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal("FileReader", FakeFileReader as unknown as typeof FileReader)
}

/** jsdom 没有真实图片解码与 canvas 渲染，这里按需替换关键点。 */
function stubImage(width: number, height: number) {
  class FakeImage {
    naturalWidth = width
    naturalHeight = height
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image)
  stubFileReader()
}

function stubCanvas(blob: Blob | null, drawSpy?: ReturnType<typeof vi.fn>) {
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage: drawSpy ?? vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(blob)
  })
  return context
}

function imageFile(name = "photo.png", type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

describe("processAvatarImage", () => {
  it("把图片裁成正方形并输出 WebP", async () => {
    stubImage(800, 600)
    const drawSpy = vi.fn()
    stubCanvas(new Blob([new Uint8Array(1024)], { type: "image/webp" }), drawSpy)

    const result = await processAvatarImage(imageFile())

    expect(result.mime).toBe("image/webp")
    expect(result.bytes).toBe(1024)
    // 居中裁切：短边 600 作为边长，横向偏移 (800-600)/2 = 100。
    expect(drawSpy).toHaveBeenCalledWith(
      expect.anything(),
      100,
      0,
      600,
      600,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    )
  })

  it("WebP 不可用时回退 JPEG", async () => {
    stubImage(300, 300)
    stubCanvas(new Blob([new Uint8Array(512)], { type: "image/jpeg" }))

    const result = await processAvatarImage(imageFile())

    expect(result.mime).toBe("image/jpeg")
  })

  it("压缩后仍超过上限时报错", async () => {
    stubImage(300, 300)
    stubCanvas(new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)], { type: "image/webp" }))

    await expect(processAvatarImage(imageFile())).rejects.toBeInstanceOf(AvatarProcessError)
  })

  it("逐档降质，命中目标体积后停止（不再继续压）", async () => {
    stubImage(300, 300)
    const calls: Array<{ mime: string; quality: number | undefined }> = []
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, mime, quality) => {
      calls.push({ mime: String(mime), quality })
      // 第一档（0.82）就给一个达标体积，应当立刻返回，不再试 0.72 及以下。
      callback(new Blob([new Uint8Array(1024)], { type: String(mime) }))
    })

    const result = await processAvatarImage(imageFile())

    expect(result.bytes).toBeLessThanOrEqual(AVATAR_TARGET_BYTES)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ mime: "image/webp", quality: 0.82 })
  })

  it("高质量档超标时继续降质，直到进入目标体积", async () => {
    stubImage(300, 300)
    const qualities: Array<number | undefined> = []
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, mime, quality) => {
      qualities.push(quality)
      // 0.82 与 0.72 都超标，0.62 达标。
      const oversized = quality === 0.82 || quality === 0.72
      const size = oversized ? AVATAR_TARGET_BYTES + 1 : 1024
      callback(new Blob([new Uint8Array(size)], { type: String(mime) }))
    })

    const result = await processAvatarImage(imageFile())

    expect(result.bytes).toBe(1024)
    expect(qualities).toEqual([0.82, 0.72, 0.62])
  })

  it("非图片文件直接拒绝，且不尝试解码", async () => {
    const readAsDataURL = vi.fn()
    class SpyReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      readAsDataURL = readAsDataURL
    }
    vi.stubGlobal("FileReader", SpyReader as unknown as typeof FileReader)

    await expect(
      processAvatarImage(new File(["hello"], "note.txt", { type: "text/plain" })),
    ).rejects.toThrow("请选择图片文件。")
    expect(readAsDataURL).not.toHaveBeenCalled()
  })

  it("图片解码失败给出可读错误", async () => {
    class BrokenImage {
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal("Image", BrokenImage as unknown as typeof Image)
    stubFileReader()

    await expect(processAvatarImage(imageFile())).rejects.toThrow("无法读取这张图片")
  })

  it("canvas 拿不到 context 时报错", async () => {
    stubImage(200, 200)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)

    await expect(processAvatarImage(imageFile())).rejects.toThrow("无法处理图片")
  })

  it("toBlob 回调不触发时用 toDataURL 兜底，不会永久挂起", async () => {
    // 首档 toBlob 等 5s 超时即判定通道失效，直接转 toDataURL，不再熬完 8 个档位。
    stubImage(300, 300)
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    // 模拟 Tauri WebView 下 toBlob 永不回调。
    stubFileReader()
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => undefined)
    // 1×1 PNG 的合法 dataURL。
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png)

    const result = await processAvatarImage(imageFile())

    expect(result.mime).toBe("image/png")
    expect(result.bytes).toBeGreaterThan(0)
  }, 20000)

  it("所有编码方式都失败时给出明确错误", async () => {
    stubImage(300, 300)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    stubFileReader()
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:,")

    await expect(processAvatarImage(imageFile())).rejects.toThrow("无法压缩图片")
  }, 20000)

  it("优先用 createImageBitmap 解码，不依赖 img-src 允许 blob:/data:", async () => {
    // 应用 CSP 的 img-src 不含 blob:/data:，用 <img> 读图会被静默拦截。
    const close = vi.fn()
    const bitmap = { width: 400, height: 300, close }
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap))
    vi.stubGlobal("FileReader", class { readAsDataURL() { throw new Error("不该走 FileReader") } })
    vi.stubGlobal("Image", class { set src(_v) { throw new Error("不该用 img 解码") } })
    const drawSpy = vi.fn()
    stubCanvas(new Blob([new Uint8Array(256)], { type: "image/webp" }), drawSpy)

    const result = await processAvatarImage(imageFile())

    expect(result.mime).toBe("image/webp")
    // 居中裁方：400x300 → 边长 300，横向偏移 (400-300)/2 = 50。
    expect(drawSpy).toHaveBeenCalledWith(bitmap, 50, 0, 300, 300, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("createImageBitmap 解码失败时回退到 img 元素", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("decode failed") }))
    stubImage(200, 200)
    stubCanvas(new Blob([new Uint8Array(128)], { type: "image/webp" }))

    const result = await processAvatarImage(imageFile())

    expect(result.mime).toBe("image/webp")
  }, 20000)
})
