import { useCallback, useEffect, useState } from "react"
import {
  loadPersonaSkillEvolutionState,
  savePersonaSkillEvolutionState,
  subscribePersonaSkillEvolution,
  type PersonaSkillEvolutionState,
} from "@/lib/novel/persona-skill-evolution-store"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 「人物 Skill 自进化」开关面板。
 *
 * 结构与「文风自进化」面板（`style-evolution-panel.tsx`）刻意一致：
 * **只有一块说明 + 一个开关**，文字在左、滑块在右，不显示进度/历史/结果 ——
 * 那些是排错日志（`.qmai/persona-skill-evolution.log`）和轮次历史的事，
 * 不在技能库里再铺一遍。
 *
 * 挂载点在 `unified-skill-library-view` 的人物 Skill tab 顶部（同文风面板挂法）。
 *
 * ⚠️ 订阅 `subscribePersonaSkillEvolution`（本 store 自己的通道），不是 `dataVersion`：
 * 节律状态写入刻意不进 `bumpDataVersion()`（store 文件头）。
 */
export function PersonaSkillEvolutionPanel() {
  const projectPath = useWikiStore((state) => state.project?.path)
  const [enabled, setEnabled] = useState(false)

  const reload = useCallback(async () => {
    if (!projectPath) return
    const evolution: PersonaSkillEvolutionState = await loadPersonaSkillEvolutionState(projectPath)
    setEnabled(evolution.enabled)
  }, [projectPath])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    // 只认本项目的变化：订阅是进程级的，别的项目落盘不该刷这个面板。
    return subscribePersonaSkillEvolution((changed) => {
      if (changed === projectPath) void reload()
    })
  }, [projectPath, reload])

  if (!projectPath) return null

  const toggle = async () => {
    /*
     * 基于刚读到的完整状态写回，而不是只传 `{ ...emptyPersonaEvolutionState(), enabled }`：
     * 后者会把打开日节律与轮次历史一起抹掉，等于点一次开关就把进度清零。
     */
    const current = await loadPersonaSkillEvolutionState(projectPath)
    await savePersonaSkillEvolutionState(projectPath, { ...current, enabled: !current.enabled })
    await reload()
  }

  return (
    <div className="flex flex-col gap-3 p-4 text-sm" data-testid="persona-skill-evolution-panel">
      {/* 标题行与说明分行（同文风面板：放同一行时长说明会挤成一堵墙）。 */}
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-base font-medium">人物 Skill 自进化</h3>
        {/*
         * 开关形态与文风面板同一枚：role="switch" + aria-checked，文字在左、
         * 滑块在右；视觉用 Tailwind 内联复刻（`.model-switch` 类名在技能库
         * chunk 加载不到，复用会退化成裸 span —— 见文风面板的同款注释）。
         */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "关闭人物 Skill 自进化" : "开启人物 Skill 自进化"}
          title={enabled ? "关闭人物 Skill 自进化" : "开启人物 Skill 自进化"}
          data-testid="persona-skill-evolution-toggle"
          onClick={() => void toggle()}
          className="flex shrink-0 items-center gap-2"
        >
          <span
            className={`text-xs font-medium ${enabled ? "text-primary" : "text-muted-foreground"}`}
          >
            {enabled ? "已开启" : "已关闭"}
          </span>
          {/* 滑块本体对读屏隐藏：状态已经由外层 `role="switch"` + `aria-checked` 承载 */}
          <span
            aria-hidden="true"
            className={`relative inline-flex h-[21px] w-9 shrink-0 items-center rounded-full transition-colors ${
              enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-[15px] w-[15px] rounded-full bg-background transition-transform ${
                enabled ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </span>
        </button>
      </div>

      <div className="flex max-w-3xl flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
        {/*
         * 说明文字一律用字符串字面量：JSX 会把文本中间的换行折叠成空格，
         * 中文句子里多出一个空格很难看（同文风面板踩过的坑）。
         */}
        <p>
          {
            "人物 Skill 自进化采用达尔文式循环：每隔几个打开日，对现有档案先诊断问题、再生成改进候选，然后由三位独立评审把新旧档案与出场原文放在一起配对比较——只有多数评审认为新档案更好的时候才会替换，否则保持原样。"
          }
        </p>
        <p>
          {"每轮进化都会消耗 token；被替换掉的旧档案会存进该人物的"}
          <span className="text-foreground">{"历史版本"}</span>
          {"，随时可以回退。没有新的章节学习时不会空转。"}
        </p>
      </div>
    </div>
  )
}
