import { describe, expect, it } from "vitest"

import {
  fetchModelConfig,
  putModelConfig,
  registerAccount,
  sendCode,
} from "@/lib/account/api"

import { decryptModelConfig, encryptModelConfig } from "./crypto"
import { buildLocalEntries, buildPayload, emptySyncState, pullAndMerge, type ModelSyncIo } from "./service"
import type { ModelSyncState } from "./service"

/**
 * **端到端**：真客户端代码 ↔ 真 Worker。
 *
 * 默认跳过（需要先起一个本地 Worker）：
 *
 * ```powershell
 * cd account-worker
 * & "C:\Program Files\nodejs\node.exe" node_modules\wrangler\wrangler-dist\cli.js `
 *     dev --port 8788 --var ALLOW_DEV_CODE:true `
 *     --var AUTH_JWT_SECRET:local-dev-jwt-secret-32-bytes-min `
 *     --var AUTH_CODE_PEPPER:local-dev-pepper-16b
 * ```
 * 然后：
 *
 * ```powershell
 * $env:QMAI_E2E_ACCOUNT_URL = "http://127.0.0.1:8788"
 * npx vitest run src/lib/model-sync/e2e-account-sync.spec.ts
 * ```
 *
 * 它要证明的就是线上事故那一条：**pullAndMerge 的「回写云端」必须是加密的**，
 * 且服务端要真的收下它。事故时代码推明文，服务端 400，于是「立即同步」永远失败。
 */
const BASE = process.env.QMAI_E2E_ACCOUNT_URL
const PASSWORD = "sync-password-e2e"

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
}

/** 用真 token 把 io 接到真服务上。 */
function liveIo(baseUrl: string, accessToken: string, configs: Record<string, unknown>) {
  let state: ModelSyncState = { ...emptySyncState(), version: 0 }
  const puts: string[] = []
  const io: ModelSyncIo = {
    now: () => Date.now(),
    loadConfigs: async () => configs,
    saveConfigs: async () => {},
    loadSettings: async () => ({}),
    saveSettings: async () => {},
    loadState: async () => state,
    saveState: async (next) => {
      state = next
    },
    fetchCloud: (ifNoneMatch) => fetchModelConfig(baseUrl, accessToken, { ifNoneMatch }, fetch),
    putCloud: async (input) => {
      puts.push(input.payload)
      return putModelConfig(baseUrl, accessToken, input, fetch)
    },
  }
  return { io, puts }
}

