/**
 * 插件 provider token 缓存（T3）的单元测试。
 *
 * 约束来自 v2.0 计划第 0 节：token 不落盘，请求前通过命令现取。
 * 这里只验证「一个进程内只取一次」与「清缓存后会重新取」，
 * 真正的 token 生命周期在 Rust 侧（`plugins_provider_auth`）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import {
  clearPluginProviderAuth,
  ensurePluginProviderAuth,
  getCachedPluginProviderAuth,
} from "./provider-auth"

describe("ensurePluginProviderAuth", () => {
  beforeEach(() => {
    invokeMock.mockReset()
    clearPluginProviderAuth()
  })

  it("同一 provider 调两次只 IPC 一次", async () => {
    invokeMock.mockResolvedValue("token-1")

    await expect(ensurePluginProviderAuth("wb-connect")).resolves.toBe("token-1")
    await expect(ensurePluginProviderAuth("wb-connect")).resolves.toBe("token-1")

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith("plugins_provider_auth", { providerId: "wb-connect" })
  })

  it("不同 provider 各取各的 token", async () => {
    invokeMock.mockImplementation(async (_command: string, args: { providerId: string }) =>
      `token-of-${args.providerId}`)

    await expect(ensurePluginProviderAuth("wb-connect")).resolves.toBe("token-of-wb-connect")
    await expect(ensurePluginProviderAuth("local-llm")).resolves.toBe("token-of-local-llm")

    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it("clear 指定 provider 后，该 provider 会重新 IPC（其余保留）", async () => {
    invokeMock.mockImplementation(async (_command: string, args: { providerId: string }) =>
      `token-of-${args.providerId}`)
    await ensurePluginProviderAuth("wb-connect")
    await ensurePluginProviderAuth("local-llm")

    clearPluginProviderAuth("wb-connect")

    // 清掉的重新取：这是停用/卸载后避免带着失效 token 继续请求的关键。
    await expect(ensurePluginProviderAuth("wb-connect")).resolves.toBe("token-of-wb-connect")
    // 没清的仍命中缓存。
    await ensurePluginProviderAuth("local-llm")

    const commands = invokeMock.mock.calls.map(([, args]) => (args as { providerId: string }).providerId)
    expect(commands).toEqual(["wb-connect", "local-llm", "wb-connect"])
  })

  it("不传参数时清空全部缓存", async () => {
    invokeMock.mockResolvedValue("token-1")
    await ensurePluginProviderAuth("wb-connect")
    await ensurePluginProviderAuth("local-llm")

    clearPluginProviderAuth()

    expect(getCachedPluginProviderAuth("wb-connect")).toBeUndefined()
    expect(getCachedPluginProviderAuth("local-llm")).toBeUndefined()
  })

  it("IPC 失败时原样抛出 Rust 错误，且不缓存失败结果", async () => {
    invokeMock.mockRejectedValueOnce(new Error("provider wb-connect 未就绪"))
    invokeMock.mockResolvedValueOnce("token-1")

    await expect(ensurePluginProviderAuth("wb-connect")).rejects.toThrow("provider wb-connect 未就绪")
    // 失败不写缓存，下一次还会重试；否则一次失败会让该 provider 永久不可用。
    await expect(ensurePluginProviderAuth("wb-connect")).resolves.toBe("token-1")
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })
})
