import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/platform"
import { httpClip } from "@/lib/http-adapter"
import { normalizeClipServerConfig } from "@/lib/project-store"
import type { ClipServerConfig } from "@/stores/wiki-store"

export interface ClipServerRuntimeConfig extends ClipServerConfig {
  status: "starting" | "running" | "port_conflict" | "error" | "stopped" | string
}

export function getClipServerUrl(config: Pick<ClipServerConfig, "port">): string {
  const normalized = normalizeClipServerConfig({ enabled: true, port: config.port })
  return `http://127.0.0.1:${normalized.port}`
}

export async function getClipServerConfig(): Promise<ClipServerRuntimeConfig> {
  if (!isTauri()) {
    const config = await httpClip.getConfig()
    return config as ClipServerRuntimeConfig
  }
  return invoke<ClipServerRuntimeConfig>("get_clip_server_config")
}

export async function setClipServerRuntimeConfig(config: ClipServerConfig): Promise<ClipServerRuntimeConfig> {
  const normalized = normalizeClipServerConfig(config)
  if (!isTauri()) {
    const result = await httpClip.setConfig(normalized)
    return result as ClipServerRuntimeConfig
  }
  return invoke<ClipServerRuntimeConfig>("set_clip_server_config", { config: normalized })
}

export async function stopClipServer(): Promise<ClipServerRuntimeConfig> {
  if (!isTauri()) {
    const result = await httpClip.stop()
    return result as ClipServerRuntimeConfig
  }
  return invoke<ClipServerRuntimeConfig>("stop_clip_server")
}
