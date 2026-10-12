import { listDirectory, readFile } from "@/commands/fs"
import type { NovelTaskIntent } from "./task-router"

export function extractChapterNumber(text: string): number | null {
  const m = text.match(/第\s*(\d+)\s*[章节回]/)
  if (m?.[1]) return Number.parseInt(m[1], 10)
  const n = text.match(/(\d+)/)
  if (n?.[1]) return Number.parseInt(n[1], 10)
  return null
}

export function flattenMdFiles(nodes: Array<{ name: string; path: string; is_dir: boolean; children?: any[] }>): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) out.push(...flattenMdFiles(node.children))
      continue
    }
    if (node.name.endsWith(".md")) {
      out.push({ name: node.name, path: node.path })
    }
  }
  return out.sort((a, b) => {
    const aNum = extractChapterNumber(a.name)
    const bNum = extractChapterNumber(b.name)
    if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum
    if (aNum !== null && bNum === null) return -1
    if (aNum === null && bNum !== null) return 1
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true })
  })
}

export async function getNextChapterNumber(projectPath: string): Promise<number> {
  let maxNum = 0
  let hasChapterOne = false
  try {
    const tree = await listDirectory(`${projectPath}/wiki/chapters`)
    const files = flattenMdFiles(tree)
    for (const file of files) {
      const byName = extractChapterNumber(file.name.replace(/\.md$/, ""))
      if (byName) {
        if (byName === 1) hasChapterOne = true
        if (byName > maxNum) maxNum = byName
      }
      try {
        const content = await readFile(file.path)
        const byFrontmatter = content.match(/^chapter_number:\s*(\d+)\s*$/m)
        if (byFrontmatter?.[1]) {
          const n = Number.parseInt(byFrontmatter[1], 10)
          if (n === 1) hasChapterOne = true
          if (n > maxNum) maxNum = n
        } else {
          const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m)
          const byTitle = titleMatch?.[1] ? extractChapterNumber(titleMatch[1]) : null
          if (byTitle) {
            if (byTitle === 1) hasChapterOne = true
            if (byTitle > maxNum) maxNum = byTitle
          }
        }
      } catch {
        // ignore unreadable chapter file
      }
    }
  } catch {
    // chapter dir may not exist yet
  }
  if (!hasChapterOne && maxNum === 0) return 1
  return maxNum + 1
}

export async function findChapterFileByNumber(projectPath: string, chapterNumber: number): Promise<string | null> {
  try {
    const tree = await listDirectory(`${projectPath}/wiki/chapters`)
    const files = flattenMdFiles(tree)
    for (const file of files) {
      const byName = extractChapterNumber(file.name.replace(/\.md$/, ""))
      if (byName === chapterNumber) return file.path
      try {
        const content = await readFile(file.path)
        const byFrontmatter = content.match(/^chapter_number:\s*(\d+)\s*$/m)
        if (byFrontmatter?.[1] && Number.parseInt(byFrontmatter[1], 10) === chapterNumber) {
          return file.path
        }
      } catch {
        // ignore unreadable chapter file
      }
    }
  } catch {
    // chapter dir may not exist yet
  }
  return null
}

interface ResolveTargetChapterNumberForChatInput {
  projectPath: string
  userRequest: string
  routeIntent?: NovelTaskIntent
  routeChapterNumber?: number
  selectedFile?: string | null
  /**
   * 当前会话里上一次已生成章节的章节号（可能还没保存到章节库）。
   * 修复 issue #6：第1章生成成功但尚未保存时，点击“继续生成下一章”
   * 不应因为章节库为空而再次生成第1章。
   */
  lastGeneratedChapterNumber?: number | null
}

export async function resolveTargetChapterNumberForChat(input: ResolveTargetChapterNumberForChatInput): Promise<number | undefined> {
  if (input.routeChapterNumber && input.routeChapterNumber > 0) {
    return input.routeChapterNumber
  }

  if (!shouldResolveNextChapter(input.userRequest, input.routeIntent)) {
    // general_chat 意图下，尝试从已选文件或上次生成章节推断章节号
    // 避免上下文包无法构建（阶段1显示"未读取到明确章节目标"）
    if (input.routeIntent === "general_chat") {
      const fromSelected = await readSelectedChapterNumber(input.selectedFile)
      if (fromSelected && fromSelected > 0) return fromSelected
      const lastGen = input.lastGeneratedChapterNumber ?? 0
      if (lastGen > 0) return lastGen
    }
    return undefined
  }

  const lastGenerated = input.lastGeneratedChapterNumber ?? 0
  const minimumNextChapter = lastGenerated > 0 ? lastGenerated + 1 : 0

  const selectedChapterNumber = await readSelectedChapterNumber(input.selectedFile)
  if (selectedChapterNumber && selectedChapterNumber > 0) {
    return Math.max(selectedChapterNumber + 1, minimumNextChapter)
  }

  return Math.max(await getNextChapterNumber(input.projectPath), minimumNextChapter)
}

