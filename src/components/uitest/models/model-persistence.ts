import { flushAppState } from "@/lib/web-store"
/** 原存储会暂存set；失败后尽力恢复，避免后续防抖写入一个已报告失败的草稿。不是跨文件事务。 */
export async function persistModelChange(write: () => Promise<void>, restore: () => Promise<void>): Promise<void> {
  try { await write(); await flushAppState() }
  catch (error) {
    try { await restore(); await flushAppState() }
    catch { throw new Error("保存未完成，恢复原配置也失败。请重试保存并重新核对配置；当前输入仍保留。") }
    throw error
  }
}
