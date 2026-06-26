import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { WORD_BUDGET_PRESETS, type SimulationMode } from "@/lib/novel/story-simulation/types"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import { cn } from "@/lib/utils"

const MODES = [
  { mode: "event-driven" as SimulationMode, labelKey: "storySimulation.modeEventDriven", descKey: "storySimulation.modeEventDrivenDesc" },
  { mode: "free-emergence" as SimulationMode, labelKey: "storySimulation.modeFreeEmergence", descKey: "storySimulation.modeFreeEmergenceDesc" },
  { mode: "decision-tree" as SimulationMode, labelKey: "storySimulation.modeDecisionTree", descKey: "storySimulation.modeDecisionTreeDesc" },
  { mode: "hybrid" as SimulationMode, labelKey: "storySimulation.modeHybrid", descKey: "storySimulation.modeHybridDesc" },
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
  const setMode = useStorySimulationStore((s) => s.setMode)
  const setUserIdea = useStorySimulationStore((s) => s.setUserIdea)
  const setTargetWords = useStorySimulationStore((s) => s.setTargetWords)
  const setSourceChapters = useStorySimulationStore((s) => s.setSourceChapters)
  const setSimulationRounds = useStorySimulationStore((s) => s.setSimulationRounds)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      {/* 1. 仿真模式选择 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("storySimulation.selectMode")}</h3>
        <div className="grid grid-cols-2 gap-3">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              onClick={() => setMode(m.mode)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                mode === m.mode
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              )}
            >
              <span className="text-sm font-medium">{t(m.labelKey)}</span>
              <span className="text-xs text-muted-foreground">{t(m.descKey)}</span>
            </button>
          ))}
        </div>
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

      {/* 6. 开始按钮 */}
      <div className="flex justify-end pt-2">
        <Button onClick={onStart} size="lg">
          {t("storySimulation.startExtract")}
        </Button>
      </div>
    </div>
  )
}
