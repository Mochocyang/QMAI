const APP_NAME = "青幕AI写作"

export function formatAppTitle(projectName: string | null | undefined, totalWordCount?: number | null): string {
  const name = projectName?.trim()
  if (!name) return APP_NAME
  const totalWordCountLabel =
    typeof totalWordCount === "number" && Number.isFinite(totalWordCount)
      ? `｜总字数：${totalWordCount}字`
      : ""
  return `${APP_NAME}｜${name}${totalWordCountLabel}`
}
