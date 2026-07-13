import {
  CHAPTER_OUTLINE_REQUIRED_SECTIONS,
  VOLUME_OUTLINE_REQUIRED_FIELDS,
} from "./outline-templates";
import {
  checkChapterPositioningDistribution,
  checkAdjacentEmotionClustering,
  parsePositionTableFromMarkdown,
} from "./chapter-positioning";
import {
  checkEnjoymentRhythm,
  checkEightNodeStructure,
  checkEmotionArc,
} from "./rhythm-checker";

export interface QualityCheckItem {
  category: string;
  status: "pass" | "warn" | "error";
  message: string;
  details?: string[];
}

export interface ChapterOutlineQualitySummary {
  valid: boolean;
  errors: string[];
  warnings: string[];
  items: QualityCheckItem[];
}

export interface OutlineGenerationQualityFeedback {
  status: "pass" | "warn" | "error";
  title: string;
  summary: string;
  issues: string[];
  repairPrompt: string;
}

/**
 * 对卷纲 Markdown 内容执行全部质量检查。
 *
 * @param content - 卷纲 Markdown 完整内容
 * @returns 质量检查结果列表
 */
export function runVolumeOutlineQualityCheck(
  content: string,
): QualityCheckItem[] {
  const results: QualityCheckItem[] = [];

  // 1. 卷纲必填项检查
  results.push(checkRequiredFields(content));

  // 2. 八节点结构检查
  results.push(checkEightNodeStructureWrapper(content));

  // 3. 情绪弧线检查
  results.push(checkEmotionArcWrapper(content));

  // 4. 章节定位分布检查
  const positions = parsePositionTableFromMarkdown(content);
  if (positions.length > 0) {
    results.push(checkPositioningDistribution(positions));
    results.push(checkEnjoymentRhythmWrapper(positions));
    results.push(checkAdjacentEmotion(positions));
  } else {
    results.push({
      category: "章节定位分布",
      status: "warn",
      message: "未解析到章节定位分布表，跳过章节级检查",
    });
  }

  // 5. 伏笔无回收计划检查
  results.push(checkForeshadowingRecovery(content));

  return results;
}

export function runChapterOutlineQualityCheck(content: string): QualityCheckItem[] {
  return [
    checkChapterRequiredSections(content),
    checkChapterTimeContinuity(content),
    checkChapterCoreEvents(content),
    checkChapterScenes(content),
    checkChapterStructureNodes(content),
    checkChapterHooksAndEnjoyment(content),
    checkChapterExecutionConstraints(content),
    checkChapterCharacterState(content),
    checkChapterForeshadowing(content),
    checkChapterWritingConstraints(content),
  ];
}

export function summarizeChapterOutlineQuality(content: string): ChapterOutlineQualitySummary {
  const items = runChapterOutlineQualityCheck(content);
  const errors = items
    .filter((item) => item.status === "error")
    .flatMap((item) => item.details?.length ? item.details : [item.message]);
  const warnings = items
    .filter((item) => item.status === "warn")
    .flatMap((item) => item.details?.length ? item.details : [item.message]);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    items,
  };
}

export function formatChapterOutlineQualityReport(
  summary: ChapterOutlineQualitySummary,
  options: { maxIssues?: number; includeWarnings?: boolean } = {},
): string {
  const maxIssues = Math.max(1, options.maxIssues ?? 5);
  const errors = Array.from(new Set(summary.errors));
  const warnings = Array.from(new Set(summary.warnings));

  if (errors.length === 0) {
    if (warnings.length === 0) return "章纲质量检查通过。";
    const warningPreview = warnings.slice(0, maxIssues).join("；");
    const remainingWarnings = warnings.length - Math.min(warnings.length, maxIssues);
    return [
      `章纲质量检查通过，但有 ${warnings.length} 项提醒。`,
      `建议完善：${warningPreview}${remainingWarnings > 0 ? `；另有 ${remainingWarnings} 项未列出` : ""}。`,
    ].join("");
  }

  const issuePreview = errors.slice(0, maxIssues).join("；");
  const remainingIssues = errors.length - Math.min(errors.length, maxIssues);
  const warningText =
    options.includeWarnings && warnings.length > 0
      ? `，另有 ${warnings.length} 项提醒`
      : "";

  return [
    `章纲质量检查未通过：${errors.length} 项错误${warningText}。`,
    `主要缺失：${issuePreview}${remainingIssues > 0 ? `；另有 ${remainingIssues} 项未列出` : ""}。`,
    "请让 AI 按章纲标准补齐后重新输出完整章纲，再保存。",
  ].join("");
}

