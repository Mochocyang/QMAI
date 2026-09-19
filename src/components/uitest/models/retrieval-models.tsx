import { confirmModelAction } from "./model-confirm"
import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useWikiStore, type EmbeddingConfig, type LlmConfig, type RerankConfig } from "@/stores/wiki-store"
import { saveEmbeddingConfig, saveRerankConfig } from "@/lib/project-store"
import { persistModelChange } from "./model-persistence"
import { testSettingsEmbeddingModel, testSettingsRerankModel } from "@/lib/settings-model-test"
import { fetchEmbeddingModelList, fetchRerankModelList } from "@/lib/settings-model-list"
import { dropLegacyVectorTable, embedAllPages, getEmbeddingCount, getLastEmbeddingError, legacyVectorRowCount } from "@/lib/embedding"
import { ModelSelectInput } from "@/components/settings/model-select-input"
import { ModelSecretInput } from "./model-secret-input"
import { useModelConfigForm } from "./model-config-form"
import { useModelDraftGuard } from "./model-draft-guard"
import { safeModelError, validateModelEndpoint } from "./model-feedback"
import { validateEmbeddingDraft, validateRerankDraft } from "./retrieval-data"
import "./model-settings.css"

type Message = { running?: boolean; error?: boolean; text: string } | null
const PROVIDERS: Array<{ value: LlmConfig["provider"]; label: string }> = [{ value: "custom", label: "自定义兼容接口" },{ value: "openai", label: "OpenAI" },{ value: "anthropic", label: "Anthropic" },{ value: "google", label: "Google" },{ value: "ollama", label: "Ollama（本地）" },{ value: "minimax", label: "MiniMax" },{ value: "claude-code", label: "Claude Code CLI" },{ value: "codex-cli", label: "Codex CLI" },{ value: "cursor-cli", label: "Cursor CLI" }]
function ApiMode({ value, onChange }: { value: RerankConfig["apiMode"]; onChange: (value: RerankConfig["apiMode"]) => void }) {
  return <label className="model-field"><span>API 模式</span><select aria-label="API 模式" value={value ?? "chat_completions"} onChange={event => onChange(event.target.value as RerankConfig["apiMode"])}><option value="chat_completions">OpenAI 兼容</option><option value="responses">Responses API</option><option value="anthropic_messages">Anthropic 兼容</option></select></label>
}
function SaveFooter({ dirty, saving, status, onSave, onReset }: { dirty: boolean; saving: boolean; status: Message; onSave: () => void; onReset: () => void }) {
  return <footer className="model-save-footer"><p role="status" aria-live="polite" className={status?.error ? "model-feedback error" : "model-feedback"}>{status?.text ?? (dirty ? "有未保存修改，保存后生效。" : "配置已保存。测试不等于保存。")}</p><div className="model-actions">{dirty && <button type="button" className="model-button ghost" disabled={saving} onClick={async () => { if ((await confirmModelAction("放弃本页未保存的修改？"))) onReset() }}>放弃修改</button>}<button type="button" className="model-button primary" disabled={!dirty || saving} onClick={onSave}>{saving ? "正在保存…" : "保存配置"}</button></div></footer>
}
export function UiTestEmbeddingModels() {
  const saved = useWikiStore(s => s.embeddingConfig), project = useWikiStore(s => s.project)
  const form = useModelConfigForm("embedding-model", saved, (value: EmbeddingConfig) => [value.apiKey])
  const { draft, dirty, saving, status, update, reset, save, revision, alive } = form
  const [options, setOptions] = useState<string[]>([]), [action, setAction] = useState<Message>(null)
  const [stats, setStats] = useState<{ count: number | null; legacy: number }>({ count: null, legacy: 0 })
  const [indexAction, setIndexAction] = useState<Message>(null)
  const [indexStale, setIndexStale] = useState(false)
  const indexBusy = useRef(false), actionId = useRef(0)
  useModelDraftGuard("embedding-index", "向量索引任务", false, !!indexAction?.running)
  const scope = project?.path ?? ""
  const scopeRef = useRef(scope); scopeRef.current = scope
  async function refresh() {
    if (!project) return
    try { const [count, legacy] = await Promise.all([getEmbeddingCount(project.path), legacyVectorRowCount(project.path)]); if (alive.current && scopeRef.current === scope) setStats({ count, legacy }) }
    catch { if (alive.current && scopeRef.current === scope) setStats({ count: null, legacy: 0 }) }
  }
  useEffect(() => { void refresh() }, [scope])
  useEffect(() => { actionId.current++; setOptions([]); setAction(null) }, [draft.endpoint, draft.apiKey])
  useEffect(() => { actionId.current++; setAction(null) }, [draft])
  async function network(kind: "fetch" | "test") {
    const error = validateModelEndpoint(draft.endpoint) ?? (kind === "test" ? validateEmbeddingDraft({ ...draft, enabled: true }) : null)
    if (error) { setAction({ error: true, text: error }); return }
    if (kind === "test" && !(await confirmModelAction("将向当前向量接口发送测试文本，可能产生费用；不会保存配置或重建索引。是否继续？"))) return
    const version = revision.current, id = ++actionId.current, captured = { ...draft, enabled: true }
    const current = () => alive.current && revision.current === version && actionId.current === id
    setAction({ running: true, text: kind === "fetch" ? "正在拉取模型…" : "正在测试向量模型…" })
    try {
      if (kind === "fetch") { const result = await fetchEmbeddingModelList(captured); if (current()) { setOptions(result.models); setAction({ text: `已拉取 ${result.models.length} 个模型。选择后请保存。` }) } }
      else { const result = await testSettingsEmbeddingModel(captured); if (current()) setAction({ text: `向量测试通过：${result.model}，返回 ${result.dimensions} 维。${dirty ? "当前配置尚未保存。" : "没有重建索引。"}` }) }
    } catch (error) { if (current()) setAction({ error: true, text: safeModelError(error, [captured.apiKey]) }) }
  }
  async function index(kind: "rebuild" | "legacy") {
    if (!project || indexBusy.current || dirty || saving) return
    if (!(await confirmModelAction(kind === "rebuild" ? `将为“${project.name}”重建向量索引，调用已保存的向量模型并可能产生费用；不会删除正文。是否继续？` : `将删除“${project.name}”的旧版向量索引，不删除正文或新索引。是否继续？`))) return
    indexBusy.current = true; setIndexAction({ running: true, text: "正在处理索引…" })
    try {
      if (kind === "legacy") { await dropLegacyVectorTable(project.path); if (alive.current && scopeRef.current === scope) { setIndexAction({ text: "旧版索引已删除，正文未改变。" }); await refresh() } }
      else {
        const count = await embedAllPages(project.path, saved, (done, total) => { if (alive.current && scopeRef.current === scope) setIndexAction({ running: true, text: `索引进度：${done}/${total}` }) })
        const error = getLastEmbeddingError()
        if (alive.current && scopeRef.current === scope) { setIndexAction(error ? { error: true, text: safeModelError(error, [saved.apiKey]) } : { text: `索引处理完成，${count} 个文本块。` }); if (!error) setIndexStale(false); await refresh() }
      }
    } catch (error) { if (alive.current && scopeRef.current === scope) setIndexAction({ error: true, text: safeModelError(error, [saved.apiKey]) }) }
    finally { indexBusy.current = false }
  }
  const change = (patch: Partial<EmbeddingConfig>) => { update(patch); actionId.current++; setAction(null) }
  return <section className="model-retrieval" aria-label="向量模型配置">
    <header>
      <div><h2>启用向量检索</h2><p className="model-note">全局模型配置 · 关闭后仍可使用关键词搜索，不会删除小说或索引。</p></div>
      <button type="button" className="model-switch" role="switch" aria-label="启用向量检索" aria-checked={draft.enabled} disabled={saving || indexAction?.running} onClick={() => change({ enabled: !draft.enabled })}><span /></button>
    </header>
    <fieldset className="model-form" disabled={saving || indexAction?.running}>
      <div className="model-fields">
        <label className="model-field"><span>接口地址</span><input aria-label="向量接口地址" value={draft.endpoint} onChange={event => change({ endpoint: event.target.value })} placeholder="https://api.example.com/v1/embeddings" /></label>
        <div className="model-field"><span>API 密钥（本地服务可选）</span><ModelSecretInput value={draft.apiKey} onChange={apiKey => change({ apiKey })} label="向量 API 密钥" /></div>
        <label className="model-field"><span>模型 ID</span><ModelSelectInput value={draft.model} options={options} onChange={model => change({ model })} inputPlaceholder="输入向量模型 ID" selectPlaceholder="选择已拉取的向量模型" /></label>
        <label className="model-field"><span>输出维度（仅 Gemini）</span><input type="number" min={1} aria-label="向量输出维度" value={draft.outputDimensionality ?? ""} placeholder="留空使用模型默认值" onChange={event => change({ outputDimensionality: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
        <label className="model-field"><span>每块字符数</span><input type="number" min={200} aria-label="每块字符数" value={draft.maxChunkChars ?? ""} placeholder="默认 1000" onChange={event => change({ maxChunkChars: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
        <label className="model-field"><span>重叠字符数</span><input type="number" min={0} aria-label="重叠字符数" value={draft.overlapChunkChars ?? ""} placeholder="默认 200" onChange={event => change({ overlapChunkChars: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
      </div>
      <p className="model-note">分块单位是字符，不是 tokens；重叠须小于每块字符数。输出维度仅在支持此参数的 Gemini 原生接口生效。</p>
      <div className="model-actions">
        <button type="button" className="model-button" disabled={action?.running} onClick={() => void network("fetch")}><RefreshCw />拉取模型</button>
        <button type="button" className="model-button ghost" disabled={action?.running} onClick={() => void network("test")}>测试向量模型</button>
      </div>
      {action && <p className={action.error ? "model-feedback error" : "model-feedback"} role="status">{action.text}</p>}
    </fieldset>
    <section className="model-section-note">
      <h3>当前小说索引</h3>
      <p>{project ? `${project.name} · ${stats.count === null ? "尚未读取索引数量" : `${stats.count} 个文本块`} · 旧版索引 ${stats.legacy} 条` : "请先打开小说，再查看或重建索引。"}</p>
      <p>{indexStale ? "模型配置已改变，请重建索引后再使用新向量。" : "索引数量不代表与当前模型兼容；更改模型、维度或分块后请重建。"}</p>
      <div className="model-index-actions">
        <button type="button" className="model-button ghost" disabled={!project || indexAction?.running} onClick={() => void refresh()}>刷新状态</button>
        <button type="button" className="model-button" disabled={!project || !saved.enabled || dirty || saving || indexAction?.running} onClick={() => void index("rebuild")}>重建索引</button>
        {stats.legacy > 0 && <button type="button" className="model-button ghost" disabled={!project || dirty || saving || indexAction?.running} onClick={() => void index("legacy")}>删除旧版索引</button>}
      </div>
      {dirty && <p>先保存配置，再执行索引维护。</p>}
      {indexAction && <p role="status" className={indexAction.error ? "model-feedback error" : "model-feedback"}>{indexAction.text}</p>}
    </section>
    <SaveFooter dirty={dirty} saving={saving} status={status} onReset={reset} onSave={() => void save(validateEmbeddingDraft(draft), async snapshot => { await persistModelChange(() => saveEmbeddingConfig(snapshot), () => saveEmbeddingConfig(saved)); useWikiStore.getState().setEmbeddingConfig(snapshot); setIndexStale(true) })} />
  </section>
}

export function UiTestRerankModels() {
  const saved = useWikiStore(s => s.rerankConfig), llm = useWikiStore(s => s.llmConfig), project = useWikiStore(s => s.project)
  const form = useModelConfigForm("rerank-model", saved, (value: RerankConfig) => [value.apiKey])
  const { draft, dirty, saving, status, update, reset, save, revision, alive } = form
  const [options, setOptions] = useState<string[]>([]), [action, setAction] = useState<Message>(null)
  const request = useRef(0)
  useEffect(() => { request.current++; setOptions([]); setAction(null) }, [draft.provider, draft.apiKey, draft.customEndpoint, draft.ollamaUrl, draft.apiMode, draft.useMainLlm])
  useEffect(() => { if (draft.useMainLlm) { request.current++; setAction(null) } }, [llm])
  useEffect(() => { request.current++; setAction(null) }, [draft])
  const change = (patch: Partial<RerankConfig>) => { update(patch); request.current++; setAction(null) }
  async function network(kind: "fetch" | "test") {
    const error = kind === "test" ? validateRerankDraft({ ...draft, enabled: true }, llm.model) : draft.provider === "custom" && !draft.useMainLlm ? validateModelEndpoint(draft.customEndpoint) : null
    if (error) { setAction({ error: true, text: error }); return }
    if (kind === "test" && !(await confirmModelAction("将向当前重排模型发送测试请求，可能消耗 token 和费用；不会保存配置。是否继续？"))) return
    const id = ++request.current, generation = revision.current, config = { ...draft, enabled: true }
    const current = () => alive.current && request.current === id && revision.current === generation
    setAction({ running: true, text: kind === "fetch" ? "正在拉取模型…" : "正在测试重排模型…" })
    try {
      if (kind === "fetch") { const result = await fetchRerankModelList(llm, config); if (current()) { setOptions(result.models); setAction({ text: `已拉取 ${result.models.length} 个模型。` }) } }
      else { const result = await testSettingsRerankModel(llm, config); if (current()) setAction({ text: `重排测试通过：${result.model}。${dirty ? "当前配置尚未保存。" : "测试没有更改配置。"}` }) }
    } catch (error) { if (current()) setAction({ error: true, text: safeModelError(error, [config.apiKey, llm.apiKey]) }) }
  }
  const showKey = !["ollama", "claude-code", "codex-cli"].includes(draft.provider)
  const showEndpoint = ["custom", "ollama", "cursor-cli", "azure"].includes(draft.provider)
  const candidatesField = <label className="model-field"><span>候选 TOPN</span><input type="number" aria-label="候选 TOPN" min={3} max={30} step={1} value={draft.maxCandidates} onChange={event => change({ maxCandidates: Number(event.target.value) })} /></label>
  return <section className="model-retrieval" aria-label="重排模型配置">
    <header>
      <div><h2>启用检索重排</h2><p className="model-note">{project ? `当前小说：${project.name}，同时更新全局默认配置。` : "全局重排配置。"} 关闭后保留基础检索。</p></div>
      <button type="button" className="model-switch" role="switch" aria-label="启用检索重排" aria-checked={draft.enabled} disabled={saving} onClick={() => change({ enabled: !draft.enabled })}><span /></button>
    </header>
    <fieldset className="model-form" disabled={saving}>
      <div className="model-source-row">
        <div><h3>复用主模型</h3><p className="model-note">关闭后可单独配置重排模型，不改变聊天框的模型选择。</p></div>
        <button type="button" className="model-switch" role="switch" aria-label="复用主模型" aria-checked={draft.useMainLlm} onClick={() => change({ useMainLlm: !draft.useMainLlm })}><span /></button>
      </div>
      {draft.useMainLlm ? <><p className="model-section-note">当前主模型：{llm.model || "尚未配置"}。只用于重排，不改变聊天模型选择。</p><div className="model-fields">{candidatesField}</div></> : <>
        <div className="model-fields">
          <label className="model-field"><span>提供方</span><select aria-label="重排提供方" value={draft.provider} onChange={event => change({ provider: event.target.value as LlmConfig["provider"] })}>{!PROVIDERS.some(item => item.value === draft.provider) && <option value={draft.provider}>{draft.provider}（原配置）</option>}{PROVIDERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {draft.provider === "custom" && <ApiMode value={draft.apiMode} onChange={apiMode => change({ apiMode })} />}
          {showEndpoint && <label className="model-field"><span>接口地址</span><input aria-label="重排接口地址" value={draft.provider === "ollama" ? draft.ollamaUrl : draft.customEndpoint} onChange={event => change(draft.provider === "ollama" ? { ollamaUrl: event.target.value } : { customEndpoint: event.target.value })} placeholder="https://api.example.com/v1/rerank" /></label>}
          {showKey && <div className="model-field"><span>API 密钥</span><ModelSecretInput value={draft.apiKey} label="重排 API 密钥" onChange={apiKey => change({ apiKey })} /></div>}
          <label className="model-field"><span>模型 ID</span><ModelSelectInput value={draft.model} options={options} onChange={model => change({ model })} inputPlaceholder="输入重排模型 ID" selectPlaceholder="选择已拉取的重排模型" /></label>
          {candidatesField}
        </div>
        {["claude-code", "codex-cli", "cursor-cli"].includes(draft.provider) && <p className="model-note">本地 CLI 需先在“大语言模型”的配置示例中完成检测与登录；此处不会自动安装或登录。</p>}
      </>}
      <p className="model-section-note">TOPN 不是 TOPK：这里只控制送入重排的候选数量（3–30），不是最终返回数量。重排不可用时沿用原有检索降级。</p>
      <div className="model-actions">
        {!draft.useMainLlm && <button type="button" className="model-button" disabled={action?.running} onClick={() => void network("fetch")}><RefreshCw />拉取模型</button>}
        <button type="button" className="model-button ghost" disabled={action?.running} onClick={() => void network("test")}>测试重排模型</button>
      </div>
      {action && <p role="status" className={action.error ? "model-feedback error" : "model-feedback"}>{action.text}</p>}
    </fieldset>
    <SaveFooter dirty={dirty} saving={saving} status={status} onReset={reset} onSave={() => void save(validateRerankDraft(draft, llm.model), async snapshot => { const target = project; await persistModelChange(() => saveRerankConfig(snapshot, target?.id, target?.path), () => saveRerankConfig(saved, target?.id, target?.path)); if ((useWikiStore.getState().project?.id ?? "global") === (target?.id ?? "global")) useWikiStore.getState().setRerankConfig(snapshot) })} />
  </section>
}
