/**
 * 本地「系统凭据加密」存储的薄封装。
 *
 * 用于把模型配置从明文（app-state.json 里的 providerConfigs）迁移到
 * 系统加密的文件（Windows 走 DPAPI，其它平台是 0600 权限文件）：
 * 里面存着 API Key，明文落盘等于谁拷走目录谁能用。
 *
 * 非 Tauri 环境（浏览器预览 / 单测）直接返回不可用，调用方自行回退明文存储。
 */

import { isTauri } from "@/lib/platform"

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

/** 写入加密副本；返回 false 表示当前环境不支持（调用方回退明文）。 */
export async function saveModelConfigsEncrypted(contents: string): Promise<boolean> {
  if (!isTauri()) return false
  await invokeCommand<void>("model_configs_save", { contents })
  return true
}

/** 读取加密副本；不存在或解不开返回 null。 */
export async function loadModelConfigsEncrypted(): Promise<string | null> {
  if (!isTauri()) return null
  const value = await invokeCommand<string | null>("model_configs_load")
  return value && value.length > 0 ? value : null
}

/** 删除加密副本（不存在也算成功）。 */
export async function clearModelConfigsEncrypted(): Promise<void> {
  if (!isTauri()) return
  await invokeCommand<void>("model_configs_clear")
}