export function buildOutlineGenerationQualityFeedback(input: {
  fileType: string;
  fileName: string;
  content: string;
}): OutlineGenerationQualityFeedback | null {
  if (input.fileType !== "chapter-outline" && !isLikelyChapterOutline(input.content, input.fileName)) {
    return null;
  }

  const summary = summarizeChapterOutlineQuality(input.content);
  const issues = Array.from(new Set([...summary.errors, ...summary.warnings]));
  if (issues.length === 0) {
    return {
      status: "pass",
      title: "生成后质量检查",
      summary: `${input.fileName} 章纲质量检查通过。`,
      issues: [],
      repairPrompt: "",
    };
  }

  const status: "warn" | "error" = summary.valid ? "warn" : "error";
  const preview = issues.slice(0, 5).join("；");
  const remaining = issues.length > 5 ? `；另有 ${issues.length - 5} 项未列出` : "";
  return {
    status,
    title: "生成后质量检查",
    summary: `${input.fileName} 存在 ${issues.length} 个可修复项：${preview}${remaining}。`,
    issues,
    repairPrompt: [
      `请按章纲标准修订「${input.fileName}」。`,
      "必须补齐以下可修复项，不要改变已确认的剧情方向：",
      ...issues.slice(0, 12).map((issue, index) => `${index + 1}. ${issue}`),
      "",
      "重要要求：",
      "1. 必须输出修订后的完整章纲正文（使用标准 Markdown 格式），不能只输出修改摘要或说明。",
      "2. 系统会自动从你的回复正文中提取完整内容并保存，你不需要在 JSON 中重复输出 content。",
      "3. 在回复末尾附加 outlineSaveRequest JSON，只需包含 targetFolder、fileName、fileType、writeMode、referencedSkills、sourceIntent 等元数据。fileType 只能用英文枚举（outline/volume-outline/chapter-outline/character/setting/foreshadowing/organization/quality-report），writeMode 只能用英文枚举（create/append/replace/patch），targetFolder 必须是相对路径（如「章纲」），禁止绝对路径。",
      "4. 正文中必须包含完整的章纲所有必填章节，不能省略未修改的部分。",
    ].join("\n"),
  };
}

export function isLikelyChapterOutline(content: string, fileName = ""): boolean {
  const text = `${fileName}\n${content}`;
  return /章纲|细纲|章节细纲|章节计划|本章目标|核心事件|场景顺序|章尾钩子/.test(text);
}

export function extractChapterOutlineStatus(content: string): "已确认" | "草稿" | "需修改" | "未知" {
  const match = content.match(/当前状态[：:]\s*(已确认|草稿|需修改)/);
  return (match?.[1] as "已确认" | "草稿" | "需修改" | undefined) ?? "未知";
}

function checkChapterRequiredSections(content: string): QualityCheckItem {
  const missing = CHAPTER_OUTLINE_REQUIRED_SECTIONS.filter((section) => {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`^#{1,3}\\s*${escaped}\\s*$`, "m").test(content);
  });

  if (missing.length === 0) {
    return {
      category: "章纲必填章节",
      status: "pass",
      message: "章纲必填章节完整",
    };
  }

  return {
    category: "章纲必填章节",
    status: "error",
    message: `缺少 ${missing.length} 个章纲必填章节`,
    details: missing.map((section) => `缺少「${section}」章节`),
  };
}

