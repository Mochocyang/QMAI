import { isTauri } from "@/lib/platform"

/**
 * 「记住密码」的凭据读写。
 *
 * 密码不落在 localStorage，也不写进应用配置——那两种都是「拿到电脑就能读到明文」。
 * 真正的存储在后端 `commands/account_credential.rs`，走 Windows DPAPI：
 * 密文绑定当前 Windows 用户账户，换用户或换机器都解不开。
 *
 * 这里的职责只有两件：调命令、把失败吞掉。
 * 失败必须静默：用户在没装好凭据存储的平台上（如 macOS 现阶段），
 * 不该看到一个红色报错弹窗——「没记住密码」是可用状态，不是故障。
 */

const SAVE = "account_credential_save"
const LOAD = "account_credential_load"
const CLEAR = "account_credential_clear"

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import("@tauri-apps/api/core")
  return call<T>(command, args)
}

/** 当前平台是否支持安全保存密码。非 Tauri（浏览器预览）一律不支持。 */
export function canRememberPassword(): boolean {
  return isTauri()
}

/**
 * 保存密码到系统凭据存储。
 *
 * 返回是否真的保存成功——调用方据此决定要不要把勾选框显示为已勾上。
 * 不允许「假装保存成功」：用户以为记住了、下次却没有，比不提供这个功能更糟。
 */
export async function saveRememberedPassword(password: string): Promise<boolean> {
  if (!canRememberPassword()) return false
  try {
    await invoke(SAVE, { password })
    return true
  } catch {
    return false
  }
}

/** 读取已保存的密码。读不到（没存过 / 解不开 / 平台不支持）一律返回空串。 */
export async function loadRememberedPassword(): Promise<string> {
  if (!canRememberPassword()) return ""
  try {
    return (await invoke<string>(LOAD)) ?? ""
  } catch {
    // 解不开通常意味着换了用户或换了机器：顺手清掉坏凭据，避免每次都失败一次。
    void clearRememberedPassword()
    return ""
  }
}

/** 清除已保存的密码。 */
export async function clearRememberedPassword(): Promise<void> {
  if (!canRememberPassword()) return
  try {
    await invoke(CLEAR)
  } catch {
    // 删除失败不影响使用：下次自动登录会失败，用户重输一次即可。
  }
}
