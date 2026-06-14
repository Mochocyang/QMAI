export interface SimpleExtractionPromptInput {
  characterNames: string[]
  chapterSamples: string  // 章节内容拼接
}

export function buildSimpleExtractionPrompt(
  input: SimpleExtractionPromptInput
): string {
  const { characterNames, chapterSamples } = input
  const nameList = characterNames.map((n) => `- ${n}`).join("\n")

  return `你是一个小说角色分析助手。请根据下列章节内容，分析以下角色的人物特征。

# 角色列表
${nameList}

# 章节内容
${chapterSamples}

# 分析要求
对每个角色输出 4 个字段 + 3-5 句代表性台词：
- personality（性格）：核心性格特征 + 优缺点（50-100 字）
- motivation（动机）：核心目标、欲望、恐惧（30-80 字）
- speechStyle（说话风格）：语言习惯、用词偏好、语气（30-80 字）
- behaviorPatterns（行为模式）：决策倾向、面对冲突的方式、社交风格（30-80 字）
- quotes（代表性台词）：3-5 句最能体现该角色性格的原文台词

# 输出格式（JSON 数组）
[
  {
    "name": "角色名",
    "personality": "...",
    "motivation": "...",
    "speechStyle": "...",
    "behaviorPatterns": "...",
    "quotes": ["台词1", "台词2", "台词3", "台词4", "台词5"]
  }
]

只返回 JSON，不要其他文字。`
}
