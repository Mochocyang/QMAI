import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  BookOpen,
  Check,
  CloudOff,
  Info,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
} from "lucide-react"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { WikiReader } from "@/components/editor/wiki-reader"
import { OutlineDualPreview } from "@/components/editor/outline-dual-preview"
import { splitChapterHeading } from "@/lib/chapter-selection"
import { parseFrontmatter } from "@/lib/frontmatter"
import { isTauri } from "@/lib/platform"
import { resolveReaderWindowPayload, type ReaderWindowPayload } from "@/lib/reader-window"
import {
  READER_WINDOW_APPEARANCE_EVENT,
  applyReaderWindowAppearance,
  resolveReaderWindowAppearance,
} from "@/lib/reader-window-appearance"
import { useReaderDocument, type ReaderSaveState } from "@/hooks/use-reader-document"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 「在独立窗口打开」的窗口本体（可编辑）。
 *
 * 它运行在**另一个 webview** 里：store 是独立的一份，主窗口的
 * `selectedFile` / `fileContent` / 未保存草稿一概看不到、也碰不到，所以这里
 * 自己读盘、自己落盘（见 `hooks/use-reader-document.ts`）。
 *
 * 为什么不复用 PreviewPanel：那套组件依赖主窗口的整条打开链路（文件切换、
 * flush 上一个章节、AI 面板、生成状态机），搬进来既拖慢启动，也会把
 * 「切换即覆盖」的老问题一并带过来。这里只保留"打开一份文档"必需的部分。
 *
 * 两个窗口同时写同一份文件没有全局锁（主窗口写盘时不会通知这里），所以策略是
 * **先发现、再让用户选**：写盘前比对磁盘基线，不一致就暂停自动保存并给出
 * 「载入磁盘版本 / 用我的覆盖」两个出口，绝不闷头覆盖对方的内容。
 */

interface ReaderWindowProps {
  /** main.tsx 启动时已解析好的参数；不传则自己从 location.search 再解析一次。 */
  payload?: ReaderWindowPayload | null
}

function fileNameOf(path: string): string {
  return (path.replace(/\\/g, "/").split("/").pop() ?? path).replace(/\.md$/i, "")
}

/**
 * 正文承载层：**刻意照抄主窗口编辑器的那几层容器名**。
 *
 * 为什么不能只把 CSS 变量写上去就完事：正文字体 / 字号 / 行距 / 字距 /
 * 左右边距 / 底部安全距离在 `ui-test-editor.css` 里全挂在
 * `.ui-test-root .ui-test-editor-body`、`.ui-test-editor-scroll`、
 * `.ui-test-editor-document` 这几层上。独立窗口原先直接渲染 WikiEditor，
 * 一层都不命中，于是变量写了也没有消费者 —— 用户看到的就是
 * 「独立窗口没有字体设置」。
 *
 * 直接复用同一套类名，而不是给独立窗口另写一份样式：两份 CSS 必然漂移，
 * 而漂移的表现恰恰是"主窗口改了、独立窗口没改"这种最难解释的缺陷。
 */
function WritingSurface({
  kind,
  children,
}: {
  kind: "chapter" | "outline"
  children: ReactNode
}) {
  return (
    <div className="ui-test-editor" data-kind={kind}>
      <article className="ui-test-editor-document">
        <div className="ui-test-editor-scroll">
          <div className="ui-test-editor-body">{children}</div>
        </div>
      </article>
    </div>
  )
}

/** 顶栏右侧的状态文字与配色：让"现在到底存没存"一眼可见。 */
function statusHint(
  saveState: ReaderSaveState,
  dirty: boolean,
): { text: string; tone: string } | null {
  if (saveState === "saving") return { text: "保存中…", tone: "text-muted-foreground" }
  if (saveState === "conflict") return { text: "有冲突，已暂停自动保存", tone: "text-amber-600" }
  if (saveState === "failed") return { text: "保存失败", tone: "text-destructive" }
  if (dirty) return { text: "未保存", tone: "text-amber-600" }
  if (saveState === "saved") return { text: "已保存", tone: "text-emerald-600" }
  return null
}

