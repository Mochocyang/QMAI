import { useState } from "react"
import { LogIn, LogOut, UserPlus, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { useAccountStore } from "@/stores/account-store"
import {
  ACCOUNT_LOGOUT_CONFIRM,
  accountCreatedDate,
  accountDisplayName,
  accountInitial,
} from "@/components/account/account-display"

const ACCOUNT_DESCRIPTION =
  "登录青幕账号，会员权益与后续云服务会记在这个账号下。不登录也可以正常写作。"

/** 设置 › 账号：只展示登录态，不请求接口，也不影响其它设置。 */
export function AccountSection() {
  const status = useAccountStore((state) => state.status)
  const user = useAccountStore((state) => state.user)
  const sessionUnverified = useAccountStore((state) => state.sessionUnverified)
  const openDialog = useAccountStore((state) => state.openDialog)
  const logout = useAccountStore((state) => state.logout)
  const [loggingOut, setLoggingOut] = useState(false)

  const header = (
    <div>
      <h2 className="text-xl font-semibold">账号</h2>
      <p className="mt-1 text-sm text-muted-foreground">{ACCOUNT_DESCRIPTION}</p>
    </div>
  )

  if (status === "idle" || status === "booting") {
    return (
      <div data-ui="account-section" className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground" role="status">正在读取账号状态…</p>
      </div>
    )
  }

  if (status === "authenticated" && user) {
    const handleLogout = async () => {
      if (loggingOut) return
      if (!window.confirm(ACCOUNT_LOGOUT_CONFIRM)) return
      setLoggingOut(true)
      await logout()
      setLoggingOut(false)
      toast.success("已退出登录")
    }

    return (
      <div data-ui="account-section" className="space-y-6">
        {header}

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-base font-semibold text-primary-foreground">
              {accountInitial(user.displayName, user.email)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {accountDisplayName(user.displayName, user.email)}
              </p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                注册于 {accountCreatedDate(user.createdAt)}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-dashed border-border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              会员功能即将上线
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              会员权益筹备中。上线后会在这里显示套餐与到期时间。
            </p>
          </div>

          {sessionUnverified ? (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground" role="status">
              账号服务暂时不可用，已保留本地登录状态；会员与云同步稍后再试。
            </p>
          ) : null}

          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
            >
              <LogOut aria-hidden="true" />
              {loggingOut ? "正在退出…" : "退出登录"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-ui="account-section" className="space-y-6">
      {header}
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">{ACCOUNT_DESCRIPTION}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => openDialog("login")}>
            <LogIn aria-hidden="true" />
            登录
          </Button>
          <Button type="button" variant="outline" onClick={() => openDialog("register")}>
            <UserPlus aria-hidden="true" />
            注册
          </Button>
        </div>
      </div>
    </div>
  )
}
