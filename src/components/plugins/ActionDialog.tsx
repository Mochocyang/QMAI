/**
 * 声明式 action 的执行对话框（设计 §4.4 的状态机）。
 *
 *   form → running → done | error
 *
 * 无表单的 action 直接从 `running` 起步（少一次无意义的点击）。
 *
 * ## 为什么"空列表"与"降级"必须渲染成两种东西
 *
 * 这是 B1 特意在 `output.ts` 里拆开的两条路径，混在一起就白拆了：
 *   - `{ kind: "list", items: [] }`：模型**遵守了格式**，只是这次没给出内容
 *     （例如它认为条件不足）。这是"结果为空"，用户该做的是**调整表单再试一次**，
 *     界面要显示空状态文案，而不是把一堆原始输出摊给用户。
 *   - `{ kind: "degraded", text, reason }`：模型**没有遵守格式**（加了编号、回了
 *     解释、返回空、JSON 坏了）。原文里可能藏着用户想要的内容，所以必须
 *     **原样展示 + 允许复制 + 说明为什么降级 + 给重试**。
 * 把两者都渲染成"没有结果"，用户就分不清是"我填得不对"还是"模型不听话"，
 * 作者也永远看不到自己提示词跑偏的信号。
 *
 * ## 为什么这里绝不渲染插件提供的 HTML
 *
 * 对话框展示的全是**模型输出**与**插件给的文案**（纯字符串）。任何一处改成
 * `dangerouslySetInnerHTML`，插件/模型就拿到了本 webview 的脚本执行权 ——
 * 那里同时躺着项目正文、模型密钥与用户凭据。所以 `markdown` 呈现方式也在
 * 这里退化成"纯文本 + 保留换行"，只为了可读，不引入渲染管线。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Copy, Loader2, RotateCcw, Square } from "lucide-react"
import { renameProject } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { initialFormValues, validateFormValues } from "@/lib/plugins/declarative/form"
import { pluginsApi } from "@/lib/plugins/api"
import type { ParsedOutput } from "@/lib/plugins/declarative/output"
import {
  MissingProjectPermissionError,
  isRunActionAborted,
  runDeclarativeAction,
  type RunActionDeps,
} from "@/lib/plugins/declarative/run"
import {
  isWritableProjectField,
  sanitizeBookTitle,
  targetAvailability,
  type TargetAvailability,
} from "@/lib/plugins/declarative/targets"
import type { ActionForm, ActionOutput, OutputTarget } from "@/lib/plugins/declarative/types"
import { syncPluginsProject } from "@/lib/plugins/project-sync"
import type { SlotActionEntry } from "@/lib/plugins/slots"
import { toast } from "@/lib/toast"
import { useWikiStore } from "@/stores/wiki-store"
import { SchemaForm } from "./SchemaForm"

/** 把解析结果写到某个目标（项目字段 / 光标处 / 剪贴板 / 章节备注）。 */
export type TargetApplier = (target: OutputTarget, parsed: ParsedOutput) => Promise<void>

export type ActionDialogPhase = "form" | "running" | "done" | "error"

/**
 * 失败的两条完全不同的路径（决定 UI 文案与"下一步该做什么"）。
 *
 * - `failed`：模型/网络/解析层面的失败 → 用户能做的是重试或改表单；
 * - `permission`：插件没获批 `fs:project-read` 却要读项目 → 模型**一次都没被调用**，
 *   重试没有意义，必须去插件中心重新启用并批准权限。
 * 两者混成一句「生成失败」，用户会一直在对话框里重试一个永远不可能成功的动作。
 */
export type ActionErrorKind = "failed" | "permission"

