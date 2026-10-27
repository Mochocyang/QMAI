import { UserRound } from "lucide-react"

import { useAccountStore } from "@/stores/account-store"
import { AccountAvatar } from "./account-avatar"
import { accountDisplayName } from "./account-display"

/** 顶栏账号入口：匿名是图标，有用户（含 booting 缓存）就显示头像。 */
export function AccountButton() {
  const user = useAccountStore((state) => state.user)
  const session = useAccountStore((state) => state.session)
  const openDialog = useAccountStore((state) => state.openDialog)

  const hasUser = user !== null
  const displayName = hasUser ? accountDisplayName(user.displayName, user.email) : ""
  const title = !hasUser
    ? "登录 / 注册"
    : displayName === user.email
      ? user.email
      : `${displayName} · ${user.email}`

  return (
    <button
      type="button"
      className="ui-test-icon-btn account-entry"
      aria-label="账号"
      title={title}
      onClick={() => openDialog()}
    >
      {hasUser ? (
        <AccountAvatar user={user} baseUrl={session?.baseUrl ?? null} />
      ) : (
        <UserRound aria-hidden="true" />
      )}
    </button>
  )
}
