/**
 * 「登录 / 添加 WorkBuddy 账号」对话框。
 *
 * 结构：账号版本 → 添加方式（网页登录 / 导入凭证文件）→ 子面板 → 已有账号。
 * 视觉沿用 QMAI 设置页现有的卡片与按钮样式。
 *
 * 本期只做国内版：`国际版` 分段可见但禁用，后缀「二期」。这样二期放开时只删
 * 一个 disabled，不用重排结构。
 *
 * ── 为什么没有「从本机客户端导入」────────────────────────────
 * 曾有过，但 2026-10 的新版 WorkBuddy 客户端把 accessToken / refreshToken /
 * nickname 全部改成了 `{"$wbEncrypted":1,"envelope":"…"}`（它自己的 at-rest 密钥
 * 保护，密钥由客户端原生模块持有、不落盘、不可导出），外部程序读不出来 ——
 * 那条路对当前客户端结构性不可用，因此整条链路已删除，不在界面上留一个永远
 * 点不通的入口。想用客户端里的账号，就走「网页登录」：同一个账号登录一次即可。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { openExternalUrl } from "@/lib/open-external-url"
import {
  cancelWorkbuddyLogin,
  importWorkbuddyCredential,
  listWorkbuddyAccounts,
  refreshWorkbuddyModels,
  removeWorkbuddyAccount,
  startWorkbuddyLogin,
  waitForLogin,
  type WorkbuddyAccount,
  type WorkbuddyModel,
} from "@/lib/workbuddy-accounts"

type AddMethod = "web" | "file"
type LoginMode = "embedded" | "external"

export interface AddWorkbuddyAccountDialogProps {
  open: boolean
  onClose: () => void
  /** 账号列表或某个账号变化后回调（设置页据此刷新模型卡片与可用性） */
  onAccountsChanged?: (accounts: WorkbuddyAccount[]) => void
  /**
   * 有账号「新」加入时回调，参数是当前的模型目录。
   *
   * 设置页拿它生成 WorkBuddy 模型卡片 —— 「登录完就能直接选模型」是这个功能的
   * 核心体验，用户不该再被要求点一次「添加提供方」。只在**从 0 到 1** 时触发，
   * 已有卡片时由卡片自己的保存流程接管。
   */
  onAccountAdded?: (models: WorkbuddyModel[]) => void | Promise<void>
  /** 删到最后一个账号时回调：设置页把卡片置灰（保留模型列表）。 */
  onAllAccountsRemoved?: () => void | Promise<void>
}