function extractSection(content: string, section: string): string {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`^(#{1,3})\\s*${escaped}\\s*$`, "m").exec(content);
  if (!start) return "";
  const currentLevel = start[1].length;
  const rest = content.slice(start.index + start[0].length);
  const nextHeading = new RegExp(`^#{1,${currentLevel}}\\s+`, "m").exec(rest);
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
}

function countMatches(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length ?? 0;
}

function checkChapterCoreEvents(content: string): QualityCheckItem {
  const section = extractSection(content, "核心事件");
  const eventCount = countMatches(section, /(?:^|\n)\s*(?:[-*]\s*)?事件\s*\d+\s*[：:]/g);
  const missingFields = ["事件内容", "事件作用", "涉及人物", "因果关系", "必须写出的细节"]
    .filter((field) => !section.includes(field));

  const details: string[] = [];
  if (eventCount < 6) details.push(`核心事件至少需要 6 条，当前检测到 ${eventCount} 条`);
  details.push(...missingFields.map((field) => `核心事件缺少「${field}」字段`));

  if (details.length === 0) {
    return {
      category: "核心事件",
      status: "pass",
      message: "核心事件数量和字段完整",
    };
  }

  return {
    category: "核心事件",
    status: "error",
    message: "核心事件不完整",
    details,
  };
}

