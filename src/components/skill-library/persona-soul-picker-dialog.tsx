/**
 * 「人物 Skill」里绑定角色灵魂的选择弹窗（方案 S1）。
 *
 * ── 为什么要有这个弹窗 ──
 * 之前「绑定灵魂」就是一个空输入框，用户既看不到灵魂库里有什么，也不知道
 * 该填什么名字；填了一个不存在的名字也不会有任何反馈。这里改成：点「绑定灵魂」
 * → 从**角色灵魂库**（`listCharacterAuras`：内置 + 自定义）里挑 → 确认才写入。
 *
 * ── 为什么是单选、并且底部要一个明确的确认按钮 ──
 * 绑定是一个**写操作**：它会改档案里的「绑定灵魂」这一格。点一下就写会让人
 * 在无意间改掉别人设好的东西，所以选完必须再点「绑定这个灵魂」。
 *
 * ── 它不写盘 ──
 * 弹窗只负责「问」：确认后把灵魂名交回调用方，由 `PersonaPersonalityTab` 走
 * 既有的 `onChange` → 保存流程。取消这条路径不产生任何写入。
 */
import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { listCharacterAuras, type CharacterAura } from "@/lib/novel/character-aura"

export interface PersonaSoulPickerDialogProps {
  open: boolean
  projectPath?: string
  /** 要绑定的角色名（仅用于文案）。 */
  characterName: string
  /** 当前已绑定的灵魂名，用于在卡片上标「已绑定」。 */
  currentSoulName: string
  onOpenChange: (open: boolean) => void
  /** 用户确认后交出灵魂名；取消走 `onOpenChange(false)`，不会调用本回调。 */
  onConfirm: (soulName: string) => void
}

type FilterKey = "all" | "builtIn" | "custom"

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "builtIn", label: "内置" },
  { key: "custom", label: "自定义" },
]

/** 卡片上那两行风格描述：优先风格描述，退回到来源说明。 */
function describeSoul(aura: CharacterAura): string {
  const parts = [aura.styleDescription, aura.expressionDna, aura.sourceNote]
    .map((item) => (item ?? "").trim())
    .filter(Boolean)
  return parts[0] ?? "这个灵魂还没有写风格描述。"
}

export function PersonaSoulPickerDialog({
  open,
  projectPath,
  characterName,
  currentSoulName,
  onOpenChange,
  onConfirm,
}: PersonaSoulPickerDialogProps) {
  const [auras, setAuras] = useState<CharacterAura[] | null>(null)
  const [picked, setPicked] = useState("")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterKey>("all")
  const [error, setError] = useState("")

  // 每次打开都重读：灵魂库可能刚被改动过（新建了自定义灵魂）。
  useEffect(() => {
    if (!open) return
    setPicked("")
    setQuery("")
    setFilter("all")
    setError("")
    setAuras(null)
    if (!projectPath) {
      setAuras([])
      return
    }
    let current = true
    void listCharacterAuras(projectPath)
      .then((list) => {
        if (current) setAuras(list)
      })
      .catch(() => {
        if (current) {
          setAuras([])
          setError("读取角色灵魂库失败，请重试。")
        }
      })
    return () => {
      current = false
    }
  }, [open, projectPath])

  const loading = auras === null

  const counts = useMemo(() => {
    const list = auras ?? []
    return {
      all: list.length,
      builtIn: list.filter((aura) => aura.builtIn).length,
      custom: list.filter((aura) => !aura.builtIn).length,
    }
  }, [auras])

  const visible = useMemo(() => {
    const list = auras ?? []
    const byFilter =
      filter === "builtIn"
        ? list.filter((aura) => aura.builtIn)
        : filter === "custom"
          ? list.filter((aura) => !aura.builtIn)
          : list
    const keyword = query.trim().toLowerCase()
    if (!keyword) return byFilter
    return byFilter.filter(
      (aura) =>
        aura.name.toLowerCase().includes(keyword) ||
        (aura.category ?? "").toLowerCase().includes(keyword),
    )
  }, [auras, filter, query])

  const trimmedCurrent = currentSoulName.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="persona-soul-picker"
        className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto sm:max-w-[760px]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>为「{characterName}」绑定角色灵魂</DialogTitle>
        </DialogHeader>
        <p className="shrink-0 text-sm text-muted-foreground">
          灵魂只决定「怎么演」，性格决定「演成什么样」；两者冲突时以性格为准。
        </p>

        <label className="flex shrink-0 items-center gap-2 rounded-md border px-2">
          <Search className="size-4 shrink-0 opacity-60" />
          <input
            aria-label="搜索角色灵魂"
            placeholder="搜索灵魂名 / 分类"
            value={query}
            className="h-9 w-full bg-transparent text-sm outline-none"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              data-testid={`persona-soul-filter-${item.key}`}
              onClick={() => setFilter(item.key)}
              className={`ui-test-skills-chip${filter === item.key ? " is-active" : ""}`}
            >
              {item.label} {counts[item.key]}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="persona-soul-grid">
          {loading ? (
            <p className="text-sm text-muted-foreground">正在读取角色灵魂库…</p>
          ) : error ? (
            <p role="alert" className="text-sm">
              {error}
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {(auras ?? []).length === 0
                ? "角色灵魂库还是空的。先到「灵魂」页新建一个角色灵魂，再回来绑定。"
                : `没有匹配「${query.trim()}」的角色灵魂`}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {visible.map((aura) => {
                const isBound = Boolean(trimmedCurrent) && aura.name.trim() === trimmedCurrent
                const isPicked = picked === aura.name
                return (
                  <button
                    key={aura.id}
                    type="button"
                    data-testid={`persona-soul-option-${aura.name}`}
                    aria-pressed={isPicked}
                    onClick={() => setPicked(aura.name)}
                    className={`ui-test-soul-card${isPicked ? " is-picked" : ""}`}
                  >
                    <span className="ui-test-soul-card-head">
                      <span className="ui-test-soul-card-avatar" aria-hidden="true">
                        {aura.name.slice(0, 1)}
                      </span>
                      <b title={aura.name}>{aura.name}</b>
                      {isBound ? <span className="ui-test-soul-card-bound">已绑定</span> : null}
                    </span>
                    <span className="ui-test-soul-card-desc">{describeSoul(aura)}</span>
                    <span className="ui-test-soul-card-meta">{aura.builtIn ? "内置" : "自定义"}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {picked ? `已选：${picked}` : "还没有选择"}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!picked}
            data-testid="persona-soul-confirm"
            onClick={() => onConfirm(picked)}
          >
            绑定这个灵魂
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
