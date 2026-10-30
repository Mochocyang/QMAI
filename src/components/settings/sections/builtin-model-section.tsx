/**
 * 「内置模型」设置页（网关卡版）。
 *
 * 旧版：登录 → 换 30 分钟票据 → 每过半小时回来点「重新获取」。
 * 新版：登录 → 已经带着一张长期网关卡 → 进来就能直接用。
 *
 * 本页只做三件事：
 *   1. 显示当前账号与内置模型是否可用（有卡 = 可用）
 *   2. 从中转站拉模型清单，勾选后写入 provider 配置
 *   3. 测试连接
 *
 * 没有「重新获取凭证」按钮、没有倒计时 —— 那张卡不会过期。
 * 只有「老版本升级上来还没同步卡」时才需要点一次「同步凭证」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ExternalLink, RefreshCw, Server, Sparkles, UserRound } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useAccountStore } from "@/stores/account-store"
import { openExternalUrl } from "@/lib/open-external-url"
import { resolveAccountBaseUrl } from "@/lib/account/api"
import { saveAccountSession } from "@/lib/account/session"
import { safeModelError } from "@/components/uitest/models/model-feedback"
import {
  DEFAULT_RELAY_URL,
  gatewayListModels,
  gatewayProbeChat,
  normalizeGatewayBaseUrl,
} from "@/lib/builtin-models/gateway-api"
import { netcardOf } from "@/lib/builtin-models/netcard"
import { BUILTIN_PROVIDER_ID, applyBuiltinModels } from "@/lib/builtin-models/provider-bridge"
import { defaultSelectedModelIds, describeBuiltinModel, sortBuiltinModelIds } from "@/lib/builtin-models/catalog"
import "./builtin-model-section.css"

interface StatusLine {
  error?: boolean
  text: string
}

const RELAY_URL_STORAGE_KEY = "qmai.builtin.serverUrl.v3"

function readStoredRelayUrl(): string {
  if (typeof localStorage === "undefined") return DEFAULT_RELAY_URL
  return localStorage.getItem(RELAY_URL_STORAGE_KEY)?.trim() || DEFAULT_RELAY_URL
}

function writeStoredRelayUrl(value: string): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(RELAY_URL_STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

function errorText(error: unknown, secrets: string[] = []): string {
  return safeModelError(error, secrets)
}

function maskCard(card: string): string {
  if (card.length <= 16) return "****"
  return `${card.slice(0, 10)}…${card.slice(-6)}`
}

export function BuiltinModelSection() {
  const providerOverride = useWikiStore((s) => s.providerConfigs[BUILTIN_PROVIDER_ID])
  const accountStatus = useAccountStore((s) => s.status)
  const accountSession = useAccountStore((s) => s.session)

  const [relayUrl, setRelayUrl] = useState(() => readStoredRelayUrl())
  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusLine | null>(null)
  const [makeDefault, setMakeDefault] = useState(true)
  const [probeModel, setProbeModel] = useState("")
  const [probeResult, setProbeResult] = useState<StatusLine | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const card = netcardOf(accountSession)
  const loggedIn = accountStatus === "authenticated" && Boolean(accountSession)
  const sortedModels = useMemo(() => sortBuiltinModelIds(models), [models])
  const enabledCount = providerOverride?.savedModels?.length ?? 0
  const base = normalizeGatewayBaseUrl(relayUrl) || DEFAULT_RELAY_URL

  const loadModels = useCallback(async (relay: string, netcard: string) => {
    const ids = await gatewayListModels(relay, netcard)
    if (!mounted.current) return ids
    const sorted = sortBuiltinModelIds(ids)
    setModels(ids)
    setSelected((previous) => {
      const kept = previous.filter((id) => sorted.includes(id))
      return kept.length > 0 ? kept : defaultSelectedModelIds(sorted)
    })
    return ids
  }, [])

  /** 同步凭证：向账号服务补签一张网关卡。正常登录时已经自带，这里只做补漏。 */
  const syncNetcard = useCallback(async () => {
    if (!accountSession) {
      setStatus({ error: true, text: "请先登录青幕账号。" })
      return
    }
    setBusy("sync")
    setStatus({ text: "正在同步内置模型凭证…" })
    try {
      const response = await fetch(`${resolveAccountBaseUrl()}/v1/netcard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accountSession.accessToken}`,
        },
        body: JSON.stringify({ refreshToken: accountSession.refreshToken }),
      })
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean
        data?: { netcard?: string }
      } | null
      const fresh = payload?.data?.netcard
      if (!response.ok || !fresh) {
        throw new Error(
          payload?.success === false
            ? "账号服务拒绝签发凭证，请重新登录后再试。"
            : "账号服务尚未开通内置模型凭证，请联系管理员。",
        )
      }
      const next = { ...accountSession, netcard: fresh }
      useAccountStore.getState().replaceSession(next)
      saveAccountSession(next)
      if (!mounted.current) return
      setStatus({ text: "凭证已同步，现在可以直接使用内置模型。" })
      await loadModels(base, fresh)
    } catch (error) {
      if (!mounted.current) return
      setStatus({ error: true, text: errorText(error) })
    } finally {
      if (mounted.current) setBusy(null)
    }
  }, [accountSession, base, loadModels])

  useEffect(() => {
    if (!loggedIn || !card) return
    if (models.length > 0) return
    void loadModels(base, card)
      .then(() => setStatus({ text: "已加载模型清单。" }))
      .catch((error) => setStatus({ error: true, text: errorText(error, [card]) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, card, base])

  const toggleModel = (id: string) => {
    setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]))
  }

  const handleEnable = async () => {
    if (!card) {
      setStatus({ error: true, text: "还没有凭证，先点「同步凭证」。" })
      return
    }
    if (selected.length === 0) {
      setStatus({ error: true, text: "请至少勾选一个模型。" })
      return
    }
    setBusy("enable")
    setStatus({ text: "正在写入模型配置…" })
    try {
      // 卡不写进配置：请求时由 auth-hook 从登录态现取。
      const result = await applyBuiltinModels({
        session: { serverUrl: base },
        modelIds: selected,
        makeDefault,
      })
      if (!mounted.current) return
      setStatus({
        text: makeDefault
          ? `已启用 ${result.modelCount} 个内置模型，并设为默认模型。`
          : `已启用 ${result.modelCount} 个内置模型（未改动默认模型）。`,
      })
    } catch (error) {
      if (!mounted.current) return
      setStatus({ error: true, text: errorText(error, [card]) })
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const handleProbe = async () => {
    if (!card) return
    const model = probeModel || selected[0] || models[0]
    if (!model) {
      setProbeResult({ error: true, text: "没有可测试的模型。" })
      return
    }
    setBusy("probe")
    setProbeResult({ text: `正在测试 ${model}…` })
    try {
      const result = await gatewayProbeChat(base, card, model)
      if (!mounted.current) return
      setProbeResult({ text: `${model} 返回：「${result.content}」（${result.latencyMs} ms）` })
    } catch (error) {
      if (!mounted.current) return
      setProbeResult({ error: true, text: errorText(error, [card]) })
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

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
                value={relayUrl}
                onChange={(event) => setRelayUrl(event.target.value)}
                onBlur={() => writeStoredRelayUrl(normalizeGatewayBaseUrl(relayUrl) || DEFAULT_RELAY_URL)}
                placeholder={DEFAULT_RELAY_URL}
                spellCheck={false}
                aria-label="中转站地址"
              />
            </div>
            <div className="builtin-model-row">
              <span className="builtin-model-label">
                <Check size={14} aria-hidden /> 凭证
              </span>
              <span className="builtin-model-value">
                {card ? (
                  <>
                    <span className="mono">{maskCard(card)}</span>
                    <em className="builtin-model-muted">（永久有效，随账号退出登录一起失效）</em>
                  </>
                ) : (
                  <em className="builtin-model-warn">尚未获取，点「同步凭证」</em>
                )}
              </span>
            </div>
            <div className="builtin-model-actions">
              <button
                type="button"
                className="builtin-model-button"
                onClick={() => void syncNetcard()}
                disabled={busy !== null}
              >
                <RefreshCw size={14} aria-hidden className={busy === "sync" ? "spin" : ""} />
                同步凭证
              </button>
              <button
                type="button"
                className="builtin-model-button primary"
                onClick={() => void handleEnable()}
                disabled={busy !== null || !card || selected.length === 0}
              >
                启用内置模型
              </button>
              <label className="builtin-model-check">
                <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
                同时设为默认模型
              </label>
            </div>
            {status && <p className={`builtin-model-status${status.error ? " error" : ""}`}>{status.text}</p>}
          </div>

          <div className="builtin-model-card">
            <div className="builtin-model-card-head">
              <strong>可用模型（{sortedModels.length}）</strong>
              <span className="builtin-model-muted">勾选后点上方「启用内置模型」写入配置</span>
            </div>
            {sortedModels.length === 0 ? (
              <p className="builtin-model-muted">
                {card ? "还没有拿到模型清单，稍等片刻或重新进入本页。" : "先点「同步凭证」获取内置模型。"}
              </p>
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
              <button
                type="button"
                className="builtin-model-button"
                onClick={() => void handleProbe()}
                disabled={busy !== null || !card}
              >
                测试连接
              </button>
            </div>
            {probeResult && <p className={`builtin-model-status${probeResult.error ? " error" : ""}`}>{probeResult.text}</p>}
          </div>
        </>
      )}

      <p className="builtin-model-foot">
        想用自己的密钥？到
        <button type="button" className="builtin-model-link" onClick={() => openExternalUrl("https://qmai.pro")}>
          大语言模型 <ExternalLink size={12} aria-hidden />
        </button>
        里选「自定义模型」，内置模型与它互不影响。
      </p>
    </section>
  )
}
