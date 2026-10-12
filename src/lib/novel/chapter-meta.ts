import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter";

/**
 * 章节状态：**只剩两种**（用户要求）。
 *
 * 改造前是 `"outline" | "draft" | "revised" | "final" | "archived"` 五种，
 * 用户明确要求砍掉「修订中 / 废弃草稿 / 大纲」，只留正式与草稿。
 *
 * ⚠️ 这是**只读收窄**，不做磁盘迁移：老文件里若仍写着
 * `chapter_status: revised`（或 archived / outline），`normalizeChapterStatus`
 * 一律回落到 `draft`，界面上按「草稿」呈现，但**文件内容不被改写**。
 * 之所以不迁移：迁移要写盘，而写盘在用户自己的作品上是有代价的
 * （git / 同步 / 版本历史都会多出一堆无意义的 diff），
 * 且归一化在读取端做完全等价。实测当前三个项目里
 * 一个这种值的文件都没有（黑雨之下 11 final + 6 draft、
 * 他，只想活着 9 draft + 1 缺字段、楚白 2 draft + 1 final），
 * 所以对存量数据是零影响。
 */
export type ChapterStatus = "draft" | "final";
export type OutlineType =
  "chapter-outline" | "volume-outline" | "story-outline";

interface ChapterMeta {
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

/**
 * 归一化章节状态：**只有 `final` 是"正式"，其余一切皆"草稿"**。
 *
 * ⚠️ 判据是"是不是 final"，而**不是**"是不是合法值"。
 * 改造前用的是白名单（`valid.includes(value)`），语义是
 * "认不出来的当草稿"；现在类型只剩两种，若继续用白名单，
 * 老文件里的 `revised` 会走到 `return "draft"` 兜底 —— 结果**碰巧**
 * 一样，但理由完全不同：一个是"不认识"，一个是"不是正式"。
 * 写成 `=== "final"` 之后，将来再加状态时不会有人误以为
 * "没列进白名单的都会被当成草稿"而漏改这里。
 */
export function normalizeChapterStatus(value: unknown): ChapterStatus {
  return value === "final" ? "final" : "draft";
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

export function isFinalChapter(frontmatter: Record<string, unknown>): boolean {
  return normalizeChapterStatus(frontmatter.chapter_status) === "final";
}

const CHAPTER_STATUS_LINE_RE = /^chapter_status:\s*["']?[\w-]+["']?\s*$/m;

/**
 * 转义写进 `title: "…"` 双引号标量里的值。
 *
 * 导出的理由：AI 生成正文的落盘路径（`chapter-draft-markdown.ts`）也要拼同一行
 * frontmatter —— 同一个转义口径只能有一份实现，抄一份就会在「只改了一边」时
 * 悄悄产出解析不回来的 YAML。
 */
export function yamlEscape(value: string): string {
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
function normalizeChapterFrontmatterBlock(
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