/** 读错误原因：Rust 与模型侧都倾向直接给中文原文，字符串优先。 */
export function describeRunError(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  if (cause === null || cause === undefined) return "生成失败，请重试。"
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

/**
 * 目标是否被阻塞，返回原因（可用时返回 `undefined`）。
 *
 * 这里只是 `targetAvailability`（纯函数，见 `declarative/targets.ts`）的**薄适配**，
 * 保留旧签名是为了既有调用点与守卫；判定规则只有一份，不允许在这个文件里另写一套。
 */
export function targetBlockedReason(
  target: OutputTarget,
  options: { editorAvailable?: boolean; projectAvailable?: boolean } = {},
): string | undefined {
  return targetAvailability(target, {
    hasEditor: Boolean(options.editorAvailable),
    hasProject: options.projectAvailable ?? true,
  }).reason
}

/** 结果文本：list 按行、text/degraded 原文。目标是"复制什么都说得清"。 */
export function resultToText(parsed: ParsedOutput): string {
  if (parsed.kind === "list") return parsed.items.join("\n")
  return parsed.text
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * 写项目字段：**目前只实现"书名"**（`rename_project`：项目目录名就是书名真源）。
 *
 * 其余字段（简介/标签/主角/设定）在宿主里**没有单一存储**，也没有写入命令。
 * 这里必须明确报错而不是"看起来成功了"：写失败被吞掉，用户会以为名字已经改了，
 * 直到某天发现目录名还是旧的。
 */
async function applyProjectField(target: OutputTarget, parsed: ParsedOutput): Promise<void> {
  if (!isWritableProjectField(target.field)) {
    throw new Error("宿主还没有该字段的写入通道：当前只能写入书名（bookTitle）。可以先用「复制」。")
  }

  const project = useWikiStore.getState().project
  if (!project) throw new Error("还没有打开项目：书名要写到项目目录上，先打开一本书。")

  const title = sanitizeBookTitle(resultToText(parsed))
  if (title === "") {
    throw new Error("生成结果里没有可用的书名（为空或只含非法字符），没有写入。")
  }

  // renameProject 失败时会把 Rust 的中文原文抛上来（重名、权限、非法字符…），
  // 由 ActionDialog 原样展示 —— 那是唯一准确的诊断信息。
  const renamed = await renameProject(project.path, title)
  useWikiStore.getState().setProject(renamed)

  /*
   * 改名会**移动整个项目目录**，于是所有已打开的文档路径都失效了。
   * 这里把当前文档关掉（清 selectedFile / fileContent）而不是让它继续指着旧路径：
   * 否则下一次自动保存会往一个已经不存在的位置写，用户看到的是"保存失败"甚至丢稿。
   * 用户重新从目录打开章节即可。
   */
  const wiki = useWikiStore.getState()
  wiki.setSelectedFile(null)
  wiki.setFileContent("")
  wiki.bumpDataVersion()

  // 项目根目录变了，插件宿主的"当前项目"必须跟着换（否则 /host/project/* 指向旧路径）。
  void syncPluginsProject(renamed.path)

  toast.success(`已把书名设为《${renamed.name}》，项目目录已改名，请重新打开章节。`)
}

/**
 * 默认的目标执行器。
 *
 * 已接通的通道：`clipboard`（一直有）、`project-field` + `bookTitle`（`rename_project`）。
 * 其余仍然明确报"宿主还没有这道通道"：
 *   - **不静默丢弃**用户刚生成的内容（那是最不能接受的失败方式）；
 *   - **也不假装成功**（写项目字段失败却弹"已保存"，用户要等几天后才发现）。
 * 界面上这些 target 会由 `targetAvailability` 判成禁用并给出 tooltip，
 * 所以正常使用根本点不到这里；这里的报错是兜底（例如插件在 `confirm` 流程里硬闯）。
 */
export const defaultTargetApplier: TargetApplier = async (target, parsed) => {
  if (target.kind === "clipboard") {
    const ok = await copyToClipboard(resultToText(parsed))
    if (ok) toast.success("已复制到剪贴板")
    else toast.error("复制失败：当前环境不允许访问剪贴板。")
    return
  }

  if (target.kind === "project-field") {
    await applyProjectField(target, parsed)
    return
  }

  // 注意：`hasProject/editorCanInsert` 这里不参与判定 —— 走到这一步说明 UI 已经放行，
  // 只可能是我方漏接。原因文案统一从 `targetAvailability` 取，避免两处口径漂移。
  const { reason } = targetAvailability(target, {
    hasEditor: false,
    hasProject: Boolean(useWikiStore.getState().project),
  })
  throw new Error(reason ?? `「${target.label}」还没有接入宿主写入通道，暂时不能用。可以先用「复制」。`)
}

/** 结果面板：按 `parsed.kind` 分成三种完全不同的呈现（见文件头注释）。 */
export function ResultPanel({
  parsed,
  presentation,
  onRetry,
}: {
  parsed: ParsedOutput
  presentation?: ActionOutput["presentation"]
  onRetry?: () => void
}) {
  if (parsed.kind === "degraded") {
    return (
      <div className="space-y-2" data-result-state="degraded">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">没能按预期格式解析模型输出</p>
            <p className="text-xs">原因：{parsed.reason}</p>
            <p className="text-xs">下面是模型返回的原文，可以手动挑用或整段复制。</p>
          </div>
        </div>
        <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
          {parsed.text}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void copyToClipboard(parsed.text).then((ok) => {
                if (ok) toast.success("已复制原文")
                else toast.error("复制失败：当前环境不允许访问剪贴板。")
              })
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            复制原文
          </Button>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" />
              重试
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (parsed.kind === "list") {
    if (parsed.items.length === 0) {
      return (
        <div
          className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
          data-result-state="empty"
        >
          模型没有给出结果，可以调整后重试。
        </div>
      )
    }
    if (presentation === "chips") {
      return (
        <div className="flex flex-wrap gap-2" data-result-state="list">
          {parsed.items.map((item, index) => (
            <button
              key={`${index}-${item}`}
              type="button"
              title="点击复制这一条"
              onClick={() => {
                void copyToClipboard(item).then((ok) => {
                  if (ok) toast.success("已复制这一条")
                })
              }}
              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs hover:bg-accent"
            >
              {item}
            </button>
          ))}
        </div>
      )
    }
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm" data-result-state="list">
        {parsed.items.map((item, index) => (
          <li key={`${index}-${item}`} className="break-words">
            {item}
          </li>
        ))}
      </ol>
    )
  }

  return (
    <pre
      className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap break-words"
      data-result-state="text"
    >
      {parsed.text}
    </pre>
  )
}

export interface ActionDialogProps {
  open: boolean
  entry: SlotActionEntry
  onClose: () => void
  deps: RunActionDeps
  onApplyTarget: TargetApplier
  /** 是否有活跃编辑器（决定 `insert-at-cursor` 是否可用）。 */
  editorAvailable?: boolean
  /**
   * 是否已打开项目（决定 `project-field` + `bookTitle` 是否可用）。
   *
   * 缺省 `true`：老调用方（插件中心、灵感库）都是在有项目的界面里挂的，
   * 缺省禁用会让本来可用的按钮突然变灰。真没项目时写入会给出可读错误，
   * 不会静默成功。
   */
  projectAvailable?: boolean
  /** 编辑器是否提供"插入"API（宿主当前还没有，见 `targetAvailability`）。 */
  editorCanInsert?: boolean
}

export function ActionDialog({
  open,
  entry,
  onClose,
  deps,
  onApplyTarget,
  editorAvailable = false,
  projectAvailable = true,
  editorCanInsert = false,
}: ActionDialogProps) {
  const action = entry.action
  /*
   * 把 `invokeTool` 绑到**当前这个插件的 id** 上：action 的 `prepare` 步骤
   * 只能调自己的工具（插件间隔离），所以 id 在这里闭包进去，不作为参数暴露。
   */
  // 当前 action 属于哪个插件 —— `prepare` 步骤只允许调它自己的工具
  const pluginIdForDeps = entry.pluginId

  const prepareDeps = useMemo(
    () =>
      pluginIdForDeps
        ? { ...deps, invokeTool: (toolName: string, args: Record<string, unknown>) => pluginsApi.invokeTool(pluginIdForDeps, toolName, args) }
        : deps,
    [deps, pluginIdForDeps],
  )

  const form: ActionForm = useMemo(() => action.form ?? { fields: [] }, [action])
  const hasForm = form.fields.length > 0

  const [phase, setPhase] = useState<ActionDialogPhase>("form")
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [streamText, setStreamText] = useState("")
  const [parsed, setParsed] = useState<ParsedOutput | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [errorText, setErrorText] = useState("")
  const [errorKind, setErrorKind] = useState<ActionErrorKind>("failed")
  const [applyError, setApplyError] = useState("")
  const [confirming, setConfirming] = useState<OutputTarget | null>(null)
  const [applying, setApplying] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  const startRun = useCallback(
    async (input: Record<string, unknown>) => {
      // 新一次运行前先掐掉上一次：否则旧请求的回调会往新结果里追加字。
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setPhase("running")
      setStreamText("")
      setParsed(null)
      setMissing([])
      setErrorText("")
      setErrorKind("failed")
      setApplyError("")
      setConfirming(null)

      try {
        const result = await runDeclarativeAction(
          action,
          entry.pluginId,
          // 权限跟着 entry 走：插槽索引从 plugins_list join 出来（见 declarative/api.ts）。
          entry.grantedPermissions,
          input,
          prepareDeps,
          (delta) => setStreamText((previous) => previous + delta),
          controller.signal,
        )
        if (controller.signal.aborted) return
        setParsed(result.parsed)
        setMissing(result.missing)
        setPhase("done")
      } catch (cause) {
        if (isRunActionAborted(cause) || controller.signal.aborted) {
          setErrorKind("failed")
          setErrorText("已停止生成。上面保留了停止前收到的内容，可以重试。")
        } else if (cause instanceof MissingProjectPermissionError) {
          /*
           * 权限问题不是"生成失败"：这一次一个模型请求都没发出去，重试也只会
           * 得到同一句话。文案（含"去插件中心停用后重新启用"的指引）来自
           * `run.ts`，这里只负责不让它被降级成笼统的失败提示。
           */
          setErrorKind("permission")
          setErrorText(describeRunError(cause))
        } else {
          setErrorKind("failed")
          setErrorText(describeRunError(cause))
        }
        setPhase("error")
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [action, deps, entry.pluginId],
  )

  // 打开 / 切换 action 时重置整台状态机。无表单 → 直接开始生成。
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      return
    }
    setValues(initialFormValues(form))
    setErrors({})
    setStreamText("")
    setParsed(null)
    setMissing([])
    setErrorText("")
    setErrorKind("failed")
    setApplyError("")
    setConfirming(null)
    if (hasForm) {
      setPhase("form")
      return
    }
    setPhase("running")
    void startRun({})
    // 依赖只放"这一次打开的是哪个 action"：form/startRun 的变化不该触发重置，
    // 否则用户填表途中一次无关的重渲染就会把表单清空。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry.pluginId, action.id])

  // 卸载时掐掉在飞的请求（对话框被父组件直接卸载的情况）。
  useEffect(() => () => abortRef.current?.abort(), [])

  function handleClose() {
    abortRef.current?.abort()
    onClose()
  }

  function submitForm() {
    const result = validateFormValues(form, values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    void startRun(result.values)
  }

  async function applyTarget(target: OutputTarget) {
    if (!parsed) return
    setApplying(true)
    setApplyError("")
    try {
      await onApplyTarget(target, parsed)
      setConfirming(null)
    } catch (cause) {
      setApplyError(describeRunError(cause))
    } finally {
      setApplying(false)
    }
  }

  function requestApply(target: OutputTarget) {
    // 覆盖类操作（`confirm: true`）必须二次确认：写项目字段会覆盖用户已有内容，
    // 而"生成结果"往往是灵感草稿，误点一次就丢一段正文。
    if (target.confirm) {
      setConfirming(target)
      return
    }
    void applyTarget(target)
  }

  const targets = action.output?.targets ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
    >
      <DialogContent className="max-w-xl" data-plugin-action-dialog={action.id}>
        <DialogHeader>
          <DialogTitle>{action.title}</DialogTitle>
          {action.description ? <DialogDescription>{action.description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-3">
          {phase === "form" ? (
            <SchemaForm form={form} values={values} errors={errors} onChange={setValues} />
          ) : null}

          {phase === "running" || (phase === "error" && streamText !== "") ? (
            <pre
              className="max-h-56 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap break-words"
              data-action-streaming="true"
            >
              {streamText === "" ? "正在生成…" : streamText}
            </pre>
          ) : null}

          {phase === "running" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在生成，可以随时停止。
            </div>
          ) : null}

          {phase === "error" ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
              data-action-error={errorKind}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                <p className="min-w-0 break-words">{errorText}</p>
                {errorKind === "permission" ? (
                  <p className="text-xs">授权后关掉这个对话框，再重新点一次这个动作即可。</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase === "done" && parsed ? (
            <>
              <ResultPanel
                parsed={parsed}
                presentation={action.output?.presentation}
                onRetry={hasForm ? () => setPhase("form") : () => void startRun(values)}
              />
              {missing.length > 0 ? (
                <p className="text-xs text-muted-foreground" data-action-missing={missing.join(",")}>
                  提示词里引用了但当前拿不到的数据：{missing.join("、")}（已按空值处理）
                </p>
              ) : null}
            </>
          ) : null}

          {applyError ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 break-words">{applyError}</p>
            </div>
          ) : null}

          {confirming ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              <p>
                「{confirming.label}」会覆盖已有内容，确定继续吗？
              </p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" disabled={applying} onClick={() => void applyTarget(confirming)}>
                  {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  确定
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={applying} onClick={() => setConfirming(null)}>
                  取消
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {phase === "running" ? (
            <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
              <Square className="h-3.5 w-3.5" />
              停止
            </Button>
          ) : null}

          {phase === "error" ? (
            <Button type="button" variant="outline" onClick={() => (hasForm ? setPhase("form") : void startRun(values))}>
              <RotateCcw className="h-3.5 w-3.5" />
              重试
            </Button>
          ) : null}

          {phase === "form" ? (
            <>
              <Button type="button" variant="outline" onClick={handleClose}>
                取消
              </Button>
              <Button type="button" onClick={submitForm}>
                生成
              </Button>
            </>
          ) : null}

          {phase === "done" && parsed
            ? targets.map((target) => {
                /*
                 * 不可用的 target **渲染成禁用按钮 + tooltip**，而不是不渲染：
                 * 用户至少能看到"这个插件想做什么"，作者也能看到宿主还缺哪道通道
                 * （理由详见 `declarative/targets.ts` 文件头）。
                 */
                const availability: TargetAvailability = targetAvailability(target, {
                  hasEditor: editorAvailable,
                  hasProject: projectAvailable,
                  editorCanInsert,
                })
                return (
                  <Button
                    key={`${target.kind}-${target.field ?? target.label}`}
                    type="button"
                    variant={target.kind === "clipboard" ? "outline" : "default"}
                    size="sm"
                    disabled={!availability.enabled || applying}
                    title={availability.enabled ? target.label : availability.reason ?? target.label}
                    onClick={() => requestApply(target)}
                  >
                    {target.label}
                  </Button>
                )
              })
            : null}

          {(phase === "done" || phase === "running") ? (
            <Button type="button" variant="ghost" onClick={handleClose}>
              关闭
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
