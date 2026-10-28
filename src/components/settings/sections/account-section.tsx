import { useRef, useState, type ChangeEvent } from "react"
import { Check, ImageUp, KeyRound, LogIn, LogOut, Pencil, UserPlus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { processAvatarImage } from "@/lib/account/avatar"
import { accountErrorMessage, isAccountApiError } from "@/lib/account/errors"
import { toast } from "@/lib/toast"
import { useAccountStore } from "@/stores/account-store"
import { AccountAvatar } from "@/components/account/account-avatar"
import {
  ACCOUNT_AVATAR_ACCEPT,
  ACCOUNT_LOGOUT_CONFIRM,
  accountCreatedDate,
  accountDisplayName,
} from "@/components/account/account-display"

const ACCOUNT_DESCRIPTION =
  "登录青幕账号，云同步与后续服务会记在这个账号下。不登录也可以正常写作。"

/** 昵称长度上限，与服务端保持一致（按字符数）。 */
const DISPLAY_NAME_MAX_CHARS = 24
/** 昵称修改冷却：30 天（服务端口径，这里只用于提示下次可改时间）。 */
const NAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000

function nextNameChangeDate(updatedAt: number | null): Date | null {
  if (!updatedAt) return null
  return new Date(updatedAt * 1000 + NAME_CHANGE_COOLDOWN_MS)
}

/** 设置 › 账号：只展示登录态，不请求接口，也不影响其它设置。 */
export function AccountSection() {
  const status = useAccountStore((state) => state.status)
  const user = useAccountStore((state) => state.user)
  const session = useAccountStore((state) => state.session)
  const sessionUnverified = useAccountStore((state) => state.sessionUnverified)
  const openDialog = useAccountStore((state) => state.openDialog)
  const openPasswordPanel = useAccountStore((state) => state.openPasswordPanel)
  const logout = useAccountStore((state) => state.logout)
  const setAvatar = useAccountStore((state) => state.setAvatar)
  const renameDisplayName = useAccountStore((state) => state.rename)
  const [loggingOut, setLoggingOut] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [nameBusy, setNameBusy] = useState(false)
  const [nameError, setNameError] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const header = (
    <div>
      <h2 className="text-xl font-semibold">账号</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        账号用于云同步与后续服务；本地写作和模型配置始终不受影响。
      </p>
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
    // 闭包里用这份常量：直接引用 `user` 会丢掉上面的非空收窄
    const profileUser = user

    const handleLogout = async () => {
      if (loggingOut) return
      if (!window.confirm(ACCOUNT_LOGOUT_CONFIRM)) return
      setLoggingOut(true)
      await logout()
      setLoggingOut(false)
      toast.success("已退出登录")
    }

    const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ""
      if (!file) return

      setAvatarBusy(true)
      try {
        const processed = await processAvatarImage(file)
        await setAvatar({ data: processed.data, mime: processed.mime })
        toast.success("头像已更新")
      } catch (error) {
        toast.error(accountErrorMessage(error))
      } finally {
        setAvatarBusy(false)
      }
    }

    const cooldownUntil = nextNameChangeDate(profileUser.displayNameUpdatedAt)
    const cooldownActive = cooldownUntil !== null && cooldownUntil.getTime() > Date.now()

    function startRename() {
      setNameDraft(accountDisplayName(profileUser.displayName, profileUser.email))
      setNameError("")
      setEditingName(true)
    }

    async function submitRename() {
      const next = nameDraft.trim()
      if (!next) {
        setNameError("昵称不能为空。")
        return
      }
      if (Array.from(next).length > DISPLAY_NAME_MAX_CHARS) {
        setNameError(`昵称最多 ${DISPLAY_NAME_MAX_CHARS} 个字。`)
        return
      }
      if (next === profileUser.displayName) {
        setEditingName(false)
        return
      }
      setNameBusy(true)
      setNameError("")
      try {
        await renameDisplayName(next)
        setEditingName(false)
        toast.success("昵称已更新")
      } catch (error) {
        // 服务端是权威：冷却期内的 429 会带 NAME_LOCKED，这里按文案提示即可
        setNameError(
          isAccountApiError(error) && error.code === "NAME_LOCKED"
            ? "昵称每个月只能修改一次，请在提示的日期之后再试。"
            : accountErrorMessage(error),
        )
      } finally {
        setNameBusy(false)
      }
    }

    return (
      <div data-ui="account-section" className="space-y-6">
        {header}

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <AccountAvatar user={user} baseUrl={session?.baseUrl ?? null} size="lg" />
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    aria-label="昵称"
                    value={nameDraft}
                    autoFocus
                    maxLength={DISPLAY_NAME_MAX_CHARS}
                    disabled={nameBusy}
                    onChange={(event) => setNameDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        void submitRename()
                      } else if (event.key === "Escape") {
                        event.preventDefault()
                        setEditingName(false)
                        setNameError("")
                      }
                    }}
                    className="h-8 max-w-56"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    aria-label="保存昵称"
                    disabled={nameBusy}
                    onClick={() => void submitRename()}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    aria-label="取消修改昵称"
                    disabled={nameBusy}
                    onClick={() => {
                      setEditingName(false)
                      setNameError("")
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium">
                    {accountDisplayName(user.displayName, user.email)}
                  </p>
                  {cooldownActive ? null : (
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label="修改昵称"
                      title="修改昵称（每月一次）"
                      onClick={startRename}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                注册于 {accountCreatedDate(user.createdAt)}
                {cooldownActive && cooldownUntil
                  ? ` · 昵称下次可修改：${cooldownUntil.toLocaleDateString("zh-CN")}`
                  : ""}
              </p>
              {nameError ? <p className="mt-1 text-xs text-destructive">{nameError}</p> : null}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={avatarBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageUp aria-hidden="true" />
              {avatarBusy ? "处理中…" : user.avatarUpdatedAt ? "更换头像" : "上传头像"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openPasswordPanel()}
            >
              <KeyRound aria-hidden="true" />
              修改密码
            </Button>            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
            >
              <LogOut aria-hidden="true" />
              {loggingOut ? "正在退出…" : "退出登录"}
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCOUNT_AVATAR_ACCEPT}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => void handleAvatarFile(event)}
          />

          {sessionUnverified ? (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground" role="status">
              账号服务暂时不可用，已保留本地登录状态；云同步稍后再试。
            </p>
          ) : null}
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
