import type { ChapterSnapshot } from "./chapter-ingest"

export interface FactCheckResult {
  severity: "blocking" | "high" | "medium" | "low"
  type: "character_jump" | "location_conflict" | "item_holder_change"
    | "org_flip" | "timeline_conflict" | "setting_conflict"
    | "relationship_reversal" | "causality_break"
  message: string
  evidenceA: string
  evidenceB: string
  chapters: [number, number]
  confidence: number
  suggestion: string
}

export interface FactCheckReport {
  results: FactCheckResult[]
  checkedChapterCount: number
  ruleEngineTime: number
  llmTime?: number
}

export interface FactCheckOptions {
  llmMode?: boolean
  projectPath?: string
}

export async function runFactCheck(
  snapshots: ChapterSnapshot[],
  _options?: FactCheckOptions,
): Promise<FactCheckReport> {
  const startTime = Date.now()

  if (snapshots.length < 2) {
    return {
      results: [],
      checkedChapterCount: snapshots.length,
      ruleEngineTime: Date.now() - startTime,
    }
  }

  const results: FactCheckResult[] = []
  const sorted = [...snapshots].sort((a, b) => a.chapterNumber - b.chapterNumber)

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    results.push(...checkCharacterJump(prev, curr))
    results.push(...checkItemHolderChange(prev, curr))
    results.push(...checkOrgFlip(prev, curr))
    results.push(...checkTimelineConflict(prev, curr))
    results.push(...checkSettingConflict(prev, curr))
    results.push(...checkRelationshipReversal(prev, curr))
    results.push(...checkCausalityBreak(prev, curr))
  }

  return {
    results,
    checkedChapterCount: sorted.length,
    ruleEngineTime: Date.now() - startTime,
  }
}

function checkCharacterJump(
  prev: ChapterSnapshot,
  curr: ChapterSnapshot,
): FactCheckResult[] {
  const results: FactCheckResult[] = []
  const prevMap = parseStateChanges(prev.characterStateChanges)
  const currMap = parseStateChanges(curr.characterStateChanges)

  const severityLevels: Record<string, number> = {
    "健康": 5,
    "轻伤": 4,
    "受伤": 3,
    "重伤": 2,
    "濒死": 1,
    "死亡": 0,
    "已死": 0,
  }

  for (const [name, currState] of currMap) {
    const prevState = prevMap.get(name)
    if (!prevState) continue

    const prevLevel = severityLevels[prevState]
    const currLevel = severityLevels[currState]
    if (prevLevel !== undefined && currLevel !== undefined) {
      const delta = prevLevel - currLevel
      if (delta >= 2) {
        results.push({
          severity: "blocking",
          type: "character_jump",
          message: `角色"${name}"状态从"${prevState}"跳变到"${currState}"，但中间缺少受伤或治疗事件`,
          evidenceA: `第${prev.chapterNumber}章：${name}=${prevState}`,
          evidenceB: `第${curr.chapterNumber}章：${name}=${currState}`,
          chapters: [prev.chapterNumber, curr.chapterNumber],
          confidence: 1,
          suggestion: `请在第${prev.chapterNumber}章到第${curr.chapterNumber}章之间补充状态变化事件，或修正角色状态。`,
        })
      }
      continue
    }

    if (prevState !== currState) {
      results.push({
        severity: "medium",
        type: "character_jump",
        message: `角色"${name}"状态从"${prevState}"变为"${currState}"，需要确认是否有对应事件支撑`,
        evidenceA: `第${prev.chapterNumber}章：${name}=${prevState}`,
        evidenceB: `第${curr.chapterNumber}章：${name}=${currState}`,
        chapters: [prev.chapterNumber, curr.chapterNumber],
        confidence: 0.7,
        suggestion: "请确认该状态变化是否合理，若合理可忽略。",
      })
    }
  }

  return results
}

function parseStateChanges(changes: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const change of changes) {
    const parts = change.split(/[:：]/)
    if (parts.length < 2) continue
    const name = parts[0].trim()
    const state = parts.slice(1).join(":").trim()
    if (name && state) {
      map.set(name, state)
    }
  }
  return map
}

