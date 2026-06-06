import type { FileNode } from "@/types/wiki"

const FS_PREFIX = "llm-wiki-fs:"

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/$/, "")
}

class WebFileSystem {
  private files: Map<string, string>
  private dirs: Set<string>

  constructor() {
    this.files = new Map()
    this.dirs = new Set()
    this.loadFromLocalStorage()
  }

  private loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(FS_PREFIX + "root")
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.files) {
          for (const [key, value] of Object.entries(parsed.files)) {
            this.files.set(key, value as string)
          }
        }
        if (parsed.dirs) {
          for (const dir of parsed.dirs as string[]) {
            this.dirs.add(dir)
          }
        }
      }
    } catch {}
  }

  private saveToLocalStorage() {
    try {
      const obj = {
        files: Object.fromEntries(this.files.entries()),
        dirs: Array.from(this.dirs.values()),
      }
      localStorage.setItem(FS_PREFIX + "root", JSON.stringify(obj))
    } catch {}
  }

  private ensureParentDirs(filePath: string) {
    const parts = filePath.split("/")
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/")
      this.dirs.add(dir)
    }
  }

  private hasAnyContentUnderPath(path: string): boolean {
    for (const [filePath] of this.files.entries()) {
      if (filePath.startsWith(path + "/")) return true
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(path + "/")) return true
    }
    return false
  }

  async readFile(path: string): Promise<string> {
    const np = normalizeFsPath(path)
    const content = this.files.get(np)
    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }
    return content
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const np = normalizeFsPath(path)
    this.ensureParentDirs(np)
    this.files.set(np, contents)
    this.saveToLocalStorage()
  }

  async listDirectory(path: string): Promise<FileNode[]> {
    return this.listDirectoryTree(normalizeFsPath(path))
  }

  private listDirectoryTree(normalizedPath: string): FileNode[] {
    type MutableDirNode = {
      name: string
      path: string
      is_dir: true
      children: Map<string, MutableTreeNode>
    }
    type MutableFileNode = {
      name: string
      path: string
      is_dir: false
    }
    type MutableTreeNode = MutableDirNode | MutableFileNode

    const rootChildren = new Map<string, MutableTreeNode>()
    const prefix = `${normalizedPath}/`

    const ensureDir = (
      children: Map<string, MutableTreeNode>,
      name: string,
      path: string,
    ): MutableDirNode => {
      const existing = children.get(name)
      if (existing?.is_dir) return existing
      const node: MutableDirNode = {
        name,
        path,
        is_dir: true,
        children: new Map(),
      }
      children.set(name, node)
      return node
    }

    const addDir = (dirPath: string) => {
      if (!dirPath.startsWith(prefix)) return
      const segments = dirPath.slice(prefix.length).split("/").filter(Boolean)
      if (segments.length === 0) return

      let children = rootChildren
      let currentPath = normalizedPath
      for (const segment of segments) {
        currentPath = `${currentPath}/${segment}`
        const node = ensureDir(children, segment, currentPath)
        children = node.children
      }
    }

    const addFile = (filePath: string) => {
      if (!filePath.startsWith(prefix)) return
      const segments = filePath.slice(prefix.length).split("/").filter(Boolean)
      if (segments.length === 0) return

      let children = rootChildren
      let currentPath = normalizedPath
      for (const segment of segments.slice(0, -1)) {
        currentPath = `${currentPath}/${segment}`
        const node = ensureDir(children, segment, currentPath)
        children = node.children
      }

      const fileName = segments[segments.length - 1]
      const existing = children.get(fileName)
      if (!existing) {
        children.set(fileName, {
          name: fileName,
          path: filePath,
          is_dir: false,
        })
      }
    }

    const toFileNodes = (children: Map<string, MutableTreeNode>): FileNode[] => {
      const nodes: FileNode[] = []
      for (const node of children.values()) {
        if (node.is_dir) {
          nodes.push({
            name: node.name,
            path: node.path,
            is_dir: true,
            children: toFileNodes(node.children),
          })
        } else {
          nodes.push({
            name: node.name,
            path: node.path,
            is_dir: false,
          })
        }
      }
      return nodes
    }

    for (const [filePath] of this.files.entries()) {
      addFile(filePath)
    }
    for (const dir of this.dirs) {
      addDir(dir)
    }

    return toFileNodes(rootChildren)
  }

  async createDirectory(path: string): Promise<void> {
    const np = normalizeFsPath(path)
    this.dirs.add(np)
    this.ensureParentDirs(np)
    this.saveToLocalStorage()
  }

  async deleteFile(path: string): Promise<void> {
    const np = normalizeFsPath(path)
    this.files.delete(np)
    this.saveToLocalStorage()
  }

  async fileExists(path: string): Promise<boolean> {
    const np = normalizeFsPath(path)
    return this.files.has(np) || this.dirs.has(np)
  }

  async getFileModifiedTime(_path: string): Promise<number> {
    return Date.now()
  }

  async getFileSize(path: string): Promise<number> {
    const content = this.files.get(normalizeFsPath(path))
    return content ? new Blob([content]).size : 0
  }

  async getFileMd5(_path: string): Promise<string> {
    return "web-dummy-md5"
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const content = this.files.get(normalizeFsPath(source))
    if (content === undefined) {
      throw new Error(`Source file not found: ${source}`)
    }
    await this.writeFile(destination, content)
  }

  async copyDirectory(source: string, destination: string): Promise<string[]> {
    const copied: string[] = []
    const normalizedSource = normalizeFsPath(source)
    for (const [filePath, content] of this.files.entries()) {
      if (!filePath.startsWith(normalizedSource + "/")) continue
      const relative = filePath.slice(normalizedSource.length)
      const newPath = normalizeFsPath(destination) + relative
      await this.writeFile(newPath, content)
      copied.push(newPath)
    }
    return copied
  }

  async preprocessFile(path: string): Promise<string> {
    return this.readFile(path)
  }

  async findRelatedWikiPages(_projectPath: string, _sourceName: string): Promise<string[]> {
    return []
  }

  async readFileAsBase64(_path: string): Promise<{ base64: string; mimeType: string }> {
    return { base64: "", mimeType: "application/octet-stream" }
  }

  async openProjectFolder(_path: string): Promise<void> {}

  async clipServerStatus(): Promise<string> {
    return "unavailable"
  }

  async getExecutableDir(): Promise<string> {
    return typeof process !== "undefined" && process.cwd ? process.cwd() : ""
  }

  async getResourceDir(): Promise<string> {
    return typeof process !== "undefined" && process.cwd ? process.cwd() : ""
  }

  async createProject(name: string, path: string): Promise<{ name: string; path: string }> {
    const np = normalizeFsPath(path)
    const root = `${np}/${name}`
    this.dirs.add(np)
    this.dirs.add(root)
    this.dirs.add(`${root}/wiki`)
    this.saveToLocalStorage()
    return { name, path: root }
  }

  async openProject(path: string): Promise<{ name: string; path: string }> {
    const np = normalizeFsPath(path)
    const name = np.split("/").pop() || "Unknown"

    if (!this.hasAnyContentUnderPath(np)) {
      this.initProjectWithDemoData(np, name)
    }

    return { name, path: np }
  }

  initProjectWithTemplate(projectPath: string, template: { schema: string; purpose: string; extraDirs: string[] }) {
    const pp = normalizeFsPath(projectPath)
    this.dirs.add(pp)
    this.dirs.add(`${pp}/wiki`)
    this.files.set(`${pp}/schema.md`, template.schema)
    this.files.set(`${pp}/purpose.md`, template.purpose)
    for (const dir of template.extraDirs) {
      this.dirs.add(`${pp}/${dir}`)
    }
    this.saveToLocalStorage()
  }

  private initProjectWithDemoData(pp: string, name: string) {
    this.dirs.add(pp)
    this.dirs.add(`${pp}/wiki`)
    this.dirs.add(`${pp}/wiki/entities`)
    this.dirs.add(`${pp}/wiki/concepts`)
    this.dirs.add(`${pp}/wiki/sources`)
    this.dirs.add(`${pp}/raw`)
    this.dirs.add(`${pp}/raw/sources`)

    this.files.set(`${pp}/schema.md`, `# Wiki Schema\n\n## Page Types\n\n| Type | Directory | Purpose |\n|------|-----------|---------|\n| entity | wiki/entities/ | Named things |\n| concept | wiki/concepts/ | Ideas and techniques |\n| source | wiki/sources/ | References |\n| overview | wiki/ | Project summary |\n`)

    this.files.set(`${pp}/purpose.md`, `# Project Purpose — ${name}\n\n## Goal\n\n<!-- What are you trying to understand or build? -->\n\n## Key Questions\n\n1.\n2.\n3.\n\n## Scope\n\n**In scope:**\n-\n\n**Out of scope:**\n-\n`)

    this.files.set(`${pp}/wiki/index.md`, `# ${name}\n\n欢迎使用项目资料库。\n\n## 页面\n\n### 实体\n\n- 暂无实体\n\n### 概念\n\n- 暂无概念\n\n### 资料\n\n- 暂无资料\n`)

    this.files.set(`${pp}/wiki/entities/示例实体.md`, `---\ntype: entity\ntitle: 示例实体\ntags: []\nrelated: []\ncreated: ${new Date().toISOString().split("T")[0]}\nupdated: ${new Date().toISOString().split("T")[0]}\n---\n\n# 示例实体\n\n这是一个示例实体页面，请替换为你的正式内容。\n`)

    this.files.set(`${pp}/wiki/concepts/示例概念.md`, `---\ntype: concept\ntitle: 示例概念\ntags: []\nrelated: []\ncreated: ${new Date().toISOString().split("T")[0]}\nupdated: ${new Date().toISOString().split("T")[0]}\n---\n\n# 示例概念\n\n这是一个示例概念页面，请替换为你的正式内容。\n`)

    this.saveToLocalStorage()
  }
}

let webFsInstance: WebFileSystem | null = null

export function getWebFs(): WebFileSystem {
  if (!webFsInstance) {
    webFsInstance = new WebFileSystem()
  }
  return webFsInstance
}
