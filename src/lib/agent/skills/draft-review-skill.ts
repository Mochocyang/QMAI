import {
  loadCognitionState,
  type CognitionState,
} from "@/lib/novel/character-cognition";
import {
  loadCharacterStates,
  type CharacterStateStore,
} from "@/lib/novel/character-state";
import {
  loadForeshadowingTracker,
  type ForeshadowingStore,
} from "@/lib/novel/foreshadowing-tracker";
import {
  listSnapshots,
  loadSnapshot,
  type ChapterSnapshot,
} from "@/lib/novel/chapter-ingest";
import { fileExists, readFile } from "@/commands/fs";
import { normalizePath } from "@/lib/path-utils";
import { streamChat } from "@/lib/llm-client";
import {
  resolveNovelModel,
  type NovelTaskType,
} from "@/lib/novel/model-resolver";
import { hasUsableLlm } from "@/lib/has-usable-llm";
import { useWikiStore } from "@/stores/wiki-store";
import type { LlmConfig } from "@/stores/wiki-store";

export type DeviationType =
  "cognition" | "state" | "continuity" | "foreshadowing";
export type DeviationSeverity = "high" | "mid" | "low";

export interface Deviation {
  id: string;
  type: DeviationType;
  location: string;
  originalText: string;
  expected: string;
  memoryEvidence: string;
  severity: DeviationSeverity;
  repairAction?: string;
}

interface DraftReviewInput {
  projectPath: string;
  draftChapterText: string;
  draftChapterNumber: number;
  mode: "full" | "incremental";
  previousRound?: DraftReviewResult;
}

export interface DraftReviewResult {
  deviations: Deviation[];
  revisedDraft: string;
  repairSummary: string;
  retryRound: number;
  truncated: boolean;
}

export interface ReviewEvidence {
  cognition: CognitionState | null;
  characterStates: CharacterStateStore;
  foreshadowing: ForeshadowingStore;
  previousSnapshot: ChapterSnapshot | null;
  previousChapterRawText?: string;
  /** 派生数据内部矛盾标志 */
  internalConflict: boolean;
  rawLoadError: boolean;
}

export async function loadReviewEvidence(
  projectPath: string,
): Promise<ReviewEvidence> {
  let cognition: CognitionState | null = null;
  let characterStates: CharacterStateStore = {
    characters: [],
    lastUpdated: "",
  };
  let foreshadowing: ForeshadowingStore = { items: [], lastUpdated: "" };
  let previousSnapshot: ChapterSnapshot | null = null;
  let rawLoadError = false;

  try {
    cognition = await loadCognitionState(projectPath);
  } catch {
    rawLoadError = true;
  }
  try {
    characterStates = await loadCharacterStates(projectPath);
  } catch {
    rawLoadError = true;
  }
  try {
    foreshadowing = await loadForeshadowingTracker(projectPath);
  } catch {
    rawLoadError = true;
  }
  try {
    const numbers = await listSnapshots(projectPath);
    const valid = numbers.filter((n) => n > 0);
    if (valid.length > 0)
      previousSnapshot = await loadSnapshot(projectPath, Math.max(...valid));
  } catch {
    rawLoadError = true;
  }

  // I3：检测派生数据内部矛盾
  let internalConflict = false;
  let previousChapterRawText: string | undefined;

  if (cognition && previousSnapshot) {
    for (const charState of characterStates.characters) {
      const cognitionChar = cognition.characters.find(
        (c) => c.character === charState.characterName,
      );
      if (!cognitionChar) continue;
      // 角色状态描述里出现"不知X"，但 cognition 里该角色却 knows X → 矛盾
      const unknownMatches = /不知(.+)/.exec(charState.status);
      if (unknownMatches) {
        const unknownInfo = unknownMatches[1].trim();
        if (
          cognitionChar.knows.some(
            (k) => k.includes(unknownInfo) || unknownInfo.includes(k),
          )
        ) {
          internalConflict = true;
          break;
        }
      }
    }
    // 也可对照 previousSnapshot.characterStateChanges 与 knowledgeChanges
    const stateChangesMentionMemory =
      previousSnapshot.characterStateChanges.some(
        (c) =>
          cognitionCharNameInChanges(c) &&
          changeMentionsKnowledge(c, previousSnapshot.knowledgeChanges),
      );
    if (stateChangesMentionMemory) internalConflict = true;
  }

  if (internalConflict && previousSnapshot) {
    // 读 wiki/chapters/ 下与 chapterNumber 对应的章节
    try {
      const pp = normalizePath(projectPath);
      const chapDir = `${pp}/wiki/chapters`;
      const probePath = `${chapDir}/chapter-${previousSnapshot.chapterNumber}.md`;
      if (await fileExists(probePath)) {
        previousChapterRawText = await readFile(probePath);
      }
    } catch {
      // 仲裁失败不致命，继续返回 internalConflict=true 但无 raw text
    }
  }

  return {
    cognition,
    characterStates,
    foreshadowing,
    previousSnapshot,
    previousChapterRawText,
    internalConflict,
    rawLoadError,
  };
}

