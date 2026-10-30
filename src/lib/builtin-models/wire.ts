/**
 * 把 account-store 接到内置模型的鉴权层（应用启动时调用一次）。
 *
 * 为什么需要这个：`auth-hook` 要在每次发请求时取"当前登录态里的网关卡"。
 * 它是 lib 层，不该 import store（会形成反向依赖），所以由这里注入。
 *
 * 读的是 `useAccountStore.getState()`，不用 hook —— 请求发生时不在 React 渲染上下文里。
 */

import { useAccountStore } from "@/stores/account-store"
import { setBuiltinSessionGetter } from "./auth-hook"

let wired = false

export function wireBuiltinAuth(): void {
  if (wired) return
  wired = true
  setBuiltinSessionGetter(() => useAccountStore.getState().session)
}
