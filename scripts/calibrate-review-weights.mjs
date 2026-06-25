/**
 * 审稿评分权重校准脚本
 * 
 * 通过黄金标准场景和网格搜索找到最优的维度和严重程度权重组合。
 * 用法: node scripts/calibrate-review-weights.mjs
 */

// ---- 黄金标准场景 ----
// 每个场景定义了：一组审稿问题 + 期望的总分（人工评估的"正确答案"）

const GOLD_STANDARD_SCENARIOS = [
  {
    name: "完美章节（零问题）",
    issues: [],
    expectedTotalScore: 100,
    notes: "无任何问题的章节应得满分",
  },
  {
    name: "轻微时间线错误",
    issues: [
      { severity: "error", type: "timeline", count: 1 },
    ],
    expectedTotalScore: 85,
    notes: "单个 facts 维度错误应扣减适量分数",
  },
  {
    name: "重大角色一致性问题",
    issues: [
      { severity: "error", type: "character_consistency", count: 2 },
      { severity: "warning", type: "character_consistency", count: 2 },
    ],
    expectedTotalScore: 65,
    notes: "多个角色问题应大幅拉低总分，但不至于不及格",
  },
  {
    name: "水文 + 缺钩子",
    issues: [
      { severity: "error", type: "plot", count: 1 },
      { severity: "warning", type: "plot", count: 2 },
      { severity: "error", type: "style", count: 1 },
    ],
    expectedTotalScore: 72,
    notes: "剧情推进问题 + 节奏问题共现",
  },
  {
    name: "多处事实错误 + 轻微人物问题",
    issues: [
      { severity: "error", type: "timeline", count: 2 },
      { severity: "error", type: "foreshadowing", count: 1 },
      { severity: "warning", type: "character_consistency", count: 1 },
      { severity: "info", type: "style", count: 3 },
    ],
    expectedTotalScore: 60,
    notes: "事实一致性严重受损，但不应直接归零",
  },
  {
    name: "全面崩坏（多维度严重错误）",
    issues: [
      { severity: "error", type: "character_consistency", count: 3 },
      { severity: "error", type: "timeline", count: 2 },
      { severity: "error", type: "plot", count: 2 },
      { severity: "error", type: "foreshadowing", count: 1 },
      { severity: "warning", type: "style", count: 4 },
      { severity: "info", type: "style", count: 5 },
    ],
    expectedTotalScore: 35,
    notes: "多维度严重错误，总分应在30-40之间",
  },
  {
    name: "轻微提示（仅 info 级别）",
    issues: [
      { severity: "info", type: "style", count: 3 },
      { severity: "info", type: "plot", count: 1 },
    ],
    expectedTotalScore: 88,
    notes: "仅有 info 级别建议，高分轻微下降",
  },
]

// ---- 权重搜索空间 ----
// 每个维度的权重 + 每种严重度的扣分值

const WEIGHT_RANGES = {
  plot: { min: 0.10, max: 0.25, step: 11 },      // 11 points: 0.10, 0.115, ..., 0.25
  character: { min: 0.10, max: 0.20, step: 9 },   // 9 points
  world: { min: 0.05, max: 0.15, step: 9 },
  pacing: { min: 0.10, max: 0.20, step: 9 },
  facts: { min: 0.20, max: 0.35, step: 13 },
  compliance: { min: 0.10, max: 0.20, step: 9 },
}

const DEDUCTION_RANGES = {
  error: { min: 15, max: 30, step: 16 },    // 16 points: 15, 16, ..., 30
  warning: { min: 8, max: 15, step: 8 },
  info: { min: 3, max: 8, step: 6 },
}

// ---- 默认值（当前实现）----

const DEFAULT_WEIGHTS = {
  plot: 0.20,
  character: 0.15,
  world: 0.10,
  pacing: 0.15,
  facts: 0.25,
  compliance: 0.15,
}

