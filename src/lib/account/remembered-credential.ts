import { isTauri } from "@/lib/platform"

/**
 * 「记住密码」的凭据读写。
 *
 * ── 存在哪 ──
 *
 * 密码不落 localStorage，也不写进应用配置——那两种本质都是「拿到电脑就能读到明文」。
 * 真正的存储在 `commands/account_credential.rs`，走 Windows DPAPI：
 * 密文绑定当前 Windows 用户账户，换用户或换机器都解不开。
 *
 * ── 有效期 ──
 *
 * 「记住密码」**不是永久**的，只在 30 天内有效，从登录成功那一刻起算，不续期。
 * 设计上是「临时免输」，不是「长期托管密码」：
 *   · 30 天内：打开软件自动填入密码，免输；
 *   · 超过 30 天：凭据视为失效，需要重新输入密码。
 *
 * 为什么不做「每次自动登录都续期」：那等于只要用户经常打开软件，密码就永不过期，
 * 「30 天」形同虚设。固定期限才能保证凭据不会无限期留在磁盘上。
 *
 * ── 退出账号不清除 ──
 *
 * 按产品约定，点「退出账号」只停登录态，不清除已记住的密码：
 * 30 天内再次打开仍可免输。要真正删除，用户需在登录页取消勾选「记住密码」。
 */

const SAVE = "account_credential_save"
const LOAD = "account_credential_load"
const CLEAR = "account_credential_clear"

/** 记住密码的有效期。 */
export const REMEMBERED_PASSWORD_TTL_MS = 30 * 24 * 60 * 60 * 1000

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
export async function saveRememberedPassword(
  password: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!canRememberPassword()) return false
  try {
    await invoke(SAVE, { password, savedAt: Math.floor(now / 1000) })
    return true
  } catch {
    return false
  }
}

interface StoredCredential {
  password: string
  saved_at: number
}

/**
 * 读取已保存的密码。
 *
 * 三个条件都满足才返回密码，否则一律返回空串（= 要求用户重输）：
 *   1. 平台支持；
 *   2. 能解开（换 Windows 用户或换机器会失败）；
 *   3. 距保存时刻不超过 30 天。
 *
 * 过期时顺手删掉凭据：留着没用，还会让磁盘上多一份已失效的密文。
 */
export async function loadRememberedPassword(now: number = Date.now()): Promise<string> {
  if (!canRememberPassword()) return ""
  try {
    const saved = await invoke<StoredCredential>(LOAD)
    if (!saved || !saved.password) return ""

    // saved_at = 0 表示旧格式（没有时间戳）或文件损坏，按过期处理：
    // 宁可让用户重输一次，也不能让来历不明、无时间标记的密码无限期生效。
    if (!saved.saved_at || !Number.isFinite(saved.saved_at)) {
      void clearRememberedPassword()
      return ""
    }

    const age = now - saved.saved_at * 1000
    if (age < 0 || age > REMEMBERED_PASSWORD_TTL_MS) {
      void clearRememberedPassword()
      return ""
    }

    return saved.password
  } catch {
    // 解不开通常意味着换了用户或换了机器：顺手清掉坏凭据，避免每次都失败一次。
    void clearRememberedPassword()
    return ""
  }
}

/** 清除已保存的密码。用户取消勾选时调用。 */
export async function clearRememberedPassword(): Promise<void> {
  if (!canRememberPassword()) return
  try {
    await invoke(CLEAR)
  } catch {
    // 删除失败不影响使用：下次读取时会因解密失败被当作未记住。
  }
}

/** 已记住的密码还剩多少天（用于在界面上提示）。 */
export function remainingDays(savedAtMs: number, now: number = Date.now()): number {
  const left = REMEMBERED_PASSWORD_TTL_MS - (now - savedAtMs)
  return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)))
}
