import { useCallback, useEffect, useState } from "react"
import {
  loadStyleEvolutionState,
  saveStyleEvolutionState,
  subscribeStyleEvolution,
  type StyleEvolutionState,
} from "@/lib/novel/style-evolution-store"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 「文风自进化」开关面板。
 *
 * 刻意只有**一块说明 + 一个开关**。
 *
 * 之前这里还显示进度统计（还需 N 次打开、距上次分析、本轮阈值、当前基线）、
 * 上一轮结论、候选的启用/回滚按钮与轮次历史。按用户要求全部去掉：
 * 这一处只负责「开 / 关」，其余信息不该在文风库里再铺一遍。
 *
 * ⚠️ 去掉候选按钮**不影响**「改进后先给用户看再启用」这条要求：
 * 进化产出的候选会作为一份**普通的文风预设**写进文风库
 * （`sourceBook` 形如「我的文风 · 自动进化 · 第 N 轮」），
 * 就列在这个面板下方的画廊里，用户点那张卡片才启用。引擎从不自动启用。
 *
 * ⚠️ 订阅的是 `subscribeStyleEvolution`（本 store 自己的通道），不是 `dataVersion`：
 * 节律状态的写入刻意不进 `bumpDataVersion()`（见 store 文件头）——
 * 那会让写作统计、技能库、文风选择器整片重读，而这里的变化只是「打开日 +1」。
 */
export function StyleEvolutionPanel() {
  const projectPath = useWikiStore((state) => state.project?.path)
  const [enabled, setEnabled] = useState(false)

  const reload = useCallback(async () => {
    if (!projectPath) return
    const evolution: StyleEvolutionState = await loadStyleEvolutionState(projectPath)
    setEnabled(evolution.enabled)
  }, [projectPath])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    // 只认本项目的变化：订阅是进程级的，别的项目落盘不该刷这个面板。
    return subscribeStyleEvolution((changed) => {
      if (changed === projectPath) void reload()
    })
  }, [projectPath, reload])

  if (!projectPath) return null

  const toggle = async () => {
    /*
     * 基于刚读到的完整状态写回，而不是只传 `{ ...emptyState(), enabled }`：
     * 后者会把 `openDayCount` / `nextThreshold` / `rounds` / `probe` 一起抹掉，
     * 等于用户点一次开关就把攒了好几天的进度清零。
     */
    const current = await loadStyleEvolutionState(projectPath)
    await saveStyleEvolutionState(projectPath, { ...current, enabled: !current.enabled })
    await reload()
  }

  return (
    <div className="flex flex-col gap-3 p-4 text-sm" data-testid="style-evolution-panel">
      {/*
       * 标题行与说明**分行**，不放进同一个 flex 里。
       * 放同一行时（justify-between + 说明在左侧 div）说明会一路顶到右侧开关底下，
       * 长句挤成一堵墙——真机截图里看得很明显。分开后说明独占整行，读起来正常。
       */}
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-base font-medium">文风自进化</h3>
        {/*
         * 开关形态照「大语言模型」页里那一枚（`llm-provider-section.tsx` 的
         * Function Calling 开关）：**文字在左、滑块在右**，开关状态从文字读出来。
         *
         * ⚠️ 视觉规格与 `.model-switch`（`uitest/models/model-settings.css:43-45`）
         * 一致 —— 36×21 胶囊 + 15px 圆点 —— 但**刻意不复用那个类名**：
         * 那份 CSS 只被模型设置那几个视图 `import`，技能库这条 chunk 加载不到，
         * 复用会退化成一个裸 span（没有任何外观）。所以这里用 Tailwind 内联复刻。
         *
         * ⚠️ 颜色用 `bg-primary`：在 ui-test 皮肤下 `--primary = --ui-accent`
         * （见 `ui-test.css:76`），与模型页那枚开关同色，换皮肤时自动跟着走。
         * 圆点用 `bg-background`（= `--ui-paper`，近白），同样是皮肤变量。
         */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "关闭文风自进化" : "开启文风自进化"}
          title={enabled ? "关闭文风自进化" : "开启文风自进化"}
          data-testid="style-evolution-toggle"
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
         * 说明文字一律用**字符串字面量**，不写成裸 JSX 文本。
         *
         * ⚠️ JSX 会把文本中间的换行折叠成一个**空格**。中文句子在源码里换行，
         * 渲染出来就成了「才保留候选。 改进结果」这种句中多一个空格的样子
         * （真机截图放大后可见；这个缺陷在上一版就有，不是新引入的）。
         * 用 {"..."} 才能精确控制空格：该有的地方（「形成对应的文风 skill」）保留，
         * 不该有的地方（全角标点之后）一个都不留。
         */}
        <p>
          {
            "文风自进化会自动分析你前面所写章节的内容，提取并读取你平时的写作习惯、用词习惯，形成对应的文风 skill。"
          }
        </p>
        <p>
          {"开启后每次分析都会消耗 token。结果会作为一份新的文风预设出现在下面的文风库里，"}
          <span className="text-foreground">{"需要你点一下才会启用"}</span>
          {"——不会自动替换正在用的文风。"}
        </p>
      </div>
    </div>
  )
}
