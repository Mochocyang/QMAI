/**
 * 拆书三重验证 + 压力测试引擎（chaishugushidaotu 分支）
 *
 * 纯后台审计：读取拆书落盘产物（characters/*.json、style-profile.json、story-map.json），
 * 逐单元跑一次 LLM 三重验证（跨域佐证/预测力/独特性）+ 压力测试（apply/boundary/confusion），
 * 结果落盘 verification/<skill>-verification.json + .md。
 * best-effort：任何异常只 warn，不剔除产出、不影响拆书任务成功。
 */
import type { LlmRequestCacheTrace } from "@/lib/llm-request-trace"
import { resolveRuntimeLocalCliConfig } from "@/lib/local-cli-config"
import { createAnalysisStageCache, type AnalysisStageCache } from "./analysis-stage-cache"
import type { LlmConfig } from "@/stores/wiki-store"
import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { joinPath, normalizeComparablePath } from "@/lib/path-utils"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import type { ExtractedCharacter } from "./types"
import { isWritingDnaProfile, migrateStyleProfile } from "./style-profile-schema"
import type { BookStyleProfile } from "./types"
import type { StoryMap } from "./story-map-types"
import { STORY_BRANCH_KIND_LABELS } from "./story-map-types"
import {
  buildCharacterVerifyPrompt,
  buildStoryVerifyPrompt,
  buildStyleVerifyPrompt,
  parseVerifyResult,
  pressureKindsFor,
} from "./verification-prompts"
import type {
  PressureTestItem,
  TripleVerifyItem,
  VerificationReport,
  VerificationSkill,
  VerificationUnit,
} from "./verification-types"

/** 角色 units 数量上限（超出只取 importance 最高的前 N 个） */
export const MAX_VERIFY_UNITS = 20

export interface VerificationRunOptions {
  onRequestTrace?: (trace: LlmRequestCacheTrace) => void
  forceRefresh?: boolean
  signal?: AbortSignal
}

interface VerificationEngineDependencies {
  readFile: typeof readFile
  listDirectory: typeof listDirectory
  writeFile: typeof writeFile
  createDirectory: typeof createDirectory
  fileExists: typeof fileExists
  callModel: (messages: ChatMessage[], llmConfig: LlmConfig, signal: AbortSignal, onRequestTrace?: VerificationRunOptions["onRequestTrace"]) => Promise<string>
  stageCache: AnalysisStageCache
  now: () => number
}

async function defaultCallModel(
  messages: ChatMessage[],
  llmConfig: LlmConfig,
  signal: AbortSignal,
  onRequestTrace?: VerificationRunOptions["onRequestTrace"],
): Promise<string> {
  let output = ""
  let streamError: Error | null = null
  await streamChat(llmConfig, messages, {
    onToken: (token) => { output += token },
    onDone: () => {},
    onError: (error) => { streamError = error },
    onRequestTrace,
  }, signal, { reasoning: llmConfig.reasoning })
  if (signal.aborted) throw new Error("用户取消验证")
  if (streamError) throw streamError
  return output.trim()
}

const defaultDependencies: VerificationEngineDependencies = {
  readFile,
  listDirectory,
  writeFile,
  createDirectory,
  fileExists,
  callModel: defaultCallModel,
  stageCache: createAnalysisStageCache(),
  now: Date.now,
}

function bookIdFromPath(bookPath: string): string {
  const parts = bookPath.replace(/\\/g, "/").split("/").filter(Boolean)
  return parts[parts.length - 1] ?? bookPath
}

function characterProfileText(character: ExtractedCharacter): string {
  return [
    `姓名：${character.name}（别名：${character.aliases.join("、") || "无"}）`,
    `分类：${character.category} · 重要度：${character.importance} · 出场 ${character.appearanceCount} 次`,
    `性格：${character.personality}`,
    `动机：${character.motivation || "未提取"}`,
    `说话方式：${character.speechStyle}`,
    `行为模式：${character.behaviorPatterns || "未提取"}`,
    `目标：${character.goals?.join("；") || "未提取"}`,
    `恐惧：${character.fears?.join("；") || "未提取"}`,
    `代表台词：${(character.representativeQuotes ?? []).map((quote) => quote.text).join(" / ").slice(0, 800) || "未提取"}`,
  ].join("\n")
}

