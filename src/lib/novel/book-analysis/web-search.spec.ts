import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  searchDuckDuckGo,
  searchWikipedia,
  fetchCharacterExternalMaterial,
  __setWebSearchTimeoutForTest,
  __setWebSearchFetchForTest,
  __setWebSearchSleepForTest,
  __internal,
} from "./web-search"

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("web-search", () => {
  beforeEach(() => {
    __setWebSearchTimeoutForTest(5000)
    // 让重试的 sleep 不真等（否则测试 3 次重试要 600ms+）
    __setWebSearchSleepForTest(async () => {})
  })
  afterEach(() => {
    __setWebSearchTimeoutForTest(null)
    __setWebSearchFetchForTest(null)
    __setWebSearchSleepForTest(null)
  })

  it("searchDuckDuckGo returns null on 4xx (no retry)", async () => {
    const calls = vi.fn()
    __setWebSearchFetchForTest(async (url) => {
      calls(url)
      return makeResponse(500, "nope")
    })
    const r = await searchDuckDuckGo("X", "Y")
    expect(r).toBeNull()
    // 5xx 会触发重试；3 次尝试 = 3 次调用
    expect(calls).toHaveBeenCalledTimes(3)
  })

  it("searchDuckDuckGo retries 5xx and succeeds on second attempt", async () => {
    const calls = vi.fn()
    __setWebSearchFetchForTest(async (url) => {
      calls(url)
      if (calls.mock.calls.length === 1) {
        return makeResponse(503, "service unavailable")
      }
      return makeResponse(200, {
        Abstract:
          "许七安是大奉打更人，出身现代，穿越到古代成为了一名捕快。他以稳健、机敏的性格在朝堂与江湖之间周旋。",
        AbstractURL: "https://en.wikipedia.org/wiki/Xu_Qi%27an",
        Heading: "Xu Qi'an",
        AbstractSource: "Wikipedia",
      })
    })
    const r = await searchDuckDuckGo("许七安", "大奉")
    expect(r).not.toBeNull()
    expect(r?.source).toBe("duckduckgo")
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it("searchDuckDuckGo does NOT retry 4xx (other than 429)", async () => {
    const calls = vi.fn()
    __setWebSearchFetchForTest(async (url) => {
      calls(url)
      return makeResponse(403, "forbidden")
    })
    const r = await searchDuckDuckGo("X", "Y")
    expect(r).toBeNull()
    // 4xx 不重试，只调一次
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it("searchDuckDuckGo retries on network error (fetch throws)", async () => {
    const calls = vi.fn()
    __setWebSearchFetchForTest(async () => {
      calls("any")
      throw new Error("network failed")
    })
    const r = await searchDuckDuckGo("X", "Y")
    expect(r).toBeNull()
    // 抛错属于"可重试"，3 次
    expect(calls).toHaveBeenCalledTimes(3)
  })

  it("searchDuckDuckGo returns null when Abstract too short", async () => {
    __setWebSearchFetchForTest(async () => makeResponse(200, { Abstract: "no" }))
    const r = await searchDuckDuckGo("X", "Y")
    expect(r).toBeNull()
  })

  it("searchDuckDuckGo returns result on good payload", async () => {
    __setWebSearchFetchForTest(async () =>
      makeResponse(200, {
        Abstract:
          "许七安是大奉打更人，出身现代，穿越到古代成为了一名捕快。他以稳健、机敏的性格在朝堂与江湖之间周旋。",
        AbstractURL: "https://en.wikipedia.org/wiki/Xu_Qi%27an",
        Heading: "Xu Qi'an",
        AbstractSource: "Wikipedia",
      })
    )
    const r = await searchDuckDuckGo("许七安", "大奉")
    expect(r).not.toBeNull()
    expect(r?.source).toBe("duckduckgo")
    expect(r?.abstract).toContain("许七安")
  })

  it("searchWikipedia skips 404, tries next endpoint", async () => {
    const calls = vi.fn()
    __setWebSearchFetchForTest(async (url) => {
      calls(url)
      if (calls.mock.calls.length === 1) return makeResponse(404, "nope")
      return makeResponse(200, { extract: "Long enough content about Xu Qi'an here." })
    })
    const r = await searchWikipedia("许七安")
    expect(r).not.toBeNull()
    expect(r?.source).toMatch(/wikipedia/)
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it("searchWikipedia retries 5xx across endpoints", async () => {
    const calls = vi.fn()
    __setWebSearchFetchForTest(async (url) => {
      calls(url)
      // 第一次 503 触发重试；重试成功后返回
      if (calls.mock.calls.length <= 1) {
        return makeResponse(503, "down")
      }
      return makeResponse(200, { extract: "Long enough content about Xu Qi'an here." })
    })
    const r = await searchWikipedia("许七安")
    expect(r).not.toBeNull()
    // 第一次 + 重试 1 次 = 2 次
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it("fetchCharacterExternalMaterial falls back from ddg → wiki → null", async () => {
    const calls = vi.fn()
    __setWebSearchFetchForTest(async (url) => {
      calls(url)
      return makeResponse(500, "nope")
    })
    const r = await fetchCharacterExternalMaterial("许七安", "大奉")
    expect(r).toBeNull()
    // ddg 3 次（重试 3 次都失败）+ wiki 2 端点 × 3 次 = 9 次
    expect(calls).toHaveBeenCalledTimes(3 + 2 * 3)
  })

  it("fetchCharacterExternalMaterial returns ddg when present", async () => {
    __setWebSearchFetchForTest(async () =>
      makeResponse(200, {
        Abstract:
          "许七安是大奉打更人，出身现代，穿越到古代成为了一名捕快。他以稳健、机敏的性格在朝堂与江湖之间周旋。",
        AbstractURL: "https://example.com",
        Heading: "X",
      })
    )
    const r = await fetchCharacterExternalMaterial("许七安", "大奉")
    expect(r?.source).toBe("duckduckgo")
  })
})

describe("withRetry", () => {
  beforeEach(() => {
    __setWebSearchSleepForTest(async () => {})
  })
  afterEach(() => {
    __setWebSearchSleepForTest(null)
  })

  it("returns immediately on success", async () => {
    const fn = vi.fn(async () => "ok")
    const r = await __internal.withRetry(fn)
    expect(r).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries up to maxAttempts then throws", async () => {
    const fn = vi.fn(async () => {
      throw new Error("nope")
    })
    await expect(
      __internal.withRetry(fn, { maxAttempts: 3, baseMs: 1, maxMs: 1, jitterMs: 0 })
    ).rejects.toThrow("nope")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("calls onRetry with attempt and delay", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValueOnce("ok")
    const onRetry = vi.fn()
    const r = await __internal.withRetry(fn, {
      maxAttempts: 5,
      baseMs: 100,
      maxMs: 1000,
      jitterMs: 0,
      onRetry,
    })
    expect(r).toBe("ok")
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry.mock.calls[0][0]).toBe(1) // 第 1 次失败后
    expect(onRetry.mock.calls[1][0]).toBe(2) // 第 2 次失败后
    // 第一次重试延迟 = baseMs * 2^0 = 100
    expect(onRetry.mock.calls[0][2]).toBe(100)
    // 第二次重试延迟 = baseMs * 2^1 = 200
    expect(onRetry.mock.calls[1][2]).toBe(200)
  })

  it("stops immediately when signal is aborted", async () => {
    const fn = vi.fn(async () => {
      throw new Error("e")
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      __internal.withRetry(fn, {
        maxAttempts: 5,
        baseMs: 1,
        maxMs: 1,
        jitterMs: 0,
        signal: controller.signal,
      })
    ).rejects.toThrow()
    // 第 1 次进 try 前就检测到 aborted，直接抛，fn 不会被调用
    expect(fn).toHaveBeenCalledTimes(0)
  })
})
