/** 将章纲中的“作者手搓留白”段转换为 Markdown blockquote，供只读预览高亮。 */
export function transformHandcraftZonesForReader(markdown: string): string {
  return markdown.replace(
    /^###\s*作者手搓留白(?:（[^）]*）|\([^)]*\))?\s*\r?\n([\s\S]*?)(?=\r?\n###\s|\s*$)/gm,
    (_match: string, content: string) => {
      const firstLine = "> **作者手搓留白**：以下内容需要你手工填充，AI 不会代写"
      const rest = content
        .split(/\r?\n/)
        .map((line: string) => (line.trim() ? `> ${line}` : ">"))
        .join("\n")
      return `${firstLine}\n${rest}`
    },
  )
}