function styleProfileText(profile: BookStyleProfile): string {
  // v2 优先审计分层产物与整合文档；v1 数据（或分层缺失）才回落到 9 个维度
  if (isWritingDnaProfile(profile)) {
    const layers = profile.layers
    return [
      profile.integratedDna?.trim() ? `整合文档：\n${profile.integratedDna}` : "",
      layers?.languageDna ? `L1 语言 DNA：\n${layers.languageDna}` : "",
      layers?.structurePatterns ? `L2 章节结构：\n${layers.structurePatterns}` : "",
      layers?.cognitiveFrame ? `L3-L5 认知框架：\n${layers.cognitiveFrame}` : "",
      layers?.rhythmGuide ? `L6 排版与节奏：\n${layers.rhythmGuide}` : "",
      `风格宪法：\n${profile.constitution}`,
    ].filter(Boolean).join("\n\n")
  }
  return [
    `叙事密度：${profile.narrativeDensity}`,
    `描写比重：${profile.descriptionWeight}`,
    `情绪呈现：${profile.emotionRendering}`,
    `句式：${profile.sentenceStyle}`,
    `修辞密度：${profile.rhetoricDensity}`,
    `过渡方式：${profile.transitionStyle}`,
    `叙事视角：${profile.narrativeVoice}`,
    `对白风格：${profile.dialogueStyle}`,
    `点题习惯：${profile.thematicHabits}`,
    `幽默机制：${(profile.humorMechanisms ?? []).join("；") || "无"}`,
    `热血机制：${(profile.highEnergyMechanisms ?? []).join("；") || "无"}`,
    `词汇偏好：${(profile.vocabularyPreferences ?? []).join("；") || "无"}`,
    `禁用写法：${(profile.avoidPatterns ?? []).join("；") || "无"}`,
    `风格宪法：\n${profile.constitution}`,
  ].join("\n")
}

function storyMapDigest(map: StoryMap): string {
  const lines: string[] = [
    `主线：${map.mainLineLabel}`,
    `主线概括：${map.mainSummary}`,
  ]
  for (const chapter of map.chapters) {
    lines.push(`第 ${chapter.order} 章 ${chapter.title}：${chapter.summary}`)
    chapter.mainEvents.forEach((event, index) => {
      lines.push(`  主线${index + 1}：${event.label}（${event.beats.join("；")}）${event.spinoff ? ` → 悬念：${event.spinoff}` : ""}`)
    })
    chapter.branches.forEach((branch) => {
      lines.push(`  [${STORY_BRANCH_KIND_LABELS[branch.kind]}] ${branch.label} ← 触发于：${branch.triggeredBy || "未标注"}（${branch.events.map((event) => event.label).join("；")}）`)
    })
  }
  return lines.join("\n")
}

/** 单个单元跑一次 LLM：三重验证 + 压力测试 */
/** 容错解析补出的 fail 不是有效判定；只缓存原始输出明确给出的完整审计。 */
function isCompleteVerificationResponse(raw: string, allowedKinds: Set<string>): boolean {
  const body = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const json = body.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return false
  const hasText = (value: unknown) => typeof value === "string" && Boolean(value.trim())
  const isVerdict = (value: unknown) => value === "pass" || value === "warn" || value === "fail"
  const isRow = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed.triple) || !Array.isArray(parsed.pressure)) return false
    const triple: Record<string, unknown>[] = parsed.triple.filter(isRow)
    const pressure: Record<string, unknown>[] = parsed.pressure.filter(isRow)
    return ["crossDomain", "predictive", "unique"].every((key) => {
      const rows = triple.filter((item) => item.key === key)
      return rows.length === 1 && isVerdict(rows[0].status) && hasText(rows[0].detail)
        && typeof rows[0].evidenceCount === "number" && Number.isSafeInteger(rows[0].evidenceCount) && rows[0].evidenceCount >= 0
    }) && [...allowedKinds].every((kind) => {
      const rows = pressure.filter((item) => item.kind === kind)
      return rows.length === 1 && isVerdict(rows[0].verdict) && hasText(rows[0].prompt) && hasText(rows[0].reason)
    })
  } catch { return false }
}

