import { useState } from "react"

import { accountAvatarUrl } from "@/lib/account/api"
import type { AccountUser } from "@/lib/account/types"

import { accountInitial } from "./account-display"

interface AccountAvatarProps {
  user: AccountUser
  baseUrl: string | null
  /** 尺寸修饰类；默认按 .account-avatar 的 30px。 */
  size?: "sm" | "lg"
}

/**
 * 账号头像：有头像就显示图片，否则回退到首字母色块。
 *
 * 图片加载失败（服务端还没同步、断网）时静默回退到首字母，不显示破图。
 */
export function AccountAvatar({ user, baseUrl, size = "sm" }: AccountAvatarProps) {
  const [failed, setFailed] = useState(false)

  const src = baseUrl ? accountAvatarUrl(baseUrl, user.id, user.avatarUpdatedAt) : null
  const className = size === "lg" ? "account-avatar account-avatar-lg" : "account-avatar"

  if (src && !failed) {
    return (
      <img
        className={`${className} account-avatar-image`}
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span className={className} aria-hidden="true">
      {accountInitial(user.displayName, user.email)}
    </span>
  )
}
