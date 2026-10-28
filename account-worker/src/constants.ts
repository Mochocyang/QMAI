/** 账号 Worker 共用的业务常量。 */

/** 单个验证码允许的最大错误尝试次数；达到后作废，需重新获取。 */
export const MAX_CODE_ATTEMPTS = 5

/**
 * 昵称修改冷却期：30 天。
 *
 * 用户要求「每个人每个月只能修改一次」。这里用固定 30 天而不是自然月，
 * 因为自然月在不同月份天数不同、跨月边界还会出现「同一个月能改两次」的歧义；
 * 客户端提示文案按 30 天换算成具体日期。
 */
export const NAME_CHANGE_COOLDOWN_SECONDS = 30 * 24 * 60 * 60

/** 昵称长度上限（按字符数，不按字节）。 */
export const DISPLAY_NAME_MAX_CHARS = 24
