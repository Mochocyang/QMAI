import { useEffect, useState, type FormEvent } from "react"
import { AlertTriangle, FolderOpen, Loader2 } from "lucide-react"
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
import { pluginsApi } from "@/lib/plugins/api"
import type { PluginSummary } from "@/lib/plugins/types"
import { isTauri } from "@/lib/platform"
import { toast } from "@/lib/toast"

/**
 * 「添加插件」对话框。
 *
 * 为什么两个安装入口（GitHub 地址 / 本地目录）收进**同一个**对话框、只用一个分段切换：
 * 它们是同一件事（"把一份插件交给我"），差别只有来源。做成两个弹窗时，用户点错了
 * 就得关掉重开；做成一个，改主意只是点一下旁边那个标签。
 *
 * 纯受控：`open` / `mode` 由宿主管（页头两个入口分别预选 URL / 本地目录），
 * 成功后的刷新也由宿主的 `onInstalled` 负责 —— 这个组件不认识"插件页"，
 * 换一页复用也不用改。
 */

/** 来源模式：粘贴仓库地址 / 选本机目录。 */
export type AddPluginMode = "url" | "local"

const MODES: { id: AddPluginMode; label: string }[] = [
  { id: "url", label: "GitHub 仓库" },
  { id: "local", label: "本地目录" },
]

/**
 * 读取 Tauri 命令失败原因（与 `plugin-center-view.tsx` / `plugin-section.tsx` 同构）。
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

export interface AddPluginDialogProps {
  open: boolean
  /** 预选来源（由页头那个入口决定）。 */
  mode: AddPluginMode
  onModeChange: (mode: AddPluginMode) => void
  onOpenChange: (open: boolean) => void
  /** 安装成功：宿主刷新已安装列表（对话框自己已经关掉了）。 */
  onInstalled: (plugin: PluginSummary) => void | Promise<void>
}

export function AddPluginDialog({
  open,
  mode,
  onModeChange,
  onOpenChange,
  onInstalled,
}: AddPluginDialogProps) {
  const [url, setUrl] = useState("")
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * 每次打开都从干净状态开始：上一次失败的那句红字留在框里，用户会以为
   * "这次也失败了"（尤其是同一句错误代码）。装上过的地址也不再回填 ——
   * 同一个插件装第二遍只会被后端拒绝。
   */
  useEffect(() => {
    if (!open) return
    setUrl("")
    setLocalPath(null)
    setError(null)
    setPicking(false)
    setSubmitting(false)
  }, [open])

  const source = mode === "url" ? url.trim() : (localPath?.trim() ?? "")
  const busy = submitting || picking
  const canSubmit = source !== "" && !busy

  async function pickDirectory() {
    if (busy) return
    if (!isTauri()) {
      // 浏览器预览里拿不到真实绝对路径，如实说明原因，而不是弹一个选不了东西的框。
      setError("需要在桌面应用里选择插件目录。")
      return
    }
    setPicking(true)
    setError(null)
    let picked: unknown = null
    try {
      const { open: openDirectory } = await import("@tauri-apps/plugin-dialog")
      picked = await openDirectory({
        directory: true,
        multiple: false,
        title: "选择插件目录（根目录下需有 plugin.json）",
      })
    } catch (cause) {
      setError(describeError(cause))
      setPicking(false)
      return
    }
    setPicking(false)
    // 用户取消不是错误：不留错误条，也不改已选路径。
    if (typeof picked === "string") setLocalPath(picked)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const summary =
        mode === "url"
          ? await pluginsApi.install(source)
          : await pluginsApi.installLocal(source)
      const name = summary?.name?.trim() || (mode === "url" ? source : "插件")
      toast.success(`已安装「${name}」`)
      // 先关窗再刷新：刷新可能要等后端重新扫描，让用户对着一个卡住的弹窗干等没有必要。
      onOpenChange(false)
      await onInstalled(summary)
    } catch (cause) {
      // 失败**不关窗**：Rust 的中文原因就写在这句话里，关掉等于把它扔了。
      setError(describeError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg" data-add-plugin-dialog="true">
        <DialogHeader>
          <DialogTitle>添加插件</DialogTitle>
          <DialogDescription>
            输入插件的 GitHub 仓库地址，或选择本机正在开发的插件目录。
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          {mode === "url" ? (
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
              aria-label="插件仓库地址"
              data-add-plugin-url="true"
              disabled={busy}
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <div
                data-add-plugin-path="true"
                title={localPath ?? ""}
                className="min-w-0 flex-1 truncate rounded-lg border border-input bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
              >
                {localPath ?? "还没有选择目录"}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-add-plugin-pick="true"
                disabled={busy}
                onClick={() => void pickDirectory()}
              >
                {picking ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderOpen className="mr-1 h-3.5 w-3.5" />
                )}
                {picking ? "选择中…" : "选择目录"}
              </Button>
            </div>
          )}

          {/*
            分段切换放在输入框**下面**：先看到"要填什么"，再决定"从哪儿来"。
            反过来时，用户会先被两个标签拦住，以为还要先做选择才能输入。
          */}
          <div
            role="group"
            aria-label="插件来源"
            className="flex w-fit items-center gap-0.5 rounded-lg border p-0.5"
          >
            {MODES.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="xs"
                variant={mode === item.id ? "secondary" : "ghost"}
                aria-pressed={mode === item.id}
                data-add-plugin-mode={item.id}
                onClick={() => {
                  if (busy) return
                  onModeChange(item.id)
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>

          {/* 来源警示：安装前的一句话，不是可跳过的条款 —— 它和「安装」按钮同屏可见。 */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <p className="min-w-0">
              请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能读取或泄露你的数据。
            </p>
          </div>

          {error ? (
            <div
              data-add-plugin-error="true"
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive"
            >
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <p className="min-w-0 break-words">{error}</p>
            </div>
          ) : null}

          <DialogFooter className="mt-1">
            <Button
              type="submit"
              data-add-plugin-submit="true"
              disabled={!canSubmit}
              className="w-full sm:w-auto"
            >
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {submitting ? "安装中…" : "安装"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
