export type DiffLineType = "add" | "remove" | "unchanged"

export interface DiffLine {
  type: DiffLineType
  content: string
  originalLine?: number
  modifiedLine?: number
}

export function computeLineDiff(original: string, modified: string): DiffLine[] {
  const origLines = original.length === 0 ? [] : original.split("\n")
  const modLines = modified.length === 0 ? [] : modified.split("\n")
  const m = origLines.length
  const n = modLines.length

  if (m === 0 && n === 0) return []

  const dp: number[][] = []
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0)
  }
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (origLines[i] === modLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (origLines[i] === modLines[j]) {
      result.push({ type: "unchanged", content: origLines[i], originalLine: i + 1, modifiedLine: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "remove", content: origLines[i], originalLine: i + 1 })
      i++
    } else {
      result.push({ type: "add", content: modLines[j], modifiedLine: j + 1 })
      j++
    }
  }
  while (i < m) {
    result.push({ type: "remove", content: origLines[i], originalLine: i + 1 })
    i++
  }
  while (j < n) {
    result.push({ type: "add", content: modLines[j], modifiedLine: j + 1 })
    j++
  }

  return result
}
