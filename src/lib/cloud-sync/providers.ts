/**
 * 三个网盘的静态元数据（纯数据，不含组件）。
 *
 * 登录方式决定设置页展示哪种表单：
 * - oauth-browser：跳浏览器授权（百度，简化模式免 SecretKey）
 * - form：地址 + 用户名 + 密码（WebDAV）
 * - directory：选择本地目录（网盘客户端的同步目录）
 */

import type { CloudProviderId } from "./types"

export type CloudLoginKind = "oauth-browser" | "form" | "directory"

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
  {
    id: "baidu",
    label: "百度网盘",
    hint: "浏览器一键授权",
    login: "oauth-browser",
    available: false,
    unavailableHint: "后续版本开放",
  },
  { id: "webdav", label: "WebDAV", hint: "坚果云、NAS、自建", login: "form" },
  { id: "folder", label: "网盘本地文件夹", hint: "网盘客户端在你电脑上的同步目录", login: "directory" },
]

export function providerMeta(id: CloudProviderId | null): CloudProviderMeta | null {
  if (!id) return null
  return CLOUD_PROVIDERS.find((provider) => provider.id === id) ?? null
}

/** 这一版能不能在界面上选它。 */
export function isProviderAvailable(id: CloudProviderId): boolean {
  return CLOUD_PROVIDERS.find((provider) => provider.id === id)?.available !== false
}

export function providerLabel(id: CloudProviderId | null): string {
  return providerMeta(id)?.label ?? "未选择网盘"
}
