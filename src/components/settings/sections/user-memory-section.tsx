import { useEffect, useMemo, useState } from "react"
import { Download, Eraser, Pencil, Plus, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  addManualUserMemoryRule,
  clearGlobalUserMemoryConfig,
  GLOBAL_USER_MEMORY_CHANGED_EVENT,
  deleteUserMemoryRule,
  exportGlobalUserMemoryJson,
  getGlobalUserMemoryStats,
  loadGlobalUserMemoryConfig,
  saveGlobalUserMemoryConfig,
  setUserMemoryRuleEnabled,
  updateGlobalUserMemorySettings,
  updateUserMemoryRule,
} from "@/lib/user-memory/store"
import type { GlobalUserMemoryConfig, UserMemoryCategory, UserMemoryRule } from "@/lib/user-memory/types"
import { applyUserMemoryFeedback, governUserMemoryConfig } from "@/lib/user-memory/governance"
import { loadUserMemoryLearningBudget } from "@/lib/user-memory/learning-budget"

const CATEGORY_LABELS: Record<UserMemoryCategory, string> = {
  output_style: "输出表达",
  writing_preference: "写作偏好",
  outline_preference: "大纲偏好",
  workflow_preference: "流程偏好",
  interaction_preference: "交互偏好",
  format_preference: "格式要求",
  constraint: "禁止事项",
  manual: "手动规则",
}

interface EditorState {
  id: string | null
  rule: string
  category: UserMemoryCategory
}

function settingLabel(label: string, description: string, checked: boolean, onChange: (checked: boolean) => void) {
  return (
    <label className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4" />
    </label>
  )
}