function checkItemHolderChange(
  prev: ChapterSnapshot,
  curr: ChapterSnapshot,
): FactCheckResult[] {
  const results: FactCheckResult[] = []
  const prevHolders = extractItemHolders(prev)
  const currHolders = extractItemHolders(curr)

  for (const [itemName, currHolder] of currHolders) {
    const prevHolder = prevHolders.get(itemName)
    if (!prevHolder || prevHolder === currHolder) continue

    const hasTransferEvent = prev.events.some((event) =>
      event.includes(itemName) && ["给", "交给", "夺取", "失去"].some((keyword) => event.includes(keyword)),
    ) || curr.events.some((event) =>
      event.includes(itemName) && ["获得", "拿到", "拾取"].some((keyword) => event.includes(keyword)),
    )

    if (!hasTransferEvent) {
      results.push({
        severity: "medium",
        type: "item_holder_change",
        message: `物品"${itemName}"的持有者从"${prevHolder}"变为"${currHolder}"，但缺少转移事件`,
        evidenceA: `第${prev.chapterNumber}章：${itemName}由${prevHolder}持有`,
        evidenceB: `第${curr.chapterNumber}章：${itemName}由${currHolder}持有`,
        chapters: [prev.chapterNumber, curr.chapterNumber],
        confidence: 0.8,
        suggestion: `请补充"${itemName}"如何从${prevHolder}转移到${currHolder}，或修正持有者信息。`,
      })
    }
  }

  return results
}

function extractItemHolders(snapshot: ChapterSnapshot): Map<string, string> {
  const map = new Map<string, string>()
  if (!snapshot.itemDetails) return map
  for (const [name, detail] of Object.entries(snapshot.itemDetails)) {
    if (detail.holder) {
      map.set(name, detail.holder)
    }
  }
  return map
}

function checkOrgFlip(
  prev: ChapterSnapshot,
  curr: ChapterSnapshot,
): FactCheckResult[] {
  const results: FactCheckResult[] = []
  const prevOrgs = extractOrgLeaders(prev)
  const currOrgs = extractOrgLeaders(curr)

  for (const [orgName, currLeader] of currOrgs) {
    const prevLeader = prevOrgs.get(orgName)
    if (!prevLeader || prevLeader === currLeader) continue

    const hasPowerChange = prev.events.some((event) =>
      event.includes(orgName) && ["易主", "夺权", "换帅", "推翻"].some((keyword) => event.includes(keyword)),
    ) || curr.events.some((event) =>
      event.includes(orgName) && ["新主", "接任", "上位"].some((keyword) => event.includes(keyword)),
    )

    if (!hasPowerChange) {
      results.push({
        severity: "medium",
        type: "org_flip",
        message: `组织"${orgName}"的领导者从"${prevLeader}"变为"${currLeader}"，但缺少权力变更事件`,
        evidenceA: `第${prev.chapterNumber}章：${orgName}由${prevLeader}领导`,
        evidenceB: `第${curr.chapterNumber}章：${orgName}由${currLeader}领导`,
        chapters: [prev.chapterNumber, curr.chapterNumber],
        confidence: 0.8,
        suggestion: `请补充"${orgName}"权力变更的原因，或修正领导者信息。`,
      })
    }
  }

  return results
}

function extractOrgLeaders(snapshot: ChapterSnapshot): Map<string, string> {
  const map = new Map<string, string>()
  if (!snapshot.organizationDetails) return map
  for (const [name, detail] of Object.entries(snapshot.organizationDetails)) {
    if (detail.leader) {
      map.set(name, detail.leader)
    }
  }
  return map
}

function checkTimelineConflict(
  prev: ChapterSnapshot,
  curr: ChapterSnapshot,
): FactCheckResult[] {
  const results: FactCheckResult[] = []

  for (const prevEvent of prev.timelineEvents) {
    for (const currEvent of curr.timelineEvents) {
      const prevTime = extractTimeHint(prevEvent)
      const currTime = extractTimeHint(currEvent)
      if (!prevTime || !currTime || prevTime !== currTime) continue

      if (checkTimelineContradiction(prevEvent, currEvent)) {
        results.push({
          severity: "high",
          type: "timeline_conflict",
          message: `时间线冲突：同一时间点"${prevTime}"出现互相矛盾的事件`,
          evidenceA: `第${prev.chapterNumber}章：${prevEvent}`,
          evidenceB: `第${curr.chapterNumber}章：${currEvent}`,
          chapters: [prev.chapterNumber, curr.chapterNumber],
          confidence: 0.9,
          suggestion: `请统一"${prevTime}"这个时间点发生的事件。`,
        })
      }
    }
  }

  return results
}

function extractTimeHint(event: string): string | null {
  const match = event.match(/第[零一二三四五六七八九十百千万两\d]+[天日月年]/)
  return match ? match[0] : null
}

