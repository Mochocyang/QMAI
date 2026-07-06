import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { transformWikilinks } from "@/lib/wikilink-transform";
import { resolveRelatedSlug } from "@/lib/wiki-page-resolver";
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver";
import { normalizePath } from "@/lib/path-utils";
import { detectLanguage } from "@/lib/detect-language";
import { getHtmlLang, getTextDirection } from "@/lib/language-metadata";
import { useWikiStore } from "@/stores/wiki-store";
import { MermaidDiagram, unwrapMermaidPre } from "@/components/mermaid-diagram";
import { transformHandcraftZonesForReader } from "@/lib/novel/handcraft-zone";

interface WikiReaderProps {
  body: string;
  /** 当为 true 时，识别 markdown 中的 "### 作者手搓留白" 段并高亮显示 */
  highlightHandcraftZones?: boolean;
}

/**
 * Read-only render of a wiki page body. Distinct from WikiEditor
 * (Milkdown WYSIWYG) because Milkdown round-trips the markdown
 * through prosemirror — applying our wikilink → markdown-link
 * pre-processing there would mean the user's saves overwrite the
 * original `[[…]]` source with `[label](#slug)`. Here, since we
 * never serialize back to disk, transforming for display is safe.
 *
 * Wikilink anchor clicks are intercepted: `#slug` is resolved
 * against the project's wiki tree and routed to setSelectedFile,
 * giving the user single-click navigation between pages.
 */
export function WikiReader({
  body,
  highlightHandcraftZones = false,
}: WikiReaderProps) {
  const project = useWikiStore((s) => s.project);
  const projectPathIndex = useWikiStore((s) => s.projectPathIndex);
  const fileTree = useWikiStore((s) => s.fileTree);
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile);

  const transformed = useMemo(() => {
    let processed = transformWikilinks(body);
    if (highlightHandcraftZones) {
      processed = transformHandcraftZonesForReader(processed);
    }
    return processed;
  }, [body, highlightHandcraftZones]);
  const renderLanguage = detectLanguage(body);
  const direction = getTextDirection(renderLanguage);
  const htmlLang = getHtmlLang(renderLanguage);
  const projectPath = project ? normalizePath(project.path) : null;
  const wikiRoot = projectPath ? `${projectPath}/wiki` : null;

  function handleAnchorClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (!href.startsWith("#")) return;
    e.preventDefault();
    if (!wikiRoot) return;
    const slug = (() => {
      try {
        return decodeURIComponent(href.slice(1));
      } catch {
        return href.slice(1);
      }
    })();
    const path = resolveRelatedSlug(projectPathIndex, slug, wikiRoot, fileTree);
    if (path) setSelectedFile(path);
  }

  return (
    <div
      className="min-w-0 max-w-none text-[15px] leading-7 text-foreground"
      dir={direction}
      lang={htmlLang}
      style={{ textAlign: "start" }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({ children, ...props }) => (
            <h1
              className="mb-5 mt-1 border-b border-border pb-3 text-3xl font-bold leading-tight tracking-tight text-foreground"
              {...props}
            >
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2
              className="mb-4 mt-8 text-2xl font-bold leading-snug tracking-tight text-foreground"
              {...props}
            >
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="mb-3 mt-6 text-xl font-semibold leading-snug text-foreground" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4
              className="mb-2 mt-4 text-base font-semibold leading-snug text-foreground"
              {...props}
            >
              {children}
            </h4>
          ),
          p: ({ children, ...props }) => (
            <p className="my-3 leading-7 text-foreground" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="my-3 list-disc space-y-1 pl-6" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="my-3 list-decimal space-y-1 pl-6" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="pl-1 leading-7" {...props}>
              {children}
            </li>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="my-4 border-l-4 border-primary/50 bg-muted/40 px-4 py-2 text-muted-foreground"
              {...props}
            >
              {children}
            </blockquote>
          ),
          a: ({ href, children, ...props }) => {
            const h = typeof href === "string" ? href : "";
            const isWikilink = h.startsWith("#");
            return (
              <a
                href={h || undefined}
                onClick={(e) => isWikilink && handleAnchorClick(e, h)}
                className={
                  isWikilink
                    ? "cursor-pointer text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                    : "text-primary underline underline-offset-2"
                }
                {...props}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt, ...props }) => (
            <img
              src={
                typeof src === "string"
                  ? resolveMarkdownImageSrc(src, projectPath)
                  : undefined
              }
              data-mdsrc={typeof src === "string" ? src : undefined}
              alt={alt ?? ""}
              className="max-w-full rounded border border-border/40"
              loading="lazy"
              {...props}
            />
          ),
          table: ({ children, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-sm" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-muted" {...props}>
              {children}
            </thead>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border border-border/80 bg-muted px-3 py-1.5 text-start font-semibold"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-border/60 px-3 py-1.5" {...props}>
              {children}
            </td>
          ),
          pre: ({ children, ...props }) => {
            const mermaid = unwrapMermaidPre(children);
            if (mermaid) return <>{mermaid}</>;
            return (
              <pre
                className="my-4 overflow-x-auto rounded-lg border bg-muted p-4 text-sm"
                dir="ltr"
                style={{ textAlign: "left" }}
                {...props}
              >
                {children}
              </pre>
            );
          },
          code: ({ className, children, ...props }) => {
            const lang = className?.replace("language-", "");
            const codeText = String(children).replace(/\n$/, "");
            if (lang === "mermaid") return <MermaidDiagram code={codeText} />;
            return (
              <code
                dir="ltr"
                className={
                  className ?? "rounded bg-muted px-1.5 py-0.5 text-sm"
                }
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {transformed}
      </ReactMarkdown>
    </div>
  );
}