export function UserMemorySection() {
  const [config, setConfig] = useState<GlobalUserMemoryConfig>(() => loadGlobalUserMemoryConfig())
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<UserMemoryCategory | "all">("all")
  const [editor, setEditor] = useState<EditorState | null>(null)

  useEffect(() => {
    const reload = () => setConfig(loadGlobalUserMemoryConfig())
    window.addEventListener(GLOBAL_USER_MEMORY_CHANGED_EVENT, reload)
    window.addEventListener("storage", reload)
    return () => {
      window.removeEventListener(GLOBAL_USER_MEMORY_CHANGED_EVENT, reload)
      window.removeEventListener("storage", reload)
    }
  }, [])

  const persist = (next: GlobalUserMemoryConfig) => {
    setConfig(next)
    saveGlobalUserMemoryConfig(next)
  }
  const updateSetting = (patch: Pick<Partial<GlobalUserMemoryConfig>, "enabled" | "autoLearn" | "autoRead" | "onlyManual">) => {
    persist(updateGlobalUserMemorySettings(config, patch))
  }
  const filtered = useMemo(() => config.rules.filter((rule) => (
    (category === "all" || rule.category === category)
    && (!query.trim() || `${rule.rule} ${rule.evidenceSummary}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  )), [category, config.rules, query])
  const stats = useMemo(() => getGlobalUserMemoryStats(config), [config])
  const learningBudget = loadUserMemoryLearningBudget(typeof window === "undefined" ? null : window.localStorage)

  const exportMemories = () => {
    const blob = new Blob([exportGlobalUserMemoryJson(config)], { type: "application/json;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `QMaiWrite-用户记忆-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const clearAll = () => {
    if (!window.confirm("确定清空全部用户记忆吗？此操作会删除自动规则、手动规则和学习记录，无法撤销。")) return
    clearGlobalUserMemoryConfig()
    setConfig(loadGlobalUserMemoryConfig())
  }

  const saveEditor = () => {
    if (!editor?.rule.trim()) return
    const next = editor.id
      ? updateUserMemoryRule(config, editor.id, { rule: editor.rule, category: editor.category })
      : addManualUserMemoryRule(config, { rule: editor.rule, category: editor.category, surfaces: ["all"] })
    persist(next)
    setEditor(null)
  }

  const remove = (rule: UserMemoryRule) => {
    if (!window.confirm(`删除用户记忆“${rule.rule}”？删除后，相同自动规则不会从原来源再次生成。`)) return
    persist(deleteUserMemoryRule(config, rule.id))
  }
  const feedback = (rule: UserMemoryRule, sentiment: "positive" | "negative") => {
    persist(governUserMemoryConfig(applyUserMemoryFeedback(config, [rule.id], sentiment)))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">全局用户记忆</h2>
      </div>

      <section className="border-y">
        {settingLabel("启用全局记忆", "关闭后不学习也不读取任何用户规则。", config.enabled, (enabled) => updateSetting({ enabled }))}
        {settingLabel("自动学习", "AI 请求成功后，只分析尚未处理的新用户消息。", config.autoLearn, (autoLearn) => updateSetting({ autoLearn }))}
        {settingLabel("自动读取", "发送 AI 请求前，按当前任务选择相关规则。", config.autoRead, (autoRead) => updateSetting({ autoRead }))}
        {settingLabel("仅使用手动记忆", "开启后停止自动提取，只读取用户手动添加的规则。", config.onlyManual, (onlyManual) => updateSetting({ onlyManual }))}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">用户规则</h3>
            <p className="text-xs text-muted-foreground">共 {config.rules.length} 条，自动提取规则和手动规则均可管理。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportMemories}>
              <Download className="mr-1 h-4 w-4" />导出记忆
            </Button>
            <Button variant="outline" size="sm" onClick={clearAll}>
              <Eraser className="mr-1 h-4 w-4" />清空全部
            </Button>
            <Button size="sm" onClick={() => setEditor({ id: null, rule: "", category: "manual" })}>
              <Plus className="mr-1 h-4 w-4" />新增规则
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          存储占用约 {(stats.estimatedBytes / 1024).toFixed(1)} KB / {(stats.maxStorageBytes / 1024).toFixed(0)} KB · 长期 {stats.activeRules} · 候选 {stats.candidateRules} · 冲突 {stats.conflictedRules}
        </p>
        <p className="text-xs text-muted-foreground">
          今日自动学习 {learningBudget.calls} / {config.dailyLearningLimit} 次 · 已分析 {learningBudget.inputChars.toLocaleString()} 字符
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
          <input aria-label="搜索用户记忆" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索规则" className="h-9 rounded-md border bg-background px-3 text-sm" />
          <select aria-label="筛选记忆分类" value={category} onChange={(event) => setCategory(event.target.value as UserMemoryCategory | "all")} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="all">全部分类</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="max-h-[52vh] overflow-y-auto border-y">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无符合条件的用户记忆。</p>
          ) : filtered.map((rule) => (
            <div key={rule.id} className="flex items-start gap-3 border-b py-3 last:border-b-0">
              <input aria-label={`启用 ${rule.rule}`} type="checkbox" checked={rule.enabled} onChange={(event) => persist(setUserMemoryRuleEnabled(config, rule.id, event.target.checked))} className="mt-1 h-4 w-4" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{rule.rule}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {CATEGORY_LABELS[rule.category]} · {rule.source === "manual" ? "用户添加" : `系统提取 · 置信度 ${Math.round(rule.confidence * 100)}%`} · {rule.scope === "session" ? "当前会话" : rule.scope === "project" ? "当前作品" : "全局"} · {rule.status === "candidate" ? "候选" : rule.status === "conflicted" ? "存在冲突" : rule.status === "expired" ? "已过期" : "长期有效"} · 已使用 {rule.usageCount ?? 0} 次
                </p>
                {rule.evidenceSummary && rule.source === "automatic" ? <p className="mt-1 text-xs text-muted-foreground">依据：{rule.evidenceSummary}</p> : null}
              </div>
              <Button variant="ghost" size="icon" title="标记此规则有效" onClick={() => feedback(rule, "positive")}><ThumbsUp className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="标记此规则无效" onClick={() => feedback(rule, "negative")}><ThumbsDown className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="编辑规则" onClick={() => setEditor({ id: rule.id, rule: rule.rule, category: rule.category })}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="删除规则" onClick={() => remove(rule)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[560px]">
          <DialogHeader><DialogTitle>{editor?.id ? "编辑用户规则" : "新增用户规则"}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-3">
            <label className="block space-y-1 text-sm">
              <span>规则内容</span>
              <textarea aria-label="规则内容" value={editor?.rule ?? ""} onChange={(event) => setEditor((current) => current ? { ...current, rule: event.target.value } : current)} rows={5} className="w-full resize-y rounded-md border bg-background p-3" placeholder="例如：回答时先给结论，再说明依据。" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>规则分类</span>
              <select aria-label="规则分类" value={editor?.category ?? "manual"} onChange={(event) => setEditor((current) => current ? { ...current, category: event.target.value as UserMemoryCategory } : current)} className="h-9 w-full rounded-md border bg-background px-2">
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>取消</Button>
            <Button disabled={!editor?.rule.trim()} onClick={saveEditor}>保存规则</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
