/**
 * Convert Obsidian-style `[[target]]` and `[[target|alias]]` wiki
 * links inside a markdown body to standard markdown links so a
 * commonmark renderer (Milkdown / ReactMarkdown) styles them as
 * links instead of dumping the bracket syntax as raw text.
 *
 * Output format: `[label](#target)` — using a fragment href so
 * Tauri's webview doesn't try to navigate externally on click.
 * In-app navigation can be wired up later via a click intercept
 * on `<a href="#…">` elements; for now the goal is just to stop
 * the wikilinks from looking like "raw code".
 *
 * Skips content inside fenced code blocks (```…```) and inline
 * code spans (`…`) so wikilinks shown as code examples in
 * documentation don't get mangled.
 */
export function transformWikilinks(body: string): string {
  if (!body.includes("[[")) return body

  // Split on triple-backtick fences. The capturing group keeps
  // the fence content in the output. Odd indices are inside a
  // fence and must pass through untouched.
  const parts = body.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part, idx) => (idx % 2 === 1 ? part : transformOutsideCode(part)))
    .join("")
}

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g

function transformOutsideCode(text: string): string {
  if (!text.includes("[[")) return text

  // Split on inline-code spans so backticked content is preserved.
  const parts = text.split(/(`[^`\n]+`)/g)
  return parts
    .map((part, idx) => (idx % 2 === 1 ? part : replaceWikilinks(part)))
    .join("")
}

function replaceWikilinks(text: string): string {
  return text.replace(WIKILINK_RE, (_match, rawTarget: string, rawAlias?: string) => {
    const target = rawTarget.trim()
    const alias = rawAlias?.trim() ?? ""
    const label = alias.length > 0 ? alias : target
    // Encode the target so spaces / parens / hashes don't break the
    // markdown link parser. encodeURIComponent is overkill for a
    // fragment but it's the safe default.
    const href = `#${encodeURIComponent(target)}`
    // Escape any closing brackets in the label that would otherwise
    // terminate the markdown link text.
    const escapedLabel = label.replace(/\[/g, "\\[").replace(/\]/g, "\\]")
    return `[${escapedLabel}](${href})`
  })
}