export function ReaderWindow({ payload: providedPayload }: ReaderWindowProps) {
  const payload = useMemo(
    () =>
      providedPayload ??
      resolveReaderWindowPayload(typeof window === "undefined" ? "" : window.location.search),
    [providedPayload],
  )
  const path = payload?.path ?? ""
  const kind = payload?.kind ?? "chapter"
  const {
    status,
    loadError,
    liveMarkdown,
    html,
    heading,
    editorEpoch,
    dirty,
    saveState,
    saveError,
    notice,
    conflict,
    reload,
    handleMarkdownChange,
    flushNow,
    saveHtmlNow,
    resolveConflictKeepMine,
    resolveConflictLoadDisk,
    hasPendingChanges,
  } = useReaderDocument(kind, path)

  /** 章节有"编辑 / 阅读"两种看法；大纲本身自带 HTML / MD 双格式，不用这个。 */
  const [chapterMode, setChapterMode] = useState<"edit" | "read">("edit")

  /**
   * 外观快照的**单一事实源**。
   *
   * 为什么必须是 state 而不只是往 documentElement 上写属性：ui-test.css 把
   * 基础令牌声明在 `.ui-test-root` 上（纸底、墨色…），而元素自身的声明优先于
   * 继承，所以 `html[data-ui-test-skin="xing"]` 那份变体令牌**盖不住**根节点
   * 自己的浅色基础值 —— 必须给根节点挂上 `data-skin`，走
   * `.ui-test-root[data-skin="xing"]` 那条更高优先级的规则。
   * 实测症状：属性都设对了，窗口仍是白底黑字。
   */
  const [appearance, setAppearance] = useState(() =>
    resolveReaderWindowAppearance(payload?.appearance, payload?.theme),
  )

  /**
   * 把外观落到 documentElement 上（皮肤属性 / 深浅色 / 字体 / 排版变量）。
   *
   * `useLayoutEffect` 而不是 `useEffect`：都是改属性与 CSS 变量，放在绘制前跑，
   * 首帧就是对的（main.tsx 还会更早做一次，这里管快照变化与事件下发）。
   */
  useLayoutEffect(() => {
    applyReaderWindowAppearance(appearance)
  }, [appearance])

  /**
   * 主窗口改了皮肤 / 字体 / 行距之后，这里跟着变。
   *
   * 快照只在建窗那一刻有效，而用户完全可能"开着独立窗口去设置页调字号" ——
   * 不跟随的话他会以为设置没生效（和当初"设了没反应"是同一类观感）。
   */
  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => unknown) | undefined
    let disposed = false
    /** 与关窗那段同样的理由：窗口正在销毁时 unlisten 会 reject，不能漏成 unhandled。 */
    const safeUnlisten = (fn: () => unknown) => {
      try {
        const result = fn()
        if (result && typeof (result as Promise<unknown>).catch === "function") {
          void (result as Promise<unknown>).catch(() => undefined)
        }
      } catch {
        // 收尾失败不影响任何用户可见行为。
      }
    }
    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const un = await listen(READER_WINDOW_APPEARANCE_EVENT, (event) => {
          // 事件体同样不可信（版本错配 / 手改 payload），一律走归一化。
          setAppearance(resolveReaderWindowAppearance(event.payload))
        })
        if (disposed) safeUnlisten(un)
        else unlisten = un
      })
      .catch((error) => console.error("监听外观变化失败:", error))
    return () => {
      disposed = true
      if (unlisten) safeUnlisten(unlisten)
    }
  }, [])

  /**
   * 只灌项目路径，让正文里的相对图片能解析出来（WikiReader 依赖它）。
   * 不灌 fileTree / projectPathIndex：独立窗口不提供 wikilink 跳转，
   * 扫一遍目录纯属浪费启动时间。
   */
  useEffect(() => {
    if (!payload?.projectPath) return
    const current = useWikiStore.getState().project
    if (current?.path === payload.projectPath) return
    useWikiStore.setState({ project: { id: "", name: "", path: payload.projectPath } })
  }, [payload?.projectPath])

  /**
   * Ctrl/Cmd + S 立即落盘。
   *
   * 自动保存是 30 秒一次的兜底，写完随手按一下存盘是写作时的肌肉记忆 ——
   * 在独立窗口里按了没反应会被当成"这窗口存不了"。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return
      event.preventDefault()
      void flushNow()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [flushNow])

  /**
   * 切走窗口时先落盘。
   *
   * 用户切回主窗口往往就是想看看"那边显示的是不是新的" —— 主窗口有 2 秒的磁盘
   * 轮询，这边只要写好盘，那边自然会跟着变。没有待落盘内容时是空操作。
   */
  useEffect(() => {
    const onBlur = () => {
      if (!hasPendingChanges()) return
      void flushNow()
    }
    window.addEventListener("blur", onBlur)
    return () => window.removeEventListener("blur", onBlur)
  }, [flushNow, hasPendingChanges])

  /**
   * 关窗前把未落盘的内容写掉。
   *
   * 不弹"要保存吗"的对话框：写盘无害，而三选一对话框在"用户已经决定关窗"的
   * 时刻只会添堵。写不成功（冲突 / 磁盘拒绝）时**不关窗**，把冲突条留在界面上
   * 让用户处理 —— 悄悄关掉等于丢字。
   */
  const closingRef = useRef(false)
  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => unknown) | undefined
    let disposed = false
    /**
     * 解绑监听要吞掉两种失败：同步抛错，以及返回 rejected promise。
     *
     * 后者不是假设 —— Tauri 的 unlisten 是 async 函数，窗口正在销毁时内部
     * 找不到注册表就会 reject。`try {}` 抓不到 promise 的 rejection，会变成
     * 一条 unhandledrejection，在控制台里看着像产品崩了，其实只是收尾。
     */
    const safeUnlisten = (fn: () => unknown) => {
      try {
        const result = fn()
        if (result && typeof (result as Promise<unknown>).catch === "function") {
          void (result as Promise<unknown>).catch(() => undefined)
        }
      } catch {
        // 同上：收尾失败不影响任何用户可见行为。
      }
    }
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        const un = await win.onCloseRequested(async (event) => {
          if (closingRef.current) return
          if (!hasPendingChanges()) return
          event.preventDefault()
          const ok = await flushNow()
          if (!ok || hasPendingChanges()) return
          closingRef.current = true
          try {
            await win.destroy()
          } catch (error) {
            closingRef.current = false
            console.error("关闭独立窗口失败:", error)
          }
        })
        if (disposed) {
          safeUnlisten(un)
        } else {
          unlisten = un
        }
      })
      .catch((error) => console.error("监听关窗事件失败:", error))
    return () => {
      disposed = true
      if (unlisten) safeUnlisten(unlisten)
    }
  }, [flushNow, hasPendingChanges])

  /** 刷新 = 先把我的改动写掉，再从磁盘重读（否则刷新会把没保存的内容冲掉）。 */
  const handleReload = useCallback(async () => {
    if (hasPendingChanges()) {
      const ok = await flushNow()
      if (!ok) return
    }
    await reload()
  }, [flushNow, hasPendingChanges, reload])

  const chapterReadBody = useMemo(() => {
    if (kind !== "chapter") return ""
    // 与主窗口只读模式一致：正文首行缩进两个全角空格在这里不显示。
    return splitChapterHeading(parseFrontmatter(liveMarkdown).body).body.replace(/^　　/gm, "")
  }, [kind, liveMarkdown])

  const title = status === "ready" ? heading : fileNameOf(path)
  const hint = statusHint(saveState, dirty)

  return (
    /*
     * `ui-test-root` 不只是"加个皮肤"：ui-test.css 的整套令牌、以及
     * 正文字体/字号/行距那些规则的作用域都以它为前提（子选择器写的是
     * `.ui-test-root .ui-test-editor-body`）。少了它，独立窗口既没有皮肤，
     * 也没有任何一条排版规则会命中。
     *
     * 底色显式画在纸色上：`html[data-ui-test-skin]` 那条规则会把
     * html/body/#root 变成 transparent（主窗口靠 `.ui-test-app` 铺底），
     * 这边没有那层外壳，不铺的话透明窗口会露出一块纯黑/纯白。
     *
     * 用**行内样式**而不是 `bg-[var(--ui-paper)]`：`.ui-test-root` 里那一条
     * `background: transparent` 是**不带 @layer 的普通 CSS**，而 Tailwind 的
     * 工具类在 @layer utilities 里 —— 未分层的规则永远赢，工具类的底色会被吃掉。
     */
    <div
      className="ui-test-root flex flex-col"
      data-skin={appearance.skin}
      style={{ background: "var(--ui-paper)" }}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 truncate text-sm font-medium" title={path}>
          {title || "独立窗口"}
        </span>
        {hint ? (
          <span className={`shrink-0 text-[0.6875rem] ${hint.tone}`}>{hint.text}</span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {kind === "chapter" && status === "ready" ? (
            <button
              type="button"
              aria-label={chapterMode === "edit" ? "切换到阅读" : "切换到编辑"}
              title={chapterMode === "edit" ? "切换到阅读" : "切换到编辑"}
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent"
              onClick={() => setChapterMode((mode) => (mode === "edit" ? "read" : "edit"))}
            >
              {chapterMode === "edit" ? (
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          ) : null}

          <button
            type="button"
            aria-label="保存"
            title={dirty ? "保存到磁盘（Ctrl+S）" : "没有需要保存的修改"}
            disabled={!dirty || saveState === "saving"}
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void flushNow()}
          >
            {saveState === "saved" && !dirty ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            aria-label="刷新"
            title="重新从磁盘读取"
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent"
            onClick={() => void handleReload()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {conflict ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[0.6875rem] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            磁盘上的这份文件已被其他窗口或外部编辑器修改。为避免覆盖，自动保存已暂停。
          </span>
          <button
            type="button"
            className="shrink-0 rounded border px-2 py-0.5 hover:bg-accent"
            onClick={() => void resolveConflictLoadDisk()}
          >
            载入磁盘版本
          </button>
          <button
            type="button"
            className="shrink-0 rounded border px-2 py-0.5 hover:bg-accent"
            onClick={() => void resolveConflictKeepMine()}
          >
            用我的覆盖
          </button>
        </div>
      ) : null}

      {notice && !conflict ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[0.6875rem] text-sky-900 dark:text-sky-200">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{notice}</span>
        </div>
      ) : null}

      {saveState === "failed" ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.6875rem] text-destructive">
          <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-all">
            保存失败：{saveError || "未知原因"}。内容还在窗口里，可以重试。
          </span>
          <button
            type="button"
            className="shrink-0 rounded border px-2 py-0.5 hover:bg-accent"
            onClick={() => void flushNow()}
          >
            重试
          </button>
        </div>
      ) : null}

      {/* 滚动一律交给内层容器（编辑器自带滚动、阅读视图自己套 overflow-auto），
          外层只负责把剩余高度给出去 —— 两层都开滚动会出现"滚轮卡住"的手感。 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {status === "loading" ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            正在读取…
          </div>
        ) : status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            <p>无法读取该文档，它可能已被移动或删除。</p>
            <p className="max-w-full break-all text-[0.6875rem] opacity-70">{loadError}</p>
            <button type="button" className="rounded border px-3 py-1 hover:bg-accent" onClick={() => void reload()}>
              重试
            </button>
          </div>
        ) : kind === "outline" ? (
          html ? (
            <OutlineDualPreview
              // 换文件或重新读盘都重挂载：Milkdown 的初值只在创建编辑器时读一次。
              key={`outline-${editorEpoch}`}
              htmlContent={html}
              mdEditor={
                /* MD 侧同样要套正文承载层：大纲的字号/行距/字距与左右边距
                   在 MD 视图里是同一套变量（HTML 视图是 iframe，靠注入的
                   皮肤样式，已经在 `useDocumentAppearanceHtml` 里处理好了）。 */
                <WritingSurface kind="outline">
                  <WikiEditor
                    content={liveMarkdown}
                    onSave={handleMarkdownChange}
                    formatToolbar
                    defaultMode="edit"
                  />
                </WritingSurface>
              }
              label="大纲"
              onSaveHtml={saveHtmlNow}
              documentKey={path}
            />
          ) : (
            <WritingSurface kind="outline">
              <WikiEditor
                key={`outline-md-${editorEpoch}`}
                content={liveMarkdown}
                onSave={handleMarkdownChange}
                formatToolbar
                defaultMode="edit"
              />
            </WritingSurface>
          )
        ) : chapterMode === "read" ? (
          <WritingSurface kind="chapter">
            <WikiReader body={chapterReadBody} highlightHandcraftZones />
          </WritingSurface>
        ) : (
          <WritingSurface kind="chapter">
            <WikiEditor
              key={`chapter-${editorEpoch}`}
              content={liveMarkdown}
              onSave={handleMarkdownChange}
              immersiveWriting
              defaultMode="edit"
            />
          </WritingSurface>
        )}
      </div>
    </div>
  )
}
