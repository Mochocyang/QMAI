import type { ChapterSnapshot } from "../chapter-ingest"
import type { RetrievalEntry, VolumeIndex, InvertedIndex } from "./types"
import { DEFAULT_CHAPTERS_PER_VOLUME } from "./types"
import { projectSnapshotToEntry, updateEntryFromSnapshot } from "./snapshot-projection"
import { parseVolumeEntries, serializeVolumeEntries } from "./markdown-serializer"

export interface FsAdapter {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  fileExists: (path: string) => Promise<boolean>
  listDirectory: (path: string) => Promise<string[]>
  createDirectory: (path: string) => Promise<void>
  joinPath: (...parts: string[]) => string
}

export interface RetrievalStoreOptions {
  chaptersPerVolume?: number
}

export class RetrievalStore {
  private projectPath: string
  private fs: FsAdapter
  private chaptersPerVolume: number
  private cache: {
    entries: RetrievalEntry[] | null
    invertedIndex: InvertedIndex | null
    volumes: VolumeIndex[] | null
  } = { entries: null, invertedIndex: null, volumes: null }

  constructor(projectPath: string, fs: FsAdapter, options: RetrievalStoreOptions = {}) {
    this.projectPath = projectPath
    this.fs = fs
    this.chaptersPerVolume = options.chaptersPerVolume || DEFAULT_CHAPTERS_PER_VOLUME
  }

  get retrievalDir(): string {
    return this.fs.joinPath(this.projectPath, "retrieval")
  }

  get indexPath(): string {
    return this.fs.joinPath(this.retrievalDir, "index.md")
  }

  getVolumePath(volumeName: string): string {
    const fileName = this.volumeNameToFileName(volumeName)
    return this.fs.joinPath(this.retrievalDir, fileName)
  }

  volumeNameToFileName(volumeName: string): string {
    const match = volumeName.match(/第(\d+)卷/)
    if (match) return `volume-${match[1]}.md`
    return `${volumeName}.md`
  }

  chapterToVolumeName(chapterNumber: number): string {
    const volumeNum = Math.ceil(chapterNumber / this.chaptersPerVolume)
    return `第${volumeNum}卷`
  }

  async hasIndex(): Promise<boolean> {
    return this.fs.fileExists(this.indexPath)
  }

  async buildFromSnapshots(
    snapshots: ChapterSnapshot[],
    getFilePath: (snapshot: ChapterSnapshot) => string,
    getSourceHash: (snapshot: ChapterSnapshot) => string
  ): Promise<void> {
    await this.fs.createDirectory(this.retrievalDir)

    const entries: RetrievalEntry[] = snapshots.map((snapshot) => {
      const volumeName = this.chapterToVolumeName(snapshot.chapterNumber)
      return projectSnapshotToEntry(snapshot, {
        filePath: getFilePath(snapshot),
        volumeName,
        sourceHash: getSourceHash(snapshot),
      })
    })

    const volumes = this.calculateVolumes(entries)

    for (const volume of volumes) {
      const volumeEntries = entries.filter(
        (e) => e.chapterNumber >= volume.chapterStart && e.chapterNumber <= volume.chapterEnd
      )
      const content = serializeVolumeEntries(volumeEntries, volume.name)
      await this.fs.writeFile(this.getVolumePath(volume.name), content)
    }

    const invertedIndex = this.buildInvertedIndex(entries)
    const indexContent = this.serializeMainIndex(volumes, invertedIndex)
    await this.fs.writeFile(this.indexPath, indexContent)

    this.cache = { entries, invertedIndex, volumes }
  }

  async getAllEntries(): Promise<RetrievalEntry[]> {
    if (this.cache.entries) return this.cache.entries

    const allEntries = await this.loadAllEntriesFromDisk()
    this.cache.entries = allEntries
    return allEntries
  }

  async getVolumes(): Promise<VolumeIndex[]> {
    if (this.cache.volumes) return this.cache.volumes

    const exists = await this.fs.fileExists(this.indexPath)
    if (!exists) {
      this.cache.volumes = []
      return []
    }

    const content = await this.fs.readFile(this.indexPath)
    const volumes = this.parseMainIndexVolumes(content)
    this.cache.volumes = volumes
    return volumes
  }

  async getInvertedIndex(): Promise<InvertedIndex> {
    if (this.cache.invertedIndex) return this.cache.invertedIndex

    const entries = await this.getAllEntries()
    const invertedIndex = this.buildInvertedIndex(entries)
    this.cache.invertedIndex = invertedIndex
    return invertedIndex
  }

  async getEntry(chapterNumber: number): Promise<RetrievalEntry | null> {
    const entries = await this.getAllEntries()
    return entries.find((e) => e.chapterNumber === chapterNumber) || null
  }

  async updateChapterEntry(
    chapterNumber: number,
    snapshot: ChapterSnapshot,
    options: { filePath?: string; sourceHash?: string } = {}
  ): Promise<void> {
    const volumeName = this.chapterToVolumeName(chapterNumber)
    const volumePath = this.getVolumePath(volumeName)

    let entries: RetrievalEntry[] = []
    const exists = await this.fs.fileExists(volumePath)

    if (exists) {
      const content = await this.fs.readFile(volumePath)
      entries = parseVolumeEntries(content)
    } else {
      await this.fs.createDirectory(this.retrievalDir)
    }

    const existingIndex = entries.findIndex((e) => e.chapterNumber === chapterNumber)

    if (existingIndex >= 0) {
      entries[existingIndex] = updateEntryFromSnapshot(entries[existingIndex], snapshot, {
        sourceHash: options.sourceHash,
      })
      if (options.filePath) {
        entries[existingIndex].filePath = options.filePath
      }
      entries[existingIndex].volumeName = volumeName
    } else {
      const newEntry = projectSnapshotToEntry(snapshot, {
        filePath: options.filePath || `wiki/chapters/chapter-${String(chapterNumber).padStart(3, "0")}.md`,
        volumeName,
        sourceHash: options.sourceHash,
      })
      entries.push(newEntry)
    }

    const content = serializeVolumeEntries(entries, volumeName)
    await this.fs.writeFile(volumePath, content)

    this.invalidateCache()
    await this.updateMainIndexIfNeeded()
  }

  async validateEntry(chapterNumber: number, currentHash: string): Promise<{
    valid: boolean
    status: "valid" | "maybe_outdated" | "conflict"
  }> {
    const entry = await this.getEntry(chapterNumber)
    if (!entry) {
      return { valid: false, status: "maybe_outdated" }
    }
    if (!entry.sourceHash) {
      return { valid: false, status: "maybe_outdated" }
    }
    if (entry.sourceHash !== currentHash) {
      return { valid: false, status: "maybe_outdated" }
    }
    return { valid: entry.indexStatus === "valid", status: entry.indexStatus }
  }

  async checkOutdatedEntries(): Promise<{
    total: number
    outdated: number
    maybeOutdated: number
    conflict: number
    chapterNumbers: {
      maybeOutdated: number[]
      conflict: number[]
    }
  }> {
    const entries = await this.getAllEntries()
    const maybeOutdatedChapters: number[] = []
    const conflictChapters: number[] = []

    for (const entry of entries) {
      if (entry.indexStatus === "maybe_outdated") {
        maybeOutdatedChapters.push(entry.chapterNumber)
      } else if (entry.indexStatus === "conflict") {
        conflictChapters.push(entry.chapterNumber)
      }
    }

    return {
      total: entries.length,
      outdated: maybeOutdatedChapters.length + conflictChapters.length,
      maybeOutdated: maybeOutdatedChapters.length,
      conflict: conflictChapters.length,
      chapterNumbers: {
        maybeOutdated: maybeOutdatedChapters.sort((a, b) => a - b),
        conflict: conflictChapters.sort((a, b) => a - b),
      },
    }
  }

  private calculateVolumes(entries: RetrievalEntry[]): VolumeIndex[] {
    if (entries.length === 0) return []

    const maxChapter = Math.max(...entries.map((e) => e.chapterNumber))
    const volumeCount = Math.ceil(maxChapter / this.chaptersPerVolume)
    const volumes: VolumeIndex[] = []

    for (let i = 1; i <= volumeCount; i++) {
      const start = (i - 1) * this.chaptersPerVolume + 1
      const end = Math.min(i * this.chaptersPerVolume, maxChapter)
      volumes.push({
        name: `第${i}卷`,
        fileName: `volume-${i}.md`,
        chapterStart: start,
        chapterEnd: end,
      })
    }

    return volumes
  }

  private buildInvertedIndex(entries: RetrievalEntry[]): InvertedIndex {
    const foreshadowing: Record<string, number[]> = {}
    const characters: Record<string, number[]> = {}
    const timeline: Record<string, number[]> = {}

    for (const entry of entries) {
      const foreshadowingMatches = entry.foreshadowingChanges.match(/[新埋伏笔|回收伏笔]([^；,，。]+)/g)
      if (foreshadowingMatches) {
        for (const match of foreshadowingMatches) {
          const name = match.replace(/^(新埋伏笔|回收伏笔)/, "").trim()
          if (name) {
            if (!foreshadowing[name]) foreshadowing[name] = []
            if (!foreshadowing[name].includes(entry.chapterNumber)) {
              foreshadowing[name].push(entry.chapterNumber)
            }
          }
        }
      }

      const characterMatches = entry.characterStates.match(/([^；,，。\s]+?)[（(]/g)
      if (characterMatches) {
        for (const match of characterMatches) {
          const name = match.replace(/[（(].*$/, "").trim()
          if (name && name.length >= 2) {
            if (!characters[name]) characters[name] = []
            if (!characters[name].includes(entry.chapterNumber)) {
              characters[name].push(entry.chapterNumber)
            }
          }
        }
      }

      const timelineMatches = entry.timelineEvents.match(/([^；,，。]+?)[-—]/g)
      if (timelineMatches) {
        for (const match of timelineMatches) {
          const point = match.replace(/[-—].*$/, "").trim()
          if (point) {
            if (!timeline[point]) timeline[point] = []
            if (!timeline[point].includes(entry.chapterNumber)) {
              timeline[point].push(entry.chapterNumber)
            }
          }
        }
      }
    }

    return { foreshadowing, characters, timeline }
  }

  private serializeMainIndex(volumes: VolumeIndex[], invertedIndex: InvertedIndex): string {
    const lines: string[] = []
    lines.push("# 检索主索引")
    lines.push("")
    lines.push("## 分卷目录")
    for (const v of volumes) {
      lines.push(`- ${v.name}：retrieval/${v.fileName}（第${v.chapterStart}-${v.chapterEnd}章）`)
    }
    lines.push("")
    lines.push("## 伏笔倒排索引")
    for (const [name, chapters] of Object.entries(invertedIndex.foreshadowing)) {
      lines.push(`- ${name}：${chapters.map((c) => `第${c}章`).join(", ")}`)
    }
    if (Object.keys(invertedIndex.foreshadowing).length === 0) {
      lines.push("- 暂无")
    }
    lines.push("")
    lines.push("## 人物倒排索引")
    for (const [name, chapters] of Object.entries(invertedIndex.characters)) {
      lines.push(`- ${name}：${chapters.map((c) => `第${c}章`).join(", ")}`)
    }
    if (Object.keys(invertedIndex.characters).length === 0) {
      lines.push("- 暂无")
    }
    lines.push("")
    lines.push("## 时间线倒排索引")
    for (const [point, chapters] of Object.entries(invertedIndex.timeline)) {
      lines.push(`- ${point}：${chapters.map((c) => `第${c}章`).join(", ")}`)
    }
    if (Object.keys(invertedIndex.timeline).length === 0) {
      lines.push("- 暂无")
    }
    lines.push("")
    return lines.join("\n")
  }

  private parseMainIndexVolumes(content: string): VolumeIndex[] {
    const volumes: VolumeIndex[] = []
    const lines = content.split("\n")
    let inVolumeSection = false

    for (const line of lines) {
      if (line.startsWith("## 分卷目录")) {
        inVolumeSection = true
        continue
      }
      if (inVolumeSection && line.startsWith("## ")) {
        break
      }
      if (inVolumeSection && line.startsWith("- ")) {
        const match = line.match(/- (第\d+卷)：retrieval\/([^（]+)（第(\d+)-(\d+)章）/)
        if (match) {
          volumes.push({
            name: match[1],
            fileName: match[2].trim(),
            chapterStart: parseInt(match[3], 10),
            chapterEnd: parseInt(match[4], 10),
          })
        }
      }
    }

    return volumes
  }

  private async updateMainIndexIfNeeded(): Promise<void> {
    const exists = await this.fs.fileExists(this.indexPath)
    if (!exists) return

    const allEntries = await this.loadAllEntriesFromDisk()
    const volumes = this.calculateVolumes(allEntries)
    const invertedIndex = this.buildInvertedIndex(allEntries)
    const content = this.serializeMainIndex(volumes, invertedIndex)
    await this.fs.writeFile(this.indexPath, content)

    this.cache.volumes = volumes
    this.cache.invertedIndex = invertedIndex
    this.cache.entries = allEntries
  }

  private async loadAllEntriesFromDisk(): Promise<RetrievalEntry[]> {
    const allEntries: RetrievalEntry[] = []
    try {
      const files = await this.fs.listDirectory(this.retrievalDir)
      const volumeFiles = files.filter((f) => /volume-\d+\.md$/.test(f))

      for (const file of volumeFiles) {
        try {
          const filePath = this.fs.joinPath(this.retrievalDir, file)
          const content = await this.fs.readFile(filePath)
          const entries = parseVolumeEntries(content)
          allEntries.push(...entries)
        } catch {
          // 跳过无法读取的卷
        }
      }
    } catch {
      // 目录不存在或无法列出
    }
    return allEntries
  }

  invalidateCache(): void {
    this.cache = { entries: null, invertedIndex: null, volumes: null }
  }
}