/** 状态变化字符串是否包含角色名（宽松判定） */
function cognitionCharNameInChanges(change: string): boolean {
  return /[^:]+[:：]/.test(change);
}

/**
 * 检测：状态变化里说不知 X，但 knowledgeChanges 里同角色说知道 X
 */
function changeMentionsKnowledge(
  stateChange: string,
  knowledgeChanges: string[],
): boolean {
  const m = stateChange.match(/(.+?)[:：].*?不知(.+)/);
  if (!m) return false;
  const charName = m[1];
  const unknownInfo = m[2];
  return knowledgeChanges.some(
    (k) =>
      k.startsWith(charName) &&
      (k.includes("知道") || k.includes("得知")) &&
      k.includes(unknownInfo),
  );
}

const COGNITION_LEAK_PATTERNS = [
  "知道",
  "知道了",
  "得知了",
  "察觉到",
  "意识到",
  "已经知道了",
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatchingCharacter(draft: string, character: string): boolean {
  // 用 includes 判断角色名是否出现在草稿中
  // 不做中文边界检查，因为角色名被更长的名词包含时角色本身也与此处相关
  return draft.includes(character);
}

function findLocation(draft: string, character: string): string {
  const lines = draft.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(character)) {
      return "第 " + String(i + 1) + " 行";
    }
  }
  return "第 1 行";
}

const heavyActionKeywords = [
  "冲入",
  "斩倒",
  "全力",
  "拔剑",
  "飞奔",
  "跃起",
  "搏杀",
];

const tenseWords = [
  "被困",
  "即将",
  "就在此时",
  "杀手",
  "危在旦夕",
  "杀机",
  "逼近",
];

const relaxWords = ["回家", "入睡", "安然", "平静", "久违", "休整"];

const revealPatterns = [
  (draft: string, name: string) => draft.includes(`认出${name}`),
  (draft: string, name: string) => draft.includes(`${name}正是`),
  (draft: string, name: string) => draft.includes(`${name}就是`),
];

export function identifyDeviations(
  draft: string,
  evidence: ReviewEvidence,
): Deviation[] {
  const deviations: Deviation[] = [];
  let idCounter = 0;

  // 角色认知偏差：角色说出了 doesNotKnow 里的信息
  const { cognition } = evidence;
  if (cognition) {
    for (const cc of cognition.characters) {
      const { character, doesNotKnow } = cc;
      if (!findMatchingCharacter(draft, character)) continue;

      for (const unknown of doesNotKnow) {
        const pattern = COGNITION_LEAK_PATTERNS.some((kw) => {
          const sentencePattern = new RegExp(
            escapeRegex(character) +
              "[^。！？\\n]{0,50}" +
              escapeRegex(kw) +
              "[^。！？\\n]{0,50}" +
              escapeRegex(unknown),
          );
          if (sentencePattern.test(draft)) return true;

          const reversePattern = new RegExp(
            escapeRegex(unknown) +
              "[^。！？\\n]{0,50}" +
              escapeRegex(kw) +
              "[^。！？\\n]{0,50}" +
              escapeRegex(character),
          );
          if (reversePattern.test(draft)) return true;

          return false;
        });

        if (!pattern) continue;

        deviations.push({
          id: "dev-cog-" + String(++idCounter),
          type: "cognition",
          location: findLocation(draft, character),
          originalText: character + "提及了 " + unknown,
          expected: character + "不知道" + unknown,
          memoryEvidence:
            "记忆中心记录：" + character + " 不知道\u300C" + unknown + "\u300D",
          severity: "high",
        });
      }
    }
  }

  // 角色状态偏差：草稿出现强动作关键词，但记忆库 status 含"重伤/昏迷/濒死"
  if (evidence.characterStates?.characters) {
    for (const char of evidence.characterStates.characters) {
      const charInDraft = findMatchingCharacter(draft, char.characterName);
      if (!charInDraft) continue;
      const severeStatus = /重伤|昏迷|濒死|垂危|不能动/.test(char.status);
      if (!severeStatus) continue;
      const hit = heavyActionKeywords.find((k) => draft.includes(k));
      if (hit) {
        deviations.push({
          id: "dev-state-" + String(++idCounter),
          type: "state",
          location: findLocation(draft, hit),
          originalText: hit,
          expected:
            char.characterName +
            ' 状态为"' +
            char.status +
            '"，不应出现"' +
            hit +
            '"类强动作',
          memoryEvidence:
            "角色状态（" +
            char.characterName +
            "）：" +
            char.status +
            "（更新于第 " +
            char.lastUpdatedChapter +
            " 章）",
          severity: "high",
        });
      }
    }
  }

  // 上一章承接偏差：草稿首段与上章 endingHook 场景不一致
  if (evidence.previousSnapshot?.endingHook) {
    const hook = evidence.previousSnapshot.endingHook;
    const draftHead = draft.slice(0, 80);
    const hookTense = tenseWords.some((w) => hook.includes(w));
    const headRelax = relaxWords.some((w) => draftHead.includes(w));
    if (hookTense && headRelax) {
      deviations.push({
        id: "dev-cont-" + String(++idCounter),
        type: "continuity",
        location: "本章开头",
        originalText: draftHead,
        expected: "应承接上章结尾：" + hook,
        memoryEvidence:
          "上一章（第" +
          evidence.previousSnapshot.chapterNumber +
          "章）结尾钩子",
        severity: "high",
      });
    }
  }

  // 伏笔冲突：已 planted/advanced 的伏笔被本章提前说破
  if (evidence.foreshadowing?.items) {
    for (const fs of evidence.foreshadowing.items) {
      if (fs.status === "resolved" || fs.status === "abandoned") continue;
      const hit = revealPatterns.some((p) => p(draft, fs.name));
      if (!hit) continue;

      deviations.push({
        id: "dev-fs-" + String(++idCounter),
        type: "foreshadowing",
        location: findLocation(draft, fs.name),
        originalText: fs.name,
        expected:
          '伏笔"' +
          fs.name +
          '"当前状态为 ' +
          fs.status +
          "，不应被本章提前说破",
        memoryEvidence:
          "伏笔追踪：" +
          fs.name +
          "（" +
          fs.status +
          "，第" +
          fs.plantedChapter +
          "章埋设）",
        severity: "high",
      });
    }
  }

  return deviations;
}

