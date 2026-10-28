/**
 * 模型配置云同步的自动接线。
 *
 * 只在主窗口挂一次（独立窗口没有模型设置入口，挂了会重复触发）。
 *
 * 触发源与节流：
 * - 启动 / 登录状态变化：跑一次（内部按「距上次拉取 5 分钟」判断要不要真的拉）；
 * - 窗口重新聚焦 / 从后台切回：跑一次——用户在另一台设备改过配置时，回来就能看到；
 * - 常驻心跳 60 秒：只做本地快照比较，内容没变不会联网（见 `autoSyncTick`）。
 *
 * 所有"该不该联网"的判断都在 `lib/model-sync/scheduler.ts` 与 store 里，
 * 这里只负责定时器与事件订阅、以及组件卸载时的清理。
 */

import { useEffect } from "react"

import { isTauri } from "@/lib/platform"
import { useAccountStore } from "@/stores/account-store"
import { useModelSyncStore } from "@/stores/model-sync-store"

export const MODEL_SYNC_HEARTBEAT_MS = 60_000

export function useModelSyncAutoSync(): void {
  useEffect(() => {
    if (!isTauri()) return

    // 先把本地状态读出来（是否开启、上次同步时间）。
    void useModelSyncStore.getState().init()

    let timer: ReturnType<typeof setInterval> | null = null

    const tick = () => {
      const store = useModelSyncStore.getState()
      if (!store.enabled) return
      if (!useAccountStore.getState().session) return
      void store.autoSyncTick()
    }

    const start = () => {
      if (timer !== null) return
      tick()
      timer = setInterval(tick, MODEL_SYNC_HEARTBEAT_MS)
    }

    const stop = () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }

    // 开启同步或登录状态变化时重新评估：关掉同步就停表，避免空转。
    const unsubscribe = useModelSyncStore.subscribe((next) => {
      if (next.enabled && useAccountStore.getState().session) start()
      else stop()
    })
    const unsubscribeAccount = useAccountStore.subscribe(() => {
      const enabled = useModelSyncStore.getState().enabled
      if (enabled && useAccountStore.getState().session) start()
      else stop()
    })

    const onFocus = () => tick()
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)

    if (useModelSyncStore.getState().enabled && useAccountStore.getState().session) start()

    return () => {
      stop()
      unsubscribe()
      unsubscribeAccount()
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [])
}
