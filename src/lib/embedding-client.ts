import type { LlmConfig } from "@/stores/wiki-store"

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function embed(text: string, config: LlmConfig): Promise<number[]> {
  const baseUrl = (config as { baseUrl?: string }).baseUrl || "https://api.openai.com/v1"
  const endpoint = `${baseUrl.replace(/\/$/, "")}/embeddings`

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: text,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`Embedding API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText.slice(0, 200)}` : ""}`)
  }

  const data = await response.json()
  const embedding = data?.data?.[0]?.embedding

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Invalid embedding response: missing data[0].embedding")
  }

  return embedding as number[]
}