const MAX_RETRY_ROUNDS = 2;
const REPAIR_TIMEOUT_MS = 30_000;

function buildRepairPrompt(
  draftText: string,
  deviations: Deviation[],
  evidence: ReviewEvidence,
): string {
  const deviationLines = deviations
    .map(
      (d, i) =>
        `${i + 1}. [${d.type}] ${d.location}\n   原文：${d.originalText}\n   应当：${d.expected}\n   记忆依据：${d.memoryEvidence}\n   建议：${d.repairAction ?? "按记忆依据调整"}`,
    )
    .join("\n");

  const characterBrief = evidence.cognition
    ? evidence.cognition.characters
        .map(
          (c) =>
            `- ${c.character}：知道[${c.knows.join("、") || "无"}]；不知道[${c.doesNotKnow.join("、") || "无"}]`,
        )
        .join("\n")
    : "（无角色认知记录）";

  const stateBrief =
    evidence.characterStates.characters.length > 0
      ? evidence.characterStates.characters
          .map((c) => `- ${c.characterName}：${c.status}`)
          .join("\n")
      : "（无角色状态记录）";

  const foreshadowingBrief =
    evidence.foreshadowing.items.length > 0
      ? evidence.foreshadowing.items
          .filter((f) => f.status !== "resolved" && f.status !== "abandoned")
          .map(
            (f) =>
              `- [${f.status}] ${f.name}：${f.description}（第${f.plantedChapter}章）`,
          )
          .join("\n")
      : "（无伏笔记录）";

  const hookBrief = evidence.previousSnapshot?.endingHook
    ? `上一章结尾钩子：${evidence.previousSnapshot.endingHook}`
    : "（无上一章钩子）";

  return [
    "## 任务",
    "你是小说校对编辑。请按以下偏差清单修订下方草稿，使修订后内容与「记忆中心真源」严格一致。",
    "只输出修订后的整章正文，不要输出说明、不要输出 markdown 代码块标记。",
    "",
    "## 偏差清单",
    deviationLines || "（无偏差）",
    "",
    "## 记忆中心真源",
    "### 角色认知",
    characterBrief,
    "### 角色状态",
    stateBrief,
    "### 伏笔状态",
    foreshadowingBrief,
    "### 上一章钩子",
    hookBrief,
    "",
    "## 草稿正文",
    draftText,
  ].join("\n");
}

