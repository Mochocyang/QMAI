import { confirmModelAction } from "./model-confirm"
import { useEffect, useRef } from "react"

interface DraftStatus { token: symbol; label: string; dirty: boolean; saving: boolean }
// 只登记状态，不放入密钥、表单内容或持久化存储。
const drafts = new Map<string, DraftStatus>()

export function useModelDraftGuard(id: string, label: string, dirty: boolean, saving = false): void {
  const token = useRef(Symbol(id))
  useEffect(() => {
    drafts.set(id, { token: token.current, label, dirty, saving })
    return () => { if (drafts.get(id)?.token === token.current) drafts.delete(id) }
  }, [id, label, dirty, saving])
}

export async function confirmModelDraftLeave(): Promise<boolean> {
  const values = [...drafts.values()]
  if (values.some(item => item.saving)) {
    window.alert("模型配置正在保存，请稍候再离开。")
    return false
  }
  const pending = values.filter(item => item.dirty)
  if (!pending.length) return true
  return confirmModelAction("模型配置还有未保存的修改。离开会放弃这些修改，已保存的配置不受影响。\n\n确定离开？")
}
