import { isTauri } from "@/lib/platform"

/**
 * 「记住密码」的凭据读写。
 *
 * ── 记住的是「邮箱 + 密码」，不只是密码 ──
 *
 * 只记密码的话，下次打开是「邮箱空着、密码填好」的半吊子状态，
 * 用户还是得手输邮箱，"免输登录"根本没成立（用户 2026-11-02 指出）。
 * 两者打包成**一个** JSON 交给 DPAPI 密文：
 *   · 原子性 —— 一起存、一起清、一起过期，不会出现半截凭据；
 *   · 邮箱不额外明文落一份（虽然后者不算高敏，但没必要多一处拷贝）；
 *   · Rust 端把它整体当不透明字节加密，零改动。
 *
 * ── 存在哪 ──
 *
 * 凭据不落 localStorage，也不写进应用配置——那两种本质都是「拿到电脑就能读到明文」。
 * 真正的存储在 `commands/account_credential.rs`，走 Windows DPAPI：
 * 密文绑定当前 Windows 用户账户，换用户或换机器都解不开。
 *
 * ── 有效期 ──
 *
 * 「记住密码」**不是永久**的，只在 30 天内有效，从登录成功那一刻起算，不续期。
 * 设计上是「临时免输」，不是「长期托管密码」：
 *   · 30 天内：打开软件自动填入邮箱和密码，免输；
 *   · 超过 30 天：凭据视为失效，需要重新输入。
 *
 * 为什么不做「每次自动登录都续期」：那等于只要用户经常打开软件，凭据就永不过期，
 * 「30 天」形同虚设。固定期限才能保证凭据不会无限期留在磁盘上。
 *
 * ── 退出账号不清除 ──
 *
 * 按产品约定，点「退出账号」只停登录态，不清除已记住的凭据：
 * 30 天内再次打开仍可免输。要真正删除，用户需在登录页取消勾选「记住密码」。
 */

const SAVE = "account_credential_save"
const LOAD = "account_credential_load"
const CLEAR = "account_credential_clear"

/** 记住凭据的有效期。 */
export const REMEMBERED_PASSWORD_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 一条完整的记住凭据：登录需要什么，就记什么。 */
export interface RememberedCredential {
  email: string
  password: string
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import("@tauri-apps/api/core")
  return call<T>(command, args)
}

/** 当前平台是否支持安全保存凭据。非 Tauri（浏览器预览）一律不支持。 */
export function canRememberPassword(): boolean {
  return isTauri()
}

/**
 * 解析凭据信封。
 *
 * 新格式是 JSON（{email, password}）；旧版本存的是裸密码字符串，
 * 解析失败就按旧格式处理（邮箱为空、整串当密码）——升级不能把用户
 * 已存的密码作废，让用户平白重输一次。
 * 密码恰好长得像 JSON 对象又缺 password 字段的旧凭据会被判无效，
 * 代价只是重输一次，不是安全问题；为此加启发式判断不值当。
 */
function parseEnvelope(raw: string): RememberedCredential | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as { email?: unknown; password?: unknown }
      if (typeof record.password !== "string") return null
      return { email: typeof record.email === "string" ? record.email : "", password: record.password }
    }
    // JSON 里的字符串/数字等标量：旧版裸密码本来就是任意字符串。
    return { email: "", password: raw }
  } catch {
    return { email: "", password: raw }
  }
}

/**
 * 保存凭据（邮箱 + 密码打包）到系统凭据存储。
 *
 * 返回是否真的保存成功——调用方据此决定要不要把勾选框显示为已勾上。
 * 不允许「假装保存成功」：用户以为记住了、下次却没有，比不提供这个功能更糟。
 */
export async function saveRememberedCredential(
  credential: RememberedCredential,
  now: number = Date.now(),
): Promise<boolean> {
  if (!canRememberPassword()) return false
  try {
    await invoke(SAVE, { password: JSON.stringify(credential), savedAt: Math.floor(now / 1000) })
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
 * 读取记住的凭据（邮箱 + 密码）。
 *
 * 全部条件满足才返回，否则返回 null（= 要求用户重输）：
 *   1. 平台支持；
 *   2. 能解开（换 Windows 用户或换机器会失败）；
 *   3. 距保存时刻不超过 30 天（时间被回拨也判无效）；
 *   4. 信封里确实有密码（只有邮箱不算记住）。
 *
 * 任何一种失效都会顺手删掉凭据：留着没用，还会让磁盘上多一份失效密文。
 */
export async function loadRememberedCredential(now: number = Date.now()): Promise<RememberedCredential | null> {
  if (!canRememberPassword()) return null
  try {
    const saved = await invoke<StoredCredential>(LOAD)
    if (!saved || !saved.password) return null

    // saved_at = 0 表示没有时间戳或文件损坏，按过期处理：
    // 宁可让用户重输一次，也不能让来历不明、无时间标记的凭据无限期生效。
    if (!saved.saved_at || !Number.isFinite(saved.saved_at)) {
      void clearRememberedPassword()
      return null
    }

    const age = now - saved.saved_at * 1000
    if (age < 0 || age > REMEMBERED_PASSWORD_TTL_MS) {
      void clearRememberedPassword()
      return null
    }

    const credential = parseEnvelope(saved.password)
    if (!credential || !credential.password) {
      void clearRememberedPassword()
      return null
    }
    return credential
  } catch {
    // 解不开通常意味着换了用户或换了机器：顺手清掉坏凭据，避免每次都失败一次。
    void clearRememberedPassword()
    return null
  }
}

/** 清除已保存的凭据。用户取消勾选时调用。 */
export async function clearRememberedPassword(): Promise<void> {
  if (!canRememberPassword()) return
  try {
    await invoke(CLEAR)
  } catch {
    // 删除失败不影响使用：下次读取时会因解密失败被当作未记住。
  }
}

/** 已记住的凭据还剩多少天（用于在界面上提示）。 */
export function remainingDays(savedAtMs: number, now: number = Date.now()): number {
  const left = REMEMBERED_PASSWORD_TTL_MS - (now - savedAtMs)
  return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)))
}
