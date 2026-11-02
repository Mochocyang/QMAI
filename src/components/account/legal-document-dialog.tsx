import { useMemo, useState } from "react"
import { FileText, ShieldCheck } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PRIVACY_BLOCKS, TERMS_BLOCKS } from "@/lib/account/legal-content"
import { LEGAL_TERMS_VERSION } from "@/lib/account/legal-consent"
import type { LegalBlock } from "@/lib/account/legal-block-types"

/**
 * 软件内的条款阅读器。
 *
 * ── 为什么要在软件里看，而不是只给外链 ──
 *
 * 条款挂在外网（qmai.pro/legal），但在中国大陆访问 Cloudflare 全球节点并不稳定。
 * 用户点「同意」时如果只弹出外部浏览器且打不开，**就等于没有给出可读入口**，
 * 这样取得的「同意」在法律上是站不住的。
 *
 * 客户端又无法感知外部浏览器是否加载成功（那是系统浏览器，不是我们的 WebView），
 * 所以「打不开就自动回退到备用地址」这种自动方案做不到。
 *
 * 最可靠的做法：条款正文随安装包一起分发，软件内直接打开，**完全不依赖网络**。
 * 外链仍然保留，供需要在线地址的场景（如开放平台审核）使用。
 *
 * 正文由 scripts/build-legal-site.mjs 从同一份 md 生成，
 * 与 qmai.pro/legal 上的网页版永远一致。
 */

type DocKey = "terms" | "privacy"

const DOCS: Record<DocKey, { label: string; blocks: LegalBlock[] }> = {
  terms: { label: "服务条款", blocks: TERMS_BLOCKS },
  privacy: { label: "隐私政策", blocks: PRIVACY_BLOCKS },
}

/** 渲染一个块。只处理生成器实际产出的 7 种类型。 */
function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "h1":
      return <h1 className="mb-2 text-xl font-semibold">{block.text}</h1>
    case "h2":
      return (
        <h2
          id={block.id}
          className="mt-7 border-t pt-5 text-[15px] font-semibold first:mt-0 first:border-t-0 first:pt-0"
        >
          {block.text}
        </h2>
      )
    case "h3":
      return <h3 className="mt-4 text-sm font-medium">{block.text}</h3>
    case "quote":
      return (
        <blockquote className="my-3 border-l-2 border-primary/30 bg-muted/40 px-3 py-2 text-[13px] leading-6 text-muted-foreground">
          {block.text}
        </blockquote>
      )
    case "list":
      return (
        <ul className="my-2 list-disc space-y-1 pl-5 text-[13px] leading-6 text-muted-foreground">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )
    case "table":
      return (
        <div className="my-3 overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} className="whitespace-nowrap bg-muted px-2.5 py-2 text-left font-medium">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.body.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-t px-2.5 py-2 align-top text-muted-foreground">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "paragraph":
    default:
      return <p className="my-1.5 text-[13px] leading-6 text-muted-foreground">{block.text}</p>
  }
}

export function LegalDocumentDialog({
  open,
  initialDoc = "terms",
  onClose,
}: {
  open: boolean
  initialDoc?: DocKey
  onClose: () => void
}) {
  const [doc, setDoc] = useState<DocKey>(initialDoc)

  // 打开时跟随传入的 tab，避免「点了隐私政策却停在服务条款」。
  const activeDoc = useMemo<DocKey>(() => doc, [doc])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
        else setDoc(initialDoc)
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 p-0" data-ui="legal-document-dialog">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            服务条款与隐私政策
            <span className="text-xs font-normal text-muted-foreground">版本 {LEGAL_TERMS_VERSION}</span>
          </DialogTitle>
          <div className="mt-2 flex gap-1" role="tablist" aria-label="条款切换">
            {(Object.keys(DOCS) as DocKey[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeDoc === key}
                onClick={() => setDoc(key)}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                  activeDoc === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {DOCS[key].label}
              </button>
            ))}
          </div>
        </DialogHeader>

        {/*
         * 正文区独立滚动：条款很长（服务条款 19 章、隐私政策 27 章），
         * 让整个弹窗滚动会把标题和 tab 一起滚出去。
         */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-ui="legal-document-body">
          {DOCS[activeDoc].blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
          <p className="mt-6 flex items-center gap-1.5 border-t pt-4 text-[11px] text-muted-foreground">
            <FileText className="h-3 w-3" />
            本文本随软件分发，与 qmai.pro/legal 在线版本一致。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
