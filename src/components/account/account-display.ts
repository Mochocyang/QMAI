/** 账号 UI 共用的展示与确认文案。 */

export const ACCOUNT_LOGOUT_CONFIRM =
  "退出后这台设备需要重新登录；本地小说和模型配置不会被删除。"

export function accountDisplayName(displayName: string, email: string): string {
  return displayName.trim() || email
}

export function accountInitial(displayName: string, email: string): string {
  return (Array.from(accountDisplayName(displayName, email))[0] ?? "").toUpperCase()
}

export function accountCreatedDate(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString("zh-CN")
}

/** 换头像时的文件选择框过滤；与后端白名单一致。 */
export const ACCOUNT_AVATAR_ACCEPT = "image/png,image/jpeg,image/webp"
