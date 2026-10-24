/**
 * 自动同步接线：把「用户真的做了事」翻译成一次同步。
 *
 * 三个触发源：
 * - 落盘（`notifyProjectSaved`）→ 攒 8 秒再同步，避免连续打字时每几秒传一遍；
 * - 窗口重新聚焦 / 从后台切回 → 最多两分钟一次；
 * - 刚连上网盘 → 立刻跑一轮（用户正盯着「已连接」，没反应很像坏了）。
 *
 * 判定全在 `scheduler.ts` 的纯函数里，这里只负责定时器、事件订阅和清理。
 * **只在主窗口挂一次**：独立窗口没有同步入口，挂了会重复触发。
 */

import { useEffect } from "react"

import { isTauri } from "@/lib/platform"

import { SAVE_DEBOUNCE_MS, decideAutoRun, type AutoTrigger } from "@/lib/cloud-sync/scheduler"
import { subscribeProjectSaved } from "@/lib/cloud-sync/save-signal"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

export function useCloudSyncAutoSync(): void {
  useEffect(() => {
    if (!isTauri()) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let prevConnected = useCloudSyncStore.getState().config.connected

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const attempt = (trigger: AutoTrigger) => {
      const store = useCloudSyncStore.getState()
      const decision = decideAutoRun({
        enabled: store.config.enabled,
        connected: store.config.connected,
        running: store.runtime.running,
        lastAttemptAt: store.runtime.lastAttemptAt,
        consecutiveFailures: store.runtime.consecutiveFailures,
        lastErrorCode: store.runtime.lastErrorCode,
        trigger,
        now: Date.now(),
      })

      if (decision.verdict === "run") {
        void store.runNowFromRegistry(trigger)
        return
      }
      // 只对「时间没到」安排下一次：busy 由下一轮落盘/聚焦自然重试，
      // needs-user 必须等用户去设置里处理，disabled 等开关本身会触发。
      if (decision.verdict === "wait" && decision.waitMs > 0) {
        schedule(decision.waitMs, trigger)
      }
    }

    const schedule = (delayMs: number, trigger: AutoTrigger) => {
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        attempt(trigger)
      }, delayMs)
    }

    const offSaved = subscribeProjectSaved(() => {
      // 保存信号本身不判断「能不能跑」，先按去抖时间排队：
      // 这样连打十次字也只会在安静下来之后跑一轮。
      schedule(SAVE_DEBOUNCE_MS, "editor-save")
    })

    const onFocus = () => attempt("window-focus")
    const onVisibility = () => {
      if (document.visibilityState === "visible") attempt("window-focus")
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)

    // 连上网盘的那一刻跑一轮：订阅不到 store 的 selector 时只能手动比上一次的值。
    const unsubscribe = useCloudSyncStore.subscribe((next) => {
      const connected = next.config.connected
      if (!prevConnected && connected) {
        clearTimer()
        attempt("first-connect")
      }
      prevConnected = connected
    })

    return () => {
      clearTimer()
      offSaved()
      unsubscribe()
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])
}
