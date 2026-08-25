import { useState, useEffect, useMemo, useRef } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileSpreadsheet,
  FileQuestion,
  Eye,
  Code2,
  Save,
} from "lucide-react"
import { getFileCategory, getCodeLanguage } from "@/lib/file-types"
import type { FileCategory } from "@/lib/file-types"
import { getFileName } from "@/lib/path-utils"
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver"
import { detectLanguage } from "@/lib/detect-language"
import { getHtmlLang, getTextDirection } from "@/lib/language-metadata"
import { parseFrontmatter } from "@/lib/frontmatter"
import { FrontmatterPanel } from "@/components/editor/frontmatter-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { MermaidDiagram, unwrapMermaidPre } from "@/components/mermaid-diagram"
import { isTauri } from "@/lib/platform"

interface FilePreviewProps {
  filePath: string
  textContent: string
  /** 可选：非只读文件（当前为 HTML）编辑后的保存回调 */
  onSave?: (content: string) => Promise<void> | void
}

function isHtmlPath(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  return ext === "html" || ext === "htm"
}

export function FilePreview({ filePath, textContent, onSave }: FilePreviewProps) {
  const category = getFileCategory(filePath)
  const fileName = getFileName(filePath)

  if ((category === "code" || category === "data") && isHtmlPath(filePath)) {
    return <HtmlFilePreview filePath={filePath} content={textContent} onSave={onSave} />
  }

  switch (category) {
    case "image":
      return <ImagePreview filePath={filePath} fileName={fileName} />
    case "video":
      return <VideoPreview filePath={filePath} fileName={fileName} />
    case "audio":
      return <AudioPreview filePath={filePath} fileName={fileName} />
    case "code":
      return <CodePreview filePath={filePath} content={textContent} />
    case "data":
      return <CodePreview filePath={filePath} content={textContent} />
    case "text":
      return <TextPreview filePath={filePath} content={textContent} label="Text" />
    case "document":
      return <BinaryPlaceholder filePath={filePath} fileName={fileName} category={category} />
    default:
      return <BinaryPlaceholder filePath={filePath} fileName={fileName} category={category} />
  }
}

function ImagePreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const [src, setSrc] = useState<string>("")

  useEffect(() => {
    if (isTauri()) {
      import("@tauri-apps/api/core").then(({ convertFileSrc }) => {
        setSrc(convertFileSrc(filePath))
      })
    } else {
      setSrc(filePath)
    }
  }, [filePath])

  if (!src) return null
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 text-xs text-muted-foreground">{filePath}</div>
      <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-muted/30">
        <img
          src={src}
          alt={fileName}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    </div>
  )
}

function VideoPreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const [src, setSrc] = useState<string>("")

  useEffect(() => {
    if (isTauri()) {
      import("@tauri-apps/api/core").then(({ convertFileSrc }) => {
        setSrc(convertFileSrc(filePath))
      })
    } else {
      setSrc(filePath)
    }
  }, [filePath])

  if (!src) return null
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 text-xs text-muted-foreground">{filePath}</div>
      <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-black">
        <video
          src={src}
          controls
          className="max-h-full max-w-full"
        >
          <track kind="captions" label={fileName} />
        </video>
      </div>
    </div>
  )
}

function AudioPreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const [src, setSrc] = useState<string>("")

  useEffect(() => {
    if (isTauri()) {
      import("@tauri-apps/api/core").then(({ convertFileSrc }) => {
        setSrc(convertFileSrc(filePath))
      })
    } else {
      setSrc(filePath)
    }
  }, [filePath])

  if (!src) return null
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="text-xs text-muted-foreground">{filePath}</div>
      <Music className="h-16 w-16 text-muted-foreground/50" />
      <p className="text-sm font-medium">{fileName}</p>
      <audio src={src} controls className="w-full max-w-md">
        <track kind="captions" label={fileName} />
      </audio>
    </div>
  )
}

function CodePreview({ filePath, content }: { filePath: string; content: string }) {
  const lang = getCodeLanguage(filePath)
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{filePath}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{lang}</span>
      </div>
      <pre className="whitespace-pre-wrap rounded-lg bg-muted/30 p-4 font-mono text-sm">
        {content}
      </pre>
    </div>
  )
}

