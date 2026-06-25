/**
 * 6 维度分析深度的用户偏好持久化
 *
 * 作用：
 * - 用户每次在深度选择弹窗中选完档位并确认后，把档位记到 localStorage
 * - 下次打开弹窗时，自动勾选上一次的档位
 *
 * 设计原则：
 * - 失败静默：localStorage 不可用时（无 window/隐私模式/损坏值）一律返回 null，不抛错
 * - 强校验：写入只接受合法的 AnalysisDepth，读出后必须通过校验才返回
 * - 用户级而非项目级：偏好是用户习惯，不跟项目路径绑定
 */

import type { AnalysisDepth } from "./types"

const STORAGE_KEY = "qmai.book-analysis.depth-preference"

const VALID_DEPTHS: AnalysisDepth[] = ["fast", "standard", "deep"]

function isValidDepth(value: unknown): value is AnalysisDepth {
  return typeof value === "string" && (VALID_DEPTHS as string[]).includes(value)
}

/**
 * 安全读取 localStorage（无 window 时返回 null）
 */
function safeGet(key: string): string | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * 安全写入 localStorage（无 window 或写入失败时静默忽略）
 */
function safeSet(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return
    window.localStorage.setItem(key, value)
  } catch {
    // 静默忽略（隐私模式 / 配额耗尽 / 不可用）
  }
}

/**
 * 读取上次保存的深度档位。
 * - 无记录 / 损坏值 / localStorage 不可用 → 返回 null
 */
export function loadDepthPreference(): AnalysisDepth | null {
  const raw = safeGet(STORAGE_KEY)
  if (!raw) return null
  return isValidDepth(raw) ? raw : null
}

/**
 * 写入深度档位。
 * - 只接受合法 AnalysisDepth，非法值静默忽略
 */
export function saveDepthPreference(depth: AnalysisDepth): void {
  if (!isValidDepth(depth)) return
  safeSet(STORAGE_KEY, depth)
}
