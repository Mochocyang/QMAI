/**
 * 文风自进化的**节律**：算「今天这次打开要不要分析」。
 *
 * 零 IO、连时间都不自己取（`today` 由调用方以本地日期 `YYYY-MM-DD` 传入）。
 * 抽成纯函数是刻意的：「每天只算一次、跨天才 +1、到阈值才分析」这类规则
 * **只能靠时间流逝在真实环境里观察**，一旦和 IO 混在一起就等于不可测
 * （或者只能靠改系统时钟测）。分开之后，同一天开 6 次、连开 7 天、隔 30 天再开，
 * 全都能在一个测试里穷举。
 *
 * ── 用户原话（本模块逐条对照实现，改代码前先读这三条）────────────────────
 *   ①「每打开 3 次、4 次或 5 次时，才进行一次自动分析」
 *   ②「我们将每天的打开行为定义为 1 次……如果第二天没有打开，隔了很长时间
 *       第三天再打开，依然算作第 2 次」
 *   ③「如果用户一天内打开了 5 到 6 次，不能每天都分析」
 *
 * ── 三条容易写错、已由测试钉住的边界 ────────────────────────────────
 *   ① **归零与「成功」解耦**：`advanceOpenDay` 达到阈值时**只加计数、不归零**，
 *      归零只由 `completeRound` 做。若在达到阈值时就归零，一次**失败**的分析
 *      也会消费掉这 3~5 天 —— 用户白等 3 天却什么都没发生。
 *   ② **同一天最多尝试一次**：计数保留在阈值之上意味着 `count >= threshold`
 *      在当天恒为真，而 `hydrateDeferredProjectState` 是 `void`、无 in-flight 锁，
 *      用户切书 A→B→A 就会再进一次。靠 `lastAttemptedOn` 拦住。
 *   ③ **只比「是否同一天」，不比间隔天数**：中间空多少天都不影响计数。
 */

/** 允许的阈值区间。`nextThreshold` 只许取这三个值。 */
export const THRESHOLD_RANGE = [3, 4, 5] as const

export type StyleEvolutionThreshold = (typeof THRESHOLD_RANGE)[number]

/**
 * 节律状态（也就是 `.qmai/style-evolution.json` 里除开关与轮次历史之外的那几个字段）。
 *
 * ⚠️ 日期一律是**本地**日期 `YYYY-MM-DD`，与 `user-memory/learning-budget.ts` 的
 * `dayKey` 同口径。**不要**用 UTC —— 东八区晚上 8 点后就跨天，
 * 用户会发现「同一天开了两次却算两次」。
 */
export interface StyleEvolutionScheduleState {
  /** 最近一次「打开日」。空串表示还没有过，视为新的一天。 */
  lastOpenDate: string
  /**
   * 最近一次**尝试分析**的打开日。
   *
   * 与 `lastAnalyzedOn` 刻意分开：「已尝试」不等于「已成功」。
   * 失败后只在**下一个打开日**重试。
   */
  lastAttemptedOn: string
  /** 已累计的打开日数（不含尚未开始计数的当天）。 */
  openDayCount: number
  /** 本轮阈值，必须落在 {@link THRESHOLD_RANGE}。 */
  nextThreshold: StyleEvolutionThreshold
  /** 最近一次**成功完成**一轮分析的打开日；从未分析过为 `null`。 */
  lastAnalyzedOn: string | null
}

export interface AdvanceOpenDayResult<T extends StyleEvolutionScheduleState = StyleEvolutionScheduleState> {
  state: T
  shouldAnalyze: boolean
}

/**
 * 初始状态。
 *
 * ⚠️ `nextThreshold` 必须是 3，**不能**是 0：写成 0 时第 1 次打开就会
 * `count(1) >= 0` ⇒ 立刻分析，直接违反原话①，而且是静默发生的
 * （用户第一次开软件就花掉一次模型调用）。
 */
