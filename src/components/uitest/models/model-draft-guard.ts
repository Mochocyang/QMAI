import { confirmModelAction, confirmModelDraftAction } from "./model-confirm"
import { useEffect, useRef } from "react"
import { toast } from "@/lib/toast"

interface DraftStatus { label: string; dirty: boolean; saving: boolean; save?: () => Promise<boolean>; discard?: () => void }
// 状态与回调只存在内存中，不将表单内容或密钥放入全局store、事件或持久化存储。
const drafts = new Map<symbol, { current: DraftStatus }>()
let leaving = false

export function useModelDraftGuard(id: string, label: string, dirty: boolean, saving = false, save?: () => Promise<boolean>, discard?: () => void): void {
  const token = useRef(Symbol(id))
  const status = useRef<DraftStatus>({ label, dirty, saving, save, discard })
  status.current = { label, dirty, saving, save, discard }
  useEffect(() => {
    const key = token.current
    drafts.set(key, status)
    return () => { drafts.delete(key) }
  }, [id])
}

export async function confirmModelDraftLeave(): Promise<boolean> {
  if (leaving) return false
  const values = [...drafts.values()].map(item => item.current)
  if (values.some(item => item.saving)) {
    window.alert("模型配置正在保存，请稍候再离开。")
    return false
  }
  const pending = values.filter(item => item.dirty)
  if (!pending.length) return true
  leaving = true
  try {
    const choice = await confirmModelDraftAction()
    if (choice === "cancel") return false
    const current = [...drafts.values()].map(item => item.current)
    if (current.some(item => item.saving)) return false
    if (choice === "leave") { current.filter(item => item.dirty).forEach(item => item.discard?.()); return true }
    for (const item of current.filter(item => item.dirty)) {
      if (!item.save) { toast.error("此项修改尚不能保存，请检查模型配置后重试。"); return false }
      if (!(await item.save())) return false
    }
    return true
  } catch {
    toast.error("模型配置保存失败，当前输入已保留，请检查后重试。")
    return false
  } finally { leaving = false }
}

/**
 * 退出软件时的唯一确认框。
 * 有未保存的模型配置时把提示合并进同一句，避免退出时先后弹出两个确认框。
 */
export async function confirmAppQuit(): Promise<boolean> {
  if (leaving) return false
  const values = [...drafts.values()].map(item => item.current)
  if (values.some(item => item.saving)) {
    window.alert("模型配置正在保存，请稍候再退出。")
    return false
  }
  const message = values.some(item => item.dirty)
    ? "模型配置还有未保存的修改。退出会放弃这些修改，已保存的配置不受影响。\n\n确定退出？"
    : "确定要退出小说写作助手吗？"
  return confirmModelAction(message, "确认退出")
}
