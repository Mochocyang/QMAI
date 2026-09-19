import { useEffect, useRef, useState } from "react"
import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { useModelDraftGuard } from "./model-draft-guard"
import { safeModelError } from "./model-feedback"
import { saveUiTestProvider } from "./provider-save"

export function useProviderDraft(id: string, defaults: ProviderOverride, newRecord = false) {
  const saved = useWikiStore(s => s.providerConfigs[id])
  const baseline = useRef(saved)
  const [draft, setDraft] = useState<ProviderOverride>(() => ({ ...defaults, ...saved }))
  const baselineDraft = useRef(JSON.stringify({ ...defaults, ...saved }))
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null)
  const dirty = (newRecord && !saved) || JSON.stringify(draft) !== baselineDraft.current
  const latest = useRef(draft); latest.current = draft
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty
  const revision = useRef(0)
  useModelDraftGuard(`provider:${id}`, "提供方配置", dirty, saving)
  useEffect(() => {
    if (saved === baseline.current || dirtyRef.current) return
    const value = { ...defaults, ...saved }
    baseline.current = saved; baselineDraft.current = JSON.stringify(value); setDraft(value)
  }, [saved])
  const update = (patch: Partial<ProviderOverride>) => { revision.current++; setStatus(null); setDraft(previous => ({ ...previous, ...patch })) }
  const reset = () => {
    const value = { ...defaults, ...useWikiStore.getState().providerConfigs[id] }
    baseline.current = useWikiStore.getState().providerConfigs[id]
    baselineDraft.current = JSON.stringify(value)
    revision.current++; setDraft(value); setStatus(null)
  }
  const save = async (error: string | null = null) => {
    if (savingRef.current) return false
    if (error) { setStatus({ error: true, text: error }); return false }
    savingRef.current = true; setSaving(true); setStatus(null)
    const submitted = latest.current
    try {
      await saveUiTestProvider(id, submitted, baseline.current)
      baseline.current = useWikiStore.getState().providerConfigs[id]
      baselineDraft.current = JSON.stringify(submitted)
      setStatus({ error: false, text: "配置已保存，将用于下一次请求。" })
      return true
    } catch (error) { setStatus({ error: true, text: `保存失败：${safeModelError(error, [submitted.apiKey ?? ""])}；当前输入已保留，请重试。` }); return false }
    finally { savingRef.current = false; setSaving(false) }
  }
  return { draft, saved, dirty, saving, status, revision, update, reset, save, setStatus }
}
