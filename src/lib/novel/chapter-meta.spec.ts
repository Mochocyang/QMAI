import { describe, expect, it } from "vitest";
import {
  syncChapterFrontmatterFromBody,
  updateChapterStatus,
  updateChapterTitle,
} from "./chapter-meta";

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
