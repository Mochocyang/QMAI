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

/**
 * 载荷版本。
 *
 * 2 = 在 `providers`（大语言模型的各家提供方）之外多了 `settings`
 * （重排模型 / 向量模型的整份配置）。老客户端只读 `providers`，
 * 多出来的字段会被它忽略（它推送时会把 settings 丢掉，属于可接受的降级）。
 */
export const SYNC_PAYLOAD_SCHEMA = 2

/**
 * 非 provider 的那几类配置在**同步状态**里的键前缀。
 *
 * 为什么需要前缀：`ModelSyncState.snapshot/updatedAt` 是按名字存指纹的，
 * provider 的 id 与 `rerank` / `embedding` 万一同名会互相覆盖；
 * 只在状态里加前缀，写回本地/上传云端时再去掉（载荷里仍是干净的键名）。
 */
const SETTINGS_STATE_PREFIX = "settings:"

export interface SyncPayload {
  /** 大语言模型的各提供方配置（含 API Key）。 */
  providers: Record<string, SyncProviderEntry>
  /** 重排模型 / 向量模型等整份配置。 */
  settings: Record<string, SyncProviderEntry>
}

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

/** 云端载荷：`{ schema, providers: {...}, settings: {...} }`。 */
export function buildPayload(
  providers: Record<string, SyncProviderEntry>,
  settings: Record<string, SyncProviderEntry> = {},
): string {
  return canonicalJson({
    schema: SYNC_PAYLOAD_SCHEMA,
    providers: toWire(providers),
    settings: toWire(settings),
  })
}

function toWire(entries: Record<string, SyncProviderEntry>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [key, { value: entry.value, updatedAt: entry.updatedAt }]),
  )
}

function fromWire(raw: unknown): Record<string, SyncProviderEntry> {
  const entries: Record<string, SyncProviderEntry> = {}
  if (!raw || typeof raw !== "object") return entries
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const item = value as { value?: unknown; updatedAt?: unknown } | null
    const updatedAt = typeof item?.updatedAt === "number" && Number.isFinite(item.updatedAt)
      ? item.updatedAt
      : 0
    entries[key] = { key, value: item?.value, updatedAt }
  }
  return entries
}

/**
 * 解析云端载荷；结构不对抛错（会被上层当作「云端配置损坏」处理）。
 * `schema: 1` 的老载荷没有 `settings`，按空处理即可，不用报错。
 */
export function parsePayload(text: string): SyncPayload {
  const parsed = JSON.parse(text) as unknown
  const record = parsed as { schema?: unknown; providers?: unknown; settings?: unknown } | null
  if (!record || typeof record.providers !== "object" || record.providers === null) {
    throw new Error("云端配置结构无法识别")
  }
  return {
    providers: fromWire(record.providers),
    settings: fromWire(record.settings),
  }
}

/** 编排所需的全部 IO（生产环境由 model-sync-store 注入）。 */
export interface ModelSyncIo {
  now(): number
  loadConfigs(): Promise<Record<string, unknown>>
  saveConfigs(configs: Record<string, unknown>): Promise<void>
  /** 重排 / 向量这类「整份配置」的读取（键：rerank、embedding…）。 */
  loadSettings(): Promise<Record<string, unknown>>
  saveSettings(settings: Record<string, unknown>): Promise<void>
  loadState(): Promise<ModelSyncState>
  saveState(state: ModelSyncState): Promise<void>
  fetchCloud(ifNoneMatch?: string): Promise<ModelConfigFetchResult>
  putCloud(input: { payload: string; baseVersion: number | null }): Promise<{
    version: number
    updatedAt: number
  }>
}

/** settings 的键在同步状态里加前缀，写回本地/上传时去掉。 */
export function prefixSettingsKeys(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [`${SETTINGS_STATE_PREFIX}${key}`, value]))
}

function unprefixSettingsKeys(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key.startsWith(SETTINGS_STATE_PREFIX) ? key.slice(SETTINGS_STATE_PREFIX.length) : key,
      value,
    ]),
  )
}

function prefixEntries(entries: Record<string, SyncProviderEntry>): Record<string, SyncProviderEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [
      `${SETTINGS_STATE_PREFIX}${key}`,
      { ...entry, key: `${SETTINGS_STATE_PREFIX}${key}` },
    ]),
  )
}

