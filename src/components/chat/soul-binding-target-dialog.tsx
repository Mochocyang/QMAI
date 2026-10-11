/**
 * 丁-4：把 `@某人灵魂` 变成「本条消息的临时绑定」时，必须经过的**确认**步骤。
 *
 * ── 为什么不是静默绑定 ──
 * `bindCharacterAura` 写的是项目存储 `.qmai/character-aura.json`，绑定表按
 * `characterName` **一对一**：同一个人物只能有一条绑定。所以「点一下 `@` 就写盘」
 * 会同时做两件用户没同意的事——改一个持久设置、并且可能顶掉他原有的绑定。
 * 本弹窗让用户在**写盘之前**明确指定「绑给哪个小说人物」。
 *
 * ── 为什么没有直接复用 `BindingTargetDialog` ──
 * 那个组件是拆书工作台的绑定入口，它的固定文案是
 * 「绑定后会自动把该角色灵魂加入自定义灵魂库」——那是**发布**语义；
 * 本处的灵魂**已经在库里**，要做的是临时绑定，这句文案在这里是错的。
 * 它还是多选（`onConfirm(names: string[])`）且无法插入「影响范围」说明，
 * 而多选会让「只对这一条消息生效」的还原边界变得含糊。
 * ⇒ 这是一个**同形但不同语义**的弹窗；人物名单的来源与过滤复用了同一条链
 * （`listBindableNovelCharacters` + `readBindableIgnoreList` + `filterBindableCharacters`），
 * 不复用它的呈现。
 *
 * ── 它**不**写盘 ──
 * 弹窗只负责「问」：确认后把人物名交回调用方，由
 * `message-scoped-soul-binding.ts` 的 `beginMessageScopedSoulBinding` 写盘。
 * 这样写盘失败（灵魂被删 / 磁盘错误）的报错归调用方统一呈现，
 * 而「取消」这条路径从头到尾不产生任何写入。
 */
import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { filterBindableCharacters, readBindableIgnoreList } from "@/lib/novel/bindable-characters-filter"
import { listBindableNovelCharacters } from "@/lib/novel/character-aura"
import { describePortablePersonalityRisk, describeSoulBlastRadius } from "@/lib/novel/message-scoped-soul-binding"

interface SoulBindingTargetDialogProps {
  open: boolean
  projectPath: string
  /** 被引用的角色灵魂名（仅用于文案）。 */
  soulName: string
  /**
   * 这条灵魂是否带 `portablePersonality`。
   * 为真时必须把 fail-closed 的失败模式提前说清楚（风险 6）。
   */
  soulHasPortablePersonality: boolean
  onOpenChange: (open: boolean) => void
  /** 用户确认后交出**一个人物名**；取消走 `onOpenChange(false)`，不会调用本回调。 */
  onConfirm: (characterName: string) => void
}

export function SoulBindingTargetDialog({
  open,
  projectPath,
  soulName,
  soulHasPortablePersonality,
  onOpenChange,
  onConfirm,
}: SoulBindingTargetDialogProps) {
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<string>("")
  const [query, setQuery] = useState("")

  // 每次打开都重读：名单依赖 wiki 内容，弹窗开着的时候用户可能刚补了人物小传。
  useEffect(() => {
    if (!open) return
    setPicked("")
    setQuery("")
    setCandidates(null)
    let current = true
    void Promise.all([
      listBindableNovelCharacters(projectPath),
      // 读不到忽略表就当没有忽略项，绝不能因此挡住名单。
      readBindableIgnoreList(projectPath).catch(() => [] as string[]),
    ])
      .then(([names, ignored]) => {
        if (current) setCandidates(filterBindableCharacters(names, ignored))
      })
      .catch(() => {
        if (current) setCandidates([])
      })
    return () => {
      current = false
    }
  }, [open, projectPath])

  const loading = candidates === null
  const keyword = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const list = candidates ?? []
    return keyword ? list.filter((name) => name.toLowerCase().includes(keyword)) : list
  }, [candidates, keyword])

  const displaySoulName = soulName.trim() || "这条角色灵魂"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        纵向分配同 `BindingTargetDialog`：标题/说明/搜索/计数/页脚全部 shrink-0，
        只有名单区吸收剩余高度并自己滚动；对话框再兜一层 overflow-y-auto，
        窗口极矮时宁可它自己滚，也不让「确认」按钮跑到看不见的地方。
      */}
      <DialogContent
        data-testid="soul-binding-target-dialog"
        className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto sm:max-w-[720px]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>用「{displaySoulName}」的灵魂</DialogTitle>
        </DialogHeader>
        <p className="shrink-0 text-sm text-muted-foreground">
          这条引用只对<b>这一条消息</b>生效：发送前临时绑定，生成结束（含失败）后自动还原。
          请选择它作用在哪个小说人物上。
        </p>

        {soulHasPortablePersonality ? (
          <p className="shrink-0 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground" data-testid="soul-personality-risk">
            {describePortablePersonalityRisk()}
          </p>
        ) : null}

        <label className="flex shrink-0 items-center gap-2 rounded-md border px-2">
          <Search className="size-4 shrink-0 opacity-60" />
          <input
            aria-label="搜索小说人物"
            placeholder="搜索小说人物"
            value={query}
            className="h-9 w-full bg-transparent text-sm outline-none"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {!loading ? (
          <p className="shrink-0 text-xs text-muted-foreground">
            匹配 {visible.length} / 共 {candidates.length}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="soul-bindable-name-list">
          {loading ? (
            <p className="text-sm text-muted-foreground">正在读取小说人物…</p>
          ) : candidates.length === 0 ? (
            /*
             * 文案与 `character-aura.ts` 的 `CHARACTER_AURA_BINDING_BLOCK_MESSAGE` 逐字一致。
             * 这条不是「兜底」而是**主要**呈现点：没有可绑定人物时，用户在这里
             * 就该看到「先去补人物小传」这条可操作指引。
             */
            <p role="alert" className="text-sm">请先在大纲中添加人物小传或人物设定，再绑定角色灵魂</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有匹配「{query.trim()}」</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3" data-testid="soul-bindable-name-grid">
              {visible.map((name) => (
                <label key={name} className="flex min-w-0 items-center gap-1.5 py-1.5 text-sm">
                  <input
                    type="radio"
                    name="soul-binding-target"
                    checked={picked === name}
                    aria-label={`绑定到${name}`}
                    onChange={() => setPicked(name)}
                  />
                  <span className="truncate" title={name}>{name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/*
          影响范围（风险 7）：只有选定了人物才说 —— 这段文案里的名字必须是
          用户真正会绑上去的那个，否则就是在吓人或误导。
        */}
        {picked ? (
          <p className="shrink-0 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="soul-blast-radius">
            {describeSoulBlastRadius(picked)}
          </p>
        ) : null}

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            disabled={!picked}
            data-testid="soul-binding-confirm"
            onClick={() => onConfirm(picked)}
          >
            用这条灵魂生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