function checkTimelineContradiction(a: string, b: string): boolean {
  const exclusivePairs: Array<[string, string]> = [
    ["出发", "到达"],
    ["死亡", "出现"],
    ["开始", "结束"],
    ["闭关", "外出"],
  ]

  for (const [left, right] of exclusivePairs) {
    if ((a.includes(left) && b.includes(right)) || (a.includes(right) && b.includes(left))) {
      return true
    }
  }

  return false
}

function checkSettingConflict(
  prev: ChapterSnapshot,
  curr: ChapterSnapshot,
): FactCheckResult[] {
  const results: FactCheckResult[] = []

  for (const prevFact of prev.newCanonFacts) {
    for (const currFact of curr.newCanonFacts) {
      const prevSubject = extractFactSubject(prevFact)
      const currSubject = extractFactSubject(currFact)
      if (!prevSubject || !currSubject || prevSubject !== currSubject) continue

      if (areFactsContradictory(prevFact, currFact)) {
        results.push({
          severity: "high",
          type: "setting_conflict",
          message: `设定矛盾：关于"${prevSubject}"的描述前后不一致`,
          evidenceA: `第${prev.chapterNumber}章：${prevFact}`,
          evidenceB: `第${curr.chapterNumber}章：${currFact}`,
          chapters: [prev.chapterNumber, curr.chapterNumber],
          confidence: 0.85,
          suggestion: `请统一"${prevSubject}"的设定描述。`,
        })
      }
    }
  }

  return results
}

function extractFactSubject(fact: string): string | null {
  const match = fact.match(/^(.+?)(：|:|是|为|属于)/)
  return match ? match[1].trim() : fact.slice(0, 20).trim()
}

function areFactsContradictory(a: string, b: string): boolean {
  const negations = ["不是", "不再", "并非", "没有"]
  const affirmations = ["是", "属于", "拥有"]

  for (const negation of negations) {
    for (const affirmation of affirmations) {
      if ((a.includes(negation) && b.includes(affirmation)) || (b.includes(negation) && a.includes(affirmation))) {
        return true
      }
    }
  }

  return false
}

function checkRelationshipReversal(
  prev: ChapterSnapshot,
  curr: ChapterSnapshot,
): FactCheckResult[] {
  const results: FactCheckResult[] = []
  const prevRels = parseRelationships(prev.relationshipChanges)
  const currRels = parseRelationships(curr.relationshipChanges)
  const reversalPairs: Array<[string, string]> = [
    ["友好", "敌对"],
    ["信任", "怀疑"],
    ["爱慕", "仇恨"],
    ["同盟", "敌对"],
  ]

  for (const [pairKey, currStatus] of currRels) {
    const prevStatus = prevRels.get(pairKey)
    if (!prevStatus) continue

    for (const [positive, negative] of reversalPairs) {
      const isReversed =
        (prevStatus.includes(positive) && currStatus.includes(negative)) ||
        (prevStatus.includes(negative) && currStatus.includes(positive))
      if (!isReversed) continue

      const hasTransitionEvent = prev.events.some((event) =>
        ["关系", "背叛", "决裂", "和解"].some((keyword) => event.includes(keyword)),
      ) || curr.events.some((event) =>
        ["关系", "背叛", "决裂", "和解"].some((keyword) => event.includes(keyword)),
      )

      if (!hasTransitionEvent) {
        results.push({
          severity: "medium",
          type: "relationship_reversal",
          message: `关系反转：${pairKey.replace("->", "与")}从"${prevStatus}"变为"${currStatus}"，但缺少过渡事件`,
          evidenceA: `第${prev.chapterNumber}章：${pairKey.replace("->", "与")}关系=${prevStatus}`,
          evidenceB: `第${curr.chapterNumber}章：${pairKey.replace("->", "与")}关系=${currStatus}`,
          chapters: [prev.chapterNumber, curr.chapterNumber],
          confidence: 0.75,
          suggestion: "请补充关系变化的原因，或修正关系状态。",
        })
      }
      break
    }
  }

  return results
}

function parseRelationships(changes: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const change of changes) {
    const parts = change.split(/[:：]/)
    if (parts.length < 2) continue
    map.set(parts[0].trim(), parts.slice(1).join(":").trim())
  }
  return map
}