async function verifyUnit(
  unitId: string,
  unitName: string,
  prompt: string,
  skill: VerificationSkill,
  llmConfig: LlmConfig,
  dependencies: VerificationEngineDependencies,
  options: VerificationRunOptions,
  bookPath: string,
  source: unknown,
): Promise<VerificationUnit> {
  const allowedKinds = new Set<string>(pressureKindsFor(skill))
  let triple: TripleVerifyItem[] = []
  let pressure: PressureTestItem[] = []
  try {
    const signal = options.signal ?? new AbortController().signal
    if (signal.aborted) throw new Error("用户取消验证")
    const cacheInput = { bookPath, llmConfig, stage: `verification-${skill}`, materials: {
      prompt, source: JSON.parse(JSON.stringify(source, (key, value) =>
        ["createdAt", "updatedAt", "generatedAt", "taskId", "evidenceIds"].includes(key) ? undefined : value)),
    } }
    const key = await dependencies.stageCache.createKey(cacheInput)
    const complete = (value: string) => isCompleteVerificationResponse(value, allowedKinds)
    let raw = key && !options.forceRefresh ? await dependencies.stageCache.read<string>(cacheInput, key) : null
    if (typeof raw !== "string" || !complete(raw)) raw = null
    if (signal.aborted) throw new Error("用户取消验证")
    const reused = raw !== null
    if (raw === null) raw = await dependencies.callModel(
      [
        { role: "system", content: [{ type: "text", text: "你是严格的拆书质量审计员，只输出要求的 JSON。", cacheControl: true }] },
        { role: "user", content: [{ type: "text", text: prompt, cacheControl: true }] },
      ],
      llmConfig, signal, options.onRequestTrace,
    )
    if (signal.aborted) throw new Error("用户取消验证")
    const parsed = parseVerifyResult(raw)
    if (!reused && key && complete(raw) && await dependencies.stageCache.createKey(cacheInput) === key) {
      await dependencies.stageCache.write(cacheInput, key, raw, signal)
    }
    triple = parsed.triple
    pressure = parsed.pressure
      .filter((item) => allowedKinds.has(item.kind))
      .slice(0, allowedKinds.size)
      .map((item, index) => ({
        id: `${unitId}-p${index}`,
        kind: item.kind as PressureTestItem["kind"],
        prompt: item.prompt,
        verdict: item.verdict as PressureTestItem["verdict"],
        reason: item.reason,
      }))
  } catch (error) {
    console.warn(`[verify] 单元校验调用失败（${unitName}）：`, error)
  }

  // LLM 未返回有效判定时补齐三项 fail，保证报告结构完整
  if (triple.length < 3) {
    const returned = new Set(triple.map((item) => item.key))
    const fallback: Array<TripleVerifyItem["key"]> = ["crossDomain", "predictive", "unique"]
    for (const key of fallback) {
      if (returned.has(key)) continue
      triple.push({
        key,
        label: { crossDomain: "跨域佐证", predictive: "预测力", unique: "独特性" }[key],
        status: "fail",
        detail: "AI 未返回有效判定",
        evidenceCount: 0,
      })
    }
  }

  return {
    id: unitId,
    name: unitName,
    triple,
    passed: !triple.some((item) => item.status === "fail"),
    pressureTests: pressure,
  }
}

