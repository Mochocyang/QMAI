import type { CognitionState } from "./character-cognition"

/** Select locally; do not send the entire accumulated cognition store to every chapter. */
export function relevantCognitionContext(state: CognitionState, query: string, maxChars = 6000): string {
  const compact = query.replace(/\s+/gu, "")
  if (!compact || maxChars <= 0) return ""
  const ignored = new Set(["知道", "不知", "人物", "角色", "本章", "章节", "正文", "写作", "读者", "生成", "内容", "继续"])
  const tokens = new Set<string>()
  for (const segment of compact.match(/[\p{Script=Han}]{2,}|[a-zA-Z0-9_-]{2,}/gu) ?? []) {
    if (/\p{Script=Han}/u.test(segment)) {
      for (let i = 0; i + 1 < segment.length; i++) {
        const token = segment.slice(i, i + 2)
        if (!ignored.has(token)) tokens.add(token)
      }
    } else tokens.add(segment.toLowerCase())
  }
  const score = (text: string) => [...tokens].reduce((n, token) => n + Number(text.toLowerCase().includes(token)), 0)
  const ranked = (items: string[]) => items.map((text, index) => ({ text, index, score: score(text) }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
  const lines: Array<{ text: string; score: number }> = []
  for (const char of state.characters) {
    const mentioned = compact.includes(char.character.replace(/\s+/gu, ""))
    if (!mentioned) continue
    for (const [items, label] of [[char.knows, "知道"], [char.doesNotKnow, "不知道"]] as const) {
      for (const item of ranked(items).slice(0, 12)) lines.push({ text: `${char.character}${label}：${item.text}`, score: item.score + 10 })
    }
  }
  for (const item of ranked(state.readerKnows).filter((item) => item.score >= 2).slice(0, 12)) {
    lines.push({ text: `读者知道：${item.text}`, score: item.score })
  }
  lines.sort((a, b) => b.score - a.score)
  const selected: string[] = []
  let length = 0
  for (const { text } of lines) {
    // Keep facts whole; truncating a negative clause can reverse its meaning.
    if (length + text.length + 1 > maxChars) continue
    selected.push(text); length += text.length + 1
  }
  return selected.join("\n")
}
