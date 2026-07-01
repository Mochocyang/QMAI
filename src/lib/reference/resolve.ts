import { readFile } from "@/commands/fs"
import type { ReferenceToken } from "./types"

export interface ResolvedReference {
  token: ReferenceToken
  content: string
  metadata: {
    byteLength: number
    charCount: number
  }
}

export async function resolveReference(
  token: ReferenceToken,
): Promise<ResolvedReference> {
  if (token.conversationId) {
    return {
      token,
      content: `[跨会话引用: ${token.title}, id=${token.conversationId}]`,
      metadata: { byteLength: 0, charCount: 0 },
    }
  }

  if (token.skillId) {
    return {
      token,
      content: `[技能引用: ${token.title}]`,
      metadata: { byteLength: 0, charCount: 0 },
    }
  }

  if (token.path) {
    try {
      const content = await readFile(token.path)
      return {
        token,
        content,
        metadata: {
          byteLength: new TextEncoder().encode(content).length,
          charCount: content.length,
        },
      }
    } catch {
      return {
        token,
        content: `[无法读取: ${token.path}]`,
        metadata: { byteLength: 0, charCount: 0 },
      }
    }
  }

  return {
    token,
    content: `[引用: ${token.title}]`,
    metadata: { byteLength: 0, charCount: 0 },
  }
}
