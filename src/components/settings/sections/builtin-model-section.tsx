/**
 * 「内置模型」设置页（自建 qmai.work 中转站版）。
 *
 * 作者不用去各家平台申请密钥，也不用在这里再注册一个账号 ——
 * **只要已经在 QMAI 里登录**，点一下「启用内置模型」就能用：
 *
 *   1. 用当前登录态向账号服务换一张 30 分钟票据（POST /v1/relay/token）
 *   2. 拿票据去中转站拉模型清单（GET /v1/models）
 *   3. 勾选后写进现有模型配置（provider-bridge），写作链路零改动
 *
 * 票据会过期，所以这里同时显示剩余时间并提供「重新获取」；写作请求本身由
 * token-fresh 层负责续签，不依赖本页是否打开。
 *
 * 安全：票据只存 localStorage 的 qmai.builtin.session.v2，不进导出包，也不显示完整值。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ExternalLink, KeyRound, RefreshCw, Server, Sparkles, UserRound } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useAccountStore } from "@/stores/account-store"
import { openExternalUrl } from "@/lib/open-external-url"
import { resolveAccountBaseUrl } from "@/lib/account/api"
import { safeModelError } from "@/components/uitest/models/model-feedback"
import {
  DEFAULT_RELAY_URL,
  fetchRelayTicket,
  gatewayListModels,
  gatewayProbeChat,
  isAccessTokenExpired,
  normalizeGatewayBaseUrl,
} from "@/lib/builtin-models/gateway-api"
import {
  createBuiltinSession,
  loadBuiltinSession,
  maskSecret,
  saveBuiltinSession,
  type BuiltinSession,
} from "@/lib/builtin-models/session"
import { BUILTIN_PROVIDER_ID, applyBuiltinModels } from "@/lib/builtin-models/provider-bridge"
import { defaultSelectedModelIds, describeBuiltinModel, sortBuiltinModelIds } from "@/lib/builtin-models/catalog"
import "./builtin-model-section.css"

interface StatusLine {
  error?: boolean
  text: string
}

const SERVER_URL_STORAGE_KEY = "qmai.builtin.serverUrl.v2"

function readStoredServerUrl(): string {
  if (typeof localStorage === "undefined") return DEFAULT_RELAY_URL
  return localStorage.getItem(SERVER_URL_STORAGE_KEY)?.trim() || DEFAULT_RELAY_URL
}

function writeStoredServerUrl(value: string): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(SERVER_URL_STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

function errorText(error: unknown, secrets: string[] = []): string {
  return safeModelError(error, secrets)
}

/** 把剩余秒数说成人话：只剩几分钟时提示重新获取。 */
function describeRemaining(expiresAt: number): { text: string; urgent: boolean } {
  const left = Math.max(0, Math.round(expiresAt - Date.now() / 1000))
  if (left <= 0) return { text: "已过期", urgent: true }
  const minutes = Math.floor(left / 60)
  const seconds = left % 60
  if (minutes >= 1) return { text: `剩余 ${minutes} 分钟`, urgent: minutes < 5 }
  return { text: `剩余 ${seconds} 秒`, urgent: true }
}

