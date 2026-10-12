import type { StyleMetricDerived } from "./book-analysis/style-metrics"

/**
 * 文风自进化的**判据**：把两份统计数字折算成「离用户的真实写法有多远」。
 *
 * 这一层刻意不碰模型分数、只做确定性算术。原因不是「算术更准」，而是
 * 模型自评分**不可复现**：同一份画像跑两次会得到不同的分数，于是
 * 「这一轮到底有没有变好」这个决定就变成了掷骰子 —— 而它决定的是
 * 要不要把一份新画像推给用户。数字类的判据至少能被测试钉死。
 *
 * ── 必须避开的两个坑（各有一条用例守着）──────────────────────────
 *   ① **不能用目标值当分母。** 最自然的写法是 `norm = x / target`，
 *      但纯中文小说的 `latinCharRatio` 恒为 0 ⇒ `0/0 = NaN` ⇒
 *      所有比较恒为 false ⇒ 判定静默退化且不报错（表现成「功能一直没效果」）。
 *      所以这里用**固定的每项量纲** `scale`，与数据无关。
 *   ② **标点必须摊平成 8 个标量。** `punctuationPerThousand` 是个对象，
 *      对象做 `Math.abs` 得 `NaN`，同样会静默污染整条距离。
 */

/**
 * 每项的量纲（分母），写死在代码里、不随数据变。
 *
 * 取值原则：让该维度大致落在 0~1。比率类本身就是 0~1，故量纲为 1；
 * 均值与密度类按中文网文的常见值域取整。
 */
export const METRIC_SCALES = {
  shortSentenceRatio: 1,
  longSentenceRatio: 1,
  oneSentenceParagraphRatio: 1,
  longParagraphRatio: 1,
  dialogueParagraphRatio: 1,
  latinCharRatio: 1,
  avgSentenceChars: 60,
  avgParagraphChars: 300,
  avgParagraphSentences: 8,
  "punctuationPerThousand.dash": 100,
  "punctuationPerThousand.ellipsis": 100,
  "punctuationPerThousand.quote": 100,
  "punctuationPerThousand.exclamation": 100,
  "punctuationPerThousand.question": 100,
  "punctuationPerThousand.comma": 100,
  "punctuationPerThousand.semicolon": 100,
  "punctuationPerThousand.colon": 100,
} as const satisfies Record<string, number>

export type StyleMetricKey = keyof typeof METRIC_SCALES

/** 量表里的键，顺序固定（距离是各项的平均，顺序不影响结果，但固定更好断言）。 */
export const METRIC_KEYS = Object.keys(METRIC_SCALES) as StyleMetricKey[]

/** 折算后的定长向量：每个分量都是有限数。 */
export type StyleMetricVector = Record<StyleMetricKey, number>

/** 判定阈值。含义是「平均每个指标至少要改善 1%」才算改进。 */
export const EPSILON = 0.01

const PUNCTUATION_KEYS = [
  "dash",
  "ellipsis",
  "quote",
  "exclamation",
  "question",
  "comma",
  "semicolon",
  "colon",
] as const

/** 取一个有限数，否则 0 —— 缺失字段与 `NaN` 都不许传下去。 */
function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * 把派生指标拍成定长向量。
 *
 * 只取 `derived`：`counts` 是绝对计数，随文本长短变，拿它算距离会把
 * 「这段文本比较长」误判成「风格不同」。
 */
export function flattenMetrics(metrics: StyleMetricDerived): StyleMetricVector {
  const punctuation = metrics?.punctuationPerThousand
  const vector = {
    shortSentenceRatio: finite(metrics?.shortSentenceRatio),
    longSentenceRatio: finite(metrics?.longSentenceRatio),
    oneSentenceParagraphRatio: finite(metrics?.oneSentenceParagraphRatio),
    longParagraphRatio: finite(metrics?.longParagraphRatio),
    dialogueParagraphRatio: finite(metrics?.dialogueParagraphRatio),
    latinCharRatio: finite(metrics?.latinCharRatio),
    avgSentenceChars: finite(metrics?.avgSentenceChars),
    avgParagraphChars: finite(metrics?.avgParagraphChars),
    avgParagraphSentences: finite(metrics?.avgParagraphSentences),
  } as StyleMetricVector

  for (const key of PUNCTUATION_KEYS) {
    // ★ 逐个摊平，绝不把对象本身放进向量
    vector[`punctuationPerThousand.${key}`] = finite(punctuation?.[key])
  }

  return vector
}

/**
 * 两份向量之间的归一化平均绝对差。
 *
 * `mean_i |a_i - b_i| / scale_i` —— 每项先按自己的量纲折算到同一尺度，
 * 再取平均。这样「句长差 10 字」与「对白段占比差 0.1」不会因为量纲不同
 * 而互相淹没。
 */
export function distance(a: StyleMetricVector, b: StyleMetricVector): number {
  let total = 0
  for (const key of METRIC_KEYS) {
    const scale = METRIC_SCALES[key]
    if (!(scale > 0)) continue // 量纲为 0 会立刻产生 Infinity；量表已由用例守住
    total += Math.abs(finite(a?.[key]) - finite(b?.[key])) / scale
  }
  return total / METRIC_KEYS.length
}

export type StyleEvolutionVerdict = "kept" | "reverted"

export type StyleEvolutionVerdictReason = "improved" | "not-improved" | "undecidable"

export interface StyleEvolutionVerdictResult {
  verdict: StyleEvolutionVerdict
  reason: StyleEvolutionVerdictReason
  /** `distanceBase - distanceCandidate`；无法判定时为 `null`。 */
  delta: number | null
}

/**
 * 判定候选该不该保留。
 *
 * 规则：**候选的距离比基线小超过 ε** 才保留。
 *
 * 三条刻意选择的语义：
 *   · 比较用**严格大于** ε。写成 `>=` 会让「刚好卡在噪声线上」的结果算作改进。
 *   · 「没有改善」是默认结果 —— 拿不到证据就不采纳，绝不让「无证据」被当作「通过」。
 *   · 任何一路距离不是有限数时归入 `undecidable` 且**不保留**（fail-closed）。
 *     若这里 fail-open，一个 `NaN` 就能把从未验证过的画像推给用户。
 */
export function resolveVerdict(
  distanceCandidate: number,
  distanceBase: number,
  epsilon = EPSILON,
): StyleEvolutionVerdictResult {
  if (!Number.isFinite(distanceCandidate) || !Number.isFinite(distanceBase)) {
    return { verdict: "reverted", reason: "undecidable", delta: null }
  }

  const delta = distanceBase - distanceCandidate
  if (delta > epsilon) {
    return { verdict: "kept", reason: "improved", delta }
  }
  return { verdict: "reverted", reason: "not-improved", delta }
}
