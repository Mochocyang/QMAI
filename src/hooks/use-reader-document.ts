/**
 * 独立窗口的文档会话状态机：载入 → 编辑 → 周期落盘 → 冲突判定。
 *
 * ── 与主窗口的关系 ──
 * 主窗口那套（`preview-panel.tsx`）把保存定时器、磁盘轮询、冲突协调器全挂在
 * 组件内部的 ref 上，且绑着 AI 面板、写作统计、生成状态机等一堆独立窗口用不着
 * 的东西。两个 webview 的 store 互不相通，也没法把那些 ref 搬过来，所以这里按
 * 同样的**规则**重写一份最小实现：
 *
 *   1. 章节正文保存前必须 `normalizeChapterWriting`（与主窗口同一口径）；
 *   2. 周期自动落盘而不是"停手就写"（否则每敲一个回车都写一次盘）；
 *   3. 写盘前拿磁盘内容跟自己的基线比一次 —— 不一致说明**另一个窗口**
 *      （或外部编辑器）动过这个文件，此时停下来问人，绝不闷头覆盖；
 *   4. 本地没有未保存修改时，磁盘被外部改了就直接跟随，不打扰用户。
 *
 * 双向写冲突这件事没有全局锁可用（主窗口写盘时不会通知这里），所以规则只能是
 * "先发现、再让用户选"，而不是"抢到锁才准写"。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { writeFileAtomic } from "@/commands/fs"
import {
  companionHtmlPath,
  documentContentMatches,
  loadReaderDocument,
  normalizeDocumentForSave,
  readDiskDocument,
} from "@/lib/reader-window-document"
import type { ReaderWindowKind } from "@/lib/reader-window"

/**
 * 周期落盘间隔。
 *
 * 主窗口的章节自动保存是 3 分钟（见 `chapter-save-flush.ts` 的注释：那是为了
 * 不打断连续写作）。独立窗口的语义不同 —— 用户开它往往是为了"单开一章来写"，
 * 写完就可能直接把窗口叉掉，30 秒一次能让「已保存」这个反馈及时可信；
 * 关窗与失焦另有 flush 兜底，不会因为间隔短而多写盘。
 */
export const READER_AUTOSAVE_INTERVAL_MS = 30_000

/** 磁盘轮询间隔，与主窗口的 2 秒同级；独立窗口只盯一个文件，代价可忽略。 */
export const READER_DISK_POLL_MS = 2_500

export type ReaderLoadStatus = "loading" | "ready" | "error"
export type ReaderSaveState = "idle" | "saving" | "saved" | "failed" | "conflict"

export interface ReaderConflict {
  /** 目前只有正文会走"停下来问人"这条路径；HTML 是显式保存动作，见 saveHtmlNow。 */
  kind: "markdown"
  /** 冲突那一刻磁盘上的内容，用于"载入磁盘版本"。 */
  diskContent: string
}

export interface UseReaderDocumentResult {
  status: ReaderLoadStatus
  loadError: string
  /** 编辑器内容（含未落盘修改）。阅读视图与编辑器都以它为准。 */
  liveMarkdown: string
  html: string | null
  heading: string
  /** 变化就重挂载编辑器。外部写入磁盘后必须 +1：Milkdown 的初值只在挂载时生效。 */
  editorEpoch: number
  dirty: boolean
  saveState: ReaderSaveState
  saveError: string
  /** 被动消息（例如"已跟随磁盘上的最新内容"）。空串表示没有。 */
  notice: string
  conflict: ReaderConflict | null
  /** 重新读盘（丢弃未落盘修改）。 */
  reload: () => Promise<void>
  handleMarkdownChange: (markdown: string) => void
  /** 立即落盘（Ctrl+S / 按钮 / 关窗）。返回 false 表示没写成功（冲突或失败）。 */
  flushNow: () => Promise<boolean>
  saveHtmlNow: (html: string) => Promise<boolean>
  resolveConflictKeepMine: () => Promise<boolean>
  resolveConflictLoadDisk: () => Promise<void>
  hasPendingChanges: () => boolean
}

export function useReaderDocument(kind: ReaderWindowKind, path: string): UseReaderDocumentResult {
  const [status, setStatus] = useState<ReaderLoadStatus>("loading")
  const [loadError, setLoadError] = useState("")
  const [liveMarkdown, setLiveMarkdown] = useState("")
  const [html, setHtml] = useState<string | null>(null)
  const [heading, setHeading] = useState("")
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<ReaderSaveState>("idle")
  const [saveError, setSaveError] = useState("")
  const [notice, setNotice] = useState("")
  const [conflict, setConflict] = useState<ReaderConflict | null>(null)

  /** 与磁盘一致的那一份正文（不含未落盘修改）。冲突判定全靠它。 */
  const baselineMarkdownRef = useRef("")
  const baselineHtmlRef = useRef<string | null>(null)
  const pendingMarkdownRef = useRef<string | null>(null)
  const pendingHtmlRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const conflictRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /**
   * 短暂提示。
   *
   * 静默跟随磁盘是必要的（否则用户看不到另一个窗口刚存的内容），但编辑器里的
   * 文字**自己变了**这件事必须说一声，不然会被当成"软件把我写的弄丢了"。
   */
  const showNotice = useCallback((text: string) => {
    if (!mountedRef.current) return
    setNotice(text)
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null
      if (mountedRef.current) setNotice("")
    }, 4000)
  }, [])

  const flush = useCallback(async (): Promise<boolean> => {
    // 正在写盘时不要并发进入：两个 flush 同时比对基线，第二个必然把第一个的
    // 结果当成"外部改动"，凭空造出一次冲突。
    if (savingRef.current) return false
    if (conflictRef.current) return false

    const pendingMarkdown = pendingMarkdownRef.current
    const pendingHtml = pendingHtmlRef.current
    if (pendingMarkdown === null && pendingHtml === null) return true

    savingRef.current = true
    setSaveState("saving")
    setSaveError("")
    try {
      if (pendingMarkdown !== null) {
        const next = normalizeDocumentForSave(path, pendingMarkdown)
        if (!documentContentMatches(path, next, baselineMarkdownRef.current)) {
          const disk = await readDiskDocument(path)
          // 磁盘读不到（文件被删/被锁）时不做冲突判断，直接尝试写 —— 写失败
          // 会在下面抛错，比"静默不写"更容易让用户看懂发生了什么。
          if (disk !== null && !documentContentMatches(path, disk, baselineMarkdownRef.current)) {
            conflictRef.current = true
            if (mountedRef.current) {
              setConflict({ kind: "markdown", diskContent: disk })
              setSaveState("conflict")
            }
            return false
          }
          await writeFileAtomic(path, next)
          baselineMarkdownRef.current = next
        }
        if (pendingMarkdownRef.current === pendingMarkdown) pendingMarkdownRef.current = null
      }

      if (pendingHtml !== null) {
        const htmlPath = companionHtmlPath(path)
        if (htmlPath) {
          await writeFileAtomic(htmlPath, pendingHtml)
          baselineHtmlRef.current = pendingHtml
          if (mountedRef.current) setHtml(pendingHtml)
        }
        if (pendingHtmlRef.current === pendingHtml) pendingHtmlRef.current = null
      }

      if (mountedRef.current) {
        setSaveState("saved")
        setDirty(pendingMarkdownRef.current !== null || pendingHtmlRef.current !== null)
      }
      return true
    } catch (error) {
      if (mountedRef.current) {
        setSaveState("failed")
        setSaveError(error instanceof Error ? error.message : String(error))
      }
      return false
    } finally {
      savingRef.current = false
    }
  }, [path])

  /**
   * 定时器里不能闭包住旧的 flush：`path` 变了会重建 flush，而定时器只建一次。
   * 用 ref 取"当前这一个"，避免写到上一个文件的路径上。
   */
  const flushRef = useRef(flush)
  flushRef.current = flush

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void flushRef.current()
    }, READER_AUTOSAVE_INTERVAL_MS)
  }, [])

  const loadDocument = useCallback(
    async (silent: boolean) => {
      if (!path) {
        setStatus("error")
        setLoadError("缺少文档路径，无法打开。")
        return
      }
      clearTimer()
      if (!silent) setStatus("loading")
      try {
        const doc = await loadReaderDocument(kind, path)
        if (!mountedRef.current) return
        baselineMarkdownRef.current = doc.markdown
        baselineHtmlRef.current = doc.html
        pendingMarkdownRef.current = null
        pendingHtmlRef.current = null
        conflictRef.current = false
        setLiveMarkdown(doc.markdown)
        setHtml(doc.html)
        setHeading(doc.heading)
        // 强制重挂载：Milkdown 的默认值只在创建编辑器时读一次，光换 props 不生效。
        setEditorEpoch((epoch) => epoch + 1)
        setDirty(false)
        setConflict(null)
        setSaveState("idle")
        setSaveError("")
        setNotice("")
        setStatus("ready")
      } catch (error) {
        if (!mountedRef.current) return
        setStatus("error")
        setLoadError(error instanceof Error ? error.message : "文档读取失败，请确认文件是否还在。")
      }
    },
    [clearTimer, kind, path],
  )

  useEffect(() => {
    void loadDocument(false)
  }, [loadDocument])

  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      setLiveMarkdown(markdown)
      // 与基线等价就撤掉待落盘的那一份：用户敲了又退回去，不该再写一次盘
      // （更不该因为这一次写盘把另一个窗口的轮询搅成"外部改动"）。
      pendingMarkdownRef.current = documentContentMatches(path, markdown, baselineMarkdownRef.current)
        ? null
        : markdown
      const stillDirty = pendingMarkdownRef.current !== null || pendingHtmlRef.current !== null
      setDirty(stillDirty)
      if (pendingMarkdownRef.current !== null) scheduleSave()
    },
    [path, scheduleSave],
  )

  const flushNow = useCallback(async (): Promise<boolean> => {
    clearTimer()
    return flushRef.current()
  }, [clearTimer])

  const saveHtmlNow = useCallback(
    async (nextHtml: string): Promise<boolean> => {
      const htmlPath = companionHtmlPath(path)
      if (!htmlPath) return false
      if (savingRef.current) return false
      savingRef.current = true
      setSaveState("saving")
      setSaveError("")
      try {
        await writeFileAtomic(htmlPath, nextHtml)
        baselineHtmlRef.current = nextHtml
        pendingHtmlRef.current = null
        if (mountedRef.current) {
          setHtml(nextHtml)
          setSaveState("saved")
          setDirty(pendingMarkdownRef.current !== null)
        }
        return true
      } catch (error) {
        if (mountedRef.current) {
          setSaveState("failed")
          setSaveError(error instanceof Error ? error.message : String(error))
        }
        return false
      } finally {
        savingRef.current = false
      }
    },
    [path],
  )

  /**
   * 磁盘轮询：只在对话框不忙的时候跑。
   *
   * 本地干净 → 跟着磁盘走（另一个窗口刚保存完，这边就该看到新内容）；
   * 本地有未落盘修改 → 停下来进冲突态，绝不覆盖用户正在敲的字。
   */
  const syncWithDisk = useCallback(async () => {
    if (savingRef.current || conflictRef.current) return
    if (!path) return

    const disk = await readDiskDocument(path)
    if (disk !== null && !documentContentMatches(path, disk, baselineMarkdownRef.current)) {
      if (pendingMarkdownRef.current !== null) {
        conflictRef.current = true
        if (mountedRef.current) {
          setConflict({ kind: "markdown", diskContent: disk })
          setSaveState("conflict")
        }
        return
      }
      baselineMarkdownRef.current = disk
      if (mountedRef.current) {
        setLiveMarkdown(disk)
        setEditorEpoch((epoch) => epoch + 1)
        setSaveState("idle")
        showNotice("已载入磁盘上的最新内容（其他窗口保存了这份文件）")
      }
      return
    }

    const htmlPath = companionHtmlPath(path)
    if (!htmlPath) return
    const diskHtml = await readDiskDocument(htmlPath)
    if (diskHtml === null || diskHtml === baselineHtmlRef.current) return
    // HTML 有本地未落盘修改时不动 —— 用户正在预览里改，换掉他脚下那句就白改了。
    if (pendingHtmlRef.current !== null) return
    baselineHtmlRef.current = diskHtml
    if (mountedRef.current) setHtml(diskHtml)
  }, [path, showNotice])

  useEffect(() => {
    if (status !== "ready") return
    const id = window.setInterval(() => {
      void syncWithDisk()
    }, READER_DISK_POLL_MS)
    return () => window.clearInterval(id)
  }, [status, syncWithDisk])

  const resolveConflictKeepMine = useCallback(async (): Promise<boolean> => {
    conflictRef.current = false
    if (mountedRef.current) setConflict(null)
    const pendingMarkdown = pendingMarkdownRef.current
    if (pendingMarkdown === null) {
      if (mountedRef.current) setSaveState("idle")
      return true
    }
    const next = normalizeDocumentForSave(path, pendingMarkdown)
    savingRef.current = true
    if (mountedRef.current) setSaveState("saving")
    try {
      await writeFileAtomic(path, next)
      baselineMarkdownRef.current = next
      pendingMarkdownRef.current = null
      if (mountedRef.current) {
        setDirty(false)
        setSaveState("saved")
        setSaveError("")
      }
      return true
    } catch (error) {
      if (mountedRef.current) {
        setSaveState("failed")
        setSaveError(error instanceof Error ? error.message : String(error))
      }
      conflictRef.current = true
      return false
    } finally {
      savingRef.current = false
    }
  }, [path])

  const resolveConflictLoadDisk = useCallback(async () => {
    conflictRef.current = false
    await loadDocument(true)
  }, [loadDocument])

  const reload = useCallback(async () => {
    await loadDocument(false)
  }, [loadDocument])

  const hasPendingChanges = useCallback(
    () => pendingMarkdownRef.current !== null || pendingHtmlRef.current !== null,
    [],
  )

  // 卸载（关窗 / 崩溃前的最后一次渲染）时把定时器收掉，避免回调打到已卸载的组件。
  useEffect(
    () => () => {
      clearTimer()
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current)
        noticeTimerRef.current = null
      }
    },
    [clearTimer],
  )

  return {
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
  }
}
