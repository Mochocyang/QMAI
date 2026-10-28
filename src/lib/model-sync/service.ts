/**
 * 模型配置同步的编排层：拉取 → 解密 → 合并 → 写回本地 →（必要时）推回云端。
 *
 * 这里只编排，不碰具体 IO：网络、Tauri store、secret store 都由调用方注入，
 * 所以整条流程可以在单测里用假 IO 跑通（见 service.test.ts）。
 *
 * 状态放在本地 `StateStore` 里，字段含义：
 * - `version`：云端版本号，推送时作为 `baseVersion`（乐观锁）；
 * - `snapshot`：上次同步时每个 provider 的 canonical JSON，用来判断「哪些改过」；
 * - `updatedAt`：每个 provider 的改动时间，合并时「同键取较新」要用；
 * - `lastPullAt` / `lastPushAt`：给调度器做节流与冷却。
 */

import type { ModelConfigFetchResult } from "@/lib/account/api"

import { canonicalJson, fingerprint } from "./canonical"
import { decryptModelConfig, encryptModelConfig } from "./crypto"
import { mergeProviderConfigs, type MergeOutcome, type SyncProviderEntry } from "./merge"

export const SYNC_PAYLOAD_SCHEMA = 1

export interface ModelSyncState {
  version: number
  lastPullAt: number | null
  lastPushAt: number | null
  /** provider key → 最近一次变化时间（毫秒）。 */
  updatedAt: Record<string, number>
  /** provider key → 上次同步时的 canonical JSON，用于判断内容是否改过。 */
  snapshot: Record<string, string>
}

export function emptySyncState(): ModelSyncState {
  return { version: 0, lastPullAt: null, lastPushAt: null, updatedAt: {}, snapshot: {} }
}

/**
 * 由当前本地配置 + 上次同步快照，算出每个 provider 的「改动时间」。
 *
 * 没有单独维护「谁改了配置」的回调：直接和快照比内容更可靠——任何入口
 * （设置页、批量导入、迁移脚本）改过都能被发现，不会漏标记。
 */
export function buildLocalEntries(
  configs: Record<string, unknown>,
  state: ModelSyncState,
  now: number,
): Record<string, SyncProviderEntry> {
  const entries: Record<string, SyncProviderEntry> = {}
  for (const key of Object.keys(configs)) {
    const serialized = fingerprint(canonicalJson(configs[key]))
    const changed = state.snapshot[key] !== serialized
    entries[key] = {
      key,
      value: configs[key],
      updatedAt: changed ? now : (state.updatedAt[key] ?? 0),
    }
  }
  return entries
}

/** 云端载荷：`{ schema, providers: { key: { value, updatedAt } } }`。 */
export function buildPayload(entries: Record<string, SyncProviderEntry>): string {
  return canonicalJson({
    schema: SYNC_PAYLOAD_SCHEMA,
    providers: Object.fromEntries(
      Object.entries(entries).map(([key, entry]) => [
        key,
        { value: entry.value, updatedAt: entry.updatedAt },
      ]),
    ),
  })
}

/** 解析云端载荷；结构不对抛错（会被上层当作「云端配置损坏」处理）。 */
export function parsePayload(text: string): Record<string, SyncProviderEntry> {
  const parsed = JSON.parse(text) as unknown
  const record = parsed as { schema?: unknown; providers?: unknown } | null
  if (!record || typeof record.providers !== "object" || record.providers === null) {
    throw new Error("云端配置结构无法识别")
  }
  const entries: Record<string, SyncProviderEntry> = {}
  for (const [key, raw] of Object.entries(record.providers as Record<string, unknown>)) {
    const item = raw as { value?: unknown; updatedAt?: unknown } | null
    const updatedAt = typeof item?.updatedAt === "number" && Number.isFinite(item.updatedAt)
      ? item.updatedAt
      : 0
    entries[key] = { key, value: item?.value, updatedAt }
  }
  return entries
}

/** 编排所需的全部 IO（生产环境由 model-sync-store 注入）。 */
export interface ModelSyncIo {
  now(): number
  loadConfigs(): Promise<Record<string, unknown>>
  saveConfigs(configs: Record<string, unknown>): Promise<void>
  loadState(): Promise<ModelSyncState>
  saveState(state: ModelSyncState): Promise<void>
  fetchCloud(ifNoneMatch?: string): Promise<ModelConfigFetchResult>
  putCloud(input: { payload: string; baseVersion: number | null }): Promise<{
    version: number
    updatedAt: number
  }>
}