function checkChapterScenes(content: string): QualityCheckItem {
  const section = extractSection(content, "场景顺序");
  const sceneCount = countMatches(section, /^#{2,4}\s*场景\s*\d+/gm)
    || countMatches(section, /(?:^|\n)\s*(?:[-*]\s*)?场景\s*\d+\s*[：:]/g);
  const missingFields = ["场景地点", "出场人物", "场景目标", "冲突点", "关键动作", "关键对白", "情绪变化", "必须出现的信息", "禁止偏离"]
    .filter((field) => !section.includes(field));

  const details: string[] = [];
  if (sceneCount < 2 || sceneCount > 4) details.push(`场景顺序需要 2-4 个场景，当前检测到 ${sceneCount} 个`);
  details.push(...missingFields.map((field) => `场景顺序缺少「${field}」字段`));

  if (details.length === 0) {
    return {
      category: "场景顺序",
      status: "pass",
      message: "场景数量和字段完整",
    };
  }

  return {
    category: "场景顺序",
    status: "error",
    message: "场景顺序不完整",
    details,
  };
}

function checkChapterStructureNodes(content: string): QualityCheckItem {
  const section = extractSection(content, "结构节点");
  const required = ["CBN", "CPNs", "CEN"];
  const missing = required.filter((field) => !section.includes(field));

  if (missing.length === 0) {
    return {
      category: "结构节点",
      status: "pass",
      message: "CBN、CPNs、CEN 结构节点完整",
    };
  }

  return {
    category: "结构节点",
    status: "error",
    message: "结构节点不完整",
    details: missing.map((field) => `结构节点缺少 ${field}`),
  };
}

function checkChapterTimeContinuity(content: string): QualityCheckItem {
  const section = extractSection(content, "基础信息");
  const required = ["时间锚点", "章内时间跨度", "与上章时间差"];
  const missing = required.filter((field) => !section.includes(field));

  if (missing.length === 0) {
    return {
      category: "时间承接",
      status: "pass",
      message: "时间锚点、章内时间跨度和与上章时间差完整",
    };
  }

  return {
    category: "时间承接",
    status: "error",
    message: "时间承接字段不完整",
    details: missing.map((field) => `基础信息缺少「${field}」`),
  };
}

function checkChapterExecutionConstraints(content: string): QualityCheckItem {
  const section = extractSection(content, "执行约束");
  const required = ["必须覆盖节点", "本章禁区"];
  const missing = required.filter((field) => !section.includes(field));

  if (missing.length === 0) {
    return {
      category: "执行约束",
      status: "pass",
      message: "必须覆盖节点和本章禁区完整",
    };
  }

  return {
    category: "执行约束",
    status: "error",
    message: "执行约束不完整",
    details: missing.map((field) => `执行约束缺少「${field}」`),
  };
}

function checkChapterHooksAndEnjoyment(content: string): QualityCheckItem {
  const missing = ["章首钩子", "爽点设计", "章尾钩子"].filter((section) => !extractSection(content, section));
  if (missing.length === 0) {
    return {
      category: "钩子与爽点",
      status: "pass",
      message: "章首钩子、爽点设计和章尾钩子完整",
    };
  }

  return {
    category: "钩子与爽点",
    status: "error",
    message: "钩子或爽点缺失",
    details: missing.map((section) => `缺少「${section}」内容`),
  };
}

function checkChapterCharacterState(content: string): QualityCheckItem {
  const section = extractSection(content, "人物状态");
  const missing = ["主角状态", "关键配角状态", "反派/阻力方状态", "人物关系变化", "本章后人物认知变化"]
    .filter((field) => !section.includes(field));

  if (missing.length === 0) {
    return {
      category: "人物状态",
      status: "pass",
      message: "人物状态字段完整",
    };
  }

  return {
    category: "人物状态",
    status: "warn",
    message: "人物状态字段不完整",
    details: missing.map((field) => `人物状态缺少「${field}」字段`),
  };
}

function checkChapterForeshadowing(content: string): QualityCheckItem {
  const section = extractSection(content, "伏笔与追踪");
  if (!section) {
    return {
      category: "伏笔与追踪",
      status: "error",
      message: "缺少伏笔与追踪内容",
    };
  }

  const hasExplicitNone = /无新增伏笔|本章无新增伏笔|无新伏笔/.test(section);
  const hasForeshadowFields = ["本章投放伏笔", "本章回收伏笔", "本章延后处理"].some((field) => section.includes(field));
  if (hasExplicitNone || hasForeshadowFields) {
    return {
      category: "伏笔与追踪",
      status: "pass",
      message: "伏笔处理已说明",
    };
  }

  return {
    category: "伏笔与追踪",
    status: "warn",
    message: "伏笔处理不明确",
    details: ["需要写明本章投放/回收/延后的伏笔，或明确“本章无新增伏笔”"],
  };
}

function checkChapterWritingConstraints(content: string): QualityCheckItem {
  const constraintSection = extractSection(content, "写作约束");
  const promptSection = extractSection(content, "AI写作提示");
  const missing: string[] = [];

  if (!constraintSection.includes("必须遵守")) missing.push("写作约束缺少「必须遵守」");
  if (!constraintSection.includes("不允许改变")) missing.push("写作约束缺少「不允许改变」");
  if (!constraintSection.includes("不允许出现")) missing.push("写作约束缺少「不允许出现」");
  if (!/严格遵循|不得改变|不得自行改写/.test(promptSection)) missing.push("AI写作提示缺少严格遵循章纲的约束");

  if (missing.length === 0) {
    return {
      category: "写作约束",
      status: "pass",
      message: "写作约束和 AI 写作提示完整",
    };
  }

  return {
    category: "写作约束",
    status: "error",
    message: "写作约束不完整",
    details: missing,
  };
}

function checkRequiredFields(content: string): QualityCheckItem {
  const missing: string[] = [];
  for (const field of VOLUME_OUTLINE_REQUIRED_FIELDS) {
    const sectionHeaderRe = new RegExp(`##\\s*${field}`);
    if (!sectionHeaderRe.test(content)) {
      missing.push(field);
    }
  }
  if (missing.length === 0) {
    return {
      category: "卷纲必填项",
      status: "pass",
      message: "所有必填字段均已包含",
    };
  }
  return {
    category: "卷纲必填项",
    status: "error",
    message: `缺少以下必填字段：${missing.join("、")}`,
    details: missing.map((f) => `缺少「${f}」章节`),
  };
}

function checkEightNodeStructureWrapper(content: string): QualityCheckItem {
  const warnings = checkEightNodeStructure(content);
  if (warnings.length === 0) {
    return {
      category: "八节点结构",
      status: "pass",
      message: "八节点结构完整",
    };
  }
  return {
    category: "八节点结构",
    status: "warn",
    message: `发现 ${warnings.length} 个问题`,
    details: warnings,
  };
}

function checkEmotionArcWrapper(content: string): QualityCheckItem {
  const warnings = checkEmotionArc(content);
  if (warnings.length === 0) {
    return {
      category: "情绪弧线",
      status: "pass",
      message: "情绪弧线描述完整",
    };
  }
  return {
    category: "情绪弧线",
    status: warnings.length > 2 ? "error" : "warn",
    message: `发现 ${warnings.length} 个问题`,
    details: warnings,
  };
}

function checkPositioningDistribution(
  positions: ReturnType<typeof parsePositionTableFromMarkdown>,
): QualityCheckItem {
  const warnings = checkChapterPositioningDistribution(positions);
  if (warnings.length === 0) {
    return {
      category: "章节定位分布",
      status: "pass",
      message: "章节定位分布合理",
    };
  }
  return {
    category: "章节定位分布",
    status: "warn",
    message: `发现 ${warnings.length} 个问题`,
    details: warnings,
  };
}

function checkEnjoymentRhythmWrapper(
  positions: ReturnType<typeof parsePositionTableFromMarkdown>,
): QualityCheckItem {
  const totalChapters = positions.length;
  const warnings = checkEnjoymentRhythm(positions, totalChapters);
  if (warnings.length === 0) {
    return {
      category: "爽点节律",
      status: "pass",
      message: "爽点节律合理",
    };
  }
  return {
    category: "爽点节律",
    status: "warn",
    message: `发现 ${warnings.length} 个问题`,
    details: warnings,
  };
}

function checkAdjacentEmotion(
  positions: ReturnType<typeof parsePositionTableFromMarkdown>,
): QualityCheckItem {
  const warnings = checkAdjacentEmotionClustering(positions);
  if (warnings.length === 0) {
    return {
      category: "相邻章情绪",
      status: "pass",
      message: "相邻章情绪分布合理",
    };
  }
  return {
    category: "相邻章情绪",
    status: "warn",
    message: `发现 ${warnings.length} 处扎堆`,
    details: warnings,
  };
}

function checkForeshadowingRecovery(content: string): QualityCheckItem {
  const lines = content.split("\n");
  let inForeshadowSection = false;
  const foreshadowingRows: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测伏笔章节开始
    if (/^##\s*(本卷伏笔|伏笔布局)/.test(trimmed)) {
      inForeshadowSection = true;
      continue;
    }

    if (inForeshadowSection) {
      // 遇到下一个二级标题（非伏笔相关），退出
      if (/^##\s+/.test(trimmed) && !/伏笔/.test(trimmed)) {
        break;
      }

      // 检测表格行
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const cells = trimmed
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);

        // 跳过表头行和分隔行
        if (cells.length >= 3 && cells[0] !== "ID" && !cells[0].startsWith("---")) {
          foreshadowingRows.push(trimmed);
        }
      }
    }
  }

  if (foreshadowingRows.length === 0) {
    return {
      category: "伏笔回收",
      status: "pass",
      message: "未检测到伏笔记录",
    };
  }

  // 检查每行是否有回收时机（第4列：预计回收时机）
  const missingRecovery: string[] = [];
  for (const row of foreshadowingRows) {
    const cells = row
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);

    // 表头格式: ID | 内容 | 优先级 | 预计回收时机
    // 如果第4列为空或为占位符，则缺少回收计划
    const recoveryField = cells.length >= 4 ? cells[3] : "";
    if (
      !recoveryField ||
      recoveryField.startsWith("[") ||
      recoveryField === ""
    ) {
      missingRecovery.push(cells[0] || "未命名伏笔");
    }
  }

  if (missingRecovery.length === 0) {
    return {
      category: "伏笔回收",
      status: "pass",
      message: "所有伏笔均有回收计划",
    };
  }
  return {
    category: "伏笔回收",
    status: "warn",
    message: `${missingRecovery.length} 条伏笔缺少回收计划`,
    details: missingRecovery.map(
      (id) => `伏笔「${id}」缺少预计回收时机`,
    ),
  };
}