function TextPreview({ filePath, content, label }: { filePath: string; content: string; label: string }) {
  const projectPath = useWikiStore((s) => s.project?.path ?? null)
  const pendingScrollImageSrc = useWikiStore((s) => s.pendingScrollImageSrc)
  const setPendingScrollImageSrc = useWikiStore((s) => s.setPendingScrollImageSrc)
  const scrollRootRef = useRef<HTMLDivElement | null>(null)

  const { frontmatter, body } = useMemo(() => parseFrontmatter(content), [content])
  const renderLanguage = useMemo(() => detectLanguage(body), [body])
  const direction = getTextDirection(renderLanguage)
  const htmlLang = getHtmlLang(renderLanguage)

  useEffect(() => {
    if (!pendingScrollImageSrc) return
    const root = scrollRootRef.current
    if (!root) return
    const escapedSrc = pendingScrollImageSrc
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
    const target = root.querySelector<HTMLImageElement>(
      `img[data-mdsrc="${escapedSrc}"]`,
    )
    if (!target) {
      setPendingScrollImageSrc(null)
      return
    }
    target.scrollIntoView({ behavior: "auto", block: "center" })
    if (!target.complete) {
      const onLoad = () => {
        target.scrollIntoView({ behavior: "smooth", block: "center" })
        target.removeEventListener("load", onLoad)
      }
      target.addEventListener("load", onLoad)
    }
    target.classList.add("ring-2", "ring-primary", "ring-offset-2")
    const tHighlight = setTimeout(() => {
      target.classList.remove("ring-2", "ring-primary", "ring-offset-2")
    }, 1800)
    setPendingScrollImageSrc(null)
    return () => clearTimeout(tHighlight)
  }, [pendingScrollImageSrc, content, setPendingScrollImageSrc])

  return (
    <div ref={scrollRootRef} className="h-full overflow-auto p-6">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{filePath}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{label}</span>
      </div>
      {frontmatter && <FrontmatterPanel data={frontmatter} />}
      <div
        className="prose prose-sm max-w-none break-words dark:prose-invert"
        dir={direction}
        lang={htmlLang}
        style={{ textAlign: "start", overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            img: ({ src, alt, ...props }) => (
              <img
                src={typeof src === "string" ? resolveMarkdownImageSrc(src, projectPath) : undefined}
                data-mdsrc={typeof src === "string" ? src : undefined}
                alt={alt ?? ""}
                className="max-w-full rounded border border-border/40 transition-all"
                loading="lazy"
                {...props}
              />
            ),
            table: ({ children, ...props }) => (
              <div className="my-2 overflow-x-auto rounded border border-border">
                <table className="w-full border-collapse text-xs" {...props}>{children}</table>
              </div>
            ),
            thead: ({ children, ...props }) => (
              <thead className="bg-muted" {...props}>{children}</thead>
            ),
            th: ({ children, ...props }) => (
              <th className="border border-border/80 px-3 py-1.5 text-start font-semibold bg-muted" {...props}>{children}</th>
            ),
            td: ({ children, ...props }) => (
              <td className="border border-border/60 px-3 py-1.5" {...props}>{children}</td>
            ),
            pre: ({ children, ...props }) => {
              const mermaid = unwrapMermaidPre(children)
              if (mermaid) return <>{mermaid}</>
              return <pre dir="ltr" style={{ textAlign: "left" }} {...props}>{children}</pre>
            },
            code: ({ className, children, ...props }) => {
              const lang = className?.replace("language-", "")
              const codeText = String(children).replace(/\n$/, "")
              if (lang === "mermaid") return <MermaidDiagram code={codeText} />
              return <code dir="ltr" className={className} {...props}>{children}</code>
            },
          }}
        >
          {body}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function BinaryPlaceholder({
  filePath,
  fileName,
  category,
}: {
  filePath: string
  fileName: string
  category: FileCategory
}) {
  const iconMap: Record<string, typeof FileText> = {
    document: FileSpreadsheet,
    unknown: FileQuestion,
    image: ImageIcon,
    video: Film,
  }
  const Icon = iconMap[category] ?? FileQuestion

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Icon className="h-16 w-16 text-muted-foreground/30" />
      <div>
        <p className="text-sm font-medium">{fileName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{filePath}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        暂不支持预览该类型文件
      </p>
    </div>
  )
}

interface HtmlFilePreviewProps {
  filePath: string
  content: string
  onSave?: (content: string) => Promise<void> | void
}

/** HTML 文件预览：预览（iframe 沙箱渲染）/ 源码（可编辑保存）切换 */
function HtmlFilePreview({ filePath, content, onSave }: HtmlFilePreviewProps) {
  const [mode, setMode] = useState<"preview" | "source">("preview")
  const [draft, setDraft] = useState(content)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    setDraft(content)
    setDirty(false)
    setMessage("")
  }, [content, filePath])

  const handleSave = async () => {
    if (!onSave || saving) return
    setSaving(true)
    setMessage("")
    try {
      await onSave(draft)
      setDirty(false)
      setMessage("已保存")
    } catch {
      setMessage("保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="truncate" title={filePath}>{filePath}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">HTML</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`rounded border px-2 py-1 flex items-center gap-1 ${mode === "preview" ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
            title="渲染预览"
          >
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <button
            type="button"
            onClick={() => setMode("source")}
            className={`rounded border px-2 py-1 flex items-center gap-1 ${mode === "source" ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
            title="查看并编辑源码"
          >
            <Code2 className="h-3.5 w-3.5" />
            源码
          </button>
          {onSave && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="rounded border px-2 py-1 flex items-center gap-1 disabled:opacity-50 hover:bg-accent"
              title={dirty ? "保存修改到文件" : "无修改"}
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "保存中…" : "保存"}
            </button>
          )}
          {message && <span className="ml-1">{message}</span>}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "preview" ? (
          <iframe
            key={draft.length}
            title="HTML 预览"
            srcDoc={draft}
            sandbox="allow-same-origin"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setDirty(event.target.value !== content)
            }}
            spellCheck={false}
            className="h-full w-full resize-none bg-muted/20 p-4 font-mono text-sm leading-relaxed outline-none"
            dir="ltr"
          />
        )}
      </div>
    </div>
  )
}
