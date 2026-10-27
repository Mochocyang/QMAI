import { useRef, useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { accountErrorMessage } from "@/lib/account/errors"
import { validateAccountPassword } from "@/lib/account/validation"
import { toast } from "@/lib/toast"
import { useAccountStore } from "@/stores/account-store"

type Field = "current" | "next" | "confirm"

/**
 * 账号弹窗里的「修改密码」面板。
 *
 * 三个输入：当前密码、新密码、确认新密码。前端只做「两次输入一致」和
 * 长度校验；当前密码是否正确由服务端判断（并带独立限流）。
 */
export function AccountPasswordForm({ onDone }: { onDone: () => void }) {
  const changePassword = useAccountStore((state) => state.changePassword)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [field, setField] = useState<Field | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const composingRef = useRef(false)

  const clear = () => {
    setError(null)
    setField(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nativeEvent = event.nativeEvent as Event & { isComposing?: boolean }
    if (composingRef.current || nativeEvent.isComposing) return
    if (submitting) return

    if (!currentPassword) {
      setError("请输入当前密码。")
      setField("current")
      return
    }

    const passwordIssue = validateAccountPassword(newPassword)
    if (passwordIssue) {
      setError(passwordIssue)
      setField("next")
      return
    }

    if (currentPassword === newPassword) {
      setError("新密码不能与当前密码相同。")
      setField("next")
      return
    }

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。")
      setField("confirm")
      return
    }

    clear()
    setSubmitting(true)
    try {
      await changePassword({ currentPassword, newPassword })
      toast.success("密码已更新，其它设备需要重新登录")
      onDone()
    } catch (submitError) {
      setError(accountErrorMessage(submitError))
      setField(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className="account-form"
      noValidate
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={() => {
        composingRef.current = false
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing)) {
          event.preventDefault()
        }
      }}
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="account-reset-title">修改密码</h3>

      <div className="account-field">
        <Label htmlFor="account-current-password">当前密码</Label>
        <Input
          id="account-current-password"
          type="password"
          value={currentPassword}
          autoComplete="current-password"
          placeholder="输入当前密码"
          aria-invalid={field === "current" ? true : undefined}
          onChange={(event) => {
            setCurrentPassword(event.target.value)
            clear()
          }}
        />
      </div>

      <div className="account-field">
        <Label htmlFor="account-new-password">新密码</Label>
        <Input
          id="account-new-password"
          type="password"
          value={newPassword}
          autoComplete="new-password"
          placeholder="至少 8 位"
          aria-invalid={field === "next" ? true : undefined}
          onChange={(event) => {
            setNewPassword(event.target.value)
            clear()
          }}
        />
      </div>

      <div className="account-field">
        <Label htmlFor="account-confirm-password">确认新密码</Label>
        <Input
          id="account-confirm-password"
          type="password"
          value={confirmPassword}
          autoComplete="new-password"
          placeholder="再输一次新密码"
          aria-invalid={field === "confirm" ? true : undefined}
          onChange={(event) => {
            setConfirmPassword(event.target.value)
            clear()
          }}
        />
      </div>

      {error ? (
        <p className="account-error" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="account-submit" disabled={submitting} aria-busy={submitting || undefined}>
        {submitting ? <Loader2 className="animate-spin" /> : null}
        {submitting ? "保存中…" : "保存新密码"}
      </Button>

      <div className="account-form-links">
        <button type="button" disabled={submitting} onClick={onDone}>
          返回账号
        </button>
      </div>
    </form>
  )
}