function buildReport(
  skill: VerificationSkill,
  bookPath: string,
  units: VerificationUnit[],
  skippedUnitCount: number,
  now: number,
): VerificationReport {
  const passed = units.filter((unit) => unit.passed && !unit.triple.some((item) => item.status === "warn")).length
  const warn = units.filter((unit) => unit.passed && unit.triple.some((item) => item.status === "warn")).length
  const fail = units.filter((unit) => !unit.passed).length
  return {
    schemaVersion: 1,
    skill,
    bookId: bookIdFromPath(bookPath),
    bookPath,
    verifiedAt: now,
    costBounded: skippedUnitCount > 0,
    skippedUnitCount,
    units,
    summary: { total: units.length, passed, warn, fail },
  }
}

/** 数据源缺失（style-profile.json / story-map.json 不存在）时返回空报告，避免抛错。 */
function reportForMissingSource(
  skill: VerificationSkill,
  bookPath: string,
  now: number,
): VerificationReport {
  return {
    schemaVersion: 1,
    skill,
    bookId: bookIdFromPath(bookPath),
    bookPath,
    verifiedAt: now,
    costBounded: false,
    skippedUnitCount: 0,
    units: [],
    summary: { total: 0, passed: 0, warn: 0, fail: 0 },
  }
}

function reportToMarkdown(report: VerificationReport): string {
  const skillLabel: Record<VerificationSkill, string> = {
    characters: "角色提取",
    style: "文风提取",
    story: "故事导图",
  }
  const lines: string[] = [
    `# 拆书${skillLabel[report.skill]}质量审计报告`,
    "",
    `> 校验时间：${new Date(report.verifiedAt).toLocaleString("zh-CN")} · 单元 ${report.summary.total} 个（通过 ${report.summary.passed} / 降级 ${report.summary.warn} / 未通过 ${report.summary.fail}）${report.costBounded ? ` · 因数量上限跳过 ${report.skippedUnitCount} 个` : ""}`,
    "",
    "> 本报告为后台审计记录：未通过的单元不会被剔除，仅提示提取质量，可据此重新提取。",
    "",
  ]
  for (const unit of report.units) {
    lines.push(`## ${unit.name}${unit.passed ? "" : "（未通过）"}`)
    lines.push("")
    lines.push("| 验证项 | 结果 | 佐证数 | 说明 |")
    lines.push("| --- | --- | --- | --- |")
    for (const item of unit.triple) {
      lines.push(`| ${item.label} | ${item.status === "pass" ? "通过" : item.status === "warn" ? "降级" : "未通过"} | ${item.evidenceCount} | ${item.detail.replace(/\|/g, "｜")} |`)
    }
    if (unit.pressureTests.length > 0) {
      lines.push("")
      lines.push("**压力测试**")
      for (const test of unit.pressureTests) {
        const verdict = test.verdict === "pass" ? "通过" : test.verdict === "warn" ? "降级" : "未通过"
        lines.push(`- [${verdict}] ${test.prompt} —— ${test.reason}`)
      }
    }
    lines.push("")
  }
  return lines.join("\n")
}

