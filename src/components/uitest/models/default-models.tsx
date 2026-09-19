import { confirmModelAction } from "./model-confirm"
import { useEffect, useMemo, useRef, useState } from "react"
import { useWikiStore, type NovelConfig } from "@/stores/wiki-store"
import { saveDefaultLlmModel, saveNovelConfig } from "@/lib/project-store"
import { persistModelChange } from "./model-persistence"
import { testLlmConnection } from "@/lib/connection-tests"
import { useModelDraftGuard } from "./model-draft-guard"
import { safeModelError } from "./model-feedback"
import { listDefaultModelOptions, resolveDraftDefaultModel } from "./default-data"
import "./model-settings.css"

const ROWS = [
  { field: "defaultLlmModel", label: "默认模型（通用）", hint: "审稿、摘要、提取、去AI味默认使用此模型；不改变正文聊天模型。" },
  { field: "reviewModel", label: "审稿模型", hint: "用于连贯性、人物与文笔审查。" },
  { field: "summaryModel", label: "摘要模型", hint: "用于章节与上下文摘要。" },
  { field: "extractModel", label: "提取模型", hint: "用于结构化记忆与初始记忆。" },
  { field: "deAiModel", label: "去AI味模型", hint: "用于文本自然化与候选生成。" },
] as const
export type DefaultModelDraft = Pick<NovelConfig, typeof ROWS[number]["field"]>
function pick(config: NovelConfig): DefaultModelDraft { return Object.fromEntries(ROWS.map(row => [row.field, config[row.field]?.trim() ?? ""])) as DefaultModelDraft }
export function UiTestDefaultModels() {
  const project = useWikiStore(s => s.project)
  const novel = useWikiStore(s => s.novelConfig)
  const providers = useWikiStore(s => s.providerConfigs)
  const llm = useWikiStore(s => s.llmConfig)
  const chat = useWikiStore(s => s.aiChatModel)
  const [draft, setDraft] = useState(() => pick(novel))
  const [baseline, setBaseline] = useState(() => pick(novel))
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [status, setStatus] = useState<{ error?: boolean; text: string } | null>(null)
  const [tests, setTests] = useState<Record<string, { running?: boolean; error?: boolean; text: string }>>({})
  const revision = useRef(0)
  const mounted = useRef(true)
  const scope = `${project?.id ?? "global"}:${project?.path ?? ""}`
  const scopeRef = useRef(scope); scopeRef.current = scope
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  useModelDraftGuard("default-models", "默认模型", dirty, saving)
  const options = useMemo(() => listDefaultModelOptions(providers), [providers])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++ } }, [])
  useEffect(() => { if (!dirty) { setDraft(pick(novel)); setBaseline(pick(novel)) } }, [novel])
  useEffect(() => { revision.current++; setTests({}) }, [providers, chat, llm])
  const change = (field: keyof DefaultModelDraft, value: string) => { revision.current++; setDraft(previous => ({ ...previous, [field]: value })); setTests({}); setStatus(null) }
  async function test(field: keyof DefaultModelDraft) {
    const common = draft.defaultLlmModel
    const actual = resolveDraftDefaultModel(field === "defaultLlmModel" ? common : draft[field], common, chat, llm, providers)
    if (!actual.config) { setTests(previous => ({ ...previous, [field]: { error: true, text: "尚无可用模型，请先添加并保存大语言模型配置。" } })); return }
    if (!(await confirmModelAction(`将使用当前草稿解析出的模型“${actual.config.model}”发送测试请求，可能消耗 token 和费用，不会保存设置。是否继续？`))) return
    const generation = revision.current, requestScope = scope
    setTests(previous => ({ ...previous, [field]: { running: true, text: "正在测试…" } }))
    try {
      const result = await testLlmConnection(actual.config)
      if (!mounted.current || revision.current !== generation || scopeRef.current !== requestScope) return
      setTests(previous => ({ ...previous, [field]: { error: !result.ok, text: result.ok ? `测试通过：${actual.config!.model}。${dirty ? "本次选择尚未保存。" : "未改变聊天模型。"}` : `测试失败：${safeModelError(result.message, [actual.config!.apiKey])}` } }))
    } catch (error) { if (mounted.current && revision.current === generation && scopeRef.current === requestScope) setTests(previous => ({ ...previous, [field]: { error: true, text: safeModelError(error, [actual.config!.apiKey]) } })) }
  }
  async function save() {
    if (savingRef.current) return
    savingRef.current = true; setSaving(true); setStatus(null)
    const current = useWikiStore.getState(), requestScope = scope
    const selected = { ...draft }, config = { ...current.novelConfig, ...selected }
    try {
      if (JSON.stringify(pick(current.novelConfig)) !== JSON.stringify(baseline)) throw new Error("模型选择已在其他位置改变，请重新载入后再保存。")
      await persistModelChange(async () => {
        await saveNovelConfig(config, project?.id, project?.path)
        await saveDefaultLlmModel(selected.defaultLlmModel)
      }, async () => {
        await saveNovelConfig(current.novelConfig, project?.id, project?.path)
        await saveDefaultLlmModel(current.defaultLlmModel)
      })
      if (mounted.current && scopeRef.current === requestScope && (useWikiStore.getState().project?.id ?? "global") === (project?.id ?? "global")) {
        useWikiStore.getState().setNovelConfig(selected)
        useWikiStore.getState().setDefaultLlmModel(selected.defaultLlmModel)
        setBaseline(selected); setStatus({ text: "模型选择已保存，将用于下一次请求。" })
      }
    } catch (error) { if (mounted.current && scopeRef.current === requestScope) setStatus({ error: true, text: `保存失败：${safeModelError(error)}；当前选择已保留。` }) }
    finally { savingRef.current = false; if (mounted.current) setSaving(false) }
  }
  return <section className="model-defaults" aria-label="默认模型设置">
    <p className="model-section-note">{project ? `作用范围：当前小说“${project.name}”，同时沿用现有全局默认规则。` : "作用范围：全局默认。打开小说后可单独指定各写作环节。"} 保存后生效。</p>
    {!options.length && <p className="model-feedback">尚无已启用模型。请先到“大语言模型”添加模型并保存配置。</p>}
    {ROWS.map((row, index) => {
      const actual = resolveDraftDefaultModel(draft[row.field], draft.defaultLlmModel, chat, llm, providers)
      const available = options.some(option => option.key === draft[row.field])
      const disabled = saving || (!project && index > 0)
      return <div key={row.field} className="model-default-row"><div><h3>{row.label}</h3><p>{row.hint}</p><p>实际使用：{actual.config ? `${options.find(option => option.key === actual.key)?.label ?? actual.config.model}` : "尚无可用模型"}</p>{actual.fallback && <p className="model-feedback error">原选择不可用，将按默认／聊天模型回退。请核对后保存。</p>}{!project && index > 0 && <p>打开小说后可配置此项。</p>}</div><div><select aria-label={row.label} value={draft[row.field]} disabled={disabled} onChange={event => change(row.field, event.target.value)}><option value="">{index === 0 ? "跟随聊天模型" : "跟随默认模型"}</option>{!!draft[row.field] && !available && <option value={draft[row.field]}>原选择（不可用）：{draft[row.field]}</option>}{options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select><button type="button" className="model-button ghost" disabled={disabled || !actual.config || tests[row.field]?.running} onClick={() => void test(row.field)}>{tests[row.field]?.running ? "正在测试…" : "测试模型"}</button>{tests[row.field] && <p className={tests[row.field].error ? "model-feedback error" : "model-feedback"} role="status">{tests[row.field].text}</p>}</div></div>
    })}
    <div className="model-save-footer"><p role="status" className={status?.error ? "model-feedback error" : "model-feedback"}>{status?.text ?? (dirty ? "有未保存的模型选择。" : "已保存的设置才会用于下一次请求。")}</p><button type="button" className="model-button primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存设置"}</button></div>
  </section>
}
