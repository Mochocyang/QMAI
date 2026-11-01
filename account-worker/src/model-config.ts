/**
 * 模型配置同步：服务端只保管**密文**。
 *
 * 设计要点（与客户端约定）：
 * - `payload` 是客户端用「同步密码」派生的密钥做 AES-GCM 加密后的 JSON，
 *   服务端从不解析内容，也拿不到 apiKey / baseUrl；
 * - `version` 每次写入自增，配合 `baseVersion` 做乐观锁：旧设备不能覆盖新配置；
 * - 只保留**最新一份**（不做历史版本），避免无谓占用 D1 额度；
 * - 同步过程永远不删除条目，只有用户显式调用 DELETE 才清空。
 */

import type { Env } from "./types"
import { requireUser } from "./auth"
import { consumeRateLimit } from "./db"
import {
  MAX_MODEL_CONFIG_BODY_BYTES,
  failure,
  jsonSuccess,
  readJsonBody,
} from "./http"

/** 表里的行（给内部用）。 */
interface ModelConfigRow {
  payload: string
  version: number
  updated_at: number
  device_label: string | null
}

/** 客户端上传的加密信封（服务端只做形状校验，不做语义解析）。 */
export interface ModelConfigEnvelope {
  v: number
  kdf: string
  iter: number
  salt: string
  iv: string
  ct: string
}

export type ParsedPutBody =
  | { ok: true; payload: string; baseVersion: number | null; deviceLabel: string }
  /** reason 会原样返回给客户端：默认的「请检查填写的内容」对用户毫无指向性。 */
  | { ok: false; reason: string }

const PAYLOAD_MIN_CHARS = 32
const PAYLOAD_MAX_CHARS = 60_000
const DEVICE_LABEL_MAX_CHARS = 48
const WRITE_LIMIT_PER_MINUTE = 30

function currentSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** 校验信封形状：必须是对象且六个字段齐全、类型正确。纯函数，便于单测。 */
export function isModelConfigEnvelope(value: unknown): value is ModelConfigEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.v === "number" &&
    Number.isInteger(record.v) &&
    record.v > 0 &&
    typeof record.kdf === "string" &&
    typeof record.iter === "number" &&
    Number.isFinite(record.iter) &&
    record.iter > 0 &&
    typeof record.salt === "string" &&
    typeof record.iv === "string" &&
    typeof record.ct === "string"
  )
}

/**
 * 校验 PUT 请求体。payload 必须是「信封 JSON 的字符串」，长度有上下限：
 * 太小说明没内容，太大说明客户端的配置异常膨胀（也顺便兜住误用）。
 */
export function parsePutBody(body: Record<string, unknown>): ParsedPutBody {
  const payload = body.payload
  if (typeof payload !== "string") {
    return { ok: false, reason: "同步内容的 payload 字段必须是字符串。" }
  }
  if (payload.length < PAYLOAD_MIN_CHARS) {
    return { ok: false, reason: "同步内容为空，没有可上传的配置。" }
  }
  if (payload.length > PAYLOAD_MAX_CHARS) {
    return {
      ok: false,
      reason: `同步内容过大（${payload.length} 字符，上限 ${PAYLOAD_MAX_CHARS}）。请减少模型数量或精简配置后再试。`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { ok: false, reason: "同步内容不是有效的加密信封（JSON 解析失败）。" }
  }
  if (!isModelConfigEnvelope(parsed)) {
    return { ok: false, reason: "同步内容的加密信封缺少字段（需要 v/kdf/iter/salt/iv/ct）。" }
  }

  const rawBaseVersion = body.baseVersion
  let baseVersion: number | null = null
  if (rawBaseVersion !== undefined && rawBaseVersion !== null) {
    if (typeof rawBaseVersion !== "number" || !Number.isInteger(rawBaseVersion) || rawBaseVersion < 0) {
      return { ok: false, reason: "baseVersion 必须是 >= 0 的整数或 null。" }
    }
    baseVersion = rawBaseVersion
  }

  const rawLabel = body.deviceLabel
  const deviceLabel =
    typeof rawLabel === "string" ? rawLabel.trim().slice(0, DEVICE_LABEL_MAX_CHARS) : ""

  return { ok: true, payload, baseVersion, deviceLabel }
}

/** GET /v1/model-config —— 没有配置返回 404；`If-None-Match` 命中当前版本返回 304。 */
export async function handleGetModelConfig(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const auth = await requireUser(request, env, now)
  if (!auth.ok) return auth.response

  const row = await env.DB.prepare(
    `SELECT payload, version, updated_at, device_label FROM model_configs WHERE user_id = ?1`,
  )
    .bind(auth.user.id)
    .first<ModelConfigRow>()

  if (!row) return failure("NOT_FOUND", "云端还没有保存过模型配置。")

  const ifNoneMatch = request.headers.get("If-None-Match")
  if (ifNoneMatch && ifNoneMatch.replace(/"/g, "") === String(row.version)) {
    return new Response(null, {
      status: 304,
      headers: { "ETag": `"${row.version}"`, "Cache-Control": "no-store" },
    })
  }

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        payload: row.payload,
        version: row.version,
        updatedAt: row.updated_at,
        deviceLabel: row.device_label ?? "",
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "ETag": `"${row.version}"`,
      },
    },
  )
}

/** PUT /v1/model-config —— 覆盖写入；`baseVersion` 与云端不一致返回 409。 */
export async function handlePutModelConfig(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const auth = await requireUser(request, env, now)
  if (!auth.ok) return auth.response

  const parsed = await readJsonBody(request, MAX_MODEL_CONFIG_BODY_BYTES)
  if (!parsed.ok) return parsed.response

  const body = parsePutBody(parsed.body)
  if (!body.ok) {
    // 把具体原因返回给客户端：否则用户只看到「请检查填写的内容」无从下手。
    console.warn("[model-config] put_rejected", { reason: body.reason })
    return failure("VALIDATION", body.reason)
  }

  // 写入限流：这是唯一会写库的接口，防住"每改一个字就推一次"的客户端。
  const limit = await consumeRateLimit(
    env.DB,
    `model-config:${auth.user.id}`,
    WRITE_LIMIT_PER_MINUTE,
    60,
    now,
  )
  if (!limit.allowed) return failure("RATE_LIMITED")

  const existing = await env.DB.prepare(
    `SELECT version FROM model_configs WHERE user_id = ?1`,
  )
    .bind(auth.user.id)
    .first<{ version: number }>()
  const currentVersion = existing?.version ?? 0

  if (body.baseVersion !== null && body.baseVersion !== currentVersion) {
    return failure("CONFLICT")
  }

  const nextVersion = currentVersion + 1
  await env.DB.prepare(
    `INSERT INTO model_configs (user_id, payload, version, updated_at, device_label)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET
       payload = ?2,
       version = ?3,
       updated_at = ?4,
       device_label = ?5`,
  )
    .bind(auth.user.id, body.payload, nextVersion, now, body.deviceLabel)
    .run()

  return jsonSuccess({ version: nextVersion, updatedAt: now })
}

/** DELETE /v1/model-config —— 用户主动清空云端配置。 */
export async function handleDeleteModelConfig(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const auth = await requireUser(request, env, now)
  if (!auth.ok) return auth.response

  await env.DB.prepare(`DELETE FROM model_configs WHERE user_id = ?1`)
    .bind(auth.user.id)
    .run()

  return jsonSuccess({ deleted: true })
}
