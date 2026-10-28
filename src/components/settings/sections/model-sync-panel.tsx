/**
 * 设置 → 模型 里的「账号同步」面板。
 *
 * 只做三件事：开关、同步密码（设置/修改）、立即同步与状态提示。
 * 加解密、合并、推送全在 `lib/model-sync` 与 `stores/model-sync-store` 里。
 */

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAccountStore } from "@/stores/account-store"
import { MIN_SYNC_PASSWORD_LENGTH, useModelSyncStore } from "@/stores/model-sync-store"

export function ModelSyncPanel() {
  const enabled = useModelSyncStore((state) => state.enabled)
  const busy = useModelSyncStore((state) => state.busy)
  const status = useModelSyncStore((state) => state.status)
  const message = useModelSyncStore((state) => state.message)
  const pendingConflicts = useModelSyncStore((state) => state.pendingConflicts)
  const resolveConflict = useModelSyncStore((state) => state.resolveConflict)
  const lastSyncAt = useModelSyncStore((state) => state.lastSyncAt)
  const init = useModelSyncStore((state) => state.init)
  const enable = useModelSyncStore((state) => state.enable)
  const disable = useModelSyncStore((state) => state.disable)
  const syncNow = useModelSyncStore((state) => state.syncNow)
  const changePassword = useModelSyncStore((state) => state.changePassword)

  const accountSession = useAccountStore((state) => state.session)
  const [mode, setMode] = useState<"idle" | "setup" | "change">("idle")
  const [first, setFirst] = useState("")
  const [second, setSecond] = useState("")
  const [formError, setFormError] = useState("")

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (mode === "idle") {
      setFirst("")
      setSecond("")
      setFormError("")
    }
  }, [mode])

  const loggedIn = Boolean(accountSession)
  const syncing = status === "pulling" || status === "pushing"

  async function submitSetup() {
    if (first !== second) {
      setFormError("两次输入的同步密码不一致。")
      return
    }
    try {
      await enable(first)
      setMode("idle")
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "开启同步失败。")
    }
  }

  async function submitChange() {
    if (second.trim().length < MIN_SYNC_PASSWORD_LENGTH) {
      setFormError(`新同步密码至少 ${MIN_SYNC_PASSWORD_LENGTH} 位。`)
      return
    }
    if (first === second) {
      setFormError("新同步密码不能与当前密码相同。")
      return
    }
    try {
      await changePassword(first, second)
      setMode("idle")
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "修改同步密码失败。")
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-4" data-ui="model-sync-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">账号同步</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            模型配置（含 API Key）用你的同步密码在本机加密后再上传，云端只存密文，我们也解不开。
          </p>
        </div>
        {enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !loggedIn} onClick={() => void syncNow()}>
              {syncing ? "同步中…" : "立即同步"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setMode(mode === "change" ? "idle" : "change")}
            >
              修改同步密码
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => void disable({ clearCloud: false })}
            >
              关闭同步
            </Button>
          </div>
        ) : (
          <Button size="sm" disabled={busy || !loggedIn} onClick={() => setMode("setup")}>
            开启同步
          </Button>
        )}
      </div>

      {!loggedIn ? (
        <p className="text-xs text-destructive">请先在「账号」里登录，再开启模型同步。</p>
      ) : null}

      {enabled ? (
        <p className="text-xs text-muted-foreground">
          {lastSyncAt ? `上次同步：${new Date(lastSyncAt).toLocaleString()}` : "还没有同步过"}
        </p>
      ) : null}

      {message ? (
        <p className={status === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {message}
        </p>
      ) : null}

      {pendingConflicts.length > 0 ? (
        <div className="space-y-2 rounded-md border border-dashed p-2 text-xs" data-ui="model-sync-conflicts">
          <p className="text-muted-foreground">
            下面这些模型配置两边都改过。同步时先按更新时间保留了较新的一份，你可以逐条改成另一份：
          </p>
          {pendingConflicts.map((conflict) => (
            <div key={conflict.key} className="flex flex-wrap items-center justify-between gap-2">
              <span className="break-all">{conflict.key}</span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant={conflict.chosen === "local" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => void resolveConflict(conflict.key, "local")}
                >
                  用本地这份
                </Button>
                <Button
                  size="sm"
                  variant={conflict.chosen === "cloud" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => void resolveConflict(conflict.key, "cloud")}
                >
                  用云端这份
                </Button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {mode !== "idle" ? (
        <div className="space-y-2 rounded-md border p-3" data-ui="model-sync-password-form">
          <p className="text-xs text-muted-foreground">
            {mode === "setup"
              ? `设置一个同步密码（≥${MIN_SYNC_PASSWORD_LENGTH} 位）。它与登录密码相互独立：忘记它，云端密文将无法恢复。`
              : "修改同步密码：先用当前密码解锁，再用新密码重新加密并覆盖上传。"}
          </p>
          <div className="space-y-1">
            <Label htmlFor="model-sync-password">
              {mode === "setup" ? "同步密码" : "当前同步密码"}
            </Label>
            <Input
              id="model-sync-password"
              type="password"
              value={first}
              onChange={(event) => setFirst(event.currentTarget.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="model-sync-password-confirm">
              {mode === "setup" ? "重复同步密码" : `新同步密码（≥${MIN_SYNC_PASSWORD_LENGTH} 位）`}
            </Label>
            <Input
              id="model-sync-password-confirm"
              type="password"
              value={second}
              onChange={(event) => setSecond(event.currentTarget.value)}
              autoComplete="new-password"
            />
          </div>          {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void (mode === "setup" ? submitSetup() : submitChange())}
            >
              {mode === "setup" ? "开启并上传" : "保存新密码"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("idle")}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      {enabled ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => void disable({ clearCloud: true })}
        >
          关闭同步并清空云端配置（不可恢复）
        </button>
      ) : null}
    </section>
  )
}
