/**
 * 三个网盘的静态元数据（纯数据，不含组件）。
 *
 * 登录方式决定设置页展示哪种表单：
 * - oauth-browser：跳浏览器授权（百度，简化模式免 SecretKey；这一版先隐藏）
 * - form：地址 + 用户名 + 密码（WebDAV，界面写「坚果云」）
 * - directory：选择本地目录（网盘客户端的同步目录）
 */

import type { CloudProviderId } from "./types"

export type CloudLoginKind = "oauth-browser" | "form" | "directory" | "device"

export interface CloudProviderMeta {
  id: CloudProviderId
  label: string
  hint: string
  login: CloudLoginKind
  /**
   * 这一版是否允许用户选择。
   *
   * 百度网盘的适配器、授权流程、凭据存储都还留着（内置功能不动），
   * 只是发布版先不对外开放：卡片置灰、点不动，等应用审核走完再放开。
   */
  available?: boolean
  /** 不可用时卡片副标题的说明。 */
  unavailableHint?: string
}

export const CLOUD_PROVIDERS: CloudProviderMeta[] = [
  // 百度网盘按产品要求先隐藏（不进列表 = 设置页不显示卡片）：
  //   { id: "baidu", label: "百度网盘", hint: "浏览器一键授权", login: "oauth-browser",
  //     available: false, unavailableHint: "后续版本开放" },
  // 适配器、授权流程、凭据存储都还在（类型 CloudProviderId 仍包含 "baidu"），
  // 想恢复时把上面这条取消注释即可。
  {
    // 技术上走 WebDAV 协议，但目标用户只认「坚果云」，所以卡片直接写产品名。
    id: "webdav",
    label: "坚果云",
    hint: "坚果云 WebDAV、NAS、自建",
    login: "form",
  },
  {
    id: "github",
    label: "GitHub",
    hint: "你自己的私有仓库",
    login: "device",
  },
  { id: "folder", label: "网盘本地文件夹", hint: "网盘客户端在你电脑上的同步目录", login: "directory" },
]

/**
 * 已知但没出现在 `CLOUD_PROVIDERS` 里的网盘名字。
 *
 * 历史数据里可能还存着 `provider: "baidu"`（老配置、同步记录里的批次），
 * 卡片列表里不再展示它，但界面上的名字不能因此退化成「未选择网盘」。
 */
const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  baidu: "百度网盘",
}

export function providerMeta(id: CloudProviderId | null): CloudProviderMeta | null {
  if (!id) return null
  return CLOUD_PROVIDERS.find((provider) => provider.id === id) ?? null
}

/**
 * 这一版能不能在界面上选它。
 *
 * 不在 `CLOUD_PROVIDERS` 里就一律不可用（被隐藏的百度属于这种：适配器还在，
 * 但界面不提供入口，store 层也要拦住绕过的调用）；只有明确 `available: false` 才置灰。
 */
export function isProviderAvailable(id: CloudProviderId): boolean {
  const meta = CLOUD_PROVIDERS.find((provider) => provider.id === id)
  if (!meta) return false
  return meta.available !== false
}

export function providerLabel(id: CloudProviderId | null): string {
  if (!id) return "未选择网盘"
  return providerMeta(id)?.label ?? KNOWN_PROVIDER_LABELS[id] ?? "未选择网盘"
}