describe.skipIf(!BASE)("模型同步端到端（真 Worker）", () => {
  /**
   * 线上用户的真实处境：云端那份是**早期 v1 信封**（无 zip，约 11 KB），
   * 本地是已装新版的客户端。这条用例验证「v1 读得出来 + 新写入会升级成 v2」。
   */
  it(
    "云端已有 v1 旧信封时：能解密、合并、并以 v2+zip 回写升级",
    async () => {
      const baseUrl = BASE!
      const email = uniqueEmail()
      const sent = await sendCode(baseUrl, email, "register", fetch)
      const auth = await registerAccount(
        baseUrl,
        { email, code: sent.devCode!, password: "password123" },
        fetch,
      )
      const token = auth.accessToken

      // 1) 模拟旧客户端：v1 信封（compress:false → 无 zip 字段）
      const legacy = await encryptModelConfig(
        buildPayload({
          deepseek: { key: "deepseek", value: { enabled: true, apiKey: "sk-old", model: "vendor/a" }, updatedAt: 1 },
        }),
        PASSWORD,
        { iterations: 1_000, compress: false },
      )
      expect(JSON.parse(legacy).zip).toBeUndefined()
      const first = await putModelConfig(baseUrl, token, { payload: legacy, baseVersion: null }, fetch)
      expect(first.version).toBe(1)

      // 2) 新版客户端跑一次同步：本地多一个云端没有的 provider
      const live = liveIo(baseUrl, token, {
        deepseek: { enabled: true, apiKey: "sk-old", model: "vendor/a" },
        "custom-new": { enabled: true, apiKey: "sk-new", model: "vendor/b" },
      })
      const result = await pullAndMerge(live.io, PASSWORD)
      expect(result.status).toBe("merged")
      expect(live.puts.length).toBeGreaterThan(0)

      // 3) 回写的必须是 v2 + zip（体积更小、且仍是密文）
      for (const payload of live.puts) {
        const parsed = JSON.parse(payload) as Record<string, unknown>
        expect(parsed.v).toBe(2)
        expect(parsed.zip).toBe("deflate-raw")
        expect(typeof parsed.ct).toBe("string")
        expect(payload).not.toContain("sk-")
      }

      // 4) 云端记录已升级：能解出旧内容 + 新 provider
      const after = await fetchModelConfig(baseUrl, token, {}, fetch)
      const stored = (after as { record: { payload: string } }).record.payload
      expect(stored).toContain('"v":2')
      const plain = await decryptModelConfig(stored, PASSWORD)
      expect(plain).toContain("deepseek")
      expect(plain).toContain("custom-new")
    },
    30_000,
  )

  it(
    "注册 → 加密上传 → 拉取解密 → 回写推送全部成功",
    async () => {
      const baseUrl = BASE!
      const email = uniqueEmail()
      const password = "password123"

      // 1) 注册（本地 Worker 开了 ALLOW_DEV_CODE，验证码直接返回）
      const sent = await sendCode(baseUrl, email, "register", fetch)
      const code = sent.devCode
      expect(code, "本地 Worker 应返回 devCode").toBeTruthy()
      const auth = await registerAccount(baseUrl, { email, code: code!, password }, fetch)
      const token = auth.accessToken
      expect(token).toBeTruthy()

      // 2) 直接上传一份加密配置（pushLocal 的路径）
      const envelope = await encryptModelConfig(
        buildPayload({ deepseek: { key: "deepseek", value: { enabled: true, apiKey: "sk-a" }, updatedAt: 1 } }),
        PASSWORD,
        { iterations: 1_000 },
      )
      const first = await putModelConfig(baseUrl, token, { payload: envelope, baseVersion: null }, fetch)
      expect(first.version).toBe(1)

      // 3) 拉取并解密，验证服务端确实只存密文
      const remote = await fetchModelConfig(baseUrl, token, {}, fetch)
      expect(remote.kind).toBe("config")
      const plain = await decryptModelConfig((remote as { record: { payload: string } }).record.payload, PASSWORD)
      expect(plain).toContain('"deepseek"')
      expect((remote as { record: { payload: string } }).record.payload).not.toContain("sk-a")

      // 4) **事故点**：本地多出一个云端没有的 provider → pullAndMerge 会回写云端。
      //    事故时代码推明文 → 服务端 400；修复后必须 200 且版本 +1。
      const localConfigs = {
        deepseek: { enabled: true, apiKey: "sk-a" },
        "custom-local-only": { enabled: true, apiKey: "sk-local-only", model: "vendor/x" },
      }
      const live = liveIo(baseUrl, token, localConfigs)
      // 让 localEntries 认为 custom-local-only 是本地独有，needsPush 才会为真
      const result = await pullAndMerge(live.io, PASSWORD)
      expect(result.status).toBe("merged")

      expect(live.puts.length).toBeGreaterThan(0)
      for (const payload of live.puts) {
        // 必须仍是加密信封，不能是明文
        expect(payload).not.toContain('"providers"')
        const parsed = JSON.parse(payload) as Record<string, unknown>
        expect(typeof parsed.ct).toBe("string")
      }

      // 5) 再把云端拉一次，确认回写内容可解密且含新 provider
      const after = await fetchModelConfig(baseUrl, token, {}, fetch)
      const afterPlain = await decryptModelConfig(
        (after as { record: { payload: string } }).record.payload,
        PASSWORD,
      )
      expect(afterPlain).toContain("custom-local-only")
    },
    30_000,
  )
})