function applyMerged(merged: Record<string, SyncProviderEntry>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(merged)) {
    // 云端有、本地删除过的 provider 会被补回本地——这是「永不删除」策略的一部分，
    // 由用户在设置页自己决定是否再删一次。
    next[key] = entry.value
  }
  return next
}

function nextState(
  state: ModelSyncState,
  entries: Record<string, SyncProviderEntry>,
  version: number,
  patch: Partial<Pick<ModelSyncState, "lastPullAt" | "lastPushAt">>,
): ModelSyncState {
  return {
    version,
    lastPullAt: patch.lastPullAt ?? state.lastPullAt,
    lastPushAt: patch.lastPushAt ?? state.lastPushAt,
    updatedAt: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.updatedAt])),
    // 快照只存指纹：同步状态会落盘到 app-state，存整份 JSON 等于把 API Key 又写回明文。
    snapshot: Object.fromEntries(
      Object.entries(entries).map(([key, entry]) => [key, fingerprint(canonicalJson(entry.value))]),
    ),
  }
}

export interface PullResult {
  status: "none" | "unchanged" | "merged"
  outcome?: MergeOutcome
  /** 合并后是否又推回云端（本地独有条目需要上传时）。 */
  pushed: boolean
  version: number
}

/**
 * 拉取并合并。合并结果与本地不同才写回配置；本地独有条目会自动推回云端（并集）。
 */
export async function pullAndMerge(io: ModelSyncIo, password: string): Promise<PullResult> {
  const now = io.now()
  const state = await io.loadState()
  const remote = await io.fetchCloud(state.version > 0 ? String(state.version) : undefined)

  if (remote.kind === "none") {
    await io.saveState({ ...state, lastPullAt: now })
    return { status: "none", pushed: false, version: state.version }
  }
  if (remote.kind === "unchanged") {
    await io.saveState({ ...state, lastPullAt: now })
    return { status: "unchanged", pushed: false, version: state.version }
  }

  const cloudEntries = parsePayload(await decryptModelConfig(remote.record.payload, password))
  const configs = await io.loadConfigs()
  const localEntries = buildLocalEntries(configs, state, now)
  const outcome = mergeProviderConfigs(localEntries, cloudEntries)

  if (outcome.changedLocally) {
    await io.saveConfigs(applyMerged(outcome.merged))
  }

  let version = remote.record.version
  let pushed = false
  // 本地独有 / 本地赢下的冲突 → 回写云端，否则下次另一台设备又会把它们当"新增"。
  const needsPush = outcome.addedToCloud.length > 0 ||
    outcome.conflicts.some((key) => canonicalJson(outcome.merged[key].value) === canonicalJson(localEntries[key]?.value))
  if (needsPush) {
    const result = await io.putCloud({
      payload: buildPayload(outcome.merged),
      baseVersion: remote.record.version,
    })
    version = result.version
    pushed = true
  }

  // 快照一律取「合并后的结果」：本地随后就是这个内容，以后比较才不会误判成"又改了"。
  // （之前只在推送成功时更新快照，没推送的那一轮会让本地独有条目每轮都被当成新增。）
  await io.saveState(
    nextState(state, outcome.merged, version, {
      lastPullAt: now,
      ...(pushed ? { lastPushAt: now } : {}),
    }),
  )

  return { status: "merged", outcome, pushed, version }
}

export interface PushResult {
  status: "pushed" | "unchanged" | "conflict"
  version: number
  payload?: string
}

/**
 * 推送本地改动。云端版本已经变过（409）时返回 `conflict`，
 * 由上层触发一次 pullAndMerge，让用户在合并结果里看到两侧差异。
 */
export async function pushLocal(io: ModelSyncIo, password: string): Promise<PushResult> {
  const now = io.now()
  const state = await io.loadState()
  const configs = await io.loadConfigs()
  const entries = buildLocalEntries(configs, state, now)

  const payload = buildPayload(entries)
  const changedKeys = Object.keys(entries).filter((key) => state.snapshot[key] !== canonicalJson(entries[key].value))
  if (changedKeys.length === 0 && state.version > 0) {
    return { status: "unchanged", version: state.version }
  }

  let result: { version: number; updatedAt: number }
  try {
    result = await io.putCloud({
      payload: await encryptModelConfig(payload, password),
      baseVersion: state.version > 0 ? state.version : null,
    })
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === "CONFLICT") return { status: "conflict", version: state.version, payload }
    throw error
  }

  await io.saveState(nextState(state, entries, result.version, { lastPushAt: now }))
  return { status: "pushed", version: result.version }
}
