# 绝对单位字号/行高 · 完整清单

生成时间: 2026-10-08T02:51:13.541Z

需改（绝对单位）: 0 个数值（553 处声明；差值 12 为 font 简写的行高部分）
无需改（相对单位）: 563 个数值

> **可见范围声明：** 本清单覆盖 `.css` 声明、Tailwind 任意值 `text-[Npx]`、内联 `style={{}}`、
> px 自定义属性及其消费者。**不覆盖** `.ts/.tsx` 模板字符串与内联字符串 `style="…"` 里的 CSS
> —— 实测该处还有 16 处 px（详见下方"可见范围外"一节）。
> 故本清单的"绝对单位 0 处"仅指上述已覆盖载体。

## 经自定义属性间接传递的 px（codemod 看不见）

| 变量 | 值 | 定义处 | 消费属性 | 判定 |
|---|---|---|---|---|
| `--radius` | 10px | src/components/uitest/ui-test.css:51 | --radius-sm, --radius-md, --radius-lg, --radius-xl, xl | 白名单：圆角，与文字无关 |
| `--ui-heading-top` | 22px | src/components/uitest/ui-test.css:10 | padding, padding-top | 白名单：纯外部留白（只用于 padding/padding-top），不参与文字布局；界面字号放大时留白保持不变是刻意选择 |

## 可见范围外：模板字符串 / 内联 style 里的 CSS

| 文件 | 行 | 值 | 原文 |
|---|---|---|---|
| src/lib/novel/book-analysis/story-map-renderer.ts | 102 | 20px | `h1 { font-size: 20px; margin: 0; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 103 | 14px | `.mainline { margin: 6px 0 0; color: var(--brand); font-weight: 600; font-size: 14px; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 104 | 13px | `.main-summary { margin: 2px 0 0; color: var(--muted); font-size: 13px; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 105 | 12px | `.meta { color: var(--muted); font-size: 12px; margin: 8px 0 20px; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 119 | 12px | `.chapter-count { margin-left: auto; color: var(--muted); font-size: 12px; white-space: now` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 121 | 13px | `.chapter-summary { color: var(--ink2); font-size: 13px; margin: 10px 0; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 123 | 12px | `font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: 1px;` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 127 | 14px | `.event-label { font-weight: 600; font-size: 14px; color: var(--ink); }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 128 | 13px | `.beats { margin: 4px 0 0; padding-left: 18px; color: var(--ink2); font-size: 13px; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 129 | 12px | `.chars, .spinoff { color: var(--muted); font-size: 12px; margin-top: 2px; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 131 | 13px | `.empty { color: var(--muted); font-size: 13px; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 139 | 11px | `font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; white-space: no` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 141 | 13px | `.branch-label { font-weight: 600; font-size: 13px; color: var(--ink); }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 142 | 12px | `.branch-trigger { color: var(--muted); font-size: 12px; margin-top: 2px; }` |
| src/lib/novel/book-analysis/story-map-renderer.ts | 143 | 12px | `footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 24px; }` |
| src/lib/novel/profile-document.ts | 692 | 11px | `return `<span style="display:inline-block;font-size:11px;line-height:1.5;border-radius:999` |

## 需改清单

| 文件 | 行 | 类型 | 值 | 原文 |
|---|---|---|---|---|