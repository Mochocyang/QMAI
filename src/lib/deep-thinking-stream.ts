export interface DeepThinkingStreamRenderer {
  updateThinking: (content: string) => string
  appendFinal: (content: string) => string
  getContent: () => string
}

interface ThinkingBlock {
  key: string
  content: string
}

export function createDeepThinkingStreamRenderer(): DeepThinkingStreamRenderer {
  const thinkingBlocks: ThinkingBlock[] = []
  let finalContent = ""

  const render = () => renderDeepThinkingStream(thinkingBlocks.map((block) => block.content), finalContent)

  return {
    updateThinking(content: string) {
      const normalized = content.trim()
      if (!normalized) return render()

      const key = getThinkingBlockKey(normalized)
      const existingIndex = thinkingBlocks.findIndex((block) => block.key === key)
      if (existingIndex >= 0) {
        thinkingBlocks[existingIndex] = { key, content: normalized }
      } else {
        thinkingBlocks.push({ key, content: normalized })
      }
      return render()
    },

    appendFinal(content: string) {
      finalContent += content
      return render()
    },

    getContent() {
      return render()
    },
  }
}

export function renderDeepThinkingStream(thinkingBlocks: string[], finalContent = ""): string {
  const thinking = thinkingBlocks
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<think>\n${block}\n</think>`)
    .join("\n\n")

  if (!thinking) return finalContent
  if (!finalContent) return thinking
  return `${thinking}\n\n${finalContent}`
}

function getThinkingBlockKey(content: string): string {
  const title = content.match(/^\s*##\s*([^\n]+)/)?.[1]?.trim()
  if (title) return title
  return content.split("\n", 1)[0]?.trim() || content
}
