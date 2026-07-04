import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { WORD_BUDGET_PRESETS, type SimulationMode, MODE_VISUAL_INFO } from "@/lib/novel/story-simulation/types"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import { cn } from "@/lib/utils"
import { Info } from "lucide-react"

const MODES: { mode: SimulationMode }[] = [
  { mode: "event-driven" },
  { mode: "free-emergence" },
  { mode: "decision-tree" },
  { mode: "hybrid" },
]

const CHAPTER_OPTIONS = [5, 10, 20, 30, 50]
const ROUND_OPTIONS = [
  { value: 0, label: "自动（按字数）" },
  { value: 2, label: "快速（2轮）" },
  { value: 3, label: "标准（3轮）" },
  { value: 5, label: "深度（5轮）" },
  { value: 8, label: "充分（8轮）" },
]

const WORD_LABEL_KEYS: Record<number, string> = {
  10000: "storySimulation.words10k",
  30000: "storySimulation.words30k",
  50000: "storySimulation.words50k",
}

interface SimulationConfigPanelProps {
  onStart: () => void
}

export function SimulationConfigPanel({ onStart }: SimulationConfigPanelProps) {
  const { t } = useTranslation()
  const mode = useStorySimulationStore((s) => s.mode)
  const userIdea = useStorySimulationStore((s) => s.userIdea)
  const targetWords = useStorySimulationStore((s) => s.targetWords)
  const sourceChapters = useStorySimulationStore((s) => s.sourceChapters)
  const simulationRounds = useStorySimulationStore((s) => s.simulationRounds)
  const directorEnabled = useStorySimulationStore((s) => s.directorEnabled)
  const setMode = useStorySimulationStore((s) => s.setMode)
  const setUserIdea = useStorySimulationStore((s) => s.setUserIdea)
  const setTargetWords = useStorySimulationStore((s) => s.setTargetWords)
  const setSourceChapters = useStorySimulationStore((s) => s.setSourceChapters)
  const setSimulationRounds = useStorySimulationStore((s) => s.setSimulationRounds)
  const setDirectorEnabled = useStorySimulationStore((s) => s.setDirectorEnabled)

  const selectedModeInfo = MODE_VISUAL_INFO[mode]

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      {/* 1. 仿真模式选择 */}
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          {t("storySimulation.selectMode")}
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {MODES.map((m) => {
            const info = MODE_VISUAL_INFO[m.mode]
            const isSelected = mode === m.mode
            return (
              <button
                key={m.mode}
                type="button"
                onClick={() => setMode(m.mode)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-all",
                  isSelected
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border hover:border-primary/50 hover:bg-accent/30"
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-medium">{info.name}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", info.color)}>
                    {info.freedomLabel}
                  </span>
                </div>
                <span className="text-xs leading-relaxed text-muted-foreground">{info.shortDesc}</span>
              </button>
            )
          })}
        </div>

        {/* 选中模式的详细说明 */}
        {selectedModeInfo && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="font-medium">{selectedModeInfo.name}模式</span>
              <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs", selectedModeInfo.color)}>
                推荐
              </span>
            </div>
            
            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-background p-2">
                <div className="text-muted-foreground">轮数</div>
                <div className="mt-0.5 font-medium">{selectedModeInfo.roundsLabel}</div>
              </div>
              <div className="rounded-md bg-background p-2">
                <div className="text-muted-foreground">随机性</div>
                <div className="mt-0.5 font-medium">{selectedModeInfo.randomnessLabel}</div>
              </div>
              <div className="rounded-md bg-background p-2">
                <div className="text-muted-foreground">自由度</div>
                <div className="mt-0.5 font-medium">{selectedModeInfo.freedomLabel}</div>
              </div>
            </div>

            <div className="mb-2">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">模式特点：</p>
              <ul className="space-y-1">
                {selectedModeInfo.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs">
                    <span className="text-primary">•</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md bg-primary/5 p-2 text-xs">
              <span className="font-medium text-primary">适用场景：</span>
              <span className="text-foreground/80"> {selectedModeInfo.bestFor}</span>
            </div>
          </div>
        )}
      </section>

      {/* 2. 用户思路 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("storySimulation.yourIdea")}</h3>
        <Textarea
          value={userIdea}
          onChange={(e) => setUserIdea(e.target.value)}
          placeholder={t("storySimulation.yourIdeaPlaceholder")}
          rows={4}
        />
      </section>

      {/* 3. 目标字数 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("storySimulation.targetWords")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {WORD_BUDGET_PRESETS.map((preset) => (
            <Button
              key={preset}
              variant={targetWords === preset ? "default" : "outline"}
              size="sm"
              onClick={() => setTargetWords(preset)}
            >
              {t(WORD_LABEL_KEYS[preset])}
            </Button>
          ))}
          <span className="text-sm text-muted-foreground">{t("storySimulation.wordsCustom")}</span>
          <Input
            type="number"
            className="w-28"
            value={targetWords}
            min={1}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val) && val > 0) {
                setTargetWords(val)
              }
            }}
          />
        </div>
      </section>

      {/* 4. 提取章节数量 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("storySimulation.sourceChapters")}</h3>
        <select
          value={sourceChapters}
          onChange={(e) => setSourceChapters(Number(e.target.value))}
          className="h-8 w-40 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {CHAPTER_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {t("storySimulation.recentChapters")} {n} {t("storySimulation.chapters")}
            </option>
          ))}
        </select>
      </section>

      {/* 5. 仿真轮次 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">仿真深度（每节点轮次）</h3>
        <div className="flex flex-wrap items-center gap-2">
          {ROUND_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={simulationRounds === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setSimulationRounds(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          轮次越多，角色互动越丰富，但消耗token越多。自动模式：1万字约1轮，至少2轮。
        </p>
      </section>

      {/* 6. 高级设置 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">高级设置</h3>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="director-enabled"
            checked={directorEnabled}
            onChange={(e) => setDirectorEnabled(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-input"
          />
          <label
            htmlFor="director-enabled"
            className="cursor-pointer text-sm font-medium"
          >
            启用导演 Agent
          </label>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          节点结束时自动评估剧情质量，张力不足时会在下一节点注入突发事件以提升戏剧性。（默认关闭）
        </p>
      </section>

      {/* 7. 开始按钮 */}
      <div className="flex justify-end pt-2">
        <Button onClick={onStart} size="lg">
          {t("storySimulation.startExtract")}
        </Button>
      </div>
    </div>
  )
}
