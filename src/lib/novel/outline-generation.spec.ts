import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  buildContextPackMock: vi.fn(),
}))

vi.mock("./context-engine", async () => {
  const actual = await vi.importActual<typeof import("./context-engine")>("./context-engine")
  return {
    ...actual,
    buildContextPack: mocks.buildContextPackMock,
  }
})

import { buildOutlineGenerationPrompt, buildOutlineRefinementContext } from "./outline-generation"

describe("outline-generation context fallback", () => {
  beforeEach(() => {
    mocks.buildContextPackMock.mockReset()
  })

  it("still builds a generation prompt when context loading fails", async () => {
    mocks.buildContextPackMock.mockRejectedValueOnce(new Error("context failed"))

    const prompt = await buildOutlineGenerationPrompt("E:/Novel", "通用", "短篇", "测试")

    expect(prompt).toContain("测试")
    expect(prompt).toContain("请为以下小说生成大纲")
  })

  it("returns an empty refinement context when context loading fails", async () => {
    mocks.buildContextPackMock.mockRejectedValueOnce(new Error("context failed"))

    const result = await buildOutlineRefinementContext("E:/Novel", "测试")

    expect(result).toEqual({
      context: "",
      hasOutline: false,
    })
  })
})
