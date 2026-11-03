import { useEffect, useState } from "react"

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
 * 失败状态绑定到「当前头像 URL」而不是布尔值：换头像后 URL 变了会重新尝试，
 * 否则一旦某次加载失败，上传成功也会一直停在首字母。
 */
export function AccountAvatar({ user, baseUrl, size = "sm" }: AccountAvatarProps) {
  const src = baseUrl ? accountAvatarUrl(baseUrl, user.avatarToken, user.avatarUpdatedAt) : null
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  // 换头像（URL 变化）时清掉上一次的失败标记。
  useEffect(() => {
    setFailedSrc(null)
  }, [src])

  const className = size === "lg" ? "account-avatar account-avatar-lg" : "account-avatar"

  if (src && failedSrc !== src) {
    return (
      <img
        className={`${className} account-avatar-image`}
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailedSrc(src)}
      />
    )
  }

  return (
    <span className={className} aria-hidden="true">
      {accountInitial(user.displayName, user.email)}
    </span>
  )
}
