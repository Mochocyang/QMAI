import { useCallback, useEffect, useState, type FormEvent } from "react"
import { AlertTriangle, FolderOpen, Loader2, Puzzle, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ContentPackBrowser } from "@/components/plugins/ContentPackBrowser"
import { defaultTargetApplier } from "@/components/plugins/ActionDialog"
import { ConfigForm } from "@/components/plugins/ConfigForm"
import { SlotActions } from "@/components/plugins/SlotActions"
import { declarativePluginsApi, usePluginSlotIndex } from "@/lib/plugins/declarative/api"
import type { ContentPackItem, OutputTarget } from "@/lib/plugins/declarative/types"
import { pluginsApi } from "@/lib/plugins/api"
import { clearPluginProviderAuth } from "@/lib/plugins/provider-auth"
import { syncPluginProviders } from "@/lib/plugins/provider-sync"
import { syncPluginTools } from "@/lib/plugins/tool-sync"
import { syncPluginHooks } from "@/lib/plugins/hooks/runtime"
import type { PluginSummary } from "@/lib/plugins/types"
import { isTauri } from "@/lib/platform"
import { toast } from "@/lib/toast"

type ProcessState = PluginSummary["processState"]

/**
 * processState 的中文文案与颜色。
 *
 * 颜色不是装饰：运行中 / 异常退出 / 被安全停用必须一眼能分开，
 * 否则用户会把「插件崩了」误认为「我还没启用」。
 */
