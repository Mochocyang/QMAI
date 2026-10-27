/**
 * 一次性排障脚本：找出 WorkBuddy 登录态里 `$wbEncrypted` 字段能否在本机解开。
 *
 * 背景：WorkBuddy 新版把 accessToken / refreshToken 变成了
 *   { "$wbEncrypted": 1, "envelope": base64({suite,keyId,nonce,authTag,ciphertext}) }
 * 其中 keyId = sha256(sha256(atRestSecretKey_utf8_bytes)) 前 16 位十六进制
 * （见 app.asar → /main/dist.js 的 deriveAtRestKeyId / normalizeAtRestKeyPayload）。
 * atRestSecretKey 由 Electron 原生模块 `electron.workbuddyStorage.loggerGet()` 提供，
 * 启动日志会打印 `[CredentialBootstrap] ... symmetricAvailable`。
 *
 * 用法（node 运行，不是 Electron）：
 *   node tools/probe-workbuddy-credentials.mjs
 *   node tools/probe-workbuddy-credentials.mjs --key <base64或hex的32字节密钥>
 *
 * 只读：不写任何文件，只打印结论。
 */

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const KEYID_RE = /^[0-9a-f]{16}$/

function credentialFile() {
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? "",
      "CodeBuddyExtension",
      "Data",
      "Public",
      "auth",
      "workbuddy-desktop.info",
    )
  }
  return path.join(
    process.env.HOME ?? "",
    "Library",
    "Application Support",
    "CodeBuddyExtension",
    "Data",
    "Public",
    "auth",
    "workbuddy-desktop.info",
  )
}

/** keyId = sha256(keyBytes).slice(0, 16 hex) */
export function keyIdOf(keyBytes) {
  return crypto.createHash("sha256").update(keyBytes).digest("hex").slice(0, 16)
}

/** keyId = sha256(utf8(atRestSecretKey 的 base64 文本)).slice(0,16) */
function normalizeAtRestKey(atRestSecretKeyBase64) {
  const key = crypto.createHash("sha256").update(atRestSecretKeyBase64, "utf8").digest()
  return { key, keyId: keyIdOf(key) }
}

function readEnvelope(wrapper) {
  if (!wrapper || typeof wrapper !== "object" || wrapper.$wbEncrypted !== 1) return null
  const meta = JSON.parse(Buffer.from(String(wrapper.envelope), "base64").toString("utf8"))
  return {
    suite: meta.suite,
    keyId: meta.keyId,
    nonce: Buffer.from(meta.nonce, "base64"),
    authTag: Buffer.from(meta.authTag, "base64"),
    ciphertext: Buffer.from(meta.ciphertext, "base64"),
  }
}

function tryDecrypt(envelope, key) {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, envelope.nonce)
    decipher.setAuthTag(envelope.authTag)
    const plain = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()])
    return { ok: true, text: plain.toString("utf8") }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function main() {
  const file = credentialFile()
  console.log(`凭证文件：${file}`)
  if (!fs.existsSync(file)) {
    console.log("结论：文件不存在（先在 WorkBuddy 客户端登录一次）")
    return
  }

  const info = JSON.parse(fs.readFileSync(file, "utf8"))
  const probes = [
    ["auth.accessToken", info?.auth?.accessToken],
    ["auth.refreshToken", info?.auth?.refreshToken],
    ["account.nickname", info?.account?.nickname],
  ]
  const envelopes = probes
    .map(([name, value]) => ({ name, envelope: readEnvelope(value) }))
    .filter((item) => item.envelope)

  if (envelopes.length === 0) {
    console.log("结论：文件里的 token 是明文（没有 $wbEncrypted），可以直接导入。")
    return
  }

  console.log(`加密字段：${envelopes.map((item) => item.name).join(", ")}`)
  console.log(`suite=${envelopes[0].envelope.suite}  keyId=${envelopes[0].envelope.keyId}`)

  const argIndex = process.argv.indexOf("--key")
  const providedKey = argIndex > 0 ? process.argv[argIndex + 1] : null
  if (!providedKey) {
    console.log("")
    console.log("结论：这些字段由 WorkBuddy 自己的 at-rest 密钥保护，密钥不在数据目录里。")
    console.log("要验证某个候选密钥，把 32 字节密钥按 base64 或 64 位 hex 传进来：")
    console.log("  node tools/probe-workbuddy-credentials.mjs --key <base64|hex>")
    return
  }

  const keyBytes = /^[0-9a-fA-F]{64}$/.test(providedKey)
    ? Buffer.from(providedKey, "hex")
    : Buffer.from(providedKey, "base64")
  if (keyBytes.length !== 32) {
    console.log(`结论：密钥长度 ${keyBytes.length}，不是 32 字节`)
    return
  }

  // 两种可能的挂法都试：直接用，或当作 atRestSecretKey 再哈希一层。
  const candidates = [
    ["直接用作 AES-256 key", { key: keyBytes, keyId: keyIdOf(keyBytes) }],
    ["按 atRestSecretKey 推导", normalizeAtRestKey(keyBytes.toString("base64"))],
    [
      "把入参当 atRestSecretKey（原文即 base64 文本）",
      normalizeAtRestKey(providedKey),
    ],
  ]

  for (const [label, candidate] of candidates) {
    const match = KEYID_RE.test(envelopes[0].envelope.keyId)
      ? candidate.keyId === envelopes[0].envelope.keyId
      : false
    const result = tryDecrypt(envelopes[0].envelope, candidate.key)
    console.log(
      `- ${label}: keyId=${candidate.keyId}${match ? "（与信封匹配）" : ""} 解密${
        result.ok ? `成功 → ${result.text.slice(0, 24)}…` : `失败（${result.error}）`
      }`,
    )
    if (result.ok) return
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main()
}
