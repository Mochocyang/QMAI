type UserMemoryPrefilterReason = "explicit_preference" | "too_short" | "operation_only" | "one_off_task" | "no_stable_signal"

interface UserMemoryPrefilterResult {
  shouldAnalyze: boolean
  reason: UserMemoryPrefilterReason
}

const OPERATION_ONLY = /^(?:继续|确认|确定|可以|好的|好|是的|不是|重新生成|再来一次|就这样|开始|执行|停止|取消)[。！!，,\s]*(?:就这样|继续|开始)?[。！!\s]*$/
const ONE_OFF_TASK = /(?:第\s*[一二三四五六七八九十百千万零〇两\d、,，~～\-至到]+\s*章|当前第?[一二三四五六七八九十百千万零〇两\d]+段|生成(?:后面|接下来)?[一二三四五六七八九十百千万零〇两\d]+章)/
const EXPLICIT_PREFERENCE = /(?:以后|今后|长期|一直|始终|每次|默认|习惯|偏好|请记住|都要|务必|回答时|写作时|生成时|大纲(?:要|使用)|不要再|禁止使用|长期要求)/

export function evaluateUserMemoryCandidate(message: string): UserMemoryPrefilterResult {
  const normalized = message.replace(/\s+/g, " ").trim()
  if (normalized.length < 6) return { shouldAnalyze: false, reason: "too_short" }
  if (OPERATION_ONLY.test(normalized)) return { shouldAnalyze: false, reason: "operation_only" }
  if (EXPLICIT_PREFERENCE.test(normalized)) return { shouldAnalyze: true, reason: "explicit_preference" }
  if (ONE_OFF_TASK.test(normalized)) return { shouldAnalyze: false, reason: "one_off_task" }
  return { shouldAnalyze: false, reason: "no_stable_signal" }
}
