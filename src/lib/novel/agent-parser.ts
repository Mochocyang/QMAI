/**
 * Agent Parser - 解析 LLM 输出中的文件修改指令
 *
 * LLM 输出格式约定：
 * - 普通回复：直接文本
 * - 文件修改：包含 <file_edit> 标签
 *
 * <file_edit path="wiki/chapters/chapter-001.md">
 * <search>
 * 要替换的原文内容（精确匹配）
 * </search>
 * <replace>
 * 替换后的新内容
 * </replace>
 * </file_edit>
 *
 * 支持多个 <file_edit> 块
 */

export interface FileEditAction {
  filePath: string
  search: string
  replace: string
}

export interface ParsedAgentResponse {
  /** 纯文本回复部分（不含 file_edit 标签） */
  textContent: string
  /** 文件修改操作 */
  edits: FileEditAction[]
  /** 是否包含修改操作 */
  hasEdits: boolean
}

/**
 * 解析 LLM 输出，提取文本内容和文件修改指令
 */
export function parseAgentResponse(content: string): ParsedAgentResponse {
  const edits: FileEditAction[] = []

  // 匹配所有 <file_edit> 块
  const editRegex = /<file_edit\s+path="([^"]+)">\s*<search>\s*([\s\S]*?)\s*<\/search>\s*<replace>\s*([\s\S]*?)\s*<\/replace>\s*<\/file_edit>/g

  let match
  while ((match = editRegex.exec(content)) !== null) {
    edits.push({
      filePath: match[1].trim(),
      search: match[2].trim(),
      replace: match[3].trim(),
    })
  }

  // 移除 file_edit 标签后的纯文本
  const textContent = content
    .replace(/<file_edit\s+path="[^"]+">[\s\S]*?<\/file_edit>/g, "")
    .trim()

  return {
    textContent,
    edits,
    hasEdits: edits.length > 0,
  }
}

/**
 * 检测用户输入是否包含修改意图
 */
export function detectEditIntent(text: string): boolean {
  const editKeywords = [
    "修改", "更改", "替换", "改为", "改成", "换成",
    "删除", "去掉", "移除", "添加", "加上", "插入",
    "重写", "改写", "调整", "更新", "变更",
    "把…改", "将…改", "把…换", "将…换",
    "edit", "modify", "change", "replace", "delete", "remove", "add", "update",
  ]
  const lower = text.toLowerCase()
  return editKeywords.some((kw) => lower.includes(kw))
}

/**
 * 构建 Agent 模式的 system prompt 后缀
 * 告诉 LLM 如何输出文件修改指令
 */
export function buildAgentSystemSuffix(scope: "chapters" | "outlines"): string {
  const scopeDesc = scope === "chapters" ? "章节文件（wiki/chapters/）" : "大纲文件（wiki/outlines/）"

  return `

## 文件修改能力

当用户要求你修改${scopeDesc}中的内容时，请使用以下格式输出修改指令：

<file_edit path="文件的相对路径">
<search>
要被替换的原文（必须精确匹配文件中的内容，包括换行和空格）
</search>
<replace>
替换后的新内容
</replace>
</file_edit>

规则：
1. <search> 中的内容必须与文件中的原文完全一致，用于精确定位。
2. 必须列出所有需要修改的位置。如果多个文件中都有需要修改的内容，每个文件都要单独输出 <file_edit> 块。
3. 如果同一个文件有多处需要修改，为每处修改分别输出一个 <file_edit> 块。
4. 在修改指令之外，用自然语言简要说明你做了什么修改。
5. 如果用户只是在聊天讨论（没有要求修改文件），就正常回答，不要输出 <file_edit>。
6. 只能修改${scopeDesc}下的文件，不要尝试修改其他位置的文件。
7. 尽量完整覆盖所有相关修改，不要遗漏。`
}
