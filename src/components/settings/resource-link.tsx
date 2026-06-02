import { ExternalLink } from "lucide-react"
import type { ReactNode } from "react"
import { openExternalUrl } from "@/lib/open-external-url"

interface ResourceLinkProps {
  href: string
  title?: string
  children: ReactNode
}

export function ResourceLink({ href, title, children }: ResourceLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={(event) => {
        event.preventDefault()
        void openExternalUrl(href)
      }}
      className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      <span>{children}</span>
    </a>
  )
}
