export function normalizeNovelForHash(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
}

export async function hashNormalizedNovel(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeNovelForHash(content))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
}

export function reserveUniqueTitle(base: string, reserved: Set<string>): string {
  if (!reserved.has(base)) {
    reserved.add(base)
    return base
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${base}（${index}）`
    if (!reserved.has(candidate)) {
      reserved.add(candidate)
      return candidate
    }
  }
}