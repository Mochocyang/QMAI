import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { processAvatarImage } from "@/lib/account/avatar"
import { accountErrorMessage } from "@/lib/account/errors"
import type { AccountAuthMode } from "@/lib/account/types"
import {
  isSixDigitCode,
  isValidEmail,
  validateAccountPassword,
} from "@/lib/account/validation"
import { toast } from "@/lib/toast"
import { useAccountStore } from "@/stores/account-store"
import { AccountAvatar } from "./account-avatar"
import {
  ACCOUNT_AVATAR_ACCEPT,
  ACCOUNT_LOGOUT_CONFIRM,
  accountCreatedDate,
  accountDisplayName,
} from "./account-display"
import { AccountPasswordForm } from "./account-password-form"
import "./account-dialog.css"

interface AuthTab {
  mode: AccountAuthMode
  label: string
}

type AuthField = "email" | "code" | "password"

interface ValidationIssue {
  field: AuthField
  message: string
}

const AUTH_PANEL_ID = "account-auth-panel"
const ERROR_ID = "account-error"
const BASE_TABS: AuthTab[] = [
  { mode: "login", label: "登录" },
  { mode: "register", label: "注册" },
]
const DEFAULT_COOLDOWN_SECONDS = 60

/** 登录 / 注册 / 重置密码共用一个弹窗，所有会话变化都由 store 驱动。 */
export function AccountDialog() {
  const dialogOpen = useAccountStore((state) => state.dialogOpen)
  const authMode = useAccountStore((state) => state.authMode)
  const status = useAccountStore((state) => state.status)
  const user = useAccountStore((state) => state.user)
  const sessionError = useAccountStore((state) => state.error)
  const sessionUnverified = useAccountStore((state) => state.sessionUnverified)
  const closeDialog = useAccountStore((state) => state.closeDialog)
  const setAuthMode = useAccountStore((state) => state.setAuthMode)
  const clearError = useAccountStore((state) => state.clearError)
  const login = useAccountStore((state) => state.login)
  const register = useAccountStore((state) => state.register)
  const sendCode = useAccountStore((state) => state.sendCode)
  const resetPassword = useAccountStore((state) => state.resetPassword)
  const logout = useAccountStore((state) => state.logout)
  const setAvatar = useAccountStore((state) => state.setAvatar)
  const removeAvatar = useAccountStore((state) => state.removeAvatar)
  const session = useAccountStore((state) => state.session)
  const openPasswordPanelRequested = useAccountStore((state) => state.passwordPanelRequested)
  const clearPasswordPanelRequest = useAccountStore((state) => state.clearPasswordPanelRequest)

  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<AuthField | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const [editingPassword, setEditingPassword] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const composingRef = useRef(false)
  const requestEpochRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const authenticated = status === "authenticated" && user !== null
  const displayedError = localError ?? sessionError
  const busy = submitting || loggingOut || sendingCode

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((remaining) => Math.max(0, remaining - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  // 模式切换会作废在途请求，并清错误、验证码与敏感字段；邮箱保留。
  useEffect(() => {
    requestEpochRef.current += 1
    composingRef.current = false
    setLocalError(null)
    setFieldError(null)
    setDevCode(null)
    setCode("")
    setPassword("")
    setShowPassword(false)
    setSubmitting(false)
    setSendingCode(false)
    setCooldown(0)
  }, [authMode])

  // 设置页点「修改密码」时，弹窗打开后直接进入改密面板。
  useEffect(() => {
    if (!dialogOpen || !openPasswordPanelRequested || !authenticated) return
    setEditingPassword(true)
    clearPasswordPanelRequest()
  }, [dialogOpen, openPasswordPanelRequested, authenticated, clearPasswordPanelRequest])

  // 关闭时同样作废在途请求，不能把密码/验证码或旧错误留在下一次打开里。
  useEffect(() => {
    if (dialogOpen) return
    requestEpochRef.current += 1
    composingRef.current = false
    setPassword("")
    setCode("")
    setLocalError(null)
    setFieldError(null)
    setDevCode(null)
    setShowPassword(false)
    setSubmitting(false)
    setSendingCode(false)
    setCooldown(0)
    setLoggingOut(false)
    setEditingPassword(false)
    setAvatarBusy(false)
  }, [dialogOpen])

  const compositionHandlers = {
    onCompositionStart: () => {
      composingRef.current = true
    },
    onCompositionEnd: () => {
      composingRef.current = false
    },
  }

  const handleCompositionKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing)) {
      event.preventDefault()
    }
  }

  const clearFeedback = () => {
    setLocalError(null)
    setFieldError(null)
    if (useAccountStore.getState().error) clearError()
  }

  const changeEmail = (value: string) => {
    setEmail(value)
    setCode("")
    setDevCode(null)
    setCooldown(0)
    clearFeedback()
  }

  const changeCode = (value: string) => {
    setCode(value.replace(/\s+/g, ""))
    clearFeedback()
  }

  const changePassword = (value: string) => {
    setPassword(value)
    clearFeedback()
  }

  const switchMode = (mode: AccountAuthMode) => {
    if (mode === authMode || busy) return
    setAuthMode(mode)
  }

  const validate = (normalizedEmail: string): ValidationIssue | null => {
    if (!isValidEmail(normalizedEmail)) {
      return { field: "email", message: "请输入有效的邮箱地址。" }
    }
    if (authMode !== "login" && !isSixDigitCode(code)) {
      return { field: "code", message: "请输入 6 位数字验证码。" }
    }
    const passwordError = validateAccountPassword(password)
    if (passwordError) return { field: "password", message: passwordError }
    return null
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nativeEvent = event.nativeEvent as Event & { isComposing?: boolean }
    if (composingRef.current || nativeEvent.isComposing) return
    if (busy) return

    const normalizedEmail = email.trim().toLowerCase()
    const issue = validate(normalizedEmail)
    if (issue) {
      setLocalError(issue.message)
      setFieldError(issue.field)
      return
    }

    clearFeedback()
    setSubmitting(true)
    const epoch = requestEpochRef.current
    try {
      if (authMode === "login") {
        await login({ email: normalizedEmail, password })
        toast.success("登录成功")
      } else if (authMode === "register") {
        await register({ email: normalizedEmail, code, password })
        toast.success("注册成功，已自动登录")
      } else {
        await resetPassword({ email: normalizedEmail, code, password })
        setCode("")
        setPassword("")
        toast.success("密码已重置，请用新密码登录")
      }
    } catch (error) {
      if (requestEpochRef.current !== epoch) return
      setFieldError(null)
      setLocalError(accountErrorMessage(error))
    } finally {
      if (requestEpochRef.current === epoch) setSubmitting(false)
    }
  }

  const requestCode = async () => {
    if (sendingCode || cooldown > 0 || submitting) return

    const normalizedEmail = email.trim().toLowerCase()
    if (!isValidEmail(normalizedEmail)) {
      setLocalError("请输入有效的邮箱地址。")
      setFieldError("email")
      return
    }

    clearFeedback()
    setSendingCode(true)
    const epoch = requestEpochRef.current
    try {
      const result = await sendCode(normalizedEmail, authMode === "reset" ? "reset" : "register")
      if (requestEpochRef.current !== epoch) return
      const seconds = Number.isFinite(result.cooldownSeconds) && result.cooldownSeconds > 0
        ? Math.floor(result.cooldownSeconds)
        : DEFAULT_COOLDOWN_SECONDS
      setCooldown(seconds)
      setDevCode(import.meta.env.DEV ? result.devCode?.trim() || null : null)
    } catch (error) {
      if (requestEpochRef.current !== epoch) return
      setFieldError(null)
      setLocalError(accountErrorMessage(error))
      setDevCode(null)
    } finally {
      if (requestEpochRef.current === epoch) setSendingCode(false)
    }
  }

  const confirmLogout = async () => {
    if (loggingOut) return
    if (!window.confirm(ACCOUNT_LOGOUT_CONFIRM)) return
    setLoggingOut(true)
    await logout()
    setLoggingOut(false)
    toast.success("已退出登录")
  }

  const pickAvatar = () => {
    if (avatarBusy) return
    fileInputRef.current?.click()
  }

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // 清空 value，保证连续选同一张图也能触发 change。
    event.target.value = ""
    if (!file) return

    setAvatarBusy(true)
    try {
      const processed = await processAvatarImage(file)
      await setAvatar({ data: processed.data, mime: processed.mime })
      toast.success("头像已更新")
    } catch (error) {
      // 裁剪阶段与上传阶段的失败原因不同，都要让用户看得到。
      toast.error(accountErrorMessage(error))
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleRemoveAvatar = async () => {
    if (avatarBusy) return
    setAvatarBusy(true)
    try {
      await removeAvatar()
      toast.success("已恢复默认头像")
    } catch (error) {
      toast.error(accountErrorMessage(error))
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (!open) closeDialog()
      }}
    >
      <DialogContent className="account-dialog">
        {authenticated ? (
          <div className="account-session">
            <DialogHeader>
              <DialogTitle>{editingPassword ? "修改密码" : "账号"}</DialogTitle>
              <DialogDescription>
                {editingPassword
                  ? "改完密码后，其它设备需要重新登录。"
                  : "管理这台设备上的青幕账号。"}
              </DialogDescription>
            </DialogHeader>

            {editingPassword ? (
              <AccountPasswordForm onDone={() => setEditingPassword(false)} />
            ) : (
              <>
                <div className="account-summary">
                  <button
                    type="button"
                    className="account-avatar-button"
                    title="更换头像"
                    aria-label="更换头像"
                    disabled={avatarBusy}
                    onClick={pickAvatar}
                  >
                    <AccountAvatar user={user} baseUrl={session?.baseUrl ?? null} size="lg" />
                    {avatarBusy ? (
                      <span className="account-avatar-spinner" aria-hidden="true">
                        <Loader2 className="animate-spin" />
                      </span>
                    ) : null}
                  </button>
                  <div className="account-summary-copy">
                    <strong>{accountDisplayName(user.displayName, user.email)}</strong>
                    <span>{user.email}</span>
                    <span className="account-summary-meta">
                      注册于 {accountCreatedDate(user.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="account-avatar-actions">
                  <button type="button" disabled={avatarBusy} onClick={pickAvatar}>
                    {user.avatarUpdatedAt ? "更换头像" : "上传头像"}
                  </button>
                  {user.avatarUpdatedAt ? (
                    <button
                      type="button"
                      className="account-link-muted"
                      disabled={avatarBusy}
                      onClick={() => void handleRemoveAvatar()}
                    >
                      移除头像
                    </button>
                  ) : null}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCOUNT_AVATAR_ACCEPT}
                  className="account-file-input"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) => void handleAvatarFile(event)}
                />

                <p className="account-note">会员与云同步将在后续版本接入。</p>
                <p className="account-note account-note-muted">
                  会员权益筹备中。上线后会在这里显示套餐与到期时间。
                </p>
                {sessionUnverified ? (
                  <p className="account-note account-note-muted" role="status">
                    账号服务暂时不可用，已保留本地登录状态；会员与云同步稍后再试。
                  </p>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  className="account-submit"
                  onClick={() => setEditingPassword(true)}
                >
                  修改密码
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="account-submit"
                  disabled={loggingOut}
                  onClick={() => void confirmLogout()}
                >
                  {loggingOut ? <Loader2 className="animate-spin" /> : null}
                  {loggingOut ? "正在退出…" : "退出登录"}
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>登录青幕AI写作</DialogTitle>
              <DialogDescription>
                登录后可继承会员权益（筹备中），不影响本地写作。
              </DialogDescription>
            </DialogHeader>

            <div className="account-tabs" role="tablist" aria-label="账号操作">
              {BASE_TABS.map((tab) => (
                <button
                  key={tab.mode}
                  type="button"
                  role="tab"
                  id={`account-tab-${tab.mode}`}
                  aria-selected={authMode === tab.mode}
                  aria-controls={AUTH_PANEL_ID}
                  disabled={busy}
                  className="account-tab"
                  onClick={() => switchMode(tab.mode)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <form
              className="account-form"
              id={AUTH_PANEL_ID}
              role="tabpanel"
              aria-labelledby={authMode === "reset" ? "account-reset-title" : `account-tab-${authMode}`}
              noValidate
              {...compositionHandlers}
              onKeyDown={handleCompositionKeyDown}
              onSubmit={(event) => void submit(event)}
            >
              {authMode === "reset" ? (
                <h3 id="account-reset-title" className="account-reset-title">重置密码</h3>
              ) : null}

              <div className="account-field">
                <Label htmlFor="account-email">邮箱</Label>
                <Input
                  id="account-email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  aria-invalid={fieldError === "email" ? true : undefined}
                  aria-describedby={displayedError && fieldError === "email" ? ERROR_ID : undefined}
                  {...compositionHandlers}
                  onChange={(event) => changeEmail(event.target.value)}
                />
              </div>

              {authMode !== "login" ? (
                <div className="account-field">
                  <Label htmlFor="account-code">验证码</Label>
                  <div className="account-code-row">
                    <Input
                      id="account-code"
                      value={code}
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6 位数字"
                      aria-invalid={fieldError === "code" ? true : undefined}
                      aria-describedby={displayedError && fieldError === "code" ? ERROR_ID : undefined}
                      {...compositionHandlers}
                      onChange={(event) => changeCode(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={sendingCode || cooldown > 0 || submitting}
                      onClick={() => void requestCode()}
                    >
                      {sendingCode ? "发送中…" : cooldown > 0 ? `${cooldown} 秒后重试` : "获取验证码"}
                    </Button>
                  </div>
                  {devCode ? <p className="account-dev-code">开发模式验证码：{devCode}</p> : null}
                  {cooldown > 0 ? (
                    <p className="account-code-hint" role="status">
                      没收到？请检查垃圾箱，或在 {cooldown} 秒后重新获取。
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="account-field">
                <Label htmlFor="account-password">
                  {authMode === "reset" ? "新密码" : "密码"}
                </Label>
                <div className="account-password-field">
                  <Input
                    id="account-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    placeholder={authMode === "login" ? "输入密码" : "至少 8 位"}
                    aria-invalid={fieldError === "password" ? true : undefined}
                    aria-describedby={displayedError && fieldError === "password" ? ERROR_ID : undefined}
                    {...compositionHandlers}
                    onChange={(event) => changePassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="account-password-toggle"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    aria-pressed={showPassword}
                    title={showPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {displayedError ? (
                <p className="account-error" id={ERROR_ID} role="alert">{displayedError}</p>
              ) : null}

              <Button
                type="submit"
                className="account-submit"
                disabled={busy}
                aria-busy={submitting || undefined}
              >
                {submitting ? <Loader2 className="animate-spin" /> : null}
                {submitting
                  ? authMode === "login"
                    ? "登录中…"
                    : authMode === "register"
                      ? "注册中…"
                      : "重置中…"
                  : authMode === "login"
                    ? "登录"
                    : authMode === "register"
                      ? "注册并登录"
                      : "重置密码"}
              </Button>

              <div className="account-form-links">
                {authMode === "login" ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => switchMode("register")}>没有账号？注册</button>
                    <button type="button" disabled={busy} onClick={() => switchMode("reset")}>忘记密码？</button>
                  </>
                ) : authMode === "register" ? (
                  <button type="button" disabled={busy} onClick={() => switchMode("login")}>已有账号？登录</button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => switchMode("login")}>返回登录</button>
                )}
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
