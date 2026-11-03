/**
 * 登录态的底层持久化：Windows 走 DPAPI（系统加密仓库），否则退回 localStorage。
 *
 * ## 为什么不再直接写 localStorage
 *
 * 会话里装着三样长命东西：
 *   · `refreshToken`（90 天，可换发 accessToken）
 *   · `netcard`（10 年，直接代表内置模型的调用额度）
 *   · `accessToken`（15 分钟）
 * 它们此前以**明文 JSON** 落在 WebView 的 Local Storage 里 ——
 * `account_credential.rs` 开头那句「拿到这台电脑的人就能读到明文」说的正是
 * 这个位置。讽刺的是：当时被 DPAPI 保护的反而是价值最低、寿命最短的登录密码。
 *
 * 现在会话本身也走同一个系统加密仓库（`secret_store.rs`，DPAPI 绑定当前
 * Windows 用户）。拷走文件到别的机器 / 别的 Windows 账户都解不开。
 *
 * ## 这条防线的边界（必须说清，否则又是过度承诺）
 *
 * DPAPI 防的是「文件被复制走」，**不防同一 Windows 用户下的恶意进程** ——
 * 那种进程可以直接调用 DPAPI 解密。所以它能挡住同步盘备份、临时目录泄漏、
 * 换机使用，挡不住"本机已被同用户恶意程序控制"。真正的纵深防御还得靠
 * 系统账户隔离与杀毒，代码层面做不到。
 *
 * ## 为什么仍然保留 localStorage 分支
 *
 * 非 Tauri 环境（浏览器预览、jsdom 测试）没有系统加密仓库可用。那里退回
 * localStorage，但**只在开发/预览下出现**：正式桌面产物恒为 Tauri。
 */

import { isTauri } from "@/lib/platform"

/** 系统加密仓库里的键名。 */
export const ACCOUNT_SESSION_SECRET_NAME = "account-session"

/** 旧位置：明文存在 localStorage（升级时需要迁移后删除）。 */
export const ACCOUNT_SESSION_STORAGE_KEY = "qmai.account.session.v1"

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import("@tauri-apps/api/core")
  return call<T>(command, args)
}

/** 读原始 JSON 字符串。Tauri 走 DPAPI，其余走 localStorage。 */
export async function readStoredSessionRaw(): Promise<string | null> {
  if (isTauri()) {
    try {
      const value = await invoke<string | null>("secret_get", { name: ACCOUNT_SESSION_SECRET_NAME })
      return value && value.length > 0 ? value : null
    } catch {
      return null
    }
  }
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

/** 写原始 JSON 字符串。 */
export async function writeStoredSessionRaw(raw: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("secret_set", { name: ACCOUNT_SESSION_SECRET_NAME, value: raw })
    } catch {
      // 写不进去：本次会话仍在内存里可用，只是重启后要重新登录。
    }
    return
  }
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, raw)
  } catch {
    // 同上。
  }
}

/**
 * 删除持久化会话。
 *
 * 两个位置都清：迁移完成后 localStorage 里本不该再有明文，但升级前的
 * 残留必须一并抹掉，否则「换到 DPAPI」只是多了一处副本而已。
 */
export async function clearStoredSessionRaw(): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("secret_clear", { name: ACCOUNT_SESSION_SECRET_NAME })
    } catch {
      // 删不掉不阻塞：会话内存已清，下次读取会覆盖或失败。
    }
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY)
  } catch {
    // localStorage 不可访问时无需清理。
  }
}

/** 旧位置的明文会话（升级迁移用；Tauri 下读到的都应视作待迁移数据）。 */
export function readLegacyPlaintext(): string | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * 只删旧位置的明文，不动系统加密仓库里的新副本。
 *
 * 迁移时用：先把明文搬进 DPAPI，再抹掉 localStorage —— 顺序反了会在
 * 「已删明文、未写新副本」的瞬间丢登录态。
 */
export function removeLegacyPlaintext(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY)
  } catch {
    // 不可访问时无需清理。
  }
}
