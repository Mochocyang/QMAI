import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter";

export type ChapterStatus =
  "outline" | "draft" | "revised" | "final" | "archived";
export type OutlineType =
  "chapter-outline" | "volume-outline" | "story-outline";

export interface ChapterMeta {
  chapterNumber: number;
  status: ChapterStatus;
  outlineType?: OutlineType;
  /** 关联的剧情框架 ID（可选，追溯章纲基于哪个框架生成） */
  frameworkId?: string;
}

export function parseChapterMeta(
  frontmatter: Record<string, unknown>,
): ChapterMeta | null {
  const chapterNumber = parseChapterNumber(frontmatter.chapter_number);
  if (chapterNumber === null) return null;
  const status = normalizeChapterStatus(frontmatter.chapter_status);
  const outlineType = validateOutlineType(frontmatter.outline_type);
  const frameworkId =
    typeof frontmatter.framework_id === "string" &&
    frontmatter.framework_id.trim()
      ? frontmatter.framework_id.trim()
      : undefined;
  return { chapterNumber, status, outlineType, frameworkId };
}

export function parseChapterNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeChapterStatus(value: unknown): ChapterStatus {
  const valid = ["outline", "draft", "revised", "final", "archived"];
  if (typeof value === "string" && valid.includes(value))
    return value as ChapterStatus;
  return "draft";
}

function validateOutlineType(value: unknown): OutlineType | undefined {
  if (
    value === "chapter-outline" ||
    value === "volume-outline" ||
    value === "story-outline"
  )
    return value;
  return undefined;
}

export function isChapterPage(frontmatter: Record<string, unknown>): boolean {
  return (
    frontmatter.type === "chapter" ||
    parseChapterNumber(frontmatter.chapter_number) !== null
  );
}

export function isOutlinePage(frontmatter: Record<string, unknown>): boolean {
  return (
    frontmatter.type === "outline" ||
    typeof frontmatter.outline_type === "string"
  );
}

export function isFinalChapter(frontmatter: Record<string, unknown>): boolean {
  return normalizeChapterStatus(frontmatter.chapter_status) === "final";
}

const CHAPTER_STATUS_LINE_RE = /^chapter_status:\s*["']?[\w-]+["']?\s*$/m;

function yamlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function replaceFrontmatterLine(
  rawBlock: string,
  key: string,
  newLine: string,
): string {
  const re = new RegExp(`^${key}:\\s*.*$`, "m");
  return re.test(rawBlock) ? rawBlock.replace(re, newLine) : rawBlock;
}

/** 将章节 frontmatter 关键字段写回 canonical YAML 标量类型。 */
export function normalizeChapterFrontmatterBlock(
  rawBlock: string,
  frontmatter: Record<string, FrontmatterValue> | null,
): string {
  if (!frontmatter) return rawBlock;

  let next = rawBlock;

  const chapterNumber = parseChapterNumber(frontmatter.chapter_number);
  if (chapterNumber !== null) {
    next = replaceFrontmatterLine(
      next,
      "chapter_number",
      `chapter_number: ${chapterNumber}`,
    );
  }

  const title =
    typeof frontmatter.title === "string" ? frontmatter.title : null;
  if (title !== null && title !== "") {
    next = replaceFrontmatterLine(
      next,
      "title",
      `title: "${yamlEscape(title)}"`,
    );
  }

  const created =
    typeof frontmatter.created === "string" ? frontmatter.created.trim() : null;
  if (created) {
    next = replaceFrontmatterLine(next, "created", `created: ${created}`);
  }

  return next;
}

export function updateChapterStatus(
  content: string,
  status: ChapterStatus,
): string {
  const { frontmatter, body, rawBlock } = parseFrontmatter(content);
  if (!rawBlock) return content;

  let nextRaw = CHAPTER_STATUS_LINE_RE.test(rawBlock)
    ? rawBlock.replace(CHAPTER_STATUS_LINE_RE, `chapter_status: ${status}`)
    : insertChapterStatusLine(rawBlock, status);

  nextRaw = normalizeChapterFrontmatterBlock(nextRaw, frontmatter);

  return nextRaw + body;
}

export function updateChapterTitle(content: string, nextTitle: string): string {
  const { frontmatter, body, rawBlock } = parseFrontmatter(content);
  const normalizedTitle = nextTitle.trim();
  const bodyWithoutHeading = body
    .replace(/^#\s+.+$(\r?\n)?/m, "")
    .replace(/^\n+/, "");
  const nextBody = normalizedTitle
    ? `# ${normalizedTitle}${bodyWithoutHeading ? `\n\n${bodyWithoutHeading}` : "\n"}`
    : bodyWithoutHeading;

  if (!rawBlock || !frontmatter) return rawBlock + nextBody;

  const nextRaw = normalizeChapterFrontmatterBlock(rawBlock, {
    ...frontmatter,
    title: normalizedTitle,
  });
  return nextRaw + nextBody;
}

/** 以正文标题为准同步 frontmatter，并修正关键字段的 YAML 标量类型。 */
export function syncChapterFrontmatterFromBody(content: string): string {
  const { frontmatter, body, rawBlock } = parseFrontmatter(content);
  if (!rawBlock || !frontmatter) return content;

  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!heading) return content;

  const nextRaw = normalizeChapterFrontmatterBlock(rawBlock, {
    ...frontmatter,
    title: heading,
  });
  if (nextRaw === rawBlock) return content;
  return nextRaw + body;
}

function insertChapterStatusLine(
  rawBlock: string,
  status: ChapterStatus,
): string {
  if (/^type:\s*chapter\s*$/m.test(rawBlock)) {
    return rawBlock.replace(
      /^type:\s*chapter\s*$/m,
      `type: chapter\nchapter_status: ${status}`,
    );
  }
  return rawBlock.replace(
    /(\r?\n)---\s*(?:\r?\n|$)/,
    `$1chapter_status: ${status}$1---$1`,
  );
}
