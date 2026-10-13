/**
 * 「舞台情景」角色头像与配色
 *
 * 纯函数，无任何副作用：同一个 speakerId 在任何时候都得到同样的首字与
 * 同一个色板下标。所以同一角色在同一场、以及日后回顾历史情景时，
 * 颜色都不会变。
 *
 * ⚠️ 色板里的类名必须写成字面量。Tailwind v4 靠内容扫描收集类名，
 * 动态拼接出来的类名不会进入产物 CSS，界面上就会掉色。
 * 这条约束由 scenario-avatar.spec.ts 里的源码级用例守着。
 *
 * 已知取舍：8 个色槽对 10 个角色，撞色不可避免（散列本身也允许撞）。
 * 优先保证的是「同一角色跨场次不变色」，而不是「同一场里两两不同色」——
 * 头像上的首字与名字标签足以区分撞色的两个人。
 */

/** 名字首字（用于圆形头像）。 */
export function scenarioAvatarInitial(name: string): string {
  // 签名上明明是 string 还要兜：持久化的情景 JSON 只校验了 messages 是数组、
  // 不逐条校验每个字段（见 scenario-store 的 loadScenarios），所以旧数据、手工
  // 改过的文件、或将来字段改名后的存量数据里，speakerName 可能整个键都不存在。
  // 房间视图渲染每个气泡都会走到这里，直接 .trim() 就是一屏白。
  // String(name ?? "") 对合法输入逐字不变，只是把「抛错」换成「回退为问号」。
  const trimmed = String(name ?? "").trim()
  if (!trimmed) return "?"
  // 用码点数组而不是 charAt：代理对（如 emoji）不会被截成半个字符。
  // 已知局限：国旗（如 🇨🇳）与 ZWJ 家庭 emoji 按码点切会取到不完整的一个码点。
  // 角色名目前都是中文，等真出现 emoji 名字再处理（要 ES2023 的 Intl.Segmenter）。
  return Array.from(trimmed)[0]
}

/** 一个角色的配色：头像圆底色 + 发言人名字文字色。 */
export interface ScenarioSpeakerTone {
  /** 头像圆底色的类名 */
  readonly avatarClass: string
  /** 发言人名字文字色的类名 */
  readonly nameClass: string
}

/** 角色专属色板。取 8 个，减少常见名字撞色。 */
export const SCENARIO_SPEAKER_TONES: readonly ScenarioSpeakerTone[] = [
  {
    avatarClass: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    nameClass: "text-rose-700 dark:text-rose-300",
  },
  {
    avatarClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    nameClass: "text-amber-700 dark:text-amber-300",
  },
  {
    avatarClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    nameClass: "text-emerald-700 dark:text-emerald-300",
  },
  {
    avatarClass: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    nameClass: "text-sky-700 dark:text-sky-300",
  },
  {
    avatarClass: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    nameClass: "text-violet-700 dark:text-violet-300",
  },
  {
    avatarClass: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    nameClass: "text-teal-700 dark:text-teal-300",
  },
  {
    avatarClass: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
    nameClass: "text-fuchsia-700 dark:text-fuchsia-300",
  },
  {
    avatarClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    nameClass: "text-indigo-700 dark:text-indigo-300",
  },
]

/**
 * 主持人的固定配色。
 *
 * 刻意不参与哈希：主持人在这场里是唯一的，给它一个稳定的主色，
 * 比让它随名字换色更能让人一眼认出「这句是串场」。
 */
export const SCENARIO_MODERATOR_TONE: ScenarioSpeakerTone = {
  avatarClass: "bg-primary/15 text-primary",
  nameClass: "text-primary",
}

/**
 * 稳定哈希：同一 seed 永远落在同一个下标。
 *
 * seed 必须是已规范化的角色 id（`ScenarioParticipant.id` /
 * `ScenarioMessage.speakerId`），**不要传显示名** —— 引擎里两者今天同为
 * 角色名，但一旦 id 与名字分家，两处调用点传的东西不一致就会让同一角色
 * 在同一场里显示两种颜色。
 *
 * 这里与 scenarioAvatarInitial 一样先 trim：让带空白的输入得到同样的结果，
 * 避免「首字正确、颜色却取决于有没有空格」这种不一致。
 */
export function scenarioSpeakerToneIndex(seed: string): number {
  // 与 scenarioAvatarInitial 同一个原因要兜脏持久化数据：speakerId 可能整个键
  // 都不存在，而房间视图渲染每个气泡都调这里。根因在公共入口，所以修在这里 ——
  // 成员条、气泡、以及将来任何新调用方就都不必各自防一遍。
  const text = String(seed ?? "").trim()
  let hash = 0
  for (const ch of text) {
    // *31 + 码点：hash 始终小于 2^37，Number 精度足够，>>>0 截成 32 位无符号
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  }
  return hash % SCENARIO_SPEAKER_TONES.length
}

/**
 * 取一个角色的配色；isModerator 为真时返回主持人固定样式。
 *
 * seed 的取值要求见 scenarioSpeakerToneIndex。
 */
export function scenarioSpeakerTone(
  seed: string,
  isModerator = false,
): ScenarioSpeakerTone {
  if (isModerator) return SCENARIO_MODERATOR_TONE
  return SCENARIO_SPEAKER_TONES[scenarioSpeakerToneIndex(seed)]
}
