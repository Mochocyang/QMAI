import { confirmModelAction } from "./model-confirm"
import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, RefreshCw, Trash2, X } from "lucide-react"
import { CustomModelMark, ModelConfigTitle, modelEnableLabel, modelSaveLabel } from "@/components/settings/provider-brand-icon"
import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { resolveConfig } from "@/components/settings/preset-resolver"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import { testLlmConnection, testLlmFunction } from "@/lib/connection-tests"
import { FunctionCallingControls, ReasoningControls, withOutputRoomForReasoning } from "@/components/settings/sections/llm-provider-section"
import { ModelSecretInput } from "./model-secret-input"
import { mergeProviderModels, removeProviderModel, validateProviderDraft } from "./provider-data"
import { useProviderDraft } from "./provider-draft"
import { useModelDraftGuard } from "./model-draft-guard"
import { deleteUiTestProvider } from "./provider-save"
import { safeModelError, validateModelEndpoint } from "./model-feedback"
import "./model-settings.css"

export function UiTestCustomProviders() {
  const configs = useWikiStore(s => s.providerConfigs)
  const [added, setAdded] = useState<string[]>([])
  const ids = [...new Set([...Object.keys(configs).filter(id => id.startsWith("custom-")), ...added])]
  const [expanded, setExpanded] = useState<string | null>(() => ids[0] ?? null)
  return <section className="model-custom-providers" aria-label="自定义模型配置">
    <div className="model-section-heading"><div><h2>我的模型配置</h2><p>连接信息保存后生效，测试不会自动保存。</p></div><button type="button" className="model-button" onClick={() => { const id = `custom-${crypto.randomUUID()}`; setAdded(previous => [...previous, id]); setExpanded(id) }}><Plus />添加模型</button></div>
    {!ids.length && <div className="model-empty"><h3>添加你的第一个写作模型</h3><p>填写接口地址与模型 ID，测试连接后保存。支持 OpenAI 兼容、Responses 和 Anthropic 兼容接口。</p></div>}
    {ids.map(id => <UiTestProviderCard key={id} id={id} isNew={added.includes(id)} expanded={expanded === id} onToggle={() => setExpanded(expanded === id ? null : id)} onRemoved={() => { setAdded(previous => previous.filter(value => value !== id)); setExpanded(null) }} />)}
  </section>
}

