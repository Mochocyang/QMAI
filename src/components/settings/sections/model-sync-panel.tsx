/**
 * 设置 → 模型 里的「模型同步」面板。
 *
 * 只做三件事：开关、同步密码（设置/修改）、立即同步与状态提示。
 * 加解密、合并、推送全在 `lib/model-sync` 与 `stores/model-sync-store` 里。
 *
 * 名称：2026-11-02 由「账号同步」改为「模型同步」。它同步的是模型配置
 * （含 API Key），不是账号本身；旧名字会让人以为开了就能跨设备同步作品。
 *
 * 显示条件：2026-11-02 起**未登录整块不显示**。原来是显示但置灰 +
 * 提示先登录，但置灰的开关仍占一行、且会让人反复去点那个点不动的按钮，
 * 更像 bug 而不是限制。未登录本来就是开不了同步（同步要账号会话）。
 *
 * 布局（用户 2026-10-28 定）：
 * - 面板整体挂在四个模型页签**下方**（由 settings-view 渲染），可展开 / 收缩；
 * - 右上是「立即同步 / 修改同步密码」和一个与模型卡片同款的开关；
 * - 「关闭同步并清空云端配置（不可恢复）」是销毁式操作，放到「上次同步」那一行的右侧，
 *   与开关分开 —— 开关只负责停/继续，不该顺手清云端。
 */

import { useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { confirmModelAction } from "@/components/uitest/models/model-confirm"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAccountStore } from "@/stores/account-store"
import { MIN_SYNC_PASSWORD_LENGTH, useModelSyncStore } from "@/stores/model-sync-store"

export function ModelSyncPanel() {
  const enabled = useModelSyncStore((state) => state.enabled)
  const passwordReady = useModelSyncStore((state) => state.passwordReady)
  const busy = useModelSyncStore((state) => state.busy)
  const status = useModelSyncStore((state) => state.status)
  const message = useModelSyncStore((state) => state.message)
  const pendingConflicts = useModelSyncStore((state) => state.pendingConflicts)
  const resolveConflict = useModelSyncStore((state) => state.resolveConflict)
  const lastSyncAt = useModelSyncStore((state) => state.lastSyncAt)
  const init = useModelSyncStore((state) => state.init)
  const enable = useModelSyncStore((state) => state.enable)
  const setEnabled = useModelSyncStore((state) => state.setEnabled)
  const disable = useModelSyncStore((state) => state.disable)
  const syncNow = useModelSyncStore((state) => state.syncNow)
  const restoreFromCloud = useModelSyncStore((state) => state.restoreFromCloud)
  const changePassword = useModelSyncStore((state) => state.changePassword)

  const accountSession = useAccountStore((state) => state.session)
  /** 默认**折叠**（用户 2026-10-28 定）：收起后只留一行，设置页不被这块占地方。 */
  const [open, setOpen] = useState(false)
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
  const syncText = lastSyncAt ? `上次同步：${new Date(lastSyncAt).toLocaleString()}` : "还没有同步过"

  /*
   * 未登录整块不显示（2026-11-02 用户指定：同步入口放在账号登录之后）。
   *
   * 原来是显示但置灰、外加一句「请先登录」。改掉的理由：置灰的开关仍占一整行，
   * 用户会反复去点那个点不动的按钮，看起来像坏了；而未登录确实开不了同步
   * （同步需要账号会话）。自动同步的心跳在别处接线，不依赖这块是否渲染。
   */
  if (!loggedIn) return null
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

  /**
   * 从云端下载：会覆盖本机同名项，所以先弹确认框再说。
   * 典型用途就是「本机把模型删了，想从云端捞回来」。
   */
  async function download() {
    const ok = await confirmModelAction(
      "将用云端的模型配置覆盖本机的同名项（大语言模型提供方、重排模型、向量模型）；本机独有的配置会保留，不会被删除。确定下载吗？",
      "从云端下载配置",
    )
    if (!ok) return
    await restoreFromCloud()
  }

  /**
   * 开关：关 = 停止同步（密码与云端配置都留着）；开 = 直接用已存密码同步一次。
   * 只有本机还没有密码时才退回去让用户设置密码 —— 那是一次性的引导，不是每次开关都要做。
   */
  const toggle = () => {
    if (busy) return
    if (enabled) {
      void setEnabled(false)
      return
    }
    if (passwordReady) {
      void setEnabled(true)
      return
    }
    setOpen(true)
    setMode("setup")
  }

  return (
    <section
      className="my-4 space-y-3 rounded-lg border p-4"
      data-ui="model-sync-panel"
      data-open={open ? "true" : "false"}
    >
      <div className={`flex flex-wrap justify-between gap-2 ${open ? "items-start" : "items-center"}`}>
        <button
          type="button"
          className="flex min-w-0 items-start gap-1.5 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          title={open ? "收起模型同步" : "展开模型同步"}
        >
          <ChevronRight
            className={`${open ? "mt-1" : ""} h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="min-w-0">
            <span className="block font-medium">模型同步</span>
            {open ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                模型配置（含 API Key）用你的同步密码在本机加密后再上传，云端只存密文，我们也解不开。
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {enabled ? (
            <>
              {/*
               * 折叠时把上次同步时间放在「立即同步」左边（用户 2026-10-28 指定）：
               * 收起也想知道最近一次什么时候同步的，并且还能一键同步。
               */}
              {!open ? (
                <span className="ui-test-sync-time text-xs text-muted-foreground">{syncText}</span>
              ) : null}
              <Button size="sm" disabled={busy} onClick={() => void syncNow()}>
                {syncing ? "同步中…" : "立即同步"}
              </Button>
              {/*
               * 「从云端下载」只在展开后出现：它会把云端的同名项覆盖到本机，
               * 属于低频但重后果的操作，不该挤在折叠态那一行里。
               */}
              {open ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  title="把云端的模型配置下载到本机（覆盖同名项，本地独有的保留）"
                  onClick={() => void download()}
                >
                  从云端下载
                </Button>
              ) : null}
              {/* 「修改同步密码」只在展开后出现：要改密码先展开，再点它填表单。 */}
              {open ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setMode(mode === "change" ? "idle" : "change")}
                >
                  修改同步密码
                </Button>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            data-ui="model-sync-switch"
            onClick={toggle}
            disabled={busy}
            className="model-switch disabled:cursor-not-allowed disabled:opacity-50"
            title={enabled ? "关闭同步（保留云端配置）" : "开启同步"}
            aria-label={enabled ? "关闭同步" : "开启同步"}
          >
            <span />
          </button>
        </div>
      </div>

      {/*
       * 折叠时也要显示同步失败的报错：否则「点了立即同步没反应」会被当成 bug。
       * 「请先登录」那条已删除——顶部在未登录时整块 return null，永远渲染不到它。
       */}
      {!open && status === "error" && message ? (
        <p className="text-xs text-destructive">{message}</p>
      ) : null}

      {open ? (
        <div className="space-y-3">
          {/* 上次同步 + 销毁式关闭：同一行的左右两端（用户 2026-10-28 指定位置）。 */}
          {enabled ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="text-xs text-muted-foreground">{syncText}</p>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                disabled={busy}
                onClick={() => void disable({ clearCloud: true })}
              >
                关闭同步并清空云端配置（不可恢复）
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              打开右侧开关即开始同步；关闭只停止同步，云端配置和同步密码都会保留。
            </p>
          )}

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
              </div>
              {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
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
        </div>
      ) : null}
    </section>
  )
}
