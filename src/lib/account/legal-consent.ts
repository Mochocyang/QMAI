/**
 * 「已同意服务条款与隐私政策」的本地记录。
 *
 * 为什么单独一个模块，不塞进 account-dialog：
 * 1. 同意是**合规留痕**，需要有明确、可测试的读写边界，不能散落在组件状态里；
 * 2. 条款会改版，同意必须绑定**版本号**——用户同意的是 v1.0 而不是「任何未来的条款」，
 *    改版后旧同意不能自动续期，否则等于永久授权；
 * 3. 未登录时也要能记住这次勾选（用户可能勾了但还没登录就关掉弹窗）。
 *
 * 存 localStorage 而不是账号服务端：当前没有任何用户数据出境/入库的必要，
 * 把「同意」这件事留在本机，成本最低、也最符合本地优先的产品定位。
 * 代价是换设备需重新同意——这是可接受的，且更保守。
 */

/** 与 cloudflare/legal-site 发布的条款版本保持一致；改条款必须同时改这里。 */
export const LEGAL_TERMS_VERSION = "v1.0"

const STORAGE_KEY = "qmai.legalConsent"

export interface LegalConsentRecord {
  /** 用户同意的条款版本。 */
  version: string
  /** 勾选同意的时间戳（毫秒）。 */
  acceptedAt: number
}

/** 读出当前已存的同意记录；读不到、格式坏、版本不匹配，一律视为「未同意」。 */
export function readLegalConsent(): LegalConsentRecord | null {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LegalConsentRecord>
    if (typeof parsed.version !== "string" || typeof parsed.acceptedAt !== "number") return null
    // 版本不一致 = 条款改过 = 需要重新同意。
    if (parsed.version !== LEGAL_TERMS_VERSION) return null
    return { version: parsed.version, acceptedAt: parsed.acceptedAt }
  } catch {
    return null
  }
}

/** 用户是否已经同意当前版本的条款。 */
export function hasAcceptedLegalTerms(): boolean {
  return readLegalConsent() !== null
}

/** 记录同意。写入失败（隐私模式、配额满）不抛错，调用方仍可继续登录。 */
export function recordLegalConsent(now: number = Date.now()): void {
  if (typeof localStorage === "undefined") return
  try {
    const record: LegalConsentRecord = { version: LEGAL_TERMS_VERSION, acceptedAt: now }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // 存不下也不阻断登录：本次会话内的勾选状态仍在组件里。
  }
}

/** 清除同意记录（注销账号、或用户主动撤回时用）。 */
export function clearLegalConsent(): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略。
  }
}

/** 条款与隐私政策的在线地址。 */
export const LEGAL_TERMS_URL = "https://qmai.pro/legal#terms"
export const LEGAL_PRIVACY_URL = "https://qmai.pro/legal#privacy"
