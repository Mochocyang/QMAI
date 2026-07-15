import { normalizePath } from "@/lib/path-utils"

type FileExists = (path: string) => Promise<boolean>
type WriteFileIfAbsent = (path: string, content: string) => Promise<boolean>

function getDeAiDraftStem(chapterPath: string): string {
  const normalizedPath = normalizePath(chapterPath)
  const slashIndex = normalizedPath.lastIndexOf("/")
  const dir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : ""
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath
  const baseName = fileName.replace(/\.md$/i, "") || "chapter"
  return `${dir}${baseName}-去AI味稿`
}

export async function resolveAvailableDeAiDraftPath(
  chapterPath: string,
  fileExists: FileExists,
): Promise<string> {
  const draftStem = getDeAiDraftStem(chapterPath)

  const firstPath = `${draftStem}.md`
  if (!(await fileExists(firstPath))) return firstPath

  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${draftStem}-${index}.md`
    if (!(await fileExists(candidate))) return candidate
  }

  return `${draftStem}-${Date.now()}.md`
}

export async function saveDeAiDraftWithoutOverwrite(
  chapterPath: string,
  content: string,
  writeFileIfAbsent: WriteFileIfAbsent,
  now: () => number = Date.now,
): Promise<string> {
  const draftStem = getDeAiDraftStem(chapterPath)
  const numberedCandidates = [
    `${draftStem}.md`,
    ...Array.from({ length: 98 }, (_, index) => `${draftStem}-${index + 2}.md`),
  ]

  for (const candidate of numberedCandidates) {
    if (await writeFileIfAbsent(candidate, content)) return candidate
  }

  const timestamp = now()
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1
      ? `${draftStem}-${timestamp}.md`
      : `${draftStem}-${timestamp}-${suffix}.md`
    if (await writeFileIfAbsent(candidate, content)) return candidate
  }
}
