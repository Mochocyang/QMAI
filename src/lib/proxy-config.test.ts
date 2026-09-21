import { describe, it, expect } from "vitest"
import { validateProxyUrl } from "./proxy-config"

describe("validateProxyUrl", () => {
  it("accepts http:// URLs", () => {
    expect(validateProxyUrl("http://127.0.0.1:7890")).toEqual({ ok: true })
    expect(validateProxyUrl("http://proxy.corp.local:8080")).toEqual({ ok: true })
  })

  it("accepts https:// URLs", () => {
    expect(validateProxyUrl("https://proxy.corp:443")).toEqual({ ok: true })
  })

  it("accepts URLs with embedded auth", () => {
    expect(validateProxyUrl("http://user:pass@127.0.0.1:7890")).toEqual({ ok: true })
  })

  it("rejects URLs with no scheme", () => {
    // URL parser behaves differently across Node versions ("127.0.0.1:7890"
    // throws on some, parses to protocol="127.0.0.1:" on others). Either
    // way the URL must be REJECTED — the exact error message isn't part
    // of the contract.
    expect(validateProxyUrl("127.0.0.1:7890").ok).toBe(false)
    expect(validateProxyUrl("proxy.example.com:8080").ok).toBe(false)
  })

  it("rejects unsupported schemes (v1: HTTP/HTTPS only)", () => {
    expect(validateProxyUrl("socks5://127.0.0.1:1080")).toMatchObject({
      ok: false,
    })
    expect(validateProxyUrl("ftp://x")).toMatchObject({ ok: false })
  })

  it("rejects empty / whitespace input", () => {
    expect(validateProxyUrl("")).toMatchObject({ ok: false })
    expect(validateProxyUrl("   ")).toMatchObject({ ok: false })
  })

  it("rejects malformed URLs", () => {
    expect(validateProxyUrl("http://").ok).toBe(false)
    expect(validateProxyUrl("not-a-url").ok).toBe(false)
    expect(validateProxyUrl("http:").ok).toBe(false)
  })

  it("rejects URLs missing a host", () => {
    expect(validateProxyUrl("http://:7890")).toMatchObject({ ok: false })
  })
})