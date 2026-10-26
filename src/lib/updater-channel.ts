import { invoke } from "@tauri-apps/api/core"

import { isTauri } from "@/lib/platform"

export interface UpdateChannelPlanItem {
  channelId: string
  label: string
  /** `null` 表示这条通道不支持 release 资产（例如 jsDelivr）。 */
  manifestUrl: string | null
  rttMs: number | null
}

/**
 * 选出本次检查更新应该用的通道。
 *
 * 返回 `null` 表示没有任何可用通道（或根本不在 Tauri 里、命令报错）——
 * 调用方**必须**退回 `tauri.conf.json` 里的官方端点，
 * 绝不能因为探活失败就让"检查更新"彻底不可用。
 *
 * 为什么只取第一条：Rust 侧返回的顺序已经是「推荐尝试顺序」
 * （可用的按 RTT 升序、直连垫底）。下一条由 Rust 在真正下载时兜底，
 * 前端不需要自己再排一次——两处排序迟早会不一致。
 */
export async function resolveUpdateChannel(): Promise<UpdateChannelPlanItem | null> {
  if (!isTauri()) return null
  try {
    const plan = await invoke<UpdateChannelPlanItem[]>("updater_channel_plan")
    if (!Array.isArray(plan)) return null
    const usable = plan.find(
      (item) => Boolean(item) && typeof item.channelId === "string" && typeof item.manifestUrl === "string" && item.manifestUrl.length > 0,
    )
    return usable ?? null
  } catch (error) {
    console.warn("[updater] 通道探活失败，退回官方端点：", error)
    return null
  }
}