export const PROCESS_STATE_BADGES: Record<ProcessState, { label: string; className: string }> = {
  stopped: { label: "已停止", className: "border-border bg-muted text-muted-foreground" },
  /**
   * 纯声明式插件：**没有进程，但已生效**。
   *
   * 为什么不能用停止态的灰（`bg-muted` + `text-muted-foreground`）：这套界面里灰色
   * 固定表达"没跑起来"（未启用 / 被停用 / 崩了之后），用户看到灰徽章的第一反应是
   * 「启用没成功」，于是去点「启用」、重装甚至卸载一个本来工作正常的插件。
   * 这一档的真实语义是"不需要跑"，所以必须是一枚**正向**的颜色。
   *
   * 也刻意不用"运行中"的翠绿：它确实没有任何进程在跑，说成运行中是另一句假话，
   * 而且用户会去找一个并不存在的进程/端口。这里取蓝靛（indigo）—— 与运行中的绿、
   * 启动中的天蓝、异常退出的橙都能一眼分开，读作"已就绪的中性状态"。
   */
  declarative: {
    label: "声明式",
    className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  starting: {
    label: "启动中",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  running: {
    label: "运行中",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  failed: { label: "启动失败", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  crashed: {
    label: "异常退出",
    className: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  disabled_by_crash: {
    label: "已停用·异常退出",
    className: "border-destructive/40 bg-destructive/15 text-destructive",
  },
}

/** 已知权限给出可读说明，未知值仍保留原始标识，避免吞掉后端新增的权限。 */
const PERMISSION_LABELS: Record<string, string> = {
  "fs:project-read": "读取项目文件",
  "fs:project-write": "写入项目文件",
  // 读书架**概要**（书名/简介/章节数/少量正文采样），不是当前打开的这一本。
  "fs:shelf-read": "读取书架上的书籍概要",
  "net:https": "访问网络",
  "net:listen": "在本机开一个端口（供 QMAI 调用它）",
    "net:credential-vault": "保存并读取登录凭证",
    "net:login-window": "关闭登录窗口",
  "llm:use": "调用模型",
  "data:write": "写入插件数据",
}

/** 插件名可能为空：此时退回稳定的 id，至少让用户知道卸载的是哪一个。 */
function pluginDisplayName(plugin: PluginSummary): string {
  return plugin.name.trim() || plugin.id
}

/**
 * 该插件是否声明了配置项（决定要不要显示「设置」）。
 *
 * 判据是清单的**静态声明面** `preview.hasConfig`（设计 §8：免执行发现），
 * 而不是"读一次配置看有没有键" —— 没配过就是空对象，那样这个入口永远不出现。
 * 形状不认识时一律当作"没有配置"：多显示一个点了会报错的按钮，比少显示更糟。
 */
export function hasPluginConfig(plugin: Pick<PluginSummary, "preview">): boolean {
  return previewField(plugin, "hasConfig") === true
}

/**
 * 从静态声明面取 `configSchema`（设置表单的字段来源）。
 *
 * 与 `hasConfig` 同一处取：两者都来自清单，分别"看不看得见入口"与"里面画什么"。
 * 缺 schema 时返回 `undefined`，由 `ConfigForm` 显示「该插件没有可配置项」。
 */
export function previewConfigSchema(plugin: Pick<PluginSummary, "preview">): unknown {
  return previewField(plugin, "configSchema")
}

/** 只在 `preview` 是真对象时取字段；数组/null/字符串一律当"没有"。 */
function previewField(plugin: Pick<PluginSummary, "preview">, key: string): unknown {
  const preview = plugin.preview
  if (typeof preview !== "object" || preview === null || Array.isArray(preview)) return undefined
  return (preview as Record<string, unknown>)[key]
}

/** 启用确认弹窗的档位，见 `enableConfirmTone`。 */
export type EnableConfirmTone = "provider" | "default" | "declarative"

/**
 * 启用确认弹窗里那段警示文案该用哪一档。
 *
 * 三档按"能力越强、警示越重"排：
 *   - `provider`：会成为模型供应商，用户与模型的完整对话都经过它（设计 §7 的最高危档）；
 *   - `declarative`：清单只有一个配置面 / 界面声明，不跑代码不起进程 —— 按"独立进程
 *     运行、可读项目文件、可联网"去吓唬它，用户只会觉得软件在乱报警，进而对所有
 *     警示失去反应；
 *   - `default`：有工具等其它能力，但既不接管对话也非纯声明，用中间的琥珀档。
 *
 * 判据全部取自 `plugins_list` 的字段（前端不解析清单，避免双份真源）：
 * `providerIds` 为空**且** `toolCount === 0` 才算纯声明式。缺字段（`undefined`）
 * 一律按 0 处理 —— 保守方向的错误是"多一句普通警示"，不是"漏掉高危警示"，
 * 因为 provider 档先判。
 */
export function enableConfirmTone(
  plugin: Pick<PluginSummary, "providerIds" | "toolCount">,
): EnableConfirmTone {
  if ((plugin.providerIds?.length ?? 0) > 0) return "provider"
  if (!(plugin.toolCount > 0)) return "declarative"
  return "default"
}

/**
 * 读取 Tauri 命令失败原因。
 *
 * Rust 命令返回的是可直接展示的中文 `String`；Tauri 也可能把它包成 Error，
 * 因此字符串优先，其次 Error.message，最后才退化成一句通用提示。
 */
function describeError(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  if (cause === null || cause === undefined) return "操作失败，请重试。"
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

/**
 * 插件管理区的 props。
 *
 * 单独抽成具名类型（而不是内联在参数上）是为了让 `.ts` 里的测试能写
 * `createElement<PluginSectionProps>(PluginSection, ...)`：组件的参数带默认值
 * `= {}`，不显式给类型参数时 `createElement` 推不出 props，tsc 会落到最后一个重载上报错。
 */
export type PluginSectionProps = { hideInstallForm?: boolean }

/**
 * 插件管理区：设置 → 插件 与「插件」页的「已安装」tab 共用这一份实现。
 *
 * `hideInstallForm`：关掉本组件自带的「从 GitHub 安装 / 从本地目录安装」区块。
 *
 * 为什么需要它：「插件」页右上角已经有「手动安装」弹窗，做的是**同一件事**
 * （粘贴 GitHub 地址 / 选本地目录）。两个入口并排出现在同一块屏幕上，
 * 用户会以为是两件不同的事（"一个装市场外的、一个装本机的？"），于是要么两边
 * 各点一遍，要么干脆都不敢点。所以那一页把自带的这份收起来，只留页头的入口。
 *
 * 默认 `false`：设置 → 插件 里该区块照旧渲染，行为与加这个 prop 之前逐字一致
 * （既有的挂载用例、以及设置页的其它用例都不该因为这个参数而变）。
 */
export function PluginSection({ hideInstallForm = false }: PluginSectionProps = {}) {
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [source, setSource] = useState("")
  const [installing, setInstalling] = useState(false)
  const [installingLocal, setInstallingLocal] = useState(false)
  /**
   * 单卡片进行中的启停/卸载/重试。`kind` 决定按钮上的转圈文案。
   *
   * `"enable"` 是崩溃卡片的「重新启用」：它和普通「启用」走同一个 Rust 命令，
   * 但入口不同（不动 `enabled` 语义，见 `retryPlugin`），所以单列一档。
   */
  const [busy, setBusy] = useState<{
    id: string
    kind: "disable" | "uninstall" | "enable"
  } | null>(null)
  /**
   * 「重新启用」失败的原因，按插件 id 就地展示。
   *
   * 为什么不复用页面顶部的 `actionError`：那个错误条在安装表单下方，用户在列表
   * 中段点「重新启用」失败时根本看不到它，会以为按钮没反应。而且这里的错误必须
   * 和崩溃原因（`lastError`）同时可见 —— 一个是"上次为什么崩"，一个是"这次为什么
   * 还是起不来"，分开放反而要用户自己拼。
   */
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null)
  const [enableTarget, setEnableTarget] = useState<PluginSummary | null>(null)
  const [enabling, setEnabling] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)
  /**
   * 声明式插件的界面能力（`plugin-center` 插槽）。
   *
   * 这一区与下面的「已安装插件」列表**数据来源不同**：列表读 `plugins_list`
   * （进程/权限视角），能力读 `plugins_actions` / `plugins_content_packs`
   * （声明式视角）。两者故意分开渲染：一个纯声明式插件不启动进程，
   * 在列表里永远显示"已停止"，能力却完全可用 —— 混在一起会让用户以为它没生效。
   */
  const pluginSlots = usePluginSlotIndex()
  const [packBrowserOpen, setPackBrowserOpen] = useState(false)
  /** 正在配置的插件（非空时打开配置对话框）。 */
  const [configTarget, setConfigTarget] = useState<PluginSummary | null>(null)
  const centerSlot = pluginSlots.index["plugin-center"]
  const hasCenterAbilities = centerSlot.actions.length > 0 || centerSlot.packs.length > 0

  const refresh = useCallback(async () => {
    try {
      const items = await pluginsApi.list()
      setPlugins(items)
      setLoadError(null)
    } catch (cause) {
      setLoadError(describeError(cause))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void pluginsApi.list()
      .then((items) => {
        if (cancelled) return
        setPlugins(items)
        setLoadError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(describeError(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    setLoading(true)
    await refresh()
    setLoading(false)
  }

  async function installPlugin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = source.trim()
    if (!trimmed || installing) return
    setInstalling(true)
    setActionError(null)
    try {
      const installed = await pluginsApi.install(trimmed)
      setSource("")
      toast.success(`已安装「${pluginDisplayName(installed)}」`)
      await refresh()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setInstalling(false)
    }
  }

  /**
   * 从本地目录安装插件。
   *
   * 目录选择沿用项目已有的 `@tauri-apps/plugin-dialog`（和 cloud-sync-section 同款），
   * 不引入拖拽：拖拽要接管 webview 的 drag-drop 事件，会干扰编辑器里的文件拖放。
   * 浏览器预览里拿不到真实绝对路径（`showDirectoryPicker` 只给目录名），
   * 所以这里只支持桌面端，并明确告诉用户原因。
   */
  async function installLocalPlugin() {
    if (installing || installingLocal) return
    if (!isTauri()) {
      setActionError("需要在桌面应用里选择插件目录。")
      return
    }
    // 先弹目录选择器：用户取消不是错误，不该留下错误条或让按钮一直转圈
    let picked: unknown = null
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      picked = await open({
        directory: true,
        multiple: false,
        title: "选择插件目录（根目录下需有 plugin.json）",
      })
    } catch (cause) {
      setActionError(describeError(cause))
      return
    }
    if (typeof picked !== "string") return

    setInstallingLocal(true)
    setActionError(null)
    try {
      const installed = await pluginsApi.installLocal(picked)
      toast.success(`已安装「${pluginDisplayName(installed)}」`)
      await refresh()
    } catch (cause) {
      // Rust 侧的中文文案原样展示（缺 plugin.json、清单错误码、已安装等），
      // 不再包一层「安装失败」，否则作者看不出该改哪里。
      setActionError(describeError(cause))
    } finally {
      setInstallingLocal(false)
    }
  }

  function openEnableDialog(plugin: PluginSummary) {
    setEnableError(null)
    setEnableTarget(plugin)
  }

  /**
   * 启停/卸载后把插件 provider 重新同步进 `providerConfigs`，并同步工具描述符。
   *
   * 为什么失败只 warn：插件确实已经启停成功，只是模型列表没刷新。把整条操作
   * 报成失败会让用户以为插件没停掉，反而去做更激进的操作（卸载/重装）。
   * 设置页模型卡片上的「刷新模型」是补救入口。
   *
   * 工具同步与 provider 同步并列（不是二选一）：一个纯工具插件根本不贡献 provider，
   * 不同步工具就等于「启用成功但模型永远看不到它」。
   */
  async function resyncPluginProviders(action: string) {
    try {
      await syncPluginProviders()
    } catch (cause) {
      console.warn(`[plugins] 插件${action}后同步 provider 失败：`, cause)
    }
    // 独立 try：provider 同步失败不能连带跳过工具同步（反之 syncPluginTools 内部自己吞错）。
    try {
      await syncPluginTools()
    } catch (cause) {
      console.warn(`[plugins] 插件${action}后同步工具失败：`, cause)
    }
    /*
     * 钩子清单也要跟着启停刷新：它是模块级缓存，启停/卸载后不刷新就等于
     * "插件停了，钩子还在拦每一次请求"（或者反过来，装了却不生效）。
     * `syncPluginHooks` 内部自己吞错并保留旧缓存，所以这里不必再包一层。
     */
    try {
      await syncPluginHooks()
    } catch (cause) {
      console.warn(`[plugins] 插件${action}后同步钩子失败：`, cause)
    }
  }

  /**
   * 「用这条灵感」的统一落点。
   *
   * 复用对话框的目标执行器：`clipboard` 已实现，写项目字段/插入正文会给出
   * 「还没接线」的可读原因。写回语义只有一处实现，否则会出现"灵感库能复制、
   * 生成结果不能复制"这种说不清的不一致。
   */
  const applyPackItem = useCallback(async (item: ContentPackItem, target: OutputTarget) => {
    await defaultTargetApplier(target, { kind: "text", text: item.body })
  }, [])

  const loadPackItems = useCallback(
    (packId: string) => declarativePluginsApi.contentPackItems(packId),
    [],
  )

  async function confirmEnable() {
    if (!enableTarget || enabling) return
    const target = enableTarget
    setEnabling(true)
    setEnableError(null)
    try {
      /*
       * 本期是「整包授予 + 明确展示」，不做逐项开关。
       *
       * 为什么不逐项勾选：勾选界面要回答「拒绝某一项之后这个插件还能怎么跑」，
       * 而权限之间是耦合的（拒了 `fs:project-read`，用 `{{chapter.*}}` 的动作就
       * 只剩半条命）。与其给一个看起来更精细、实际导出「半坏插件」的界面，
       * 不如把「申请了什么」摆清楚、一次给足。
       *
       * 但**必须让用户先看见**：`declaredPermissions` 就是清单 `permissions` 的原文，
       * 也正是在确认层里列出的那一份 —— 授予的内容与展示的内容同源，不靠猜。
       */
      const granted = target.declaredPermissions ?? []
      await pluginsApi.enable(target.id, granted)
      toast.success(`已启用「${pluginDisplayName(target)}」`)
      // 启用成功后立刻同步：provider 插件刚注册进 Rust 表，模型要能被选到。
      await resyncPluginProviders("启用")
      setEnableTarget(null)
      await refresh()
    } catch (cause) {
      setEnableError(describeError(cause))
    } finally {
      setEnabling(false)
    }
  }

  /**
   * 崩溃后的「重新启用」：卡片上的独立入口。
   *
   * 为什么不能复用「启用」按钮：插件崩溃时 Rust **有意保留 `enabled = true`**
   * （只清运行态并记崩溃报告），所以卡片显示的是「停用」。用户想重试就得先停用
   * 再启用 —— 而停用会清掉 `lastError`，等于"想看原因就得先把它擦掉"。
   * 这里直接调 `plugins_enable`（它天然幂等：覆盖 enabled/permissions 后再启动），
   * 后端语义一行不改。
   *
   * 权限必须原样带上已授予的那份：`plugins_enable` 把 `granted` **整体覆盖**进
   * 注册表，传 `[]` 等于「重试一次就把权限抹了」，插件会从"崩了"变成"崩了且没权限"。
   * 兜底：老数据里 `grantedPermissions` 可能是空的（本次修复之前启用的插件），
   * 此时退回清单里申请的 `declaredPermissions` —— 它本来就是要生效的那份。
   */
  async function retryPlugin(plugin: PluginSummary) {
    if (busy) return
    const granted =
      plugin.grantedPermissions.length > 0
        ? plugin.grantedPermissions
        : (plugin.declaredPermissions ?? [])
    setBusy({ id: plugin.id, kind: "enable" })
    setRetryError(null)
    try {
      await pluginsApi.enable(plugin.id, granted)
      toast.success(`已重新启用「${pluginDisplayName(plugin)}」`)
      // 与普通启用同一套副作用：provider/工具/钩子清单都要跟着刷新。
      await resyncPluginProviders("重新启用")
      await refresh()
    } catch (cause) {
      // 不清 `lastError`：崩溃原因由后端给，只有重启成功（refresh 拿到新状态）
      // 之后才会消失。失败时两条信息要并排可见。
      setRetryError({ id: plugin.id, message: describeError(cause) })
    } finally {
      setBusy(null)
    }
  }

  async function disablePlugin(plugin: PluginSummary) {
    if (busy) return
    setBusy({ id: plugin.id, kind: "disable" })
    setActionError(null)
    // 「重新启用」失败的那段说明跟着卡片状态一起作废：插件已经停了，
    // 把它留在「已停止」下面只会让人以为停用也失败了。
    setRetryError(null)
    try {
      await pluginsApi.disable(plugin.id)
      // provider token 只活在本进程缓存里（不落盘，见 v2.0 计划第 0 节）。
      // 插件停了就清掉：否则后续请求会带着已失效的 token 打到已经关闭的端口上。
      // 这里清全部而不是按 providerId 清：一个插件可能声明多个 provider，而
      // 手头只有 pluginId（providerId 可以不同名），清全部最省事且不会漏。
      clearPluginProviderAuth()
      toast.success(`已停用「${pluginDisplayName(plugin)}」`)
      // 停用后该 provider 会从 providers() 消失，同步负责把配置条目也摘掉，
      // 否则模型选择器里会留下一个指向已关闭端口的条目（设计 §7 第 4 条）。
      await resyncPluginProviders("停用")
      await refresh()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  async function uninstallPlugin(plugin: PluginSummary) {
    if (busy) return
    const name = pluginDisplayName(plugin)
    /*
     * 默认保留插件私有数据：卸载经常只是重装/升级前的动作，删数据不可逆。
     * 第一期没有「同时删除数据」的勾选项，所以 deleteData 固定传 false。
     */
    if (!window.confirm(`确定卸载「${name}」吗？插件自己的数据会保留。`)) return
    setBusy({ id: plugin.id, kind: "uninstall" })
    setActionError(null)
    setRetryError(null)
    try {
      await pluginsApi.uninstall(plugin.id, false)
      // 卸载同样要清 provider token 缓存（理由同 disablePlugin）。
      clearPluginProviderAuth()
      toast.success(`已卸载「${name}」`)
      await resyncPluginProviders("卸载")
      await refresh()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  /*
   * 「这个插件是否声明了 provider」由 Rust 侧的 `plugins_list` 给出（`providerIds`，
   * 读的是插件清单的 `contributes.providers[].id`）。
   * 前端不能靠权限位或名字猜：猜错要么把高危确认降级成普通提示，
   * 要么反过来对纯工具插件吓唬用户。
   */
  const enableProviderIds = enableTarget?.providerIds ?? []
  const enableDeclaresProvider = enableProviderIds.length > 0
  /**
   * 该插件申请的权限（清单 `permissions` 原文）。
   *
   * 确认层展示的就是这份，`confirmEnable` 授予的也是这份 —— 同源，不另算一遍，
   * 否则「看到的」和「给出去的」迟早会漂移。
   */
  const enableDeclaredPermissions = enableTarget?.declaredPermissions ?? []
  /** 确认层档位（见 `enableConfirmTone`）；写在同一处，避免文案与判据各算一遍。 */
  const enableTone: EnableConfirmTone | null = enableTarget ? enableConfirmTone(enableTarget) : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">插件</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          安装和管理第三方作者编写的扩展能力。安装后不会自动运行，需要手动启用。
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-900 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          插件是第三方作者写的程序。带工具或模型能力的插件装进来后会以独立进程运行，可以读取项目文件、访问网络；只提供声明（生成器、灵感包）的插件不执行任何代码、也不启动进程。请只安装你信任的仓库。内置随软件更新的能力不属于插件。
        </p>
      </div>

      {/*
        安装区块（GitHub 地址输入 + 两个按钮 + 说明）。`hideInstallForm` 时整块不渲染。

        为什么"不渲染"而不是 display:none：留着空壳会让 `#plugin-install-source`
        这类可聚焦的输入框仍然在 DOM 里（无障碍树、自动化脚本、截图都能碰到），
        等于把"两个入口"的问题从视觉藏到了别处。

        ⚠️ 外层的 `&& !actionError`：隐藏时若没有任何错误，整个 `<div>` 也不该留下 ——
        父级 `space-y-6` 会给一个空块也加上 24px 间距，安全提示与「插件能力」之间
        会凭空多出一段空白。默认（不传 prop）时这段结构**逐字不变**。
      */}
      {hideInstallForm && !actionError ? null : (
        <div className="space-y-2">
          {hideInstallForm ? null : (
            <>
              <Label htmlFor="plugin-install-source">从 GitHub 安装</Label>
              <form onSubmit={(event) => void installPlugin(event)} className="flex gap-2">
                <Input
                  id="plugin-install-source"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="https://github.com/owner/repo"
                  disabled={installing || installingLocal}
                  className="min-w-0 flex-1"
                />
                <Button type="submit" disabled={installing || installingLocal || source.trim() === ""}>
                  {installing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {installing ? "安装中…" : "安装"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={installing || installingLocal}
                  onClick={() => void installLocalPlugin()}
                  title="用于安装你本机正在开发的插件目录。目录根下需要有 plugin.json。"
                >
                  {installingLocal ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FolderOpen className="mr-2 h-4 w-4" />
                  )}
                  {installingLocal ? "安装中…" : "从本地目录安装"}
                </Button>
              </form>
              <p className="text-xs leading-relaxed text-muted-foreground">
                用于安装你本机正在开发的插件目录。目录根下需要有 plugin.json。
              </p>
            </>
          )}
          {/*
            失败提示条**不**跟着 `hideInstallForm` 一起隐藏：`actionError` 不只承载安装
            失败，停用 / 卸载失败也写在这条上。入口藏起来的同时把它一并藏掉，用户点了
            「卸载」失败后屏幕上一片安静 —— 那比多一个重复入口糟得多。
            此刻它不可能来自安装（表单没渲染，装不了），剩下的正好是启停 / 卸载这一类。
          */}
          {actionError ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 break-words">{actionError}</p>
            </div>
          ) : null}
        </div>
      )}

      {/*
        插件能力区（`plugin-center` 插槽）。
        这里只渲染**宿主组件**：按钮（SlotActions）与内容包浏览面板
        （ContentPackBrowser）。插件能控制的只有标题、提示词与条目文本，
        拿不到任何标记/脚本执行权（见 lib/plugins/slots.ts 文件头）。
      */}
      <div className="space-y-3" data-plugin-abilities="true">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">插件能力</h3>
          {pluginSlots.degraded ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => pluginSlots.reload()}>
              重新读取
            </Button>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          声明式插件不启动进程：它声明的按钮与灵感库会直接出现在界面里，由软件渲染。
        </p>

        {pluginSlots.loading ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-4 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取插件能力…
          </div>
        ) : hasCenterAbilities ? (
          <div className="space-y-3">
            {centerSlot.actions.length > 0 ? <SlotActions entries={centerSlot.actions} variant="toolbar" /> : null}
            {centerSlot.packs.length > 0 ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPackBrowserOpen((open) => !open)}
                  aria-expanded={packBrowserOpen}
                >
                  {packBrowserOpen ? "收起灵感库" : `打开灵感库（${centerSlot.packs.length}）`}
                </Button>
                {packBrowserOpen ? (
                  <ContentPackBrowser
                    packs={centerSlot.packs}
                    loadItems={loadPackItems}
                    onUse={applyPackItem}
                    actions={centerSlot.actions}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className="rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground"
            data-plugin-abilities="empty"
          >
            {pluginSlots.degraded
              ? "暂时读不到插件能力清单：相关命令还没有就绪，其余插件功能不受影响。"
              : "还没有插件声明界面能力。安装带 actions / contentPacks 的插件后会出现在这里。"}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">已安装插件</h3>
          {!loading && plugins.length > 0 ? (
            <span className="text-xs text-muted-foreground">共 {plugins.length} 个</span>
          ) : null}
        </div>

        {loading ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载插件…
          </div>
        ) : loadError ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="break-words">{loadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void reload()}
              >
                重新加载
              </Button>
            </div>
          </div>
        ) : plugins.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <Puzzle className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {/*
                隐藏了自带的安装表单时不能再让用户"粘贴地址开始" —— 那句话指向的输入框
                已经不在这一屏上，而入口在页头的「手动安装」里。空状态是最可能被照着
                字面执行的文案，指错方向就是一次白找。
              */}
              {hideInstallForm
                ? "还没有安装插件。用页面上的「手动安装」粘贴 GitHub 地址，或选一个本地目录。"
                : "还没有安装插件。粘贴一个 GitHub 仓库地址开始。"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {plugins.map((plugin) => {
              const status = PROCESS_STATE_BADGES[plugin.processState] ?? PROCESS_STATE_BADGES.stopped
              const pluginBusy = busy?.id === plugin.id
              const disabling = pluginBusy && busy?.kind === "disable"
              const uninstalling = pluginBusy && busy?.kind === "uninstall"
              const retrying = pluginBusy && busy?.kind === "enable"
              // 同一时间只允许一个启停/卸载请求，避免两个命令同时改注册表。
              const actionsLocked = Boolean(busy) || installing || installingLocal
              return (
                <div
                  key={plugin.id}
                  className="space-y-3 rounded-lg border border-border px-4 py-3"
                  data-plugin-id={plugin.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words font-medium">
                          {pluginDisplayName(plugin)}
                        </span>
                        {plugin.version ? (
                          <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                        ) : null}
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium leading-4 ${status.className}`}
                        >
                          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                          {status.label}
                        </span>
                      </div>

                      {/*
                        进程异常原因（Rust `lastError`）。徽章只说「异常退出」，说不出
                        「因为 exit code: 3」，用户就分不清是插件自己的 bug、配置写错，
                        还是宿主把它杀了。红色小字紧贴徽章下方，和「运行中」的绿色正向
                        状态形成对比。

                        **一条通用渲染，不锁 crashed 分支**：后端将来为别的状态（比如
                        `failed`）填了原因，这里也能原样显示，不必再改一遍界面。
                        没有值时不渲染空 `<p>`，避免卡片上多出一段无意义的留白。

                        注意别和 provider 卡片的 `lastError` 混淆：那个是**模型供应商**
                        （`PluginProviderView`）的探活/抓模型失败，这里是**插件进程**的
                        退出原因，两者数据源不同，也各自渲染在各自的卡片上。
                      */}
                      {plugin.lastError ? (
                        <p
                          className="break-words text-xs text-destructive"
                          data-plugin-crash-reason="true"
                        >
                          {plugin.lastError}
                        </p>
                      ) : null}

                      {/*
                        「重新启用」失败的原因。就地显示在崩溃原因下面而不是页面顶部：
                        两条信息要一起看（上次为什么崩 / 这次为什么仍起不来），
                        而且用户是在这张卡片上点的按钮，错误离开卡片就等于消失。
                      */}
                      {retryError?.id === plugin.id ? (
                        <div
                          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
                          role="alert"
                          data-plugin-retry-error="true"
                        >
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <p className="min-w-0 break-words">{retryError.message}</p>
                        </div>
                      ) : null}

                      {plugin.description ? (
                        <p className="break-words text-sm text-muted-foreground">
                          {plugin.description}
                        </p>
                      ) : null}

                      <p className="break-all text-xs text-muted-foreground">
                        来源：{plugin.sourceRepo || "未知"}
                        {plugin.sourceCommit ? (
                          <span className="ml-1 font-mono">
                            @{plugin.sourceCommit.slice(0, 7)}
                          </span>
                        ) : null}
                      </p>

                      {/*
                        必须在这里把「工具」说清楚：工具插件不产生任何界面元素，
                        它只在启用后进入模型的可用工具列表。少了这一句，用户装完会以为没生效。
                      */}
                      {plugin.toolCount > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          提供{" "}
                          <span className="font-medium text-foreground/80">
                            {plugin.toolCount} 个工具
                          </span>
                          ：由 AI 在对话中自动调用，界面上没有单独入口；首次调用会弹确认。
                        </p>
                      ) : null}

                      {plugin.providerIds && plugin.providerIds.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          提供模型供应商：
                          <span className="ml-1 font-mono">{plugin.providerIds.join("、")}</span>
                          ，出现在「模型设置」里。
                        </p>
                      ) : null}

                      {/*
                        声明式插件既没有工具数也没有 provider，卡片上会一次说明都不出现，
                        徽章又写着「声明式」—— 用户会问"那它到底在跑什么"。
                        这一句就是答案：它没有进程，能力由宿主直接渲染。
                      */}
                      {plugin.processState === "declarative" ? (
                        <p className="text-xs text-muted-foreground">
                          纯声明式插件：不启动任何进程、不执行代码，配置与能力由宿主直接渲染。
                        </p>
                      ) : null}

                      {plugin.grantedPermissions.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>已授权权限：</span>
                          {plugin.grantedPermissions.map((permission) => (
                            <span
                              key={permission}
                              title={permission}
                              className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem] text-foreground/80"
                            >
                              {PERMISSION_LABELS[permission] ?? permission}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {/*
                        「设置」只在插件声明了 configSchema 时出现。
                        判据取清单静态声明面 `preview.hasConfig`（设计 §8：免执行发现）——
                        不能靠"读一次 config_get 看有没有键"来猜：没配过就是空对象，
                        那样永远显示不出这个入口。Rust 侧尚未提供时按钮不出现，
                        是安全的降级方向。
                      */}
                      {hasPluginConfig(plugin) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={actionsLocked}
                          onClick={() => setConfigTarget(plugin)}
                        >
                          设置
                        </Button>
                      ) : null}
                      {/*
                        「重新启用」只在崩溃态出现。
                        必要性：崩溃后 Rust 保留 `enabled = true`，卡片显示「停用」，
                        用户想重试必须先停用 —— 而停用会清掉 `lastError`，等于
                        "想看崩溃原因就得先把它擦掉"。这个按钮直接再启动一次，
                        不改后端语义，也不经过「停用」那一步。
                        「停用」仍然保留在右边：用户可能就是想让它别再来。
                      */}
                      {plugin.processState === "crashed" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={actionsLocked}
                          onClick={() => void retryPlugin(plugin)}
                          title="再试一次：宿主会重新启动这个插件的进程，已授予的权限保持不变。"
                        >
                          {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {retrying ? "重新启用中…" : "重新启用"}
                        </Button>
                      ) : null}
                      {plugin.enabled ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={actionsLocked}
                          onClick={() => void disablePlugin(plugin)}
                        >
                          {disabling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {disabling ? "停用中…" : "停用"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={actionsLocked}
                          onClick={() => openEnableDialog(plugin)}
                          /*
                            「启用」不只是翻一个开关：它会让宿主真的 spawn 插件进程，
                            崩过之后再点就是一次重试。这句话**不能只挂在 crashed 上** ——
                            崩溃卡片另有独立的「重新启用」（见上），但用户一旦先停用，
                            按钮就变回「启用」，而那时 `lastError` 已被清掉，
                            提示必须自己带在身上才真的能被看到。
                          */
                          title="重新启用会再试一次：宿主会重新启动这个插件的进程。"
                        >
                          启用
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={actionsLocked}
                        onClick={() => void uninstallPlugin(plugin)}
                      >
                        {uninstalling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {uninstalling ? "卸载中…" : "卸载"}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 插件配置对话框：表单本身复用 `SchemaForm`（与 action.form 同一套渲染器）。 */}
      <Dialog
        open={configTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfigTarget(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>插件设置</DialogTitle>
            <DialogDescription>
              {configTarget ? `配置「${pluginDisplayName(configTarget)}」。密钥字段不会落盘保存。` : ""}
            </DialogDescription>
          </DialogHeader>

          {configTarget ? (
            <ConfigForm
              pluginId={configTarget.id}
              pluginName={pluginDisplayName(configTarget)}
              configSchema={previewConfigSchema(configTarget)}
              onSaved={() => setConfigTarget(null)}
            />
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfigTarget(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={enableTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setEnableTarget(null)
          setEnableError(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>启用插件</DialogTitle>
            <DialogDescription>
              {enableTarget
                ? enableTone === "declarative"
                  ? `「${pluginDisplayName(enableTarget)}」将被启用，随时可以在这里停用。它不启动进程，只在宿主界面里出现。`
                  : `「${pluginDisplayName(enableTarget)}」将以独立进程运行，随时可以在这里停用。`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {/*
              声明了 provider 的插件必须走单独的高危确认（设计 §7）：
              它拿到的不是「被调用时的那一段上下文」，而是用户与模型的完整对话 ——
              全书设定、剧情、人物、已写正文。这里的文案要具体到用户能理解
              「谁在看我的稿子」，不能写成「该插件可能访问网络」这种空话。
            */}
            {enableTone === "provider" ? (
              <div
                className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 leading-relaxed text-destructive"
                data-plugin-risk="provider"
              >
                该插件会成为你的模型供应商：你对 AI 说的每一句话、以及软件送给 AI 的全部上下文（包括你这本书的设定、剧情和已写正文）都会经过它。它还可能把这些内容发往它自己的上游服务。请只安装你信任来源的 provider 插件。
              </div>
            ) : enableTone === "declarative" ? (
              /*
               * 纯声明式（没有 provider、也没有 tools）用最轻的一档：
               * 它连代码都不执行，把「独立进程、可读文件、可联网」那套警示搬过来
               * 属于假警报 —— 假警报多了，用户在真正高危的 provider 档上也会直接点确认。
               */
              <div
                className="rounded-lg border border-border bg-muted/50 p-3 leading-relaxed text-muted-foreground"
                data-plugin-risk="declarative"
              >
                该插件只提供配置与界面声明，不会执行任何代码，也不会启动进程。
              </div>
            ) : (
              <div
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 leading-relaxed text-amber-900 dark:text-amber-200"
                data-plugin-risk="default"
              >
                该插件会以独立进程运行。它拿到的权限就是下面列出的这些；写入它自己的数据目录始终允许。
              </div>
            )}
            {enableDeclaresProvider ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                它声明的供应商：{enableProviderIds.join("、")}。启用后这些模型会出现在模型选择器里，
                由该插件进程接收你的全部请求。
              </p>
            ) : null}
            {/*
              权限的展示与授予同源：这里列出的就是 `confirmEnable` 会交给
              `plugins_enable` 的那一份（清单 `permissions` 原文）。
              本期是「整包授予 + 明确展示」，不做逐项开关 —— 勾选需要先定义
              「拒掉某项后插件还能怎么跑」，那会把一个完整插件变成半坏的，
              但**不能因此让用户盲授**：申请了什么，必须在点确认之前看得见。
            */}
            <div className="space-y-1.5" data-plugin-declared-permissions="true">
              {enableDeclaredPermissions.length > 0 ? (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    该插件申请以下权限：
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {enableDeclaredPermissions.map((permission) => (
                      <span
                        key={permission}
                        title={permission}
                        className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem] text-foreground/80"
                      >
                        {PERMISSION_LABELS[permission] ?? permission}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  该插件不申请任何权限
                </p>
              )}
            </div>
            {enableError ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="min-w-0 break-words">{enableError}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={enabling}
              onClick={() => {
                setEnableTarget(null)
                setEnableError(null)
              }}
            >
              取消
            </Button>
            <Button type="button" disabled={enabling} onClick={() => void confirmEnable()}>
              {enabling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {enabling ? "启用中…" : "确认启用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
