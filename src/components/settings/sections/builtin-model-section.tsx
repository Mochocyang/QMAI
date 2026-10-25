/**
 * 「内置模型」设置页。
 *
 * 目标：作者不用去各家平台申请密钥，登录青幕账号、买额度，就能选
 * DeepSeek / GLM / Kimi / Grok 这些模型直接写小说。
 *
 * 这一页只做三件事：
 *  1. 账号：注册 / 登录 / 看余额 / 兑换额度；
 *  2. 开通：自动领一枚 sk- 令牌，并把网关登记成 provider（qmai-builtin）；
 *  3. 目录：从网关拉模型，勾选后写进现有模型配置，写作链路零改动。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ExternalLink, KeyRound, LogOut, RefreshCw, Server, Sparkles, UserRound } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { openExternalUrl } from "@/lib/open-external-url"
import { safeModelError } from "@/components/uitest/models/model-feedback"
import {
  BUILTIN_TOKEN_NAME,
  DEFAULT_BUILTIN_SERVER_URL,
  ensureBuiltinToken,
  formatQuotaUsd,
  gatewayFetchSelf,
  gatewayListModels,
  gatewayLogin,
  gatewayProbeChat,
  gatewayPublicStatus,
  gatewayRedeem,
  gatewayRefreshSession,
  gatewayRegister,
  isAccessTokenExpired,
  normalizeGatewayBaseUrl,
} from "@/lib/builtin-models/gateway-api"
import {
  createBuiltinSession,
  loadBuiltinSession,
  maskSecret,
  saveBuiltinSession,
  clearBuiltinSession,
  type BuiltinSession,
} from "@/lib/builtin-models/session"
import {
  BUILTIN_PROVIDER_ID,
  applyBuiltinModels,
} from "@/lib/builtin-models/provider-bridge"
import {
  defaultSelectedModelIds,
  describeBuiltinModel,
  sortBuiltinModelIds,
} from "@/lib/builtin-models/catalog"
import "./builtin-model-section.css"

type AuthMode = "login" | "register"

interface StatusLine {
  error?: boolean
  text: string
}

const SERVER_URL_STORAGE_KEY = "qmai.builtin.serverUrl.v1"

function readStoredServerUrl(): string {
  if (typeof localStorage === "undefined") return DEFAULT_BUILTIN_SERVER_URL
  return localStorage.getItem(SERVER_URL_STORAGE_KEY)?.trim() || DEFAULT_BUILTIN_SERVER_URL
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

export function BuiltinModelSection() {
  const providerOverride = useWikiStore((s) => s.providerConfigs[BUILTIN_PROVIDER_ID])
  const [session, setSession] = useState<BuiltinSession | null>(() => loadBuiltinSession())
  const [serverUrl, setServerUrl] = useState(() => loadBuiltinSession()?.serverUrl ?? readStoredServerUrl())
  const [authMode, setAuthMode] = useState<AuthMode>("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [manualKey, setManualKey] = useState("")
  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusLine | null>(null)
  const [makeDefault, setMakeDefault] = useState(true)
  const [redeemCode, setRedeemCode] = useState("")
  const [probeModel, setProbeModel] = useState("")
  const [probeResult, setProbeResult] = useState<StatusLine | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const activeKey = session?.tokenKey ?? manualKey
  // 已登录时以登录时确认的网关为准：作者改地址栏不应把令牌指向另一台网关。
  const activeBase = session ? session.serverUrl : normalizeGatewayBaseUrl(serverUrl)
  const expired = session ? isAccessTokenExpired(session.accessExpiresAt) : false
  const sortedModels = useMemo(() => sortBuiltinModelIds(models), [models])
  const enabledCount = providerOverride?.savedModels?.length ?? 0

  const loadModels = useCallback(async (key: string) => {
    const base = normalizeGatewayBaseUrl(serverUrl)
    const ids = await gatewayListModels(base, key)
    if (!mounted.current) return ids
    const sorted = sortBuiltinModelIds(ids)
    setModels(ids)
    setSelected((previous) => {
      const kept = previous.filter((id) => sorted.includes(id))
      return kept.length > 0 ? kept : defaultSelectedModelIds(sorted)
    })
    setProbeModel((previous) => (previous && sorted.includes(previous) ? previous : sorted[0] ?? ""))
    return ids
  }, [serverUrl])

  // 已有登录态：进页面先刷新余额、再拉一次目录。失败只提示，不影响既有写作配置。
  useEffect(() => {
    if (!session) return
    let cancelled = false
    void (async () => {
      try {
        await loadModels(session.tokenKey)
      } catch (error) {
        if (!cancelled && mounted.current) {
          setStatus({ error: true, text: `拉取模型目录失败：${errorText(error, [session.tokenKey])}` })
        }
      }
      if (cancelled || !mounted.current) return
      let active = session
      if (isAccessTokenExpired(session.accessExpiresAt)) {
        // 账号令牌 15 分钟；同一运行周期里 plugin-http 的内存 cookie jar
        // 还能带上 refresh cookie，静默续期，作者不用重登。
        try {
          const refreshed = await gatewayRefreshSession(normalizeGatewayBaseUrl(session.serverUrl))
          if (cancelled || !mounted.current) return
          active = {
            ...session,
            accessToken: refreshed.accessToken,
            accessExpiresAt: refreshed.accessExpiresAt,
            quota: refreshed.user.quota,
            usedQuota: refreshed.user.usedQuota,
          }
          setSession(active)
          saveBuiltinSession(active)
        } catch {
          return
        }
      }
      try {
        const user = await gatewayFetchSelf(normalizeGatewayBaseUrl(session.serverUrl), active.accessToken)
        if (cancelled || !mounted.current) return
        setSession((previous) => {
          if (!previous) return previous
          const next = { ...previous, quota: user.quota, usedQuota: user.usedQuota, displayName: user.displayName || previous.displayName }
          saveBuiltinSession(next)
          return next
        })
      } catch {
        // 余额刷新失败不打扰作者：页面上仍显示最后一次已知数值。
      }
    })()
    return () => {
      cancelled = true
    }
    // 只在登录身份变化时跑一次；serverUrl 改动由“登录/开通”重新触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.tokenKey])

  /** 账号操作前先保证 access token 可用：过期就续期，续不上就提示重登。 */
  async function freshSession(): Promise<BuiltinSession> {
    if (!session) throw new Error("请先登录。")
    if (!isAccessTokenExpired(session.accessExpiresAt)) return session
    const refreshed = await gatewayRefreshSession(normalizeGatewayBaseUrl(session.serverUrl))
    const next: BuiltinSession = {
      ...session,
      accessToken: refreshed.accessToken,
      accessExpiresAt: refreshed.accessExpiresAt,
      quota: refreshed.user.quota,
      usedQuota: refreshed.user.usedQuota,
    }
    setSession(next)
    saveBuiltinSession(next)
    return next
  }

  async function withBusy(name: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(name)
    setStatus({ text: name === "login" ? "正在登录…" : name === "register" ? "正在注册…" : "处理中…" })
    setProbeResult(null)
    try {
      await action()
    } catch (error) {
      if (mounted.current) setStatus({ error: true, text: errorText(error, [password, manualKey, session?.tokenKey ?? ""]) })
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  async function finishProvision(
    base: string,
    accessToken: string,
    accessExpiresAt: number,
    user: { id: number; username: string; displayName: string; group: string; quota: number; usedQuota: number },
    tokenId: number,
    tokenKey: string,
    created: boolean,
    modelsHint: string[],
  ) {
    const publicStatus = await gatewayPublicStatus(base).catch(() => null)
    const nextSession = createBuiltinSession({
      serverUrl: base,
      accessToken,
      accessExpiresAt,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      group: user.group,
      quota: user.quota,
      usedQuota: user.usedQuota,
      quotaPerUnit: publicStatus?.quotaPerUnit,
      usdExchangeRate: publicStatus?.usdExchangeRate,
      tokenId,
      tokenKey,
    })
    setSession(nextSession)
    saveBuiltinSession(nextSession)
    writeStoredServerUrl(base)
    setManualKey("")

    const sorted = sortBuiltinModelIds(modelsHint)
    setModels(modelsHint)
    const picks = defaultSelectedModelIds(sorted)
    setSelected(picks)
    setProbeModel((previous) => (previous && sorted.includes(previous) ? previous : sorted[0] ?? ""))

    const result = await applyBuiltinModels({ session: nextSession, modelIds: picks, makeDefault })
    const quotaText = formatQuotaUsd(user.quota, publicStatus?.quotaPerUnit ?? 500000)
    const lowQuota = user.quota <= 0
    setStatus({
      text: [
        created ? `已为账号开通「${BUILTIN_TOKEN_NAME}」令牌。` : "已复用账号里已有的内置模型令牌。",
        `启用 ${result.modelCount} 个模型${result.modelKey ? `，默认写作模型：${result.modelKey}` : ""}。`,
        lowQuota
          ? `当前余额 ${quotaText}，额度为 0 时请求会提示“额度不足”，请先在下方充值。`
          : `当前余额 ${quotaText}。`,
      ].join(""),
    })
  }

  function login() {
    void withBusy("login", async () => {
      const base = normalizeGatewayBaseUrl(serverUrl)
      if (!base) throw new Error("请先填写网关地址，例如 http://localhost:3000")
      if (!username.trim() || !password) throw new Error("请填写账号和密码。")
      const result = await gatewayLogin(base, username.trim(), password)
      const token = await ensureBuiltinToken(base, result.accessToken)
      const ids = await gatewayListModels(base, token.key)
      if (ids.length === 0) throw new Error("登录成功，但网关没有给这个账号返回任何模型。请联系管理员确认会员分组/渠道。")
      await finishProvision(
        base,
        result.accessToken,
        result.accessExpiresAt,
        result.user,
        token.tokenId,
        token.key,
        token.created,
        ids,
      )
    })
  }

  function register() {
    void withBusy("register", async () => {
      const base = normalizeGatewayBaseUrl(serverUrl)
      if (!base) throw new Error("请先填写网关地址，例如 http://localhost:3000")
      if (!username.trim() || !password) throw new Error("请填写要注册的账号和密码。")
      if (password.length < 8) throw new Error("密码至少 8 位（网关要求 8–128 位）。")
      if (username.trim().length > 20) throw new Error("账号最多 20 个字符。")
      await gatewayRegister(base, username.trim(), password)
      const result = await gatewayLogin(base, username.trim(), password)
      const token = await ensureBuiltinToken(base, result.accessToken)
      const ids = await gatewayListModels(base, token.key)
      await finishProvision(
        base,
        result.accessToken,
        result.accessExpiresAt,
        result.user,
        token.tokenId,
        token.key,
        token.created,
        ids,
      )
    })
  }

  function useManualKey() {
    void withBusy("key", async () => {
      const key = manualKey.trim()
      if (!key) throw new Error("请填写以 sk- 开头的密钥。")
      const base = normalizeGatewayBaseUrl(serverUrl)
      const ids = await gatewayListModels(base, key)
      if (ids.length === 0) throw new Error("这个密钥没有可用的模型。请确认密钥所属账号已开通。")
      setModels(ids)
      const picks = defaultSelectedModelIds(sortBuiltinModelIds(ids))
      setSelected(picks)
      setProbeModel((previous) => (previous && ids.includes(previous) ? previous : picks[0] ?? ids[0]))
      const result = await applyBuiltinModels({
        session: { serverUrl: base, tokenKey: key.startsWith("sk-") ? key : `sk-${key}` },
        modelIds: picks,
        makeDefault,
      })
      writeStoredServerUrl(base)
      setStatus({
        text: `已用测试密钥启用 ${result.modelCount} 个内置模型${result.modelKey ? `，默认写作模型：${result.modelKey}` : ""}。这套配置不依赖账号登录，可直接写作。`,
      })
    })
  }

  function applySelection() {
    void withBusy("apply", async () => {
      if (!activeKey) throw new Error("还没有可用的令牌，请先登录或在下方填写密钥。")
      if (selected.length === 0) throw new Error("请至少勾选一个模型。")
      const ordered = sortBuiltinModelIds(selected)
      const result = await applyBuiltinModels({
        session: { serverUrl: activeBase, tokenKey: activeKey },
        modelIds: ordered,
        makeDefault,
      })
      setStatus({
        text: `已启用 ${result.modelCount} 个内置模型${result.modelKey ? `，默认写作模型：${result.modelKey}` : ""}。到「章节」即可开始写作。`,
      })
    })
  }

  function refreshAccount() {
    void withBusy("refresh", async () => {
      const active = await freshSession()
      const user = await gatewayFetchSelf(normalizeGatewayBaseUrl(active.serverUrl), active.accessToken)
      const next = { ...active, quota: user.quota, usedQuota: user.usedQuota, displayName: user.displayName || active.displayName }
      setSession(next)
      saveBuiltinSession(next)
      setStatus({ text: `余额已更新：${formatQuotaUsd(user.quota, active.quotaPerUnit)}。` })
    })
  }

  function redeem() {
    void withBusy("redeem", async () => {
      if (!redeemCode.trim()) throw new Error("请填写兑换码。")
      const active = await freshSession()
      const message = await gatewayRedeem(normalizeGatewayBaseUrl(active.serverUrl), active.accessToken, redeemCode.trim())
      const user = await gatewayFetchSelf(normalizeGatewayBaseUrl(active.serverUrl), active.accessToken)
      const next = { ...active, quota: user.quota, usedQuota: user.usedQuota }
      setSession(next)
      saveBuiltinSession(next)
      setRedeemCode("")
      setStatus({ text: `${message || "兑换成功"}。当前余额 ${formatQuotaUsd(user.quota, active.quotaPerUnit)}。` })
    })
  }

  function probe() {
    void withBusy("probe", async () => {
      if (!activeKey) throw new Error("还没有可用的令牌。")
      if (!probeModel) throw new Error("请先选择要测试的模型。")
      const result = await gatewayProbeChat(normalizeGatewayBaseUrl(activeBase), activeKey, probeModel)
      setProbeResult({ text: `测试通过：${probeModel} · ${(result.latencyMs / 1000).toFixed(1)} 秒 · 回复「${result.content.slice(0, 40)}」` })
    })
  }

  function logout() {
    clearBuiltinSession()
    setSession(null)
    setManualKey("")
    setModels([])
    setSelected([])
    setProbeResult(null)
    setStatus({ text: "已退出内置模型账号。已写入的模型配置仍保留，写作不会中断；令牌可在网关后台删除。" })
  }

  const base = normalizeGatewayBaseUrl(session?.serverUrl ?? serverUrl)
  const topupUrl = `${base}/console/topup`
  const quotaText = session ? formatQuotaUsd(session.quota, session.quotaPerUnit) : ""
  const usedText = session ? formatQuotaUsd(session.usedQuota, session.quotaPerUnit) : ""
  const cnyText = session && session.usdExchangeRate > 0
    ? `¥${((session.quota / (session.quotaPerUnit || 500000)) * session.usdExchangeRate).toFixed(2)}`
    : ""

  return (
    <section data-ui="builtin-models" aria-label="内置模型">
      <div className="model-section-heading">
        <div>
          <h2>青幕内置模型</h2>
          <p>不用自己申请各家密钥：登录账号、开通额度，直接选 DeepSeek / GLM / Kimi / Grok 写小说。</p>
        </div>
        <span className={enabledCount > 0 ? "builtin-badge is-on" : "builtin-badge"}>
          {enabledCount > 0 ? `已启用 ${enabledCount} 个模型` : "尚未启用"}
        </span>
      </div>

      {!session && (
        <div className="builtin-card">
          <div className="builtin-auth-head">
            <div role="tablist" aria-label="账号方式" className="builtin-tabs">
              <button type="button" role="tab" aria-selected={authMode === "login"} onClick={() => { setAuthMode("login"); setStatus(null) }}>
                <UserRound aria-hidden /> 登录
              </button>
              <button type="button" role="tab" aria-selected={authMode === "register"} onClick={() => { setAuthMode("register"); setStatus(null) }}>
                <Sparkles aria-hidden /> 注册新账号
              </button>
            </div>
            <span className="builtin-server-chip">
              <Server aria-hidden /> {base.replace(/^https?:\/\//, "") || DEFAULT_BUILTIN_SERVER_URL.replace(/^https?:\/\//, "")}
            </span>
          </div>

          <div className="model-fields">
            <label className="model-field">
              <span>网关地址</span>
              <input
                aria-label="内置模型网关地址"
                value={serverUrl}
                spellCheck={false}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder={DEFAULT_BUILTIN_SERVER_URL}
              />
              <small>当前测试版指向本机 New API 网关；正式版换成官方 HTTPS 域名。</small>
            </label>
            <label className="model-field">
              <span>{authMode === "login" ? "账号" : "设置账号"}</span>
              <input
                aria-label="内置模型账号"
                value={username}
                autoComplete="username"
                spellCheck={false}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="用户名"
              />
            </label>
            <label className="model-field">
              <span>{authMode === "login" ? "密码" : "设置密码"}</span>
              <input
                aria-label="内置模型密码"
                type="password"
                value={password}
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    if (authMode === "login") login()
                    else register()
                  }
                }}
                placeholder={authMode === "login" ? "密码" : "至少 8 位"}
              />
            </label>
          </div>

          <div className="builtin-actions">
            <button
              type="button"
              className="model-button primary"
              data-guide="builtin.login"
              disabled={!!busy}
              onClick={() => (authMode === "login" ? login() : register())}
            >
              {busy === "login" || busy === "register" ? "正在连接…" : authMode === "login" ? "登录并开通内置模型" : "注册并开通内置模型"}
            </button>
            <p className="model-note">
              开通时会自动创建一枚「{BUILTIN_TOKEN_NAME}」令牌并写进模型配置；余额为 0 时能选模型，但请求会提示额度不足。
            </p>
          </div>

          <div className="builtin-divider"><span>或者，先用测试密钥跑通</span></div>
          <div className="builtin-key-row">
            <label className="model-field">
              <span>API 密钥</span>
              <input
                aria-label="内置模型测试密钥"
                value={manualKey}
                spellCheck={false}
                onChange={(event) => setManualKey(event.target.value)}
                placeholder="sk-..."
              />
              <small>仅用于本机验证。填了密钥就会拉取该账号可见的模型并直接启用。</small>
            </label>
            <button type="button" className="model-button" disabled={!!busy || !manualKey.trim()} onClick={useManualKey}>
              <KeyRound aria-hidden /> 用这个密钥启用
            </button>
          </div>
        </div>
      )}

      {session && (
        <div className="builtin-card builtin-account">
          <div className="builtin-account-main">
            <div className="builtin-identity">
              <span className="builtin-avatar" aria-hidden><UserRound /></span>
              <div>
                <strong>{session.displayName || session.username}</strong>
                <small>
                  账号 {session.username}
                  {session.group ? ` · 分组 ${session.group}` : ""}
                  {expired ? " · 登录已过期" : ""}
                </small>
              </div>
            </div>
            <div className="builtin-balance">
              <div>
                <span>余额</span>
                <strong>{quotaText}</strong>
                {cnyText && <small>{cnyText}</small>}
              </div>
              <div>
                <span>已用</span>
                <strong>{usedText}</strong>
              </div>
              <div>
                <span>写作令牌</span>
                <strong className="builtin-token">{maskSecret(session.tokenKey)}</strong>
              </div>
            </div>
          </div>
          <div className="builtin-account-actions">
            <button type="button" className="model-button ghost" disabled={!!busy} onClick={refreshAccount}>
              <RefreshCw aria-hidden /> 刷新余额
            </button>
            <button type="button" className="model-button ghost" disabled={!!busy} onClick={logout}>
              <LogOut aria-hidden /> 退出登录
            </button>
            <p className="model-note">
              网关地址：{session.serverUrl}
              {expired ? "。账号令牌 15 分钟过期，重新登录即可继续看余额/充值；写作令牌不受影响。" : "。"}
            </p>
          </div>
        </div>
      )}

      {sortedModels.length > 0 && (
        <div className="builtin-card">
          <div className="builtin-card-head">
            <div>
              <h3>模型目录</h3>
              <p>勾选要用于写作的模型。上下文与输出上限按保守值预置，可在「大语言模型」里逐项调整。</p>
            </div>
            <div className="model-actions">
              <button
                type="button"
                className="model-button ghost"
                disabled={!!busy}
                onClick={() => setSelected(defaultSelectedModelIds(sortedModels))}
              >
                选推荐
              </button>
              <button type="button" className="model-button ghost" disabled={!!busy} onClick={() => setSelected([])}>
                清空
              </button>
            </div>
          </div>
          <div className="builtin-model-grid">
            {sortedModels.map((id) => {
              const meta = describeBuiltinModel(id)
              const checked = selected.includes(id)
              return (
                <button
                  type="button"
                  key={id}
                  aria-pressed={checked}
                  className={checked ? "builtin-model-card is-selected" : "builtin-model-card"}
                  onClick={() => setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]))}
                >
                  <span className="builtin-model-card-top">
                    <strong>{meta.label}</strong>
                    {checked && <Check aria-hidden />}
                  </span>
                  <code>{id}</code>
                  <small>{meta.note}</small>
                  <span className="builtin-model-card-meta">
                    上下文 {Math.round(meta.contextSize / 1000)}k · 输出 {Math.round(meta.maxOutputTokens / 1000)}k
                    {meta.recommended ? " · 推荐" : ""}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="builtin-apply-row">
            <label className="builtin-switch">
              <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
              <span>同时设为默认写作模型</span>
            </label>
            <button
              type="button"
              className="model-button primary"
              data-guide="builtin.apply"
              disabled={!!busy || selected.length === 0}
              onClick={applySelection}
            >
              {busy === "apply" ? "正在写入…" : `启用选中的 ${selected.length} 个模型`}
            </button>
          </div>
        </div>
      )}

      {activeKey && (
        <div className="builtin-card">
          <div className="builtin-card-head">
            <div>
              <h3>测试连接</h3>
              <p>发一条最小请求，确认令牌、模型和额度都能用。</p>
            </div>
          </div>
          <div className="builtin-probe-row">
            <select aria-label="测试模型" value={probeModel} onChange={(event) => setProbeModel(event.target.value)} disabled={!!busy}>
              {sortedModels.map((id) => <option key={id} value={id}>{describeBuiltinModel(id).label}（{id}）</option>)}
            </select>
            <button type="button" className="model-button" disabled={!!busy || !probeModel} onClick={probe}>
              {busy === "probe" ? "正在测试…" : "测试连接"}
            </button>
          </div>
          {probeResult && <p className={probeResult.error ? "model-feedback error" : "model-feedback"} role="status">{probeResult.text}</p>}
        </div>
      )}

      {session && (
        <div className="builtin-card">
          <div className="builtin-card-head">
            <div>
              <h3>充值 / 兑换额度</h3>
              <p>会员套餐在网关侧购买。已有兑换码可直接在这里兑换，额度立刻到账。</p>
            </div>
            <button type="button" className="model-button ghost" onClick={() => void openExternalUrl(topupUrl)}>
              <ExternalLink aria-hidden /> 打开充值页面
            </button>
          </div>
          <div className="builtin-redeem-row">
            <label className="model-field">
              <span>兑换码</span>
              <input
                aria-label="充值兑换码"
                value={redeemCode}
                spellCheck={false}
                onChange={(event) => setRedeemCode(event.target.value)}
                placeholder="粘贴兑换码"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    redeem()
                  }
                }}
              />
            </label>
            <button type="button" className="model-button" disabled={!!busy || !redeemCode.trim()} onClick={redeem}>
              {busy === "redeem" ? "正在兑换…" : "兑换额度"}
            </button>
          </div>
          <p className="model-note">测试版网关未接在线支付，额度由管理员发放兑换码；正式版可接支付宝/微信或 Stripe。</p>
        </div>
      )}

      {status && (
        <p className={status.error ? "builtin-status error" : "builtin-status"} role="status" aria-live="polite">
          {status.text}
        </p>
      )}
    </section>
  )
}