const GENERATED_CHAPTER_PATTERNS = [
  // 深度生成思考过程中的目标章节标记
  /目标章节：第(\d+)章/,
  /按黄金三章规则生成第(\d+)章正文/,
  // 章节正文标题行
  /^#\s*第\s*(\d+)\s*章/m,
]

/**
 * 从会话的 AI 回复内容里识别上一次生成的章节号。
 * 只匹配章节生成特有的强标记（思考过程目标章节、正文标题行），
 * 避免普通问答里顺带提到“第N章”造成误判。
 */
export function detectLastGeneratedChapterNumber(assistantContents: string[]): number | undefined {
  for (let index = assistantContents.length - 1; index >= 0; index -= 1) {
    const content = assistantContents[index]
    if (!content) continue
    for (const pattern of GENERATED_CHAPTER_PATTERNS) {
      const match = content.match(pattern)
      if (match?.[1]) {
        const chapterNumber = Number.parseInt(match[1], 10)
        if (Number.isFinite(chapterNumber) && chapterNumber > 0) return chapterNumber
      }
    }
  }
  return undefined
}

function shouldResolveNextChapter(userRequest: string, routeIntent?: NovelTaskIntent): boolean {
  if (routeIntent !== "continue_chapter" && routeIntent !== "write_chapter") return false
  const compact = userRequest.replace(/\s+/g, "")
  return /下一章|下1章|下章|新的?一章/.test(compact)
}

