import { describe, expect, it } from "vitest"

import {
  applyResponseHeaders,
  errorMessage,
  errorStatus,
  failure,
  jsonSuccess,
  parseAllowedOrigins,
  preflightResponse,
  readJsonBody,
  resolveAllowedOrigin,
} from "../src/http"

async function envelope(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe("error codes", () => {
  it("maps every spec code to its HTTP status", () => {
    expect(errorStatus("VALIDATION")).toBe(400)
    expect(errorStatus("EMAIL_TAKEN")).toBe(409)
    expect(errorStatus("CODE_INVALID")).toBe(400)
    expect(errorStatus("CODE_EXPIRED")).toBe(400)
    expect(errorStatus("CODE_ATTEMPTS")).toBe(429)
    expect(errorStatus("RATE_LIMITED")).toBe(429)
    expect(errorStatus("INVALID_CREDENTIALS")).toBe(401)
    expect(errorStatus("ACCOUNT_DISABLED")).toBe(403)
    expect(errorStatus("TOKEN_EXPIRED")).toBe(401)
    expect(errorStatus("INVALID_REFRESH")).toBe(401)
    expect(errorStatus("EMAIL_SEND_FAILED")).toBe(502)
    expect(errorStatus("SERVER_ERROR")).toBe(500)
  })

  it("carries a Chinese fallback message for every spec code", () => {
    expect(errorMessage("CODE_EXPIRED")).toContain("过期")
    expect(errorMessage("EMAIL_TAKEN")).toContain("注册")
    expect(errorMessage("INVALID_CREDENTIALS")).toContain("密码")
  })
})

describe("response envelope", () => {
  it("wraps success payload and disables caching", async () => {
    const response = jsonSuccess({ user: { id: 1 } })
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await envelope(response)).toEqual({ success: true, data: { user: { id: 1 } } })
  })

  it("wraps failure payload with code and default message", async () => {
    const response = failure("EMAIL_TAKEN")
    expect(response.status).toBe(409)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await envelope(response)).toEqual({
      success: false,
      code: "EMAIL_TAKEN",
      message: "这个邮箱已经注册过，直接登录即可。",
    })
  })

  it("allows a custom fallback message but keeps the code", async () => {
    const response = failure("SERVER_ERROR", "内部错误")
    expect(await envelope(response)).toMatchObject({ code: "SERVER_ERROR", message: "内部错误" })
  })
})

describe("CORS allowlist", () => {
  it("parses comma-separated origins and drops blanks", () => {
    expect(parseAllowedOrigins(" a , b ,,")).toEqual(["a", "b"])
    expect(parseAllowedOrigins("")).toEqual([])
    expect(parseAllowedOrigins(undefined)).toEqual([])
  })

  it("only resolves exact allowlisted origins", () => {
    const allowed = ["tauri://localhost", "http://localhost:1420"]
    const allowedRequest = new Request("https://account.example/v1/auth/me", {
      headers: { Origin: "tauri://localhost" },
    })
    const deniedRequest = new Request("https://account.example/v1/auth/me", {
      headers: { Origin: "https://evil.example" },
    })
    const noOriginRequest = new Request("https://account.example/v1/auth/me")

    expect(resolveAllowedOrigin(allowedRequest, allowed)).toBe("tauri://localhost")
    expect(resolveAllowedOrigin(deniedRequest, allowed)).toBeNull()
    expect(resolveAllowedOrigin(noOriginRequest, allowed)).toBeNull()
  })

  it("adds CORS headers only for allowlisted origins and always no-store", () => {
    const allowed = ["http://127.0.0.1:1420"]
    const allowedResponse = applyResponseHeaders(
      jsonSuccess(null),
      new Request("https://account.example/", { headers: { Origin: "http://127.0.0.1:1420" } }),
      allowed,
    )
    expect(allowedResponse.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://127.0.0.1:1420",
    )
    expect(allowedResponse.headers.get("Vary")).toContain("Origin")
    expect(allowedResponse.headers.get("Cache-Control")).toBe("no-store")

    const deniedResponse = applyResponseHeaders(
      jsonSuccess(null),
      new Request("https://account.example/", { headers: { Origin: "https://evil.example" } }),
      allowed,
    )
    expect(deniedResponse.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(deniedResponse.headers.get("Cache-Control")).toBe("no-store")
  })
})

describe("CORS preflight", () => {
  const allowed = ["tauri://localhost", "https://tauri.localhost"]

  it("returns 204 with methods and headers for an allowlisted origin", () => {
    const response = preflightResponse(
      new Request("https://account.example/v1/auth/login", {
        method: "OPTIONS",
        headers: {
          Origin: "tauri://localhost",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      }),
      allowed,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("tauri://localhost")
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST")
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization")
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type")
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400")
    expect(response.headers.get("Vary")).toContain("Origin")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("returns 204 without ACAO for a non-allowlisted origin", () => {
    const response = preflightResponse(
      new Request("https://account.example/v1/auth/login", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      allowed,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull()
    expect(response.headers.get("Access-Control-Allow-Headers")).toBeNull()
  })

  it("returns 204 without ACAO when Origin is absent", () => {
    const response = preflightResponse(
      new Request("https://account.example/v1/auth/login", { method: "OPTIONS" }),
      allowed,
    )
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})

describe("readJsonBody", () => {
  it("parses a JSON object with an allowed content type", async () => {
    const request = new Request("https://account.example/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ email: "a@b.com" }),
    })
    const result = await readJsonBody(request)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.body).toEqual({ email: "a@b.com" })
  })

  it("rejects a non-JSON content type", async () => {
    const request = new Request("https://account.example/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "email=a@b.com",
    })
    const result = await readJsonBody(request)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      expect(await envelope(result.response)).toMatchObject({ code: "VALIDATION" })
    }
  })

  it("rejects malformed JSON", async () => {
    const request = new Request("https://account.example/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    })
    const result = await readJsonBody(request)
    expect(result.ok).toBe(false)
  })

  it("rejects JSON arrays and null", async () => {
    for (const body of ["[]", "null", '"text"']) {
      const request = new Request("https://account.example/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      expect((await readJsonBody(request)).ok).toBe(false)
    }
  })

  it("rejects bodies over 8 KB", async () => {
    const request = new Request("https://account.example/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${"a".repeat(8200)}@b.com` }),
    })
    const result = await readJsonBody(request)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(await envelope(result.response)).toMatchObject({ code: "VALIDATION" })
    }
  })

  it("rejects a declared Content-Length over 8 KB before reading the body", async () => {
    const request = new Request("https://account.example/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "9000" },
      body: JSON.stringify({ email: "a@b.com" }),
    })
    const result = await readJsonBody(request)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(await envelope(result.response)).toMatchObject({ code: "VALIDATION" })
    }
  })

  it("rejects a body streamed past 8 KB without a Content-Length header", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4096).fill(0x20))
      },
      cancel() {
        cancelled = true
      },
    })
    const request = new Request("https://account.example/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      // @ts-expect-error Node fetch needs duplex for streaming request bodies
      duplex: "half",
    })
    const result = await readJsonBody(request)
    expect(result.ok).toBe(false)
    expect(cancelled).toBe(true)
  })
})
