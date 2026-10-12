import { describe, expect, it } from "vitest";
import {
  normalizeChapterStatus,
  syncChapterFrontmatterFromBody,
  updateChapterStatus,
  updateChapterTitle,
} from "./chapter-meta";

/**
 * 状态类型从五种收窄到两种（用户要求砍掉「修订中 / 废弃草稿 / 大纲」）。
 *
 * 这一组钉的是**收窄之后老文件怎么读**：磁盘上仍可能写着那三种值
 * （本仓库不迁移、不写盘，理由见 `ChapterStatus` 的注释），
 * 读进来必须一律算「草稿」，而**不能**算「正式」——
 * 把它算成正式的话，一个没提取过记忆的老章节会被当成已定稿，
 * 草稿提示不再弹出、Canon 保护也把它当正式内容摄取。
 *
 * 判据是「只有 final 是正式」，不是「白名单里有没有」：
 * 这两种写法在今天的取值下结果相同，但白名单式写法在
 * `undefined` / `null` / `""` / `123` / `"FINAL"` 上全靠兜底碰巧对，
 * 下面把这些非字符串与大小写变体一并列出来，就是为了让
 * "改成 `value === \"final\"`" 这个语义被显式冻结。
 */
describe("normalizeChapterStatus", () => {
  it("只认 final 是正式，其余（含已废弃的三种老值）一律是草稿", () => {
    expect(normalizeChapterStatus("final")).toBe("final");
    expect(normalizeChapterStatus("draft")).toBe("draft");
    // 三种已从类型里删掉、但磁盘上可能仍存在的老值
    expect(normalizeChapterStatus("revised")).toBe("draft");
    expect(normalizeChapterStatus("archived")).toBe("draft");
    expect(normalizeChapterStatus("outline")).toBe("draft");
  });

  it("非字符串与大小写变体都回落到草稿，不会误判成正式", () => {
    for (const value of [undefined, null, "", 0, 123, true, {}, [], "FINAL", "Final", " final "]) {
      expect(normalizeChapterStatus(value)).toBe("draft");
    }
  });
});

describe("updateChapterStatus", () => {
  it("updates only chapter_status while preserving other frontmatter formatting", () => {
    const input = [
      "---",
      "type: chapter",
      "chapter_number: 49",
      "chapter_status: draft",
      'title: "第49章-第三枚筹码"',
      "created: 2026-07-04",
      "---",
      "",
      "# 第49章-第三枚筹码",
      "",
      "正文",
    ].join("\n");

    const output = updateChapterStatus(input, "final");

    expect(output).toBe(
      [
        "---",
        "type: chapter",
        "chapter_number: 49",
        "chapter_status: final",
        'title: "第49章-第三枚筹码"',
        "created: 2026-07-04",
        "---",
        "",
        "# 第49章-第三枚筹码",
        "",
        "正文",
      ].join("\n"),
    );
  });

  it("replaces quoted chapter_status values", () => {
    const input = [
      "---",
      "type: chapter",
      "chapter_status: 'draft'",
      "---",
      "",
      "正文",
    ].join("\n");

    expect(updateChapterStatus(input, "final")).toContain(
      "chapter_status: final",
    );
    expect(updateChapterStatus(input, "final")).not.toContain("'draft'");
  });

  it("returns content unchanged when frontmatter is missing", () => {
    const input = "# 无 frontmatter\n\n正文";
    expect(updateChapterStatus(input, "final")).toBe(input);
  });

  it("repairs yaml.dump corruption to canonical scalar types", () => {
    const input = [
      "---",
      "type: chapter",
      "chapter_number: '49'",
      "chapter_status: draft",
      "title: 第49章-第三枚筹码",
      "created: '2026-07-04'",
      "---",
      "",
      "正文",
    ].join("\n");

    const output = updateChapterStatus(input, "final");

    expect(output).toBe(
      [
        "---",
        "type: chapter",
        "chapter_number: 49",
        "chapter_status: final",
        'title: "第49章-第三枚筹码"',
        "created: 2026-07-04",
        "---",
        "",
        "正文",
      ].join("\n"),
    );
  });
});

describe("updateChapterTitle", () => {
  it("updates body heading and frontmatter title with canonical formatting", () => {
    const input = [
      "---",
      "type: chapter",
      "chapter_number: '49'",
      "chapter_status: draft",
      "title: 旧标题",
      "created: '2026-07-04'",
      "---",
      "",
      "# 旧标题",
      "",
      "正文",
    ].join("\n");

    const output = updateChapterTitle(input, "第49章-第三枚筹码");

    expect(output).toBe(
      [
        "---",
        "type: chapter",
        "chapter_number: 49",
        "chapter_status: draft",
        'title: "第49章-第三枚筹码"',
        "created: 2026-07-04",
        "---",
        "",
        "# 第49章-第三枚筹码",
        "",
        "正文",
      ].join("\n"),
    );
  });
});

describe("syncChapterFrontmatterFromBody", () => {
  it("normalizes frontmatter from body heading without changing body", () => {
    const input = [
      "---",
      "type: chapter",
      "chapter_number: '49'",
      "chapter_status: draft",
      "title: 第49章-第三枚筹码",
      "created: '2026-07-04'",
      "---",
      "",
      "# 第49章-第三枚筹码",
      "",
      "正文",
    ].join("\n");

    const output = syncChapterFrontmatterFromBody(input);

    expect(output).toBe(
      [
        "---",
        "type: chapter",
        "chapter_number: 49",
        "chapter_status: draft",
        'title: "第49章-第三枚筹码"',
        "created: 2026-07-04",
        "---",
        "",
        "# 第49章-第三枚筹码",
        "",
        "正文",
      ].join("\n"),
    );
  });
});
