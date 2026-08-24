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
