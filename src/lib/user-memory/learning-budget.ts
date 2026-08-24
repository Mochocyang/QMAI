const USER_MEMORY_LEARNING_BUDGET_KEY = "qmai.user-memory-learning-budget.v1"

type StorageLike = Pick<Storage, "getItem" | "setItem">

interface UserMemoryLearningBudget {
  day: string
  calls: number
  inputChars: number
}

function dayKey(now: number): string {
  const date = new Date(now)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-")
}

function emptyBudget(now: number): UserMemoryLearningBudget {
  return { day: dayKey(now), calls: 0, inputChars: 0 }
}

export function loadUserMemoryLearningBudget(storage: StorageLike | null, now = Date.now()): UserMemoryLearningBudget {
  if (!storage) return emptyBudget(now)
  try {
    const parsed = JSON.parse(storage.getItem(USER_MEMORY_LEARNING_BUDGET_KEY) ?? "null") as Partial<UserMemoryLearningBudget> | null
    if (!parsed || parsed.day !== dayKey(now)) return emptyBudget(now)
    return {
      day: parsed.day,
      calls: typeof parsed.calls === "number" && Number.isFinite(parsed.calls) ? Math.max(0, parsed.calls) : 0,
      inputChars: typeof parsed.inputChars === "number" && Number.isFinite(parsed.inputChars) ? Math.max(0, parsed.inputChars) : 0,
    }
  } catch {
    return emptyBudget(now)
  }
}

export function consumeUserMemoryLearningBudget(
  storage: StorageLike | null,
  dailyLimit: number,
  inputChars: number,
  now = Date.now(),
): boolean {
  const current = loadUserMemoryLearningBudget(storage, now)
  if (current.calls >= Math.max(0, dailyLimit)) return false
  if (!storage) return true
  const next = { ...current, calls: current.calls + 1, inputChars: current.inputChars + Math.max(0, inputChars) }
  try {
    storage.setItem(USER_MEMORY_LEARNING_BUDGET_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

export function resetUserMemoryLearningBudget(storage: StorageLike | null): void {
  if (!storage) return
  try {
    storage.setItem(USER_MEMORY_LEARNING_BUDGET_KEY, JSON.stringify({ day: "", calls: 0, inputChars: 0 }))
  } catch {
    // 清理预算失败不应阻断记忆清空。
  }
}