const DEFAULT_DEDUCTIONS = {
  error: 20,
  warning: 10,
  info: 5,
}

// ---- 辅助函数 ----

function range(min, max, steps) {
  const result = []
  const stepSize = (max - min) / (steps - 1)
  for (let i = 0; i < steps; i++) {
    result.push(Math.round((min + i * stepSize) * 1000) / 1000)
  }
  return result
}

function generateWeightCombinations(ranges) {
  const dims = Object.keys(ranges)
  const combos = []
  
  const values = {}
  for (const dim of dims) {
    values[dim] = range(ranges[dim].min, ranges[dim].max, ranges[dim].step)
  }
  
  for (const p of values.plot) {
    for (const c of values.character) {
      for (const w of values.world) {
        for (const pa of values.pacing) {
          for (const f of values.facts) {
            for (const co of values.compliance) {
              const sum = p + c + w + pa + f + co
              if (Math.abs(sum - 1.0) < 0.01) {
                combos.push({ plot: p, character: c, world: w, pacing: pa, facts: f, compliance: co })
              }
            }
          }
        }
      }
    }
  }
  return combos
}

function generateDeductionCombinations(ranges) {
  const combos = []
  const errors = range(ranges.error.min, ranges.error.max, ranges.error.step)
  const warnings = range(ranges.warning.min, ranges.warning.max, ranges.warning.step)
  const infos = range(ranges.info.min, ranges.info.max, ranges.info.step)
  
  for (const e of errors) {
    for (const w of warnings) {
      for (const i of infos) {
        // error > warning > info must hold
        if (e > w && w > i) {
          combos.push({ error: e, warning: w, info: i })
        }
      }
    }
  }
  return combos
}

const TYPE_TO_DIM_MAP = {
  "character_consistency": "character",
  "timeline": "facts",
  "foreshadowing": "facts",
  "plot": "plot",
  "style": "pacing",
  "world": "world",
  "compliance": "compliance",
}

function computeScore(issues, weights, deductions) {
  const dimIssues = {}
  for (const dim of Object.keys(weights)) {
    dimIssues[dim] = []
  }
  
  for (const issue of issues) {
    const dim = TYPE_TO_DIM_MAP[issue.type] || "facts"
    for (let j = 0; j < issue.count; j++) {
      dimIssues[dim].push(issue.severity)
    }
  }
  
  let totalScore = 0
  for (const dim of Object.keys(weights)) {
    const deduction = dimIssues[dim].reduce((sum, sev) => {
      return sum + (deductions[sev] || 5)
    }, 0)
    const dimScore = Math.max(0, 100 - deduction)
    totalScore += dimScore * weights[dim]
  }
  
  return Math.round(totalScore)
}

// ---- 主校准流程 ----

console.log("====== 审稿评分权重校准 ======\n")

console.log(`黄金标准场景数: ${GOLD_STANDARD_SCENARIOS.length}`)

// 搜索权重
console.log("\n[1/2] 搜索最优维度权重...")
const weightCombos = generateWeightCombinations(WEIGHT_RANGES)
console.log(`  候选权重组合: ${weightCombos.length}`)

let bestWeightCombo = null
let bestWeightError = Infinity

for (const combo of weightCombos) {
  let totalError = 0
  for (const scenario of GOLD_STANDARD_SCENARIOS) {
    const score = computeScore(scenario.issues, combo, DEFAULT_DEDUCTIONS)
    totalError += Math.abs(score - scenario.expectedTotalScore)
  }
  if (totalError < bestWeightError) {
    bestWeightError = totalError
    bestWeightCombo = combo
  }
}

// 搜索扣分值
console.log("\n[2/2] 搜索最优扣分值...")
const deductionCombos = generateDeductionCombinations(DEDUCTION_RANGES)
console.log(`  候选扣分量组合: ${deductionCombos.length}`)

let bestDeductionCombo = null
let bestDeductionError = Infinity

