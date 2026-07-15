export interface WikiProject {
  /** Stable UUID, persisted inside the project at .qmai/project.json.
   *  Survives the user moving or renaming the project folder. */
  id: string
  name: string
  path: string
}

export interface FileNode {
  name: string
  path: string
  is_dir: boolean
  mtimeMs?: number
  size?: number
  children?: FileNode[]
}

export interface WikiPage {
  path: string
  content: string
  frontmatter: Record<string, unknown>
}
