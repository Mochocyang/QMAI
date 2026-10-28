// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const platform = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }))
vi.mock("@/lib/platform", () => platform)

import {
  clearModelConfigsEncrypted,
  loadModelConfigsEncrypted,
  saveModelConfigsEncrypted,
} from "./local-secret"

describe("local-secret（非 Tauri 环境）", () => {
  beforeEach(() => {
    platform.isTauri.mockReturnValue(false)
  })

  it("加密存储不可用时返回 false，调用方据此回退明文", async () => {
    await expect(saveModelConfigsEncrypted("{}")).resolves.toBe(false)
  })

  it("读取返回 null（视为没有加密副本）", async () => {
    await expect(loadModelConfigsEncrypted()).resolves.toBeNull()
  })

  it("清除是空操作，不抛错", async () => {
    await expect(clearModelConfigsEncrypted()).resolves.toBeUndefined()
  })
})
