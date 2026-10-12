/**
 * 「舞台情景」角色头像与配色
 *
 * 纯函数，无任何副作用：同一个 speakerId 在任何时候都得到同样的首字与
 * 同一个色板下标。所以同一角色在同一场、以及日后回顾历史情景时，
 * 颜色都不会变。
 *
 * ⚠️ 色板里的类名必须写成字面量。Tailwind v4 靠内容扫描收集类名，
 * 动态拼接出来的类名不会进入产物 CSS，界面上就会掉色。
 */

/** 名字首字（用于圆形头像）。 */
export function scenarioAvatarInitial(name: string): string {
  const trimmed = (name ?? "").trim()
  if (!trimmed) return "?"
  // 用码点数组而不是 charAt：代理对（如 emoji）不会被截成半个字符
  return Array.from(trimmed)[0] ?? "?"
}

/** 一个角色的配色：头像圆底色 + 发言人名字文字色。 */
export interface ScenarioSpeakerTone {
  /** 头像圆底色 */
  avatar: string
  /** 发言人名字的文字色 */
  name: string
}

/** 角色专属色板。取 8 个，减少常见名字撞色。 */
export const SCENARIO_SPEAKER_TONES: readonly ScenarioSpeakerTone[] = [
  {
    avatar: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    name: "text-rose-700 dark:text-rose-300",
  },
  {
    avatar: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    name: "text-amber-700 dark:text-amber-300",
  },
  {
    avatar: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    name: "text-emerald-700 dark:text-emerald-300",
  },
  {
    avatar: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    name: "text-sky-700 dark:text-sky-300",
  },
  {
    avatar: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    name: "text-violet-700 dark:text-violet-300",
  },
  {
    avatar: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    name: "text-teal-700 dark:text-teal-300",
  },
  {
    avatar: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
    name: "text-fuchsia-700 dark:text-fuchsia-300",
  },
  {
    avatar: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    name: "text-indigo-700 dark:text-indigo-300",
  },
]

/**
 * 主持人的固定配色。
 *
 * 刻意不参与哈希：主持人在这场里是唯一的，给它一个稳定的主色，
 * 比让它随名字换色更能让人一眼认出「这句是串场」。
 */
export const SCENARIO_MODERATOR_TONE: ScenarioSpeakerTone = {
  avatar: "bg-primary/15 text-primary",
  name: "text-primary",
}

/** 稳定哈希：同一 seed 永远落在同一个下标。 */
export function scenarioSpeakerToneIndex(seed: string): number {
  const text = seed ?? ""
  let hash = 0
  for (const ch of text) {
    // *31 + 码点：hash 始终小于 2^37，Number 精度足够，>>>0 截成 32 位无符号
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  }
  return hash % SCENARIO_SPEAKER_TONES.length
}

/** 取一个角色的配色；isModerator 为真时返回主持人固定样式。 */
export function scenarioSpeakerTone(
  seed: string,
  isModerator = false,
): ScenarioSpeakerTone {
  if (isModerator) return SCENARIO_MODERATOR_TONE
  return (
    SCENARIO_SPEAKER_TONES[scenarioSpeakerToneIndex(seed)] ??
    SCENARIO_SPEAKER_TONES[0]!
  )
}