async function readSelectedChapterNumber(selectedFile?: string | null): Promise<number | undefined> {
  if (!selectedFile) return undefined
  const normalized = selectedFile.replace(/\\/g, "/")
  if (!/\/wiki\/chapters\//i.test(normalized)) return undefined

  const byName = extractChapterNumber(normalized.split("/").pop()?.replace(/\.md$/i, "") ?? "")
  if (byName) return byName

  try {
    const content = await readFile(selectedFile)
    const byFrontmatter = content.match(/^chapter_number:\s*(\d+)\s*$/m)
    if (byFrontmatter?.[1]) {
      const n = Number.parseInt(byFrontmatter[1], 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch {
    // ignore unreadable selected chapter file
  }
  return undefined
}

export async function readSelectedChapterNumberForFile(selectedFile?: string | null): Promise<number | undefined> {
  return readSelectedChapterNumber(selectedFile)
}

/**
 * 路径兜底只认显式的「第N章」写法。
 *
 * 不能直接用 extractChapterNumber：它末尾有一条纯数字回退（为 chapter-006.md 这类文件名准备），
 * 套在项目绝对路径上会把目录名里的数字（如 …/QMAI-main2/… 或 …/scratch-20261010/…）当成章号。
 */
function explicitChapterNumberInPath(path: string): number | null {
  const matched = path.match(/第\s*(\d+)\s*[章节回]/)
  if (!matched) return null
  const parsed = Number.parseInt(matched[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 从整棵项目树里挑出章节库文件（wiki/chapters）。
 *
 * 「下一章」探测必须只看章节库：resolveNextChapterNumber 走的是文件名解析，
 * 而项目树里还有「章纲-第046章-….md」「事件细纲-第012章.md」「2026-10-10-灵感记录.md」
 * 这类文件，章号/日期会被当成章节号，把默认章号顶到 47 甚至 2027。
 *
 * 正则靠结尾的斜杠锚住 chapters 这一段，因此 wiki/chapters-archive/、
 * wiki/outline-chapters-notes/ 这类相邻目录名不会被误收。
 */
export function pickChapterLibraryFiles(
  files: Array<{ name: string; path: string }>,
): Array<{ name: string; path: string }> {
  return files.filter((file) => /[\\/]wiki[\\/]chapters[\\/]/.test(file.path))
}

/**
 * 探测「下一章」章号：章节库里最大章号 + 1。
 *
 * 只认文件名或路径里的章号，因此「序章」「设定」这类不带章号的文件会被忽略；
 * 空库或全无章号时回落到第 1 章。
 *
 * 文件名用 extractChapterNumber（宽松，chapter-006.md 也算），路径兜底只用
 * explicitChapterNumberInPath（严格）——面板传进来的是项目绝对路径，宽松匹配会读串目录名。
 */
export function resolveNextChapterNumber(
  files: Array<{ name: string; path: string }>,
): number {
  let max = 0
  for (const file of files) {
    const fromName = extractChapterNumber(file.name)
    const fromPath = fromName ?? explicitChapterNumberInPath(file.path)
    if (fromPath !== null && fromPath > max) max = fromPath
  }
  return max + 1
}

/**
 * ── 章号的三个解析函数：从「章节树」搬到本模块（共享）──
 *
 * 搬家的理由是一个真实缺陷：侧栏的「已提取记忆」绿点与编辑器标题行的
 * 「正式/草稿」徽章本应描述**同一件事**（这一章的记忆快照是否存在），
 * 却各自算了一遍章号 —— 绿点用下面这套解析（它原先私有在
 * `knowledge-tree.tsx` 里），徽章用 frontmatter 的 `chapter_number`。
 * 两份实现只在「两个来源恰好都指向同一个号」时才一致，而那正是
 * 「没有提取过记忆的章节却显示正式」这一类不一致的来源。
 *
 * 现在两者都调用 `resolveChapterDotNumbers`，按构造不可能算出差号。
 * ⚠️ 这三个函数的**实现一字未改**（包括正则里的大小写与换行符口径），
 * 因为搬家不能顺带改语义：`parsePageInfo` 里还有别的调用方依赖它们。
 */
export function parseChineseNumber(input: string): number | null {
  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }

  if (/^\d+$/.test(input)) return Number.parseInt(input, 10)
  if (input === "十") return 10

  const tenIndex = input.indexOf("十")
  if (tenIndex >= 0) {
    const left = input.slice(0, tenIndex)
    const right = input.slice(tenIndex + 1)
    const tens = left ? (digitMap[left] ?? 0) : 1
    const units = right ? (digitMap[right] ?? 0) : 0
    return tens * 10 + units
  }

  let value = 0
  for (const ch of input) {
    const digit = digitMap[ch]
    if (digit === undefined) return null
    value = value * 10 + digit
  }
  return value
}

export function extractPageOrderFromTitle(title: string): number | null {
  const titleMatch = title.match(/第\s*([0-9零一二两三四五六七八九十]+)\s*[章节卷]/)
  if (titleMatch?.[1]) {
    const value = parseChineseNumber(titleMatch[1])
    if (value !== null) return value
  }

  const numberMatch = title.match(/(\d+)/)
  if (numberMatch?.[1]) return Number.parseInt(numberMatch[1], 10)
  return null
}

/**
 * 只认**不加引号**的 `chapter_number: 13`。
 *
 * ⚠️ 这条口径是刻意保留的（不是疏漏）：`chapter_number: '13'` 取不到号，
 * 于是回退到标题里的「第N章」。本仓库有一处注释专门记录过这种真实文件
 * （「chapter-015.md 的 frontmatter 是 13、文件名是 15、标题写着第 8 章」）——
 * 三处数字互不相同，**先认哪个决定了绿点亮在哪一章上**。
 * 绿点一直认的是「内容里不加引号的号 → 标题里的号 → 文件名里的号」，
 * 徽章现在跟它走同一条路，所以两者不会对不上。
 */
export function extractChapterNumberFromContent(content: string): number | null {
  const match = content.match(/^chapter_number:\s*(\d+)\s*$/m)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * 页面的显示标题 —— 与 `knowledge-tree.tsx` 的 `parsePageInfo` 完全同源。
 *
 * 抽出来的唯一原因：`resolveChapterDotNumbers` 需要**同一个**标题去回退取号，
 * 而「标题」在树里的推导规则是三级的（frontmatter `title` → 首个 `#` 标题 →
 * 文件名去连字符）。若徽章那边自己写一份，就又回到"两套规则"的老问题上。
 *
 * ⚠️ 三级回退的第三级比较用的是**去连字符后**的文件名，且大小写敏感
 * （`.md` 而非 `.mdx`），与树里逐字一致。
 */
export function resolveChapterPageTitle(fileName: string, content: string): string {
  const stem = fileName.replace(/\.md$/, "").replace(/-/g, " ")
  let title = stem

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const titleMatch = frontmatterMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (titleMatch?.[1]) title = titleMatch[1].trim()
  }

  if (title === stem) {
    const headingMatch = content.match(/^#\s+(.+)$/m)
    if (headingMatch?.[1]) title = headingMatch[1].trim()
  }

  return title
}

/**
 * 「这一章的快照会用哪个号」—— 绿点与徽章的**唯一**取号入口。
 *
 * 返回值直接喂给 `resolveChapterMemoryDotState`：
 *   · `chapterNumber` 优先（`ingestChapter` 收到的就是它）；
 *   · 取不到时才回退 `fileChapterNumber`（`chapter-003.md` 这类只在文件名里带号的）。
 *
 * 输入刻意只有「文件内容 + 文件路径」两项 —— 两者在章节树与编辑器里
 * 都是同一份字符串，所以两处**必然**算出同一个号。不传 title 进来，
 * 就是为了不给"两边各写一个标题推导"留后门。
 */
export function resolveChapterDotNumbers(input: {
  content: string
  filePath: string
}): { chapterNumber?: number; fileChapterNumber?: number } {
  const fileName = input.filePath.split(/[\\/]/).pop() ?? ""
  const title = resolveChapterPageTitle(fileName, input.content)
  return {
    chapterNumber:
      extractChapterNumberFromContent(input.content) ??
      extractPageOrderFromTitle(title) ??
      undefined,
    fileChapterNumber: extractChapterNumber(fileName.replace(/\.md$/i, "")) ?? undefined,
  }
}