export async function runDraftReviewSkill(
  input: DraftReviewInput,
  options?: { llmConfig?: LlmConfig; signal?: AbortSignal },
): Promise<DraftReviewResult> {
  const evidence = await loadReviewEvidence(input.projectPath);

  // 边界：派生集合全空 → 直接返回无偏差
  const allEmpty =
    (evidence.cognition === null ||
      evidence.cognition.characters.length === 0) &&
    evidence.characterStates.characters.length === 0 &&
    evidence.foreshadowing.items.length === 0 &&
    !evidence.previousSnapshot;
  if (allEmpty) {
    return {
      deviations: [],
      revisedDraft: input.draftChapterText,
      repairSummary: "记忆中心无派生数据，本次校验无偏差。",
      retryRound: 0,
      truncated: false,
    };
  }

  let currentDraft = input.draftChapterText;
  let deviations = identifyDeviations(currentDraft, evidence);
  let retryRound = 0;
  let truncated = false;
  const repairLog: string[] = [];

  // incremental 模式：仅校验 previousRound 偏差涉及的角色相关项
  if (input.mode === "incremental" && input.previousRound) {
    const focusChars = new Set<string>();
    for (const d of input.previousRound.deviations) {
      const m = d.memoryEvidence.match(/（([^）]+)）/);
      if (m) focusChars.add(m[1]);
    }
    deviations = deviations.filter((d) => {
      const m = d.memoryEvidence.match(/（([^）]+)）/);
      return m ? focusChars.has(m[1]) : false;
    });
  }

  if (deviations.length === 0) {
    return {
      deviations: [],
      revisedDraft: currentDraft,
      repairSummary: "无偏差，校验完成。",
      retryRound: 0,
      truncated: false,
    };
  }

  // 有偏差 → 调 LLM 修复 → 增量重校
  const { providerConfigs, novelConfig } = useWikiStore.getState();
  const baseConfig = options?.llmConfig ?? ({} as LlmConfig);
  const canUseLlm = hasUsableLlm(baseConfig, providerConfigs);
  const taskType: NovelTaskType = "review";
  const resolvedConfig = resolveNovelModel(baseConfig, novelConfig, taskType);

  while (deviations.length > 0 && retryRound < MAX_RETRY_ROUNDS) {
    if (!canUseLlm) {
      repairLog.push("未配置可用模型，跳过自动修复，直接报告偏差。");
      truncated = true;
      break;
    }
    retryRound += 1;
    const timeoutSignal = AbortSignal.timeout(REPAIR_TIMEOUT_MS);
    const combinedSignal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let revised = "";
    let streamError: Error | null = null;
    try {
      await streamChat(
        resolvedConfig,
        [
          {
            role: "system",
            content: "你是小说校对编辑，只输出修订后的整章正文。",
          },
          {
            role: "user",
            content: buildRepairPrompt(currentDraft, deviations, evidence),
          },
        ],
        {
          onToken: (c: string) => {
            revised += c;
          },
          onDone: () => {},
          onError: (e: Error) => {
            streamError = e;
          },
        },
        combinedSignal,
      );
      if (streamError) throw streamError;
      if (!revised.trim()) {
        repairLog.push(`第 ${retryRound} 轮修复返回空内容，终止。`);
        truncated = true;
        break;
      }
      currentDraft = revised;
      repairLog.push(
        `第 ${retryRound} 轮修复完成，已修订 ${deviations.length} 项偏差。`,
      );
      // 增量重校
      deviations = identifyDeviations(currentDraft, evidence);
      // 若 incremental 模式继续保留焦点
      if (input.mode === "incremental" && input.previousRound) {
        const focusChars = new Set<string>();
        for (const d of input.previousRound.deviations) {
          const m = d.memoryEvidence.match(/（([^）]+)）/);
          if (m) focusChars.add(m[1]);
        }
        deviations = deviations.filter((d) => {
          const m = d.memoryEvidence.match(/（([^）]+)）/);
          return m ? focusChars.has(m[1]) : false;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      repairLog.push(`第 ${retryRound} 轮修复失败：${msg}，终止修复。`);
      truncated = true;
      break;
    }
  }

  if (deviations.length > 0 && retryRound >= MAX_RETRY_ROUNDS) {
    truncated = true;
    repairLog.push("已达最大重校轮次（2 轮），仍有偏差未消解，已截断。");
  }

  const summary =
    deviations.length === 0
      ? `校验完成，共修复 ${retryRound} 轮，无剩余偏差。${repairLog.join(" ")}`
      : truncated
        ? `校验已截断，剩余偏差 ${deviations.length} 项。${repairLog.join(" ")}`
        : `校验完成，剩余偏差 ${deviations.length} 项。${repairLog.join(" ")}`;

  return {
    deviations,
    revisedDraft: currentDraft,
    repairSummary: summary,
    retryRound,
    truncated,
  };
}
