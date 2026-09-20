import { afterEach, expect, test, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test("uses native fetch in a plain browser without Tauri internals", async () => {
  const nativeFetch = vi.fn(async () => new Response("ok"))

  vi.stubGlobal("window", {})
  vi.stubGlobal("fetch", nativeFetch)

  const { getHttpFetch } = await import("./tauri-fetch")
  const httpFetch = await getHttpFetch()

  await expect(httpFetch("https://example.com")).resolves.toBeInstanceOf(Response)
  expect(nativeFetch).toHaveBeenCalledWith("https://example.com")
})

test("maps plugin-http invalid resource id rejections to AbortError", async () => {
  const pluginFetch = vi.fn(async () => {
    return Promise.reject("The resource id 2199732775 is invalid.")
  })
  vi.doMock("@tauri-apps/plugin-http", () => ({
    fetch: pluginFetch,
  }))
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} })

  const { getHttpFetch, resetHttpFetchForTests } = await import("./tauri-fetch")
  resetHttpFetchForTests()
  const httpFetch = await getHttpFetch()

  await expect(httpFetch("https://example.com")).rejects.toMatchObject({
    name: "AbortError",
  })
})
