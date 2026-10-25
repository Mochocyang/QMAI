import { UserRound } from "lucide-react"

import { useAccountStore } from "@/stores/account-store"
import { accountDisplayName, accountInitial } from "./account-display"

/** 顶栏账号入口：匿名是图标，有用户（含 booting 缓存）就显示首字母头像。 */
export function AccountButton() {
  const user = useAccountStore((state) => state.user)
  const openDialog = useAccountStore((state) => state.openDialog)

  const hasUser = user !== null
  const displayName = hasUser ? accountDisplayName(user.displayName, user.email) : ""

  return (
    <button
      type="button"
      className="ui-test-icon-btn account-entry"
      aria-label="账号"
      title={hasUser ? `${displayName} · ${user.email}` : "登录 / 注册"}
      onClick={() => openDialog()}
    >
      {hasUser ? (
        <span className="account-avatar" aria-hidden="true">
          {accountInitial(user.displayName, user.email)}
        </span>
      ) : (
        <UserRound aria-hidden="true" />
      )}
    </button>
  )
}