export function emptyScheduleState(): StyleEvolutionScheduleState {
  return {
    lastOpenDate: "",
    lastAttemptedOn: "",
    openDayCount: 0,
    nextThreshold: 3,
    lastAnalyzedOn: null,
  }
}

/**
 * 从 {3,4,5} 里抽一个阈值。
 *
 * 抽的是**本轮阈值**（间隔在 3~5 之间浮动），而不是「第 3、4、5 次各分析一次」
 * —— 后者会让第 4、5 次几乎立刻重复分析，与「减少消耗」的目标相反。
 *
 * `rng` 返回越界值（例如 1.0）时夹紧到区间末端，不产生 6。
 */
export function pickThreshold(rng: () => number): StyleEvolutionThreshold {
  const ratio = rng()
  if (!Number.isFinite(ratio)) return THRESHOLD_RANGE[0]
  const raw = Math.floor(ratio * THRESHOLD_RANGE.length)
  const index = Math.min(THRESHOLD_RANGE.length - 1, Math.max(0, raw))
  return THRESHOLD_RANGE[index]
}

/**
 * 记一次「打开」。由项目打开钩子调用，每个打开日最多调用一次（重入由
 * `lastAttemptedOn` 兜住，见文件头边界②）。
 *
 * 返回的 `state` **必须写回**（先落盘再跑模型，否则重入窗口关不上）；
 * `shouldAnalyze` 为真时表示该跑一轮，但**不要**在这里归零 —— 见边界①。
 *
 * 泛型 `<T>` 是为了让调用方**保住自己那份更宽的状态类型**：
 * 上层状态是「节律字段 + 开关 + 探针 + 轮次历史」，若这里返回窄的
 * `StyleEvolutionScheduleState`，调用方一赋值就把那几个字段的类型削掉了。
 */
export function advanceOpenDay<T extends StyleEvolutionScheduleState>(
  state: T,
  today: string,
): AdvanceOpenDayResult<T> {
  // 同一天：计数完全不动（原话③）。这不是「+0.5」也不是「记一次忽略」。
  if (today === state.lastOpenDate) {
    return {
      state,
      shouldAnalyze: state.openDayCount >= state.nextThreshold && state.lastAttemptedOn !== today,
    }
  }

  const count = state.openDayCount + 1

  // 只比「是否同一天」，不比间隔天数：中间空多少天都不影响计数（原话②）。
  if (count >= state.nextThreshold) {
    return {
      state: {
        ...state,
        lastOpenDate: today,
        openDayCount: count,
        lastAttemptedOn: today,
      },
      shouldAnalyze: true,
    }
  }

  return {
    state: { ...state, lastOpenDate: today, openDayCount: count },
    shouldAnalyze: false,
  }
}

/**
 * 收一轮**完整跑完**的尾：归零、抽新阈值、记下分析日。
 *
 * ⚠️ 只有结局不是 `incomplete` 时才许调用它。任何失败（模型未配置、调用报错、
 * 超时、样本不足、候选未通过校验）都**不得**调用 —— 否则等于把用户的 3~5 天
 * 白等掉。计数留在阈值之上，下一个打开日 `advanceOpenDay` 会自动再次判真，
 * 所以重试不需要额外的「待办」字段。
 *
 * 与 `advanceOpenDay` 同理用泛型，保住调用方的完整状态类型。
 */
export function completeRound<T extends StyleEvolutionScheduleState>(
  state: T,
  today: string,
  rng: () => number,
): T {
  return {
    ...state,
    openDayCount: 0,
    nextThreshold: pickThreshold(rng),
    lastAnalyzedOn: today,
    lastAttemptedOn: today,
  }
}

/**
 * 界面上「还需 N 次打开」里的 N。
 *
 * 用「次」而不是「天」：节律计的是**打开日**，用户不打开就永远到不了阈值，
 * 说「还需 3 天」是假的。
 *
 * 已经到阈值时返回 0（不是负数）—— 失败之后计数会停在阈值之上。
 */
export function remainingOpenDays(state: StyleEvolutionScheduleState): number {
  return Math.max(0, state.nextThreshold - state.openDayCount)
}
