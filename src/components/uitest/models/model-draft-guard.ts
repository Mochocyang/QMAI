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

/**
 * 退出软件时的唯一确认框。
 * 有未保存的模型配置时把提示合并进同一句，避免退出时先后弹出两个确认框。
 */
export async function confirmAppQuit(): Promise<boolean> {
  const values = [...drafts.values()]
  if (values.some(item => item.saving)) {
    window.alert("模型配置正在保存，请稍候再退出。")
    return false
  }
  const message = values.some(item => item.dirty)
    ? "模型配置还有未保存的修改。退出会放弃这些修改，已保存的配置不受影响。\n\n确定退出？"
    : "确定要退出小说写作助手吗？"
  return confirmModelAction(message, "确认退出")
}
