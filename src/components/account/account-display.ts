/** 账号 UI 共用的展示与确认文案。 */

/**
 * 退出登录的确认文案。
 *
 * 不能说「需要重新登录」了事：勾了「记住密码」的话本机 30 天内会自动回填
 * 邮箱和密码，照样一键登录。文案必须与实际行为一致，否则就是把用户没被告知
 * 的能力替他做了决定（同时也让人以为「退出 = 清凭据」而疏于取消勾选）。
 */
export const ACCOUNT_LOGOUT_CONFIRM =
  "退出后云同步会停用；若之前勾选了「记住密码」，本机 30 天内仍可一键登录。" +
  "本地小说和模型配置不会被删除。"

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
