import { UserRound } from "lucide-react"

import { useAccountStore } from "@/stores/account-store"
import "./account-dialog.css"

/** 顶栏账号入口：匿名是图标，登录后是显示名首字母头像。 */
export function AccountButton() {
  const user = useAccountStore((state) => state.user)
  const status = useAccountStore((state) => state.status)
  const openDialog = useAccountStore((state) => state.openDialog)

  const authenticated = status === "authenticated" && user !== null
  const displayName = authenticated ? (user.displayName.trim() || user.email) : ""
  const initial = authenticated ? (Array.from(displayName)[0] ?? "").toUpperCase() : ""

  return (
    <button
      type="button"
      className="ui-test-icon-btn account-entry"
      aria-label="账号"
      title={authenticated ? `${user.displayName} · ${user.email}` : "登录 / 注册"}
      onClick={() => openDialog()}
    >
      {authenticated ? (
        <span className="account-avatar" aria-hidden="true">{initial}</span>
      ) : (
        <UserRound aria-hidden="true" />
      )}
    </button>
  )
}
