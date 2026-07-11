function isLlmEnglishThinking(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const chineseChars = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = trimmed.length;
  const chineseRatio = chineseChars / Math.max(totalChars, 1);

  if (chineseRatio > 0.15) return false;

  const thinkingKeywords = [
    "thinking process",
    "let's think",
    "let me think",
    "analyze",
    "let's write",
    "wait,",
    "word count",
    "constraints",
    "note:",
    "check:",
    "strategy",
    "i need to",
    "i should",
    "first,",
    "okay,",
    "so,",
    "now,",
    "the user",
    "based on",
    "according to",
  ];
  const lower = trimmed.toLowerCase();
  const keywordCount = thinkingKeywords.filter((kw) =>
    lower.includes(kw),
  ).length;

  return keywordCount >= 2;
}

function isWorkflowStageHeader(line: string): boolean {
  const trimmed = line.trim();
  if (/^##\s*阶段/.test(trimmed)) return true;
  if (/^阶段\s*[\d.]+\s*[：:]/.test(trimmed)) return true;
  return false;
}

function filterThinkingContent(thinking: string): string | null {
  const lines = thinking.split("\n");
  const resultLines: string[] = [];
  let currentStageHeader: string | null = null;
  let currentStageContent: string[] = [];

  const flushStage = () => {
    if (currentStageHeader) {
      resultLines.push(currentStageHeader);
      const contentText = currentStageContent.join("\n").trim();
      if (contentText) {
        if (!isLlmEnglishThinking(contentText)) {
          resultLines.push(...currentStageContent);
        }
      }
      resultLines.push("");
    } else if (currentStageContent.length > 0) {
      const blockText = currentStageContent.join("\n").trim();
      if (blockText && !isLlmEnglishThinking(blockText)) {
        resultLines.push(...currentStageContent);
        resultLines.push("");
      }
    }
    currentStageHeader = null;
    currentStageContent = [];
  };

  for (const line of lines) {
    if (isWorkflowStageHeader(line)) {
      flushStage();
      currentStageHeader = line;
    } else if (currentStageHeader) {
      currentStageContent.push(line);
    } else {
      currentStageContent.push(line);
      if (!line.trim()) {
        flushStage();
      }
    }
  }
  flushStage();

  const result = resultLines.join("\n").trim();
  return result || null;
}

export function separateThinking(text: string): {
  thinking: string | null;
  answer: string;
} {
  const thinkRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
  const thinkParts: string[] = [];
  let answer = text;

  let match: RegExpExecArray | null;
  while ((match = thinkRegex.exec(text)) !== null) {
    thinkParts.push(match[1].trim());
  }
  answer = answer
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .trim();

  const unclosedMatch = answer.match(/<think(?:ing)?>([\s\S]*)$/i);
  if (unclosedMatch) {
    thinkParts.push(unclosedMatch[1].trim());
    answer = answer.replace(/<think(?:ing)?>[\s\S]*$/i, "").trim();
  }

  const firstCloseIndex = answer.search(/<\/think(?:ing)?>/i);
  if (firstCloseIndex >= 0) {
    const beforeClose = answer.slice(0, firstCloseIndex);
    if (!/<think(?:ing)?>/i.test(beforeClose)) {
      const thinkingContent = beforeClose.trim();
      if (thinkingContent) {
        thinkParts.push(thinkingContent);
      }
      answer = answer.replace(/^[\s\S]*?<\/think(?:ing)?>\s*/i, "");
    }
  }

  const rawThinking = thinkParts.length > 0 ? thinkParts.join("\n\n") : null;
  const filteredThinking = rawThinking
    ? filterThinkingContent(rawThinking)
    : null;

  return { thinking: filteredThinking, answer: answer.trim() };
}