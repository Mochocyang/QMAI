/**
 * 拆书三重验证 + 压力测试 - 类型定义（chaishugushidaotu 分支）
 *
 * 纯审计：结果只落盘（verification/<skill>-verification.json / .md），
 * 不剔除任何提取产出，不影响拆书任务成功。
 */

/** 参与验证的拆书技能 */
export type VerificationSkill = "characters" | "style" | "story"

/** 三重验证维度 */
export type TripleVerifyKey = "crossDomain" | "predictive" | "unique"

export const TRIPLE_VERIFY_LABELS: Record<TripleVerifyKey, string> = {
  crossDomain: "跨域佐证",
  predictive: "预测力",
  unique: "独特性",
}

export interface TripleVerifyItem {
  key: TripleVerifyKey
  label: string
  status: "pass" | "warn" | "fail"
  /** 判定说明：命中点 / 反例 / 原因 */
  detail: string
  /** 跨域佐证：命中的原文佐证条数 */
  evidenceCount: number
}

/** 压力测试类型 */
export type PressureTestKind = "apply" | "boundary" | "confusion"

export const PRESSURE_TEST_KIND_LABELS: Record<PressureTestKind, string> = {
  apply: "换场景运用",
  boundary: "边界反例",
  confusion: "混淆取舍",
}

export interface PressureTestItem {
  id: string
  kind: PressureTestKind
  /** 测试场景描述 */
  prompt: string
  verdict: "pass" | "warn" | "fail"
  reason: string
}

/** 被验证的单元（角色 / 文风 / 故事导图） */
export interface VerificationUnit {
  /** 角色用 character.id；文风/故事用 "style" / "story" */
  id: string
  name: string
  triple: TripleVerifyItem[]
  /** 三重验证是否全部通过（warn 计为通过但降级，fail 不通过） */
  passed: boolean
  pressureTests: PressureTestItem[]
}

export interface VerificationReport {
  schemaVersion: 1
  skill: VerificationSkill
  bookId: string
  bookPath: string
  verifiedAt: number
  /** 是否因数量上限截断 */
  costBounded: boolean
  /** 被截断未验证的单元数 */
  skippedUnitCount: number
  units: VerificationUnit[]
  summary: {
    total: number
    passed: number
    warn: number
    fail: number
  }
}

/** 单元状态汇总辅助：任一 fail 即 fail；否则有 warn 记 warn；否则 pass */
export function summarizeUnitStatus(items: Array<{ status: "pass" | "warn" | "fail" }>): "pass" | "warn" | "fail" {
  if (items.some((item) => item.status === "fail")) return "fail"
  if (items.some((item) => item.status === "warn")) return "warn"
  return "pass"
}
