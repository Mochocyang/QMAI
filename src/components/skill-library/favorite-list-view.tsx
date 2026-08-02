import { useState } from "react"
import { Star, Copy, Trash2, Search } from "lucide-react"
import { useFavoriteSkillStore } from "@/stores/favorite-skill-store"
import { useWikiStore } from "@/stores/wiki-store"
import { toast } from "@/lib/toast"
import type { FavoriteSkillEntry } from "@/lib/novel/skill-favorite"

export function FavoriteListView() {
  const favorites = useFavoriteSkillStore((s) => s.favorites)
  const loaded = useFavoriteSkillStore((s) => s.loaded)
  const removeFavorite = useFavoriteSkillStore((s) => s.removeFavorite)
  const copyToCurrentProject = useFavoriteSkillStore((s) => s.copyToCurrentProject)
  const project = useWikiStore((s) => s.project)
  const [searchQuery, setSearchQuery] = useState("")
  const [copyingId, setCopyingId] = useState<string | null>(null)

  // 按时间降序排序（最新收藏在前）
  const sortedFavorites = [...favorites].sort((a, b) => b.favoritedAt - a.favoritedAt)

  // 搜索过滤
  const filteredFavorites = searchQuery.trim()
    ? sortedFavorites.filter(
        (f) =>
          f.snapshot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.snapshot.description.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedFavorites

  async function handleCopy(favoriteId: string) {
    if (copyingId) return
    setCopyingId(favoriteId)
    try {
      const result = await copyToCurrentProject(favoriteId)
      if (!result.ok && result.reason === "duplicate-name") {
        toast.error("当前项目已存在同名技能，复制失败")
      }
    } finally {
      setCopyingId(null)
    }
  }

  async function handleRemove(favoriteId: string, name: string) {
    if (!confirm(`确定要删除收藏「${name}」吗？`)) return
    await removeFavorite(favoriteId)
    toast.success(`已删除收藏「${name}」`)
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  if (favorites.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Star className="h-12 w-12 opacity-30" />
        <p className="text-sm">暂无收藏的技能</p>
        <p className="text-xs">点击技能卡片上的星标按钮即可收藏</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 搜索栏 */}
      <div className="shrink-0 border-b px-4 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索收藏的技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* 收藏列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-3">
          {filteredFavorites.map((entry) => (
            <FavoriteCard
              key={entry.favoriteId}
              entry={entry}
              isCurrentProject={!!project && (project.path === entry.originProjectPath || entry.source === "built-in")}
              hasCurrentProject={!!project}
              copying={copyingId === entry.favoriteId}
              onCopy={() => handleCopy(entry.favoriteId)}
              onRemove={() => handleRemove(entry.favoriteId, entry.snapshot.name)}
            />
          ))}
        </div>
        {filteredFavorites.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            没有匹配的收藏
          </div>
        )}
      </div>
    </div>
  )
}

function FavoriteCard({
  entry,
  isCurrentProject,
  hasCurrentProject,
  copying,
  onCopy,
  onRemove,
}: {
  entry: FavoriteSkillEntry
  isCurrentProject: boolean
  hasCurrentProject: boolean
  copying: boolean
  onCopy: () => void
  onRemove: () => void
}) {
  const libraryLabel = entry.library === "writing" ? "写作" : "去AI味"
  const sourceLabel =
    entry.source === "built-in"
      ? "内置"
      : entry.source === "project"
      ? "项目"
      : entry.source === "uploaded"
      ? "上传"
      : entry.source === "linked"
      ? "链接"
      : "旧版"

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium">{entry.snapshot.name}</h3>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {libraryLabel}
            </span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {sourceLabel}
            </span>
          </div>
          {entry.snapshot.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {entry.snapshot.description}
            </p>
          )}
          <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
            {entry.snapshot.content}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            收藏于 {new Date(entry.favoritedAt).toLocaleString("zh-CN")}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          disabled={copying || isCurrentProject || !hasCurrentProject}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Copy className="h-3 w-3" />
          {isCurrentProject ? "已在当前项目" : copying ? "复制中..." : "复制到当前项目"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs transition-colors hover:bg-accent"
        >
          <Trash2 className="h-3 w-3" />
          删除
        </button>
      </div>
    </div>
  )
}