for (const combo of deductionCombos) {
  let totalError = 0
  for (const scenario of GOLD_STANDARD_SCENARIOS) {
    const score = computeScore(scenario.issues, bestWeightCombo, combo)
    totalError += Math.abs(score - scenario.expectedTotalScore)
  }
  if (totalError < bestDeductionError) {
    bestDeductionError = totalError
    bestDeductionCombo = combo
  }
}

// ---- 输出结果 ----

console.log("\n====== 校准结果 ======\n")

console.log("📊 最佳维度权重：")
for (const dim of Object.keys(DEFAULT_WEIGHTS)) {
  const defVal = DEFAULT_WEIGHTS[dim]
  const calVal = bestWeightCombo[dim]
  const diff = ((calVal - defVal) / defVal * 100).toFixed(1)
  const arrow = calVal > defVal ? "↑" : calVal < defVal ? "↓" : "→"
  console.log(`  ${dim.padEnd(12)} ${defVal.toFixed(2)} → ${calVal.toFixed(2)}  (${arrow}${Math.abs(diff)}%)`)
}

console.log("\n📊 最佳扣分值：")
for (const sev of Object.keys(DEFAULT_DEDUCTIONS)) {
  const defVal = DEFAULT_DEDUCTIONS[sev]
  const calVal = bestDeductionCombo[sev]
  const diff = ((calVal - defVal) / defVal * 100).toFixed(1)
  const arrow = calVal > defVal ? "↑" : calVal < defVal ? "↓" : "→"
  console.log(`  ${sev.padEnd(12)} ${defVal} → ${calVal}  (${arrow}${Math.abs(diff)}%)`)
}

console.log("\n📊 各场景得分对比：")
console.log("  场景".padEnd(24) + "期望".padEnd(8) + "校准前".padEnd(8) + "校准后".padEnd(8) + "改进")
console.log("  " + "-".repeat(56))

let totalBefore = 0
let totalAfter = 0
for (const scenario of GOLD_STANDARD_SCENARIOS) {
  const before = computeScore(scenario.issues, DEFAULT_WEIGHTS, DEFAULT_DEDUCTIONS)
  const after = computeScore(scenario.issues, bestWeightCombo, bestDeductionCombo)
  totalBefore += Math.abs(before - scenario.expectedTotalScore)
  totalAfter += Math.abs(after - scenario.expectedTotalScore)
  const improvement = (Math.abs(before - scenario.expectedTotalScore) - Math.abs(after - scenario.expectedTotalScore)).toFixed(1)
  const arrow = improvement > 0 ? "✅" : improvement < 0 ? "❌" : "➡️"
  console.log(`  ${scenario.name.padEnd(22)} ${String(scenario.expectedTotalScore).padEnd(8)} ${String(before).padEnd(8)} ${String(after).padEnd(8)} ${arrow} ${improvement}`)
}

console.log(`\n  总绝对误差: 校准前 ${totalBefore} → 校准后 ${totalAfter} (降低 ${(totalBefore - totalAfter).toFixed(1)})`)

// ---- 归一化权重 ----
const weightSum = Object.values(bestWeightCombo).reduce((a, b) => a + b, 0)
for (const dim of Object.keys(bestWeightCombo)) {
  bestWeightCombo[dim] = Math.round(bestWeightCombo[dim] / weightSum * 1000) / 1000
}

// ---- 输出推荐配置 ----

console.log("\n====== 推荐配置（可直接用于 ReviewScoringOptions）======")

console.log("\ndimensionWeights: {")
for (const dim of Object.keys(bestWeightCombo)) {
  console.log(`  ${dim}: ${bestWeightCombo[dim].toFixed(3)},`)
}
console.log("}")

console.log("\nseverityDeductions: {")
for (const sev of Object.keys(bestDeductionCombo)) {
  console.log(`  ${sev}: ${bestDeductionCombo[sev]},`)
}
console.log("}")

console.log("\n✅ 校准完成！")