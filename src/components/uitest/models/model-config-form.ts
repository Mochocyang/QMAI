import { useEffect, useRef, useState } from "react"
import { safeModelError } from "./model-feedback"

/** 两个检索配置页共享草稿生命周期，任何时候都不把未保存字段写进运行store。 */
export function useModelConfigForm<T extends object>(_id: string, saved: T, secrets: (value: T) => string[]) {
  const [draft, setDraft] = useState(saved)
  const [baseline, setBaseline] = useState(saved)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ error?: boolean; text: string } | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const busy = useRef(false), alive = useRef(true), revision = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++ } }, [])
  useEffect(() => { if (!dirty) { setDraft(saved); setBaseline(saved) } }, [saved])
  const update = (patch: Partial<T>) => { revision.current++; setStatus(null); setDraft(previous => ({ ...previous, ...patch })) }
  const reset = () => { revision.current++; setDraft(saved); setBaseline(saved); setStatus(null) }
  const save = async (error: string | null, persist: (snapshot: T) => Promise<void>, patch?: Partial<T>) => {
    if (busy.current) return false
    if (error) { setStatus({ error: true, text: error }); return false }
    if (JSON.stringify(saved) !== JSON.stringify(baseline)) { setStatus({ error: true, text: "此配置已在其他位置修改。请重新载入后再保存，当前输入仍保留。" }); return false }
    const snapshot = patch ? { ...saved, ...patch } : { ...draft }
    const version = revision.current
    busy.current = true; setSaving(true); setStatus(null)
    try {
      await persist(snapshot)
      if (alive.current) {
        setBaseline(snapshot)
        if (patch) { revision.current++; setDraft(previous => ({ ...previous, ...patch })) }
        setStatus({ text: patch ? "开关已保存并生效，其他未保存输入未提交。" : "配置已保存，将用于下一次检索。" })
      }
      return alive.current && (Boolean(patch) || revision.current === version)
    }
    catch (error) { if (alive.current) setStatus({ error: true, text: `保存失败：${safeModelError(error, [...secrets(snapshot), ...secrets(draft)])}；当前输入已保留。` }); return false }
    finally { busy.current = false; if (alive.current) setSaving(false) }
  }
  return { draft, dirty, saving, status, update, reset, save, revision, alive, setStatus }
}