const CUSTOM_DEFAULTS: ProviderOverride = { label: "我的写作模型", baseUrl: "", apiKey: "", model: "", apiMode: "chat_completions", maxContextSize: 204800, maxOutputTokens: 16384, reasoning: { mode: "auto" }, functionCallingEnabled: true, savedModels: [], enabled: true }
interface Props { id: string; expanded: boolean; isNew: boolean; onToggle: () => void; onRemoved: () => void }
export function UiTestProviderCard({ id, expanded, isNew, onToggle, onRemoved }: Props) {
  const state = useProviderDraft(id, CUSTOM_DEFAULTS, isNew)
  const { draft, saved, dirty, saving, status, revision, update, reset, save, saveSwitch, setStatus } = state
  const fallback = useWikiStore(s => s.llmConfig)
  const [manual, setManual] = useState("")
  const [options, setOptions] = useState<string[]>([])
  const [action, setAction] = useState<{ running: boolean; kind: string; error?: boolean; text: string } | null>(null)
  const [failed, setFailed] = useState<string[]>([])
  const failedTestKind = useRef<"connection" | "function">("connection")
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  useModelDraftGuard(`provider-delete:${id}`, "删除模型配置", false, deleting)
  const saveConfig = () => save(manual.trim() ? "还有未加入列表的模型 ID，请先点击“添加”，再保存配置。" : !draft.label?.trim() ? "请填写配置名称。" : validateProviderDraft(draft))
  useModelDraftGuard(`provider:${id}`, "提供方配置", dirty || Boolean(manual.trim()), saving, saveConfig, () => { reset(); setManual("") })
  const mounted = useRef(true)
  const request = useRef(0)
  const busyRef = useRef(false)
  const savedModels = draft.savedModels ?? []
  const config = useMemo(() => resolveConfig({ id, label: draft.label || "自定义模型", provider: "custom", baseUrl: draft.baseUrl, defaultModel: draft.model, apiMode: draft.apiMode }, draft, fallback), [id, draft, fallback])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++ } }, [])
  useEffect(() => { request.current++; busyRef.current = false; setOptions([]); setAction(null); setFailed([]) }, [draft.baseUrl, draft.apiKey, draft.apiMode])
  useEffect(() => { request.current++; busyRef.current = false; setAction(null) }, [draft])
  const retainFailed = (models: { model: string }[] | undefined) => {
    const selected = new Set((models ?? []).map(item => item.model))
    setFailed(previous => {
      const next = previous.filter(model => selected.has(model))
      return next.length === previous.length ? previous : next
    })
  }
  const change = (patch: Partial<ProviderOverride>) => {
    update(patch); request.current++; busyRef.current = false; setAction(null)
    if ("savedModels" in patch) retainFailed(patch.savedModels)
  }
  const chooseModels = (ids: string[]) => { change(mergeProviderModels(draft, ids)); setManual("") }
  const chooseFetchedModel = (model: string) => { change(mergeProviderModels({ ...draft, model: "", savedModels: draft.savedModels ?? [] }, [model])); setManual("") }
  async function execute(kind: "fetch" | "connection" | "function" | "retry") {
    if (busyRef.current) return
    const endpointError = validateModelEndpoint(draft.baseUrl ?? "")
    const selectedModels = savedModels.map(item => item.model).filter(model => model.trim())
    const models = kind === "retry" ? failed : selectedModels
    const error = endpointError ?? (kind !== "fetch" && models.length === 0 ? "请先在模型框中选择要测试的模型。" : null)
    if (error) { setAction({ kind, running: false, error: true, text: error }); return }
    const testKind = kind === "retry" ? failedTestKind.current : kind === "function" ? "function" : "connection"
    if (kind !== "fetch") failedTestKind.current = testKind
    const generation = ++request.current, draftRevision = revision.current
    const current = () => mounted.current && generation === request.current && draftRevision === revision.current
    busyRef.current = true; setAction({ kind, running: true, text: kind === "fetch" ? "正在拉取模型列表…" : `正在测试 0/${models.length}…` })
    try {
      if (kind === "fetch") {
        const result = await fetchLlmModelList(config)
        if (!current()) return
        setOptions([...new Set(result.models)]); setAction(null)
      } else {
        const failedIds: string[] = [], failures: string[] = []
        for (const [index, model] of models.entries()) {
          if (!current()) return
          let result
          try { result = await (testKind === "function" ? testLlmFunction : testLlmConnection)({ ...config, model }) }
          catch (error) { result = { ok: false, message: safeModelError(error, [draft.apiKey ?? ""]) } }
          if (!current()) return
          if (!result.ok) { failedIds.push(model); failures.push(`${model}：${safeModelError(result.message, [draft.apiKey ?? ""])}`) }
          setAction({ kind, running: true, text: `已测试 ${index + 1}/${models.length}` })
        }
        if (!current()) return
        setFailed(failedIds)
        setAction({ kind, running: false, error: !!failedIds.length, text: failedIds.length ? `测试完成，${models.length - failedIds.length}/${models.length} 通过。${failures.join("；")}` : `${testKind === "function" ? "功能" : "连接"}测试通过（${models.length}/${models.length}）。${dirty ? "当前配置尚未保存。" : "本次测试没有修改配置。"}` })
      }
    } catch (error) { if (current()) setAction({ kind, running: false, error: true, text: `操作失败：${safeModelError(error, [draft.apiKey ?? ""])}` }) }
    finally { if (generation === request.current) busyRef.current = false }
  }
  async function remove() {
    if (deletingRef.current || saving) return
    deletingRef.current = true; setDeleting(true)
    try { if (await deleteUiTestProvider(id, saved, draft.label ?? "", dirty || Boolean(manual.trim()))) onRemoved() }
    catch (error) { setStatus({ error: true, text: `删除失败：${safeModelError(error, [draft.apiKey ?? "", saved?.apiKey ?? ""])}；配置和当前输入已保留。` }) }
    finally { deletingRef.current = false; if (mounted.current) setDeleting(false) }
  }
  const canSave = dirty && !saving && !deleting && !manual.trim()
  return <article className="model-provider-card" data-model-provider={id}>
    <header><ModelConfigTitle expanded={expanded} controlsId={`${id}-fields`} onToggle={onToggle} name={draft.label || "未命名配置"} saveLabel={modelSaveLabel(Boolean(saved), dirty)} enableLabel={modelEnableLabel(draft.enabled !== false)} mark={<CustomModelMark />} /><button type="button" role="switch" aria-label="启用此模型配置" aria-checked={draft.enabled !== false} className="model-switch" disabled={saving || deleting} onClick={() => void saveSwitch({ enabled: draft.enabled === false })}><span /></button></header>
    {!expanded && status?.error && <p role="status" className="model-feedback error">{status.text}</p>}
    <div id={`${id}-fields`} hidden={!expanded}>
      <fieldset disabled={saving || deleting} className="model-form">
        <div className="model-fields">
          <label className="model-field full"><span>配置名称</span><input aria-label="配置名称" value={draft.label ?? ""} onChange={event => change({ label: event.target.value })} placeholder="例如：我的写作模型" /></label>
          <label className="model-field"><span>API 模式</span><select aria-label="API 模式" value={draft.apiMode ?? "chat_completions"} onChange={event => change({ apiMode: event.target.value as ProviderOverride["apiMode"] })}><option value="chat_completions">OpenAI 兼容</option><option value="responses">Responses API</option><option value="anthropic_messages">Anthropic 兼容</option></select></label>
          <label className="model-field"><span>接口地址</span><input aria-label="接口地址" value={draft.baseUrl ?? ""} onChange={event => change({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} /></label>
          <div className="model-field"><span>API 密钥</span><ModelSecretInput value={draft.apiKey ?? ""} onChange={apiKey => change({ apiKey })} /><small>默认遮蔽，不在摘要和错误反馈中显示。</small></div>
          <div className="model-field full"><span>模型</span><div className="model-tag-input">
            {savedModels.map(item => <span key={item.id} className={failed.includes(item.model) ? "is-failed" : ""}>{item.model}<button type="button" aria-label={`移除模型${item.model}`} onClick={() => change(removeProviderModel(draft, item.model))}><X /></button></span>)}
            <div className="model-tag-compose">
              <input aria-label="模型" value={manual} onChange={event => setManual(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); chooseModels(manual.split(/[,，\n]+/)) } }} placeholder={savedModels.length ? "输入模型名称，按回车添加" : "输入模型名称或拉取后选择"} spellCheck={false} />
              <button type="button" className="model-button" onClick={() => chooseModels(manual.split(/[,，\n]+/))} disabled={!manual.trim()}>添加</button>
            </div>
          </div></div>
        </div>
        <div className="model-actions"><button type="button" className="model-button" disabled={action?.running} onClick={() => void execute("fetch")}><RefreshCw />拉取模型</button><button type="button" className="model-button ghost" disabled={action?.running} onClick={() => void execute("connection")}>测试连接</button><button type="button" className="model-button ghost" disabled={action?.running} onClick={() => void execute("function")}>测试功能</button>{failed.length > 0 && <button type="button" className="model-button ghost" disabled={action?.running} onClick={() => void execute("retry")}>重试失败模型</button>}</div>
        {action && <p className={`model-feedback${action.error ? " error" : ""}`} role="status" aria-live="polite">{action.text}</p>}
        {!!options.length && <div className="model-catalog"><div className="model-section-heading"><p>已拉取 {options.length} 个模型 · 已选择 {savedModels.length} 个</p><div className="model-actions"><button type="button" className="model-button ghost" onClick={() => chooseModels(options)}>全选</button><button type="button" className="model-button ghost" onClick={() => change({ savedModels: [], model: "" })}>清空</button></div></div><p className="model-note">点击模型加入上方输入框，再次点击可取消。</p><div className="model-catalog-list">{options.map(model => <button type="button" key={model} aria-pressed={savedModels.some(item => item.model === model)} className={failed.includes(model) ? "is-failed" : ""} onClick={() => savedModels.some(item => item.model === model) ? change(removeProviderModel(draft, model)) : chooseFetchedModel(model)}>{model}</button>)}</div></div>}
        <div className="model-inline-fields"><label className="model-inline-field"><span>上下文窗口（tokens）</span><input type="number" aria-label="上下文窗口" min={204800} step={1} value={draft.maxContextSize ?? ""} onChange={event => change({ maxContextSize: Number(event.target.value) })} /></label><label className="model-inline-field"><span>输出上限（tokens）</span><input type="number" aria-label="输出上限" min={512} step={1} value={draft.maxOutputTokens ?? ""} onChange={event => change({ maxOutputTokens: Number(event.target.value) })} /></label></div><p className="model-note">上下文窗口最低 200K。请按服务商实际能力填写；数值只限制本次请求，不会提高模型能力。</p>
        <details className="model-advanced"><summary>高级选项 · 工具调用与推理</summary><FunctionCallingControls enabled={draft.functionCallingEnabled !== false} onChange={functionCallingEnabled => void saveSwitch({ functionCallingEnabled })} /><ReasoningControls value={draft.reasoning ?? { mode: "auto" }} onChange={reasoning => change(withOutputRoomForReasoning(reasoning, draft.maxOutputTokens))} onModeChange={mode => void saveSwitch(withOutputRoomForReasoning({ ...saved?.reasoning, mode }, saved?.maxOutputTokens ?? CUSTOM_DEFAULTS.maxOutputTokens))} /></details>
      </fieldset>
      <footer className="model-save-footer"><div><p role="status" aria-live="polite" className={status?.error ? "model-feedback error" : "model-feedback"}>{manual.trim() ? "还有未加入列表的模型 ID，请先点击“添加”，再保存配置。" : status?.text ?? (dirty ? "有未保存修改，保存后才会进入模型选择器。" : "当前配置已保存。")}</p><small>测试和保存是两种独立操作。</small></div><div className="model-actions"><button type="button" className="model-icon-button danger" title="删除配置" aria-label="删除配置" disabled={saving || deleting} onClick={() => void remove()}><Trash2 /></button>{(dirty || manual.trim()) && saved && <button type="button" className="model-button ghost" disabled={saving || deleting} onClick={async () => { if ((await confirmModelAction("放弃本项未保存的修改，恢复已保存配置？"))) { reset(); setManual(""); retainFailed(useWikiStore.getState().providerConfigs[id]?.savedModels) } }}>放弃修改</button>}<button type="button" className="model-button primary" disabled={!canSave} onClick={() => void saveConfig()}>{saving ? "正在保存…" : "保存配置"}</button></div></footer>
    </div>
  </article>
}
