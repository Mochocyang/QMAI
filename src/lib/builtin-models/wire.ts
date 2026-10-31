/**
 * 把 account-store 接到内置模型的鉴权层，并在启动时补一次模型登记。
 *
 * 两件事：
 *   1. **注入 session getter** —— `auth-hook` 要在每次发请求时取"当前登录态里的网关卡"。
 *      它是 lib 层，不该 import store（会形成反向依赖），所以由这里注入。
 *      读的是 `useAccountStore.getState()`，不用 hook —— 请求发生时不在 React 渲染上下文里。
 *
 *   2. **启动补登记** —— 不能只依赖登录/续期那两个时机：
 *      如果用户本地会话的 accessToken 还没过期，bootstrap 不会走 refresh 分支，
 *      也就没人调用 syncBuiltinModels，导致「明明登录了却没有青幕模型」。
 *      这里在启动后无条件同步一次（有卡就拉清单，没卡就尝试补签）。
 */

import { useAccountStore } from "@/stores/account-store"
import { setBuiltinSessionGetter } from "./auth-hook"

let wired = false
let bootSynced = false

export function wireBuiltinAuth(): void {
  if (wired) return
  wired = true
  setBuiltinSessionGetter(() => useAccountStore.getState().session)

  // 启动补登记：等 store 恢复完会话再跑（bootstrap 可能要几百毫秒）。
  // 用轮询而不是订阅，因为 bootstrap 结束没有明确事件；
  // 最多等 8 秒，超时就按当前状态同步一次（宁可早一点也不要永远不跑）。
  if (bootSynced) return
  bootSynced = true

  const startedAt = Date.now()
  const attempt = (): void => {
    const state = useAccountStore.getState()
    const ready = state.bootstrapped || state.status === "authenticated" || state.status === "anonymous"
    const session = state.session

    if (session || ready || Date.now() - startedAt > 8000) {
      void import("./auto-sync")
        .then(({ syncBuiltinModels }) => syncBuiltinModels(session))
        .catch((error) => console.error("[builtin] 启动同步失败:", error))
      return
    }
    setTimeout(attempt, 400)
  }
  setTimeout(attempt, 300)
}

/** 测试用：允许重新接线。 */
export function resetBuiltinWiring(): void {
  wired = false
  bootSynced = false
}