export function AddWorkbuddyAccountDialog({
  open,
  onClose,
  onAccountsChanged,
  onAccountAdded,
  onAllAccountsRemoved,
}: AddWorkbuddyAccountDialogProps) {
  const [method, setMethod] = useState<AddMethod>("web")
  const [loginMode, setLoginMode] = useState<LoginMode>("embedded")
  const [accounts, setAccounts] = useState<WorkbuddyAccount[]>([])
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState("")
  const [error, setError] = useState("")
  const [loginState, setLoginState] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  /**
   * 账号集合变化后的统一收尾：刷新列表、通知设置页、必要时生成/置灰卡片。
   *
   * 抽成一个函数是因为两条链路（网页登录 / 导入凭证文件）都要走它 ——
   * 复制两份必然出现「某条链路忘了生成卡片」这种只在个别入口复现的怪现象。
   */
  const settleAccounts = useCallback(
    async (view: { accounts: WorkbuddyAccount[] }, wasEmpty: boolean) => {
      setAccounts(view.accounts)
      onAccountsChanged?.(view.accounts)
      if (view.accounts.length === 0) {
        await onAllAccountsRemoved?.()
        return
      }
      if (wasEmpty) {
        // 从 0 到 1：先把目录拉一次，再让设置页生成卡片（模型要跟着目录走）。
        try {
          const { models } = await refreshWorkbuddyModels()
          await onAccountAdded?.(models)
        } catch (reason) {
          // 目录拉不到不该吞掉「账号已登录成功」这个事实：用空目录生成卡片，
          // 用户可以在卡片里点「拉取模型」再补。
          setHint(
            `账号已加入，但模型目录拉取失败：${
              reason instanceof Error ? reason.message : String(reason)
            }。可在模型卡片里稍后重试。`,
          )
          await onAccountAdded?.([])
        }
      }
    },
    [onAccountsChanged, onAllAccountsRemoved, onAccountAdded],
  )

  const refreshAccounts = useCallback(async () => {
    try {
      const view = await listWorkbuddyAccounts()
      setAccounts(view.accounts)
      onAccountsChanged?.(view.accounts)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [onAccountsChanged])

  useEffect(() => {
    if (open) {
      setError("")
      setHint("")
      void refreshAccounts()
    } else {
      abortRef.current?.abort()
      abortRef.current = null
      setLoginState(null)
      setBusy(false)
    }
  }, [open, refreshAccounts])

  const cancelWaiting = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = null
    if (loginState) {
      await cancelWorkbuddyLogin(loginState).catch(() => false)
    }
    setLoginState(null)
    setBusy(false)
    setHint("已取消等待")
  }, [loginState])

  async function startWebLogin() {
    setError("")
    setHint("")
    setBusy(true)
    try {
      const start = await startWorkbuddyLogin({ provider: "workbuddy", mode: loginMode })
      setLoginState(start.state)
      if (loginMode === "external") {
        // 内嵌模式由后端自己开窗；系统浏览器由前端拉起。
        await openExternalUrl(start.authUrl)
      }
      setHint("请在打开的页面里完成登录，成功后会自动加入列表…")
      const controller = new AbortController()
      abortRef.current = controller
      const ready = await waitForLogin(start.state, {
        intervalMs: 2000,
        signal: controller.signal,
        onTick: (elapsed) => {
          setHint(`等待登录完成…（${Math.floor(elapsed / 1000)} 秒）`)
        },
      })
      setHint(`✅ 已加入：${ready.account.nickname || ready.account.uidTail}`)
      const wasEmpty = accounts.length === 0
      await settleAccounts(ready.accounts, wasEmpty)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (!message.includes("取消")) setError(message)
      else setHint(message)
    } finally {
      abortRef.current = null
      setLoginState(null)
      setBusy(false)
    }
  }

  async function importFile(file: File) {
    setError("")
    setBusy(true)
    try {
      const wasEmpty = accounts.length === 0
      const text = await file.text()
      const result = await importWorkbuddyCredential(text, "workbuddy")
      setHint(`✅ 已导入：${result.account.nickname || result.account.uidTail}（${result.account.editionLabel}）`)
      await settleAccounts(result.accounts, wasEmpty)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setError("")
    try {
      const view = await removeWorkbuddyAccount(id)
      await settleAccounts(view, false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const expiresLabel = useMemo(
    () => (account: WorkbuddyAccount) =>
      account.expiresAt > 0
        ? new Date(account.expiresAt).toLocaleString("zh-CN", { hour12: false })
        : "未知",
    [],
  )

  if (!open) return null

  return (
    <div className="wb-modal-overlay" role="dialog" aria-modal="true" aria-label="登录添加 WorkBuddy 账号">
      <div className="wb-modal">
        <header className="wb-modal-head">
          <h3>登录 / 添加 WorkBuddy 账号</h3>
          <button type="button" className="model-button ghost" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <section className="wb-section">
          <h4>账号版本</h4>
          <div className="wb-segmented" role="tablist" aria-label="账号版本">
            <button type="button" role="tab" aria-selected="true" className="is-active">
              国内版（WorkBuddy）
            </button>
            <button type="button" role="tab" aria-selected="false" disabled title="二期支持">
              国际版（WorkBuddy AI）· 二期
            </button>
          </div>
          <p className="model-note">国内版与国际版是两个站点、两套账号，模型清单也各自一份。</p>
        </section>

        <section className="wb-section">
          <h4>添加方式</h4>
          <div className="wb-segmented" role="tablist" aria-label="添加方式">
            {([
              ["web", "网页登录"],
              ["file", "导入凭证文件"],
            ] as Array<[AddMethod, string]>).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={method === id}
                className={method === id ? "is-active" : ""}
                onClick={() => {
                  setMethod(id)
                  setError("")
                  setHint("")
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {method === "web" && (
          <section className="wb-section">
            <h4>网页登录</h4>
            <p className="model-note">完成登录后自动加入账号列表，昵称取自上游。</p>
            <div className="wb-row">
              <span className="wb-row-label">打开方式</span>
              <div className="wb-segmented" role="tablist" aria-label="打开方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={loginMode === "embedded"}
                  className={loginMode === "embedded" ? "is-active" : ""}
                  onClick={() => setLoginMode("embedded")}
                >
                  内嵌窗口
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={loginMode === "external"}
                  className={loginMode === "external" ? "is-active" : ""}
                  onClick={() => setLoginMode("external")}
                >
                  系统默认浏览器
                </button>
              </div>
            </div>
            <p className="model-note">系统浏览器可复用已有登录态；内嵌窗口更干净（每次全新会话）。</p>
            <div className="wb-actions">
              <button type="button" className="model-button" onClick={() => void startWebLogin()} disabled={busy}>
                {busy ? "等待登录…" : "打开网页登录"}
              </button>
              {busy && (
                <button type="button" className="model-button ghost" onClick={() => void cancelWaiting()}>
                  取消等待
                </button>
              )}
            </div>
          </section>
        )}

        {method === "file" && (
          <section className="wb-section">
            <h4>导入凭证文件</h4>
            <p className="model-note">
              选择一个含 accessToken 与 uid 的 JSON（支持嵌套形：auth + account，也支持扁平形）。
              文件里的 domain 决定归属版本。
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) void importFile(file)
              }}
            />
            <div className="wb-actions">
              <button
                type="button"
                className="model-button"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                {busy ? "导入中…" : "选择凭证文件"}
              </button>
            </div>
          </section>
        )}

        {hint && <p className="wb-hint">{hint}</p>}
        {error && (
          <p className="wb-error" role="alert">
            {error}
          </p>
        )}

        <section className="wb-section">
          <h4>已有账号（{accounts.length}）</h4>
          {accounts.length === 0 ? (
            <p className="model-note">还没有 WorkBuddy 账号。</p>
          ) : (
            <ul className="wb-account-list">
              {accounts.map((account) => (
                <li key={account.id}>
                  <span className="wb-account-name">{account.nickname}</span>
                  <span className="wb-account-meta">
                    uid …{account.uidTail} · 有效期至 {expiresLabel(account)}
                  </span>
                  <button type="button" className="model-button ghost" onClick={() => void remove(account.id)}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
