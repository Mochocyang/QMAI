/**
 * 「输出目标能否真的写回」的**纯判定**（设计 D2 / §4.4）。
 *
 * ## 为什么要有这个函数
 *
 * 插件的 `output.targets` 是第三方声明的，而宿主实际能写的通道只有两条半
 * （剪贴板、书名、以及将来才有的编辑器插入）。如果不把"能不能写"集中成一个
 * 纯函数，判定就会散落在 `ActionDialog` 的 JSX、`defaultTargetApplier` 的
 * `if` 链、以及将来 e2e 的断言里 —— 三处一旦漂移，就会出现"按钮看起来能点、
 * 点下去报错"或"按钮灰着但没人知道为什么"。
 *
 * ## 为什么未支持的 target 是**禁用**而不是隐藏
 *
 * 隐藏会让用户与作者都失去信号：
 *   - 用户：装了一个插件，看不到"设为简介"的按钮，会以为插件坏了 / 自己漏装了；
 *   - 作者：清单里写了 target，界面上一片空白，永远发现不了宿主还没这道通道。
 * 禁用 + tooltip 说明则是**诚实的可见性**：能力存在与否一眼可见，原因也写着。
 * 这也是本仓既有口径（`targetBlockedReason` 当初就是为此而生）。
 *
 * 本文件保持纯函数：不 import Tauri、不读 store、不碰 DOM —— 单测与 e2e 都能验。
 */
import type { OutputTarget } from "./types"

/** 判定某条 target 当前能否写回所需的宿主事实。 */
export interface TargetAvailabilityContext {
  /** 是否有活跃的章节编辑器（有才谈得上"光标处"）。 */
  hasEditor: boolean
  /** 是否已打开项目（书名写在项目目录上）。 */
  hasProject: boolean
  /**
   * 编辑器是否提供"在光标处插入"的写入 API。
   *
   * 缺省 `false`：宿主当前的编辑器（`WikiEditor`）只暴露 `getCurrentMarkdown()`，
   * 没有把"插入某段文本并落盘"的通道。这个字段是为了**将来**接上时不用改调用点
   * 的判定语义 —— 接上后由挂载点显式传 `true`，按钮立刻可用。
   */
  editorCanInsert?: boolean
}

export interface TargetAvailability {
  enabled: boolean
  /** 不可用/降级时的中文原因，直接用作按钮 tooltip。 */
  reason?: string
}

/** 项目里只有"书名"有真正的写入通道（`rename_project`：项目目录名就是书名真源）。 */
export const WRITABLE_PROJECT_FIELDS = ["bookTitle"] as const

/** 宿主已有写入通道的项目字段集合（判定与写回共用一份，避免两处结论漂移）。 */
export function isWritableProjectField(field: string | undefined): boolean {
  return typeof field === "string" && (WRITABLE_PROJECT_FIELDS as readonly string[]).includes(field)
}

/**
 * 判定一条 target 当前能否写回。
 *
 * 规则（与 `ActionDialog` 的按钮渲染、`defaultTargetApplier` 的实现必须一致）：
 *
 * | target | 条件 | 结论 |
 * |---|---|---|
 * | `clipboard` | 无 | 可用（宿主永远能复制） |
 * | `project-field` + `field: "bookTitle"` | `hasProject` | 可用 / 无项目时禁用 |
 * | `project-field` + 其它字段 | 恒不可用 | 宿主没有该字段的写入通道 |
 * | `insert-at-cursor` | `hasEditor && editorCanInsert` | 可用 / 否则禁用并说明缺什么 |
 * | `chapter-note` | 恒不可用 | 宿主还没有章节备注的存储 |
 * | `run-action` | 恒不可用 | 它不是"写回"，由内容包浏览器单独执行 |
 */
export function targetAvailability(
  target: OutputTarget,
  ctx: TargetAvailabilityContext,
): TargetAvailability {
  switch (target.kind) {
    case "clipboard":
      return { enabled: true }

    case "project-field": {
      if (!isWritableProjectField(target.field)) {
        return {
          enabled: false,
          reason: "宿主还没有该字段的写入通道：当前只能写入书名（bookTitle）。可以先用「复制」。",
        }
      }
      // 书名写在项目目录上（目录名就是书名真源），没有项目就没有写入对象。
      if (!ctx.hasProject) {
        return { enabled: false, reason: "还没有打开项目：书名要写到项目目录上，先打开一本书。" }
      }
      return { enabled: true }
    }

    case "insert-at-cursor": {
      if (!ctx.hasEditor) {
        return { enabled: false, reason: "需要先打开一个章节编辑器：这里没有可插入的光标位置。" }
      }
      if (!ctx.editorCanInsert) {
        return {
          enabled: false,
          reason: "宿主还没有编辑器的插入通道：现在只能读正文，不能把生成结果写回光标处。可以先用「复制」。",
        }
      }
      return { enabled: true }
    }

    case "chapter-note":
      return { enabled: false, reason: "宿主还没有章节备注的存储：这条结果不会被保存。可以先用「复制」。" }

    case "run-action":
      // 内容包条目专用（设计 §4.1），由 `ContentPackBrowser` 执行；它不是写回目标。
      return { enabled: false, reason: "「运行动作」不是写回目标，请在灵感库里对条目使用它。" }

    default:
      // 归一化阶段已按白名单丢弃未知 kind；能走到这里说明有人绕过了 `normalizeTargets`。
      return { enabled: false, reason: "不认识的输出目标，已禁用。" }
  }
}

/** Windows 文件名里不允许出现的字符：书名会变成目录名，必须挡在写入之前。 */
const ILLEGAL_PATH_CHARS = /[\\/:*?"<>|]/g

/**
 * 把模型给出的「书名」规整成可以当目录名的字符串。
 *
 * 为什么必须清洗：`rename_project` 的 `name` 直接成为项目**目录名**。带 `/` 会变成
 * 建子目录，带 `:` `*` `?` 在 Windows 上直接失败（而且错误信息对用户毫无意义）。
 * 这里只做"能不能落地"的清洗，不做文学性判断 —— 用户想叫《长夜》就叫《长夜》。
 */
export function sanitizeBookTitle(raw: string): string {
  const firstLine = String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "")
  if (!firstLine) return ""
  return firstLine
    // 常见书名包装：《》、「」、“” —— 它们只是排版，不是名字的一部分
    .replace(/^[《「“"']+/, "")
    .replace(/[》」”"']+$/, "")
    .replace(ILLEGAL_PATH_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
}