export function createVerificationEngine(
  overrides: Partial<VerificationEngineDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides }
  const reportRuns = new Map<string, symbol>()
  const reportWrites = new Map<string, Promise<void>>()

  async function loadCharacters(bookPath: string): Promise<ExtractedCharacter[]> {
    const dir = joinPath(bookPath, "characters")
    const files = await dependencies.listDirectory(dir)
    const characters: ExtractedCharacter[] = []
    for (const file of files) {
      if (file.is_dir || !file.name.endsWith(".json")) continue
      try {
        const parsed = JSON.parse(await dependencies.readFile(file.path)) as ExtractedCharacter
        if (parsed && typeof parsed.name === "string") characters.push(parsed)
      } catch {
        // 跳过无法解析的角色文件
      }
    }
    return characters.sort((left, right) => (right.importance ?? 0) - (left.importance ?? 0))
  }

  async function runVerification(
    skill: VerificationSkill,
    bookPath: string,
    llmConfig: LlmConfig,
    options: VerificationRunOptions = {},
  ): Promise<VerificationReport> {
    if (options.signal?.aborted) throw new Error("用户取消验证")
    llmConfig = await resolveRuntimeLocalCliConfig(llmConfig)
    const reportKey = `${normalizeComparablePath(bookPath)}:${skill}`
    const runToken = Symbol(reportKey)
    reportRuns.set(reportKey, runToken)
    const now = dependencies.now()
    const units: VerificationUnit[] = []
    let skippedUnitCount = 0

    if (skill === "characters") {
      const characters = await loadCharacters(bookPath)
      const selected = characters.slice(0, MAX_VERIFY_UNITS)
      skippedUnitCount = characters.length - selected.length
      for (const character of selected) {
        units.push(await verifyUnit(
          character.id,
          character.name,
          buildCharacterVerifyPrompt({
            characterName: character.name,
            profileText: characterProfileText(character),
            corpus: character.corpus ?? "",
          }),
          skill,
          llmConfig,
          dependencies, options, bookPath, character,
        ))
      }
    } else if (skill === "style") {
      if (!await dependencies.fileExists(joinPath(bookPath, "style-profile.json"))) {
        return reportForMissingSource(skill, bookPath, now)
      }
      const profile = migrateStyleProfile(
        JSON.parse(await dependencies.readFile(joinPath(bookPath, "style-profile.json"))) as BookStyleProfile,
      )
      units.push(await verifyUnit(
        "style",
        "作品文风",
        buildStyleVerifyPrompt({
          bookTitle: bookIdFromPath(bookPath),
          profileText: styleProfileText(profile),
          samples: profile.samples ?? [],
        }),
        skill,
        llmConfig,
        dependencies, options, bookPath, profile,
      ))
    } else {
      if (!await dependencies.fileExists(joinPath(bookPath, "story-map.json"))) {
        return reportForMissingSource(skill, bookPath, now)
      }
      const map = JSON.parse(await dependencies.readFile(joinPath(bookPath, "story-map.json"))) as StoryMap
      units.push(await verifyUnit(
        "story",
        `${map.mainLineLabel || "主线"}导图`,
        buildStoryVerifyPrompt({
          bookTitle: map.bookTitle || bookIdFromPath(bookPath),
          mapDigest: storyMapDigest(map),
        }),
        skill,
        llmConfig,
        dependencies, options, bookPath, map,
      ))
    }

    const report = buildReport(skill, bookPath, units, skippedUnitCount, now)
    if (options.signal?.aborted) throw new Error("用户取消验证")
    if (reportRuns.get(reportKey) !== runToken) return report
    const verifyDir = joinPath(bookPath, "verification")
    const write = (reportWrites.get(reportKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (options.signal?.aborted) throw new Error("用户取消验证")
      if (reportRuns.get(reportKey) !== runToken) return
      await dependencies.createDirectory(verifyDir)
      if (options.signal?.aborted) throw new Error("用户取消验证")
      if (reportRuns.get(reportKey) !== runToken) return
      // 同一作品/技能的双文件写入串行化：新报告不会插在旧报告两次 await 之间。
      await dependencies.writeFile(joinPath(verifyDir, `${skill}-verification.json`), JSON.stringify(report, null, 2))
      await dependencies.writeFile(joinPath(verifyDir, `${skill}-verification.md`), reportToMarkdown(report))
    })
    reportWrites.set(reportKey, write)
    try { await write } finally {
      if (reportWrites.get(reportKey) === write) reportWrites.delete(reportKey)
    }
    return report
  }

  return { runVerification }
}

export const verificationEngine = createVerificationEngine()

/**
 * best-effort 触发：捕获一切异常只 warn，绝不影响拆书任务。
 * 各技能 adapter 的 publish 末尾调用。
 */
export async function scheduleVerification(
  bookPath: string,
  skill: VerificationSkill,
  llmConfig: LlmConfig,
  options: VerificationRunOptions = {},
): Promise<void> {
  try {
    await verificationEngine.runVerification(skill, bookPath, llmConfig, options)
  } catch (error) {
    console.warn(`[verify] ${skill} 审计未完成（不影响拆书结果）：`, error)
  }
}
