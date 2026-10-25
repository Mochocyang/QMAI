// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AVATAR_SIZE,
  AvatarProcessError,
  MAX_AVATAR_BYTES,
  processAvatarImage,
} from "./avatar"

afterEach(() => {
  vi.restoreAllMocks()
})

/** jsdom 没有真实图片解码与 canvas 渲染，这里按需替换两个关键点。 */
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
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined })

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
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined })

    const result = await processAvatarImage(imageFile())

    expect(result.mime).toBe("image/jpeg")
  })

  it("压缩后仍超过上限时报错", async () => {
    stubImage(300, 300)
    stubCanvas(new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)], { type: "image/webp" }))
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined })

    await expect(processAvatarImage(imageFile())).rejects.toBeInstanceOf(AvatarProcessError)
  })

  it("非图片文件直接拒绝，且不尝试解码", async () => {
    const createObjectURL = vi.fn()
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: () => undefined })

    await expect(
      processAvatarImage(new File(["hello"], "note.txt", { type: "text/plain" })),
    ).rejects.toThrow("请选择图片文件。")
    expect(createObjectURL).not.toHaveBeenCalled()
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
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined })

    await expect(processAvatarImage(imageFile())).rejects.toThrow("无法读取这张图片")
  })

  it("canvas 拿不到 context 时报错", async () => {
    stubImage(200, 200)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined })

    await expect(processAvatarImage(imageFile())).rejects.toThrow("无法处理图片")
  })
})