function checkCausalityBreak(
  _prev: ChapterSnapshot,
  curr: ChapterSnapshot,
): FactCheckResult[] {
  const results: FactCheckResult[] = []
  if (!curr.eventDetails) return results

  for (const [eventName, detail] of Object.entries(curr.eventDetails)) {
    if (!detail.cause || (!detail.cause.includes("参考") && !detail.cause.includes("见"))) {
      continue
    }

    const causeMatch = detail.cause.match(/第(\d+)章/)
    if (!causeMatch?.[1]) continue

    const causeChapter = Number.parseInt(causeMatch[1], 10)
    const knownEvents = curr.events.filter((event) => event !== eventName)
    const causePrefix = detail.cause.split(/[:：]/)[0]?.trim() ?? ""

    if (!causePrefix || knownEvents.some((event) => event.includes(causePrefix))) {
      continue
    }

    results.push({
      severity: "low",
      type: "causality_break",
      message: `事件"${eventName}"引用了可能不存在的前置事件：${detail.cause}`,
      evidenceA: `第${curr.chapterNumber}章：该事件依赖第${causeChapter}章内容`,
      evidenceB: "当前快照中未找到匹配的前置事件",
      chapters: [causeChapter, curr.chapterNumber],
      confidence: 0.5,
      suggestion: `请确认第${causeChapter}章是否存在对应前置事件。`,
    })
  }

  return results
}

export async function verifyFactCheckLlm(
  results: FactCheckResult[],
  chapterContents: Record<number, string>,
  _projectPath: string,
): Promise<FactCheckResult[]> {
  if (results.length === 0) return results

  const pendingResults = results.filter((result) => result.confidence < 1)
  if (pendingResults.length === 0) return results

  try {
    const { resolveNovelModel } = await import("./model-resolver")
    const { streamChat } = await import("@/lib/llm-client")
    const { useWikiStore } = await import("@/stores/wiki-store")
    const { hasUsableLlm } = await import("@/lib/has-usable-llm")

    const llmConfig = resolveNovelModel(
      useWikiStore.getState().llmConfig,
      useWikiStore.getState().novelConfig,
      "review",
    )
    if (!hasUsableLlm(llmConfig)) return results

    const pendingItems = pendingResults.slice(0, 5)
    const itemsText = pendingItems.map((item, index) => {
      const prevContent = chapterContents[item.chapters[0]]?.slice(0, 500) || "(无内容)"
      const currContent = chapterContents[item.chapters[1]]?.slice(0, 500) || "(无内容)"
      return `### ${index + 1}. ${item.message}
- 严重程度: ${item.severity}
- 类型: ${item.type}
- 证据A (第${item.chapters[0]}章): ${item.evidenceA}
- 证据B (第${item.chapters[1]}章): ${item.evidenceB}
- 第${item.chapters[0]}章内容片段: ${prevContent}
- 第${item.chapters[1]}章内容片段: ${currContent}`
    }).join("\n\n")

    const prompt = `请逐一审查以下规则引擎标记的可能矛盾项，判断是否确实是故事内容矛盾。

对每一项，请回复一个 JSON 数组，格式为：
[
  {"index": 1, "confirmed": true|false, "adjustedConfidence": 0.0-1.0, "note": "简要说明"}
]

注意：
- 只有在两章原文确实存在事实矛盾时才确认
- 如果只是表述差异、视角差异或信息省略，应标记为未确认
- 如果证据不足无法判断，应标记为未确认，并把置信度设为 0.3 以下

${itemsText}`

    const messages = [
      {
        role: "system" as const,
        content: "你是专业的小说事实核查员。请严格依据原文判断，不要自行补全剧情。",
      },
      { role: "user" as const, content: prompt },
    ]

    let response = ""
    await streamChat(
      llmConfig,
      messages,
      {
        onToken: (token: string) => {
          response += token
        },
        onDone: () => {},
        onError: (error: Error) => {
          console.error("[FactCheck LLM] Stream error:", error)
        },
      },
      AbortSignal.timeout(60000),
    )

    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return results

    const verdicts = JSON.parse(jsonMatch[0])
    if (!Array.isArray(verdicts)) return results

    for (const verdict of verdicts) {
      const idx = verdict.index - 1
      if (idx < 0 || idx >= pendingItems.length) continue

      const originalIndex = results.indexOf(pendingItems[idx])
      if (originalIndex < 0) continue

      results[originalIndex] = {
        ...results[originalIndex],
        confidence: typeof verdict.adjustedConfidence === "number"
          ? Math.max(0, Math.min(1, verdict.adjustedConfidence))
          : pendingItems[idx].confidence,
        suggestion: verdict.note
          ? `${pendingItems[idx].suggestion} [LLM: ${verdict.note}]`
          : pendingItems[idx].suggestion,
      }
    }

    return results
  } catch (error) {
    console.error("[FactCheck LLM] Failed:", error)
    return results
  }
}
