/**
 * 新手引导的数据契约。
 *
 * 设计原则：**步骤是纯数据**，不写 JSX、不写副作用。
 * 覆盖层（`components/guide/guide-overlay.tsx`）只负责把数据渲染成高亮 + 卡片，
 * 「这一步要哪个界面配合」通过 `directive` / `prepare` 声明，由外壳去执行。
 *
 * 这样拆开的原因：
 *   · 步骤链可以**单独测**（步骤 id 唯一、锚点存在、章节顺序正确），不需要挂 React；
 *   · 新增一步只改数据文件，不动渲染逻辑；
 *   · 引导层与业务组件没有 import 关系，业务组件只在 DOM 上加一个
 *     `data-guide="…"` 属性，删掉引导也不会留下死代码。
 */

/** 引导阶段。用户可以从任意阶段单独重播（设置 → 新手引导）。 */
export type GuideChapterId =
  | "start"
  | "models"
  | "extras"
  | "create"
  | "outline"
  | "chapter"
  | "features"

export interface GuideChapter {
  id: GuideChapterId
  /** 阶段标题，显示在卡片顶部与设置页的「从这一步开始」。 */
  title: string
  /** 一句话说明这个阶段解决什么问题。 */
  summary: string
}

/**
 * 界面配合动作。
 *
 * ⚠️ 只声明「要什么」，不直接调 store。执行者是 `UiTestShell`：
 * 它同时持有 `showGlobalSettings` / `showCreateDialog` / `navigate()`，
 * 由它统一落地可以避免引导层反向依赖业务 store 造成循环引用。
 */
export type GuideDirective =
  | "open-settings"
  | "open-shelf"
  | "open-create-dialog"
  | "open-outline-view"
  | "open-chapter-view"
  | "load-demo-chapter"

/** 进入步骤前先把界面切到指定位置（与 directive 的区别：这是「就地切换」。） */
export interface GuidePreparation {
  /** 设置页左侧分类（CategoryId）。 */
  settingsCategory?: "model" | "novel" | "interface"
  /** 模型设置内部页签；`settings-view.tsx` 会读取 store 里的 `activeModelSettingsTab`。 */
  modelTab?: "default" | "llm" | "rerank" | "embedding"
  /** 主视图。 */
  view?: "sources" | "wiki"
}

export type GuidePlacement = "auto" | "top" | "bottom" | "left" | "right" | "center"

export interface GuideBullet {
  title: string
  text: string
}

export interface GuideStep {
  id: string
  chapter: GuideChapterId
  title: string
  /** 正文段落。支持 `**加粗**` 与 `代码`，由覆盖层做最小渲染。 */
  body: string[]
  /** 要点列表（用于并列说明，比长段落易读）。 */
  bullets?: GuideBullet[]
  /**
   * 高亮靶点：对应 DOM 上的 `data-guide="<anchor>"`。
   * 不给则卡片居中显示（纯讲解步骤，例如「每个模型分别用于什么」）。
   */
  anchor?: string
  /**
   * 候选靶点，按优先级排列（`anchor` 视作最后一档）。
   *
   * 用于「同一个动作在不同阶段落在不同元素上」：比如保存大纲，弹窗没开时
   * 该点消息下方那枚软盘按钮，弹窗开了就该点弹窗里的「确认保存」。
   * 覆盖层取**第一个真实存在、且没有被其他元素盖住**的候选：
   * 被弹窗压住的按钮不能挖洞 —— 洞挖在被压住的元素上，四周的遮罩会正好
   * 落在弹窗自己的按钮上，用户点不动（真机上踩过）。
   */
  anchors?: string[]
  /** 卡片相对靶点的位置；默认 auto（自动避让视口边缘）。 */
  placement?: GuidePlacement
  /** 高亮框在靶点外扩的像素。 */
  padding?: number
  /** 进入这一步时请求界面配合。 */
  directive?: GuideDirective
  /** 进入这一步时先做就地切换（设置分类 / 模型页签 / 视图）。 */
  prepare?: GuidePreparation
  /**
   * 需要用户真的点到靶点才前进。
   *
   * 用于「点设置」「点 DeepSeek」这类**必须亲手做一遍**的动作：
   * 只点「下一步」不会前进，遮罩下方的靶点区域保持可点击。
   * 不设则使用卡片右下角的「下一步」。
   */
  requireClick?: boolean
  /**
   * 不需要 `requireClick`（可以点「下一步」），但用户真的点到这些锚点时也算完成、直接前进。
   *
   * 用于「不止一个动作」的步骤：保存大纲要点两次（软盘 → 确认），
   * 只有第二次真正落盘，所以不强制点击，但点到了就自动往下走。
   */
  advanceOn?: string[]
  /** 允许在这一步「跳过本阶段」（阶段的第一、二步会显示）。 */
  chapterBreak?: boolean
}

export interface GuideDefinition {
  chapters: GuideChapter[]
  steps: GuideStep[]
}

/** 持久化快照。字段谨慎增删：旧版本的快照会被读进来。 */
export interface GuideSnapshot {
  status: "new" | "running" | "done" | "off"
  /** 当前步骤在 `GUIDE_DEFINITION.steps` 里的下标。 */
  stepIndex: number
  /** 用户显式跳过的阶段；重播某阶段时会从这里移除。 */
  skippedChapters: GuideChapterId[]
  /** 完成（或整体跳过）的时间戳，仅用于设置页显示「上次完成时间」。 */
  finishedAt?: number
}
