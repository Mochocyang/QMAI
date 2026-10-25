import { useEffect, useState, type FormEvent } from "react"
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
import { accountErrorMessage } from "@/lib/account/errors"
import type { AccountAuthMode, AccountUser } from "@/lib/account/types"
import {
  isSixDigitCode,
  isValidEmail,
  validateAccountPassword,
} from "@/lib/account/validation"
import { toast } from "@/lib/toast"
import { useAccountStore } from "@/stores/account-store"
import "./account-dialog.css"

interface AuthTab {
  mode: AccountAuthMode
  label: string
}

const BASE_TABS: AuthTab[] = [
  { mode: "login", label: "登录" },
  { mode: "register", label: "注册" },
]

const DEFAULT_COOLDOWN_SECONDS = 60

function accountInitial(user: AccountUser): string {
  const name = user.displayName.trim() || user.email
  return (Array.from(name)[0] ?? "").toUpperCase()
}

function createdDate(user: AccountUser): string {
  return new Date(user.createdAt * 1000).toLocaleDateString("zh-CN")
}

/** 登录 / 注册 / 重置密码共用一个弹窗，所有会话变化都由 store 驱动。 */
export function AccountDialog() {
  const dialogOpen = useAccountStore((state) => state.dialogOpen)
  const authMode = useAccountStore((state) => state.authMode)
  const status = useAccountStore((state) => state.status)
  const user = useAccountStore((state) => state.user)
  const sessionError = useAccountStore((state) => state.error)
  const closeDialog = useAccountStore((state) => state.closeDialog)
  const setAuthMode = useAccountStore((state) => state.setAuthMode)
  const clearError = useAccountStore((state) => state.clearError)
  const login = useAccountStore((state) => state.login)
  const register = useAccountStore((state) => state.register)
  const sendCode = useAccountStore((state) => state.sendCode)
  const resetPassword = useAccountStore((state) => state.resetPassword)
  const logout = useAccountStore((state) => state.logout)

  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)

  const authenticated = status === "authenticated" && user !== null
  const displayedError = localError ?? sessionError
  const busy = submitting || loggingOut

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((remaining) => Math.max(0, remaining - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  // 模式切换只清错误、验证码与敏感字段，邮箱保留给用户继续用。
  useEffect(() => {
    setLocalError(null)
    setDevCode(null)
    setCode("")
    setPassword("")
    setShowPassword(false)
  }, [authMode])

  // 关闭时不能把密码/验证码留在组件状态里；邮箱与模式由 store/下次打开决定。
  useEffect(() => {
    if (dialogOpen) return
    setPassword("")
    setCode("")
    setLocalError(null)
    setDevCode(null)
    setShowPassword(false)
    setSubmitting(false)
    setSendingCode(false)
    setCooldown(0)
    setLoggingOut(false)
  }, [dialogOpen])

  const tabs = authMode === "reset"
    ? [...BASE_TABS, { mode: "reset" as const, label: "重置密码" }]
    : BASE_TABS

  const clearFeedback = () => {
    setLocalError(null)
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
    if (mode === authMode) return
    setAuthMode(mode)
  }

  const validate = (normalizedEmail: string): string | null => {
    if (!isValidEmail(normalizedEmail)) return "请输入有效的邮箱地址。"
    if (authMode !== "login" && !isSixDigitCode(code)) return "请输入 6 位数字验证码。"
    return validateAccountPassword(password)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    const normalizedEmail = email.trim().toLowerCase()
    const validationError = validate(normalizedEmail)
    if (validationError) {
      setLocalError(validationError)
      return
    }

    clearFeedback()
    setSubmitting(true)
    try {
      if (authMode === "login") {
        await login({ email: normalizedEmail, password })
        toast.success("登录成功")
      } else if (authMode === "register") {
        await register({ email: normalizedEmail, code, password })
        toast.success("注册成功")
      } else {
        await resetPassword({ email: normalizedEmail, code, password })
        setCode("")
        setPassword("")
        toast.success("密码已重置，请用新密码登录")
      }
    } catch (error) {
      setLocalError(accountErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const requestCode = async () => {
    if (sendingCode || cooldown > 0) return

    const normalizedEmail = email.trim().toLowerCase()
    if (!isValidEmail(normalizedEmail)) {
      setLocalError("请输入有效的邮箱地址。")
      return
    }

    clearFeedback()
    setSendingCode(true)
    try {
      const result = await sendCode(normalizedEmail, authMode === "reset" ? "reset" : "register")
      const seconds = Number.isFinite(result.cooldownSeconds) && result.cooldownSeconds > 0
        ? Math.floor(result.cooldownSeconds)
        : DEFAULT_COOLDOWN_SECONDS
      setCooldown(seconds)
      setDevCode(result.devCode?.trim() || null)
    } catch (error) {
      setLocalError(accountErrorMessage(error))
      setDevCode(null)
    } finally {
      setSendingCode(false)
    }
  }

  const confirmLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      toast.success("已退出登录")
    } catch {
      toast.error("退出登录失败，请稍后重试。")
    } finally {
      setLoggingOut(false)
    }
  }

  const tabPanelId = `account-panel-${authMode}`

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
              <DialogTitle>账号</DialogTitle>
              <DialogDescription>管理这台设备上的青幕账号。</DialogDescription>
            </DialogHeader>

            <div className="account-summary">
              <span className="account-avatar account-avatar-lg" aria-hidden="true">{accountInitial(user)}</span>
              <div className="account-summary-copy">
                <strong>{user.displayName.trim() || user.email}</strong>
                <span>{user.email}</span>
                <span className="account-summary-meta">注册于 {createdDate(user)}</span>
              </div>
            </div>

            <p className="account-note">会员与云同步将在后续版本接入。</p>
            <p className="account-note account-note-muted">会员权益筹备中。上线后会在这里显示套餐与到期时间。</p>

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
              {tabs.map((tab) => (
                <button
                  key={tab.mode}
                  type="button"
                  role="tab"
                  id={`account-tab-${tab.mode}`}
                  aria-selected={authMode === tab.mode}
                  aria-controls={authMode === tab.mode ? tabPanelId : undefined}
                  className="account-tab"
                  onClick={() => switchMode(tab.mode)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <form
              className="account-form"
              id={tabPanelId}
              role="tabpanel"
              aria-labelledby={`account-tab-${authMode}`}
              noValidate
              onSubmit={(event) => void submit(event)}
            >
              <div className="account-field">
                <Label htmlFor="account-email">邮箱</Label>
                <Input
                  id="account-email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
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
                    onChange={(event) => changePassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="account-password-toggle"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    title={showPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {displayedError ? (
                <p className="account-error" role="alert">{displayedError}</p>
              ) : null}

              <Button type="submit" className="account-submit" disabled={busy}>
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
                      ? "注册"
                      : "重置密码"}
              </Button>

              <div className="account-form-links">
                {authMode === "login" ? (
                  <>
                    <button type="button" onClick={() => switchMode("register")}>没有账号？注册</button>
                    <button type="button" onClick={() => switchMode("reset")}>忘记密码？</button>
                  </>
                ) : authMode === "register" ? (
                  <button type="button" onClick={() => switchMode("login")}>已有账号？登录</button>
                ) : (
                  <button type="button" onClick={() => switchMode("login")}>返回登录</button>
                )}
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