function unprefixEntries(entries: Record<string, SyncProviderEntry>): Record<string, SyncProviderEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => {
      const name = key.startsWith(SETTINGS_STATE_PREFIX) ? key.slice(SETTINGS_STATE_PREFIX.length) : key
      return [name, { ...entry, key: name }]
    }),
  )
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
  /** 重排 / 向量配置这一轮是否被改动（界面提示用）。 */
  settingsChanged?: boolean
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

  const cloud = parsePayload(await decryptModelConfig(remote.record.payload, password))
  const configs = await io.loadConfigs()
  const settings = await io.loadSettings()
  const localEntries = buildLocalEntries(configs, state, now)
  // 重排 / 向量：状态里的键带前缀，和 provider 的 id 分开放，避免同名互相覆盖。
  const localSettings = buildLocalEntries(prefixSettingsKeys(settings), state, now)

  const outcome = mergeProviderConfigs(localEntries, cloud.providers)
  const settingsOutcome = mergeProviderConfigs(localSettings, prefixEntries(cloud.settings))

  if (outcome.changedLocally) {
    await io.saveConfigs(applyMerged(outcome.merged))
  }
  if (settingsOutcome.changedLocally) {
    await io.saveSettings(unprefixSettingsKeys(applyMerged(settingsOutcome.merged)))
  }

  const mergedAll = { ...outcome.merged, ...settingsOutcome.merged }

  let version = remote.record.version
  let pushed = false
  // 本地独有 / 本地赢下的冲突 → 回写云端，否则下次另一台设备又会把它们当"新增"。
  const needsPush = outcome.addedToCloud.length > 0 ||
    settingsOutcome.addedToCloud.length > 0 ||
    outcome.conflicts.some((key) => canonicalJson(outcome.merged[key].value) === canonicalJson(localEntries[key]?.value))
  if (needsPush) {
    const result = await io.putCloud({
      payload: buildPayload(outcome.merged, unprefixEntries(settingsOutcome.merged)),
      baseVersion: remote.record.version,
    })
    version = result.version
    pushed = true
  }

  // 快照一律取「合并后的结果」：本地随后就是这个内容，以后比较才不会误判成"又改了"。
  // （之前只在推送成功时更新快照，没推送的那一轮会让本地独有条目每轮都被当成新增。）
  await io.saveState(
    nextState(state, mergedAll, version, {
      lastPullAt: now,
      ...(pushed ? { lastPushAt: now } : {}),
    }),
  )

  return {
    status: "merged",
    outcome,
    pushed,
    version,
    settingsChanged: settingsOutcome.changedLocally || settingsOutcome.addedToCloud.length > 0,
  }
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
  const settings = await io.loadSettings()
  const entries = buildLocalEntries(configs, state, now)
  const settingsEntries = buildLocalEntries(prefixSettingsKeys(settings), state, now)
  const allEntries = { ...entries, ...settingsEntries }

  const payload = buildPayload(entries, unprefixEntries(settingsEntries))
  const changedKeys = Object.keys(allEntries).filter(
    (key) => state.snapshot[key] !== canonicalJson(allEntries[key].value),
  )
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

  await io.saveState(nextState(state, allEntries, result.version, { lastPushAt: now }))
  return { status: "pushed", version: result.version }
}

export interface RestoreResult {
  status: "none" | "restored"
  /** 恢复了多少个 provider（大语言模型）。 */
  providers: number
  /** 恢复了多少组「整份配置」（重排 / 向量）。 */
  settings: number
  version: number
}

/**
 * 「从云端下载」：把云端的配置**填回本机**（用户 2026-10-28 提的需求）。
 *
 * 为什么不能只靠同步：自动同步是「并集 + 取较新」，它不会把用户主动删掉的条目
 * 硬按回来，也不会在本地被改坏时把云端那份翻出来覆盖。所以需要一个显式入口：
 * - 云端有的 key，一律覆盖本地同名项（这就是"填回设置框"）；
 * - 本地独有的 key 保留（下载不该顺手删本地东西）；
 * - 恢复后把同步状态对齐云端版本，避免下一拍又把本机旧值推上去。
 */
export async function restoreFromCloud(io: ModelSyncIo, password: string): Promise<RestoreResult> {
  const now = io.now()
  // 不带 If-None-Match：这一步就是要拿到云端当前内容，不能吃 304。
  const remote = await io.fetchCloud()
  if (remote.kind !== "config") {
    return { status: "none", providers: 0, settings: 0, version: 0 }
  }
  const cloud = parsePayload(await decryptModelConfig(remote.record.payload, password))

  const localConfigs = await io.loadConfigs()
  const localSettings = await io.loadSettings()
  await io.saveConfigs({ ...localConfigs, ...applyMerged(cloud.providers) })
  await io.saveSettings({ ...localSettings, ...applyMerged(cloud.settings) })

  const state = await io.loadState()
  await io.saveState(
    nextState(
      state,
      { ...cloud.providers, ...prefixEntries(cloud.settings) },
      remote.record.version,
      { lastPullAt: now },
    ),
  )

  return {
    status: "restored",
    providers: Object.keys(cloud.providers).length,
    settings: Object.keys(cloud.settings).length,
    version: remote.record.version,
  }
}

/**
 * 本机是否有「同步过、后来被删掉」的条目。
 *
 * 用途：自动同步的推送分支一旦把这种条目丢掉，云端那份就再也拉不回来了
 * （服务端只留最新一份）。检测到删除时改走 pull+merge，让并集策略先把它们补回来。
 * 注意快照只存指纹、不存明文，所以这里只能判断「有删除」，具体内容得靠拉取。
 */
export async function hasPendingDeletion(io: ModelSyncIo): Promise<boolean> {
  const state = await io.loadState()
  const configs = await io.loadConfigs()
  const settings = await io.loadSettings()
  const present = new Set([
    ...Object.keys(configs),
    ...Object.keys(prefixSettingsKeys(settings)),
  ])
  return Object.keys(state.snapshot).some((key) => !present.has(key))
}