export function BuiltinModelSection() {
  const providerOverride = useWikiStore((s) => s.providerConfigs[BUILTIN_PROVIDER_ID])
  const accountStatus = useAccountStore((s) => s.status)
  const accountSession = useAccountStore((s) => s.session)

  const [session, setSession] = useState<BuiltinSession | null>(() => loadBuiltinSession())
  const [serverUrl, setServerUrl] = useState(() => loadBuiltinSession()?.serverUrl ?? readStoredServerUrl())
  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusLine | null>(null)
  const [makeDefault, setMakeDefault] = useState(true)
  const [probeModel, setProbeModel] = useState("")
  const [probeResult, setProbeResult] = useState<StatusLine | null>(null)
  // 每分钟重渲染一次，让"剩余 N 分钟"自己走。
  const [, setTick] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const timer = setInterval(() => {
      if (mounted.current) setTick((value) => value + 1)
    }, 30_000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [])

  const loggedIn = accountStatus === "authenticated" && Boolean(accountSession)
  const activeBase = (session?.serverUrl || normalizeGatewayBaseUrl(serverUrl) || DEFAULT_RELAY_URL)
  const expired = session ? isAccessTokenExpired(session.expiresAt) : false
  const sortedModels = useMemo(() => sortBuiltinModelIds(models), [models])
  const enabledCount = providerOverride?.savedModels?.length ?? 0
  const sessionBelongsToOther = Boolean(
    session && accountSession && session.userId !== accountSession.user.id,
  )

  const loadModels = useCallback(async (relayUrl: string, ticket: string) => {
    const ids = await gatewayListModels(relayUrl, ticket)
    if (!mounted.current) return ids
    const sorted = sortBuiltinModelIds(ids)
    setModels(ids)
    setSelected((previous) => {
      const kept = previous.filter((id) => sorted.includes(id))
      return kept.length > 0 ? kept : defaultSelectedModelIds(sorted)
    })
    return ids
  }, [])

  /** 用账号登录态换票（必要时）并把清单拉下来。 */
  const refreshTicket = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!accountSession) {
        setStatus({ error: true, text: "请先登录青幕账号，再使用内置模型。" })
        return
      }
      setBusy("refresh")
      if (!options.silent) setStatus({ text: "正在获取内置模型凭证…" })
      try {
        const relayUrl = normalizeGatewayBaseUrl(serverUrl) || DEFAULT_RELAY_URL
        const ticket = await fetchRelayTicket(resolveAccountBaseUrl(), accountSession.accessToken)
        const next = createBuiltinSession({
          serverUrl: relayUrl,
          tokenKey: ticket.token,
          expiresAt: ticket.expiresAt,
          userId: accountSession.user.id,
        })
        saveBuiltinSession(next)
        writeStoredServerUrl(relayUrl)
        if (!mounted.current) return
        setSession(next)
        const ids = await loadModels(relayUrl, ticket.token)
        if (!mounted.current) return
        setStatus({ text: `已获取凭证，可选模型 ${ids.length} 个。` })
      } catch (error) {
        if (!mounted.current) return
        setStatus({ error: true, text: errorText(error) })
      } finally {
        if (mounted.current) setBusy(null)
      }
    },
    [accountSession, loadModels, serverUrl],
  )

  // 已登录且还没有可用票据时，自动换一次（用户不用手动点）。
  useEffect(() => {
    if (!loggedIn) return
    if (session && !expired && !sessionBelongsToOther) {
      // 已有有效票：只补拉一次清单（页面刷新后模型列表是空的）。
      if (models.length === 0 && !busy) {
        void loadModels(session.serverUrl, session.tokenKey)
          .then(() => setStatus({ text: "已加载模型清单。" }))
          .catch((error) => setStatus({ error: true, text: errorText(error) }))
      }
      return
    }
    void refreshTicket({ silent: true })
    // 只在登录态/会话身份变化时触发，避免每次渲染都换票。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, accountSession?.user.id])

  const toggleModel = (id: string) => {
    setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]))
  }

  const handleEnable = async () => {
    if (!session) {
      setStatus({ error: true, text: "凭证尚未就绪，请先点「重新获取」。" })
      return
    }
    if (selected.length === 0) {
      setStatus({ error: true, text: "请至少勾选一个模型。" })
      return
    }
    setBusy("enable")
    setStatus({ text: "正在写入模型配置…" })
    try {
      const result = await applyBuiltinModels({ session, modelIds: selected, makeDefault })
      if (!mounted.current) return
      setStatus({
        text: makeDefault
          ? `已启用 ${result.modelCount} 个内置模型，并设为默认模型。`
          : `已启用 ${result.modelCount} 个内置模型（未改动默认模型）。`,
      })
    } catch (error) {
      if (!mounted.current) return
      setStatus({ error: true, text: errorText(error, [session.tokenKey]) })
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const handleProbe = async () => {
    if (!session) return
    const model = probeModel || selected[0] || models[0]
    if (!model) {
      setProbeResult({ error: true, text: "没有可测试的模型。" })
      return
    }
    setBusy("probe")
    setProbeResult({ text: `正在测试 ${model}…` })
    try {
      const result = await gatewayProbeChat(activeBase, session.tokenKey, model)
      if (!mounted.current) return
      setProbeResult({ text: `${model} 返回：「${result.content}」（${result.latencyMs} ms）` })
    } catch (error) {
      if (!mounted.current) return
      setProbeResult({ error: true, text: errorText(error, [session.tokenKey]) })
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const remaining = session ? describeRemaining(session.expiresAt) : null

  return (
    <section className="builtin-model-section">
      <header className="builtin-model-head">
        <div>
          <h3>
            <Sparkles size={16} aria-hidden /> 内置模型
          </h3>
          <p className="builtin-model-sub">
            登录青幕账号即可直接使用，无需自己申请各家密钥。模型由青幕中转站统一提供，
            换供应商、调参都不需要更新客户端。
          </p>
        </div>
        {enabledCount > 0 && (
          <span className="builtin-model-badge">
            <Check size={13} aria-hidden /> 已启用 {enabledCount} 个
          </span>
        )}
      </header>

      {!loggedIn ? (
        <div className="builtin-model-card builtin-model-empty">
          <UserRound size={18} aria-hidden />
          <div>
            <strong>请先登录青幕账号</strong>
            <p>内置模型与你的账号绑定，登录后即可一键启用；未登录时仍可使用「自定义模型」自己填密钥。</p>
          </div>
        </div>
      ) : (
        <>
          <div className="builtin-model-card">
            <div className="builtin-model-row">
              <span className="builtin-model-label">
                <UserRound size={14} aria-hidden /> 账号
              </span>
              <span className="builtin-model-value">
                {accountSession?.user.displayName || accountSession?.user.email}
              </span>
            </div>
            <div className="builtin-model-row">
              <span className="builtin-model-label">
                <Server size={14} aria-hidden /> 中转站
              </span>
              <input
                className="builtin-model-input"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                onBlur={() => writeStoredServerUrl(normalizeGatewayBaseUrl(serverUrl) || DEFAULT_RELAY_URL)}
                placeholder={DEFAULT_RELAY_URL}
                spellCheck={false}
                aria-label="中转站地址"
              />
            </div>
            <div className="builtin-model-row">
              <span className="builtin-model-label">
                <KeyRound size={14} aria-hidden /> 凭证
              </span>
              <span className="builtin-model-value">
                {session ? maskSecret(session.tokenKey) : "尚未获取"}
                {remaining && (
                  <em className={remaining.urgent ? "builtin-model-warn" : "builtin-model-muted"}>
                    （{remaining.text}
                    {expired ? "，请重新获取" : ""}）
                  </em>
                )}
                {sessionBelongsToOther && (
                  <em className="builtin-model-warn">（属于其他账号，点「重新获取」）</em>
                )}
              </span>
            </div>
            <div className="builtin-model-actions">
              <button
                type="button"
                className="builtin-model-button"
                onClick={() => void refreshTicket()}
                disabled={busy !== null}
              >
                <RefreshCw size={14} aria-hidden className={busy === "refresh" ? "spin" : ""} />
                重新获取凭证
              </button>
              <button
                type="button"
                className="builtin-model-button primary"
                onClick={() => void handleEnable()}
                disabled={busy !== null || !session || selected.length === 0}
              >
                启用内置模型
              </button>
              <label className="builtin-model-check">
                <input
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(event) => setMakeDefault(event.target.checked)}
                />
                同时设为默认模型
              </label>
            </div>
            {status && (
              <p className={`builtin-model-status${status.error ? " error" : ""}`}>{status.text}</p>
            )}
          </div>

          <div className="builtin-model-card">
            <div className="builtin-model-card-head">
              <strong>可用模型（{sortedModels.length}）</strong>
              <span className="builtin-model-muted">勾选后点上方「启用内置模型」写入配置</span>
            </div>
            {sortedModels.length === 0 ? (
              <p className="builtin-model-muted">还没有拿到模型清单，点「重新获取凭证」试试。</p>
            ) : (
              <ul className="builtin-model-list">
                {sortedModels.map((id) => {
                  const meta = describeBuiltinModel(id)
                  const checked = selected.includes(id)
                  return (
                    <li key={id}>
                      <label className="builtin-model-check">
                        <input type="checkbox" checked={checked} onChange={() => toggleModel(id)} />
                        <span>
                          <strong>{meta.label}</strong>
                          {meta.recommended && <em className="builtin-model-rec">推荐</em>}
                          <span className="builtin-model-muted"> — {meta.note}</span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="builtin-model-actions">
              <select
                className="builtin-model-input"
                value={probeModel || selected[0] || ""}
                onChange={(event) => setProbeModel(event.target.value)}
                aria-label="选择要测试的模型"
              >
                {sortedModels.map((id) => (
                  <option key={id} value={id}>
                    {describeBuiltinModel(id).label}
                  </option>
                ))}
              </select>
              <button type="button" className="builtin-model-button" onClick={() => void handleProbe()} disabled={busy !== null || !session}>
                测试连接
              </button>
            </div>
            {probeResult && (
              <p className={`builtin-model-status${probeResult.error ? " error" : ""}`}>{probeResult.text}</p>
            )}
          </div>
        </>
      )}

      <p className="builtin-model-foot">
        想用自己的密钥？到
        <button
          type="button"
          className="builtin-model-link"
          onClick={() => openExternalUrl("https://qmai.pro")}
        >
          大语言模型 <ExternalLink size={12} aria-hidden />
        </button>
        里选「自定义模型」，内置模型与它互不影响。
      </p>
    </section>
  )
}
