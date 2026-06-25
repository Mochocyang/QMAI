import { useEffect } from "react"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"

export interface QueryPageReference {
  title: string
  path: string
}

let cachedSourceFiles: string[] = []
let lastQueryPages: QueryPageReference[] = []

export function useSourceFiles() {
  const project = useWikiStore((s) => s.project)

  useEffect(() => {
    if (!project) return
    const pp = normalizePath(project.path)
    listDirectory(`${pp}/raw/sources`)
      .then((tree) => {
        cachedSourceFiles = flattenNames(tree)
      })
      .catch(() => {
        cachedSourceFiles = []
      })
  }, [project])

  return cachedSourceFiles
}

export function getLastQueryPages(): QueryPageReference[] {
  return lastQueryPages
}

export function setLastQueryPages(pages: QueryPageReference[]) {
  lastQueryPages = pages
}

function flattenNames(nodes: FileNode[]): string[] {
  const names: string[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      names.push(...flattenNames(node.children))
    } else if (!node.is_dir) {
      names.push(node.name)
    }
  }
  return names
}
