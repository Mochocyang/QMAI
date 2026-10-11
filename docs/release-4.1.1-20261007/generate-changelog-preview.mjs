/**
 * 由 changelog-entry-4.1.1.txt 生成「软件更新日志」渲染预览。
 *
 * 为什么用生成而不用手写 HTML：条目内容与预览必须只有一个数据源。
 * 手抄一份到 HTML 里，改了条目忘了改预览，就会拿着过期画面做决策。
 *
 * 还原依据是 src/components/settings/sections/changelog-section.tsx 的真实结构：
 *   卡片  = rounded-lg border border-border/60 bg-muted/20 p-4
 *   徽标  = rounded px-2 py-0.5 text-sm font-semibold，当前版本 bg-primary/15 text-primary
 *   日期  = text-xs text-muted-foreground
 *   列表  = ul.mt-3 space-y-2 text-sm leading-relaxed，li.flex.gap-2 + 圆点 h-1.5 w-1.5
 *   折叠  = COLLAPSED_CHANGELOG_ITEM_COUNT = 5，按钮「查看更多 N 条」
 * 主题取自 src/index.css 的 :root（浅色）与 .dark（苍苍竹色）。
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { extractArray, normalizeNewlines } from "./parse-changelog-entry.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const source = normalizeNewlines(
  readFileSync(resolve(here, "changelog-entry-4.1.1.txt"), "utf8"),
)

const zh = extractArray(source, "zh")
const en = extractArray(source, "en")
if (zh.length !== en.length) {
  throw new Error(`中英条数不一致：zh=${zh.length} en=${en.length}`)
}

const version = /version: "([^"]+)"/.exec(source)[1]
const date = /date: "([^"]+)"/.exec(source)[1]
const COLLAPSED = 5

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>QMAI ${version} 更新日志预览</title>
<style>
  /* 浅色：src/index.css 的 :root */
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --primary: oklch(0.205 0 0);
    --muted: oklch(0.97 0 0);
    --muted-foreground: oklch(0.556 0 0);
    --border: oklch(0.922 0 0);
    --page: oklch(0.985 0 0);
  }
  /* 深色：src/index.css 的 .dark（苍苍竹色） */
  .dark {
    --background: #10251d;
    --foreground: #e7fff2;
    --primary: #9ad7b7;
    --muted: #1e4434;
    --muted-foreground: #a8cdb9;
    --border: #315846;
    --page: #0b1a14;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    background: var(--page);
    color: var(--foreground);
  }
  .wrap { padding: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  @media (max-width: 1000px) { .wrap { grid-template-columns: 1fr; } }
  .pane { border: 1px dashed color-mix(in srgb, var(--muted-foreground) 45%, transparent); border-radius: 10px; padding: 16px; background: var(--background); }
  .pane-title { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-foreground); margin: 0 0 14px; }
  h3 { font-size: 14px; font-weight: 500; color: var(--muted-foreground); margin: 0 0 16px; }
  /* 卡片：rounded-lg border border-border/60 bg-muted/20 p-4 */
  .card {
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    background: color-mix(in oklab, var(--muted) 20%, var(--background));
    border-radius: calc(0.625rem);
    padding: 16px;
    margin-bottom: 16px;
  }
  .head { display: flex; align-items: baseline; gap: 12px; }
  .badge { border-radius: 4px; padding: 2px 8px; font-size: 14px; font-weight: 600; background: color-mix(in oklab, var(--muted) 100%, transparent); color: var(--muted-foreground); }
  .badge.current { background: color-mix(in oklab, var(--primary) 15%, transparent); color: var(--primary); }
  .date { font-size: 12px; color: var(--muted-foreground); }
  .current-tag { font-size: 12px; color: #059669; }
  .dark .current-tag { color: #34d399; }
  ul { margin: 12px 0 0; padding: 0; list-style: none; }
  li { display: flex; gap: 8px; font-size: 14px; line-height: 1.625; color: color-mix(in oklab, var(--foreground) 90%, transparent); }
  li + li { margin-top: 8px; }
  .dot { margin-top: 6px; width: 6px; height: 6px; flex: 0 0 auto; border-radius: 9999px; background: color-mix(in oklab, var(--primary) 60%, transparent); }
  .more { margin-top: 12px; font-size: 12px; font-weight: 500; color: var(--primary); }
  .meta { font-size: 12px; color: var(--muted-foreground); margin: 0 0 14px; }
  .toggle { position: fixed; right: 16px; top: 16px; z-index: 10; display: flex; gap: 6px; }
  .toggle button {
    font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--border); background: var(--background); color: var(--foreground);
  }
  .toggle button[aria-pressed="true"] { background: var(--primary); color: var(--background); border-color: var(--primary); }
</style>
</head>
<body>
<div class="toggle">
  <button id="btn-zh" aria-pressed="true" onclick="setLang('zh')">中文</button>
  <button id="btn-en" aria-pressed="false" onclick="setLang('en')">English</button>
</div>

<div class="wrap">
  <div class="pane">
    <p class="pane-title">浅色主题（:root）— 展开全部</p>
    <h3>版本历史</h3>
    <div class="card" id="card-light"></div>
  </div>
  <div class="pane dark">
    <p class="pane-title">深色主题（.dark 苍苍竹色）— 展开全部</p>
    <h3>版本历史</h3>
    <div class="card" id="card-dark"></div>
  </div>
  <div class="pane">
    <p class="pane-title">默认折叠态（设置页打开时看到的样子）</p>
    <h3>版本历史</h3>
    <div class="card" id="card-collapsed"></div>
  </div>
  <div class="pane">
    <p class="pane-title">与上一版对比（v4.1.0 的形态）</p>
    <h3>版本历史</h3>
    <div class="card">
      <div class="head">
        <span class="badge">v4.1.0</span>
        <span class="date">2026-10-04</span>
      </div>
      <ul>
        <li><span class="dot"></span><span>上一版本共 21 条，中英各 21 条，扁平编号、无分节标题</span></li>
        <li><span class="dot"></span><span>本版共 ${zh.length} 条，比上一版多 ${zh.length - 21} 条</span></li>
        <li><span class="dot"></span><span>折叠到 ${COLLAPSED} 条，其余通过「查看更多 ${zh.length - COLLAPSED} 条」展开</span></li>
      </ul>
    </div>
  </div>
</div>

<script>
const DATA = {
  zh: ${JSON.stringify(zh)},
  en: ${JSON.stringify(en)},
};
const VERSION = ${JSON.stringify(version)};
const DATE = ${JSON.stringify(date)};
const COLLAPSED = ${COLLAPSED};
let lang = "zh";

function renderCard(target, lines, current) {
  const head = document.createElement("div");
  head.className = "head";
  const badge = document.createElement("span");
  badge.className = "badge" + (current ? " current" : "");
  badge.textContent = "v" + VERSION;
  const date = document.createElement("span");
  date.className = "date";
  date.textContent = DATE;
  head.append(badge, date);
  if (current) {
    const tag = document.createElement("span");
    tag.className = "current-tag";
    tag.textContent = "← 当前版本";
    head.append(tag);
  }
  const ul = document.createElement("ul");
  for (const line of lines) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    const span = document.createElement("span");
    span.textContent = line;
    li.append(dot, span);
    ul.append(li);
  }
  target.replaceChildren(head, ul);
}

function render() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  const lines = DATA[lang];
  renderCard(document.getElementById("card-light"), lines, true);
  renderCard(document.getElementById("card-dark"), lines, true);

  const collapsed = document.getElementById("card-collapsed");
  renderCard(collapsed, lines.slice(0, COLLAPSED), true);
  const more = document.createElement("div");
  more.className = "more";
  more.textContent = lang === "zh"
    ? "查看更多 " + (lines.length - COLLAPSED) + " 条"
    : "Show " + (lines.length - COLLAPSED) + " more";
  collapsed.append(more);

  document.getElementById("btn-zh").setAttribute("aria-pressed", String(lang === "zh"));
  document.getElementById("btn-en").setAttribute("aria-pressed", String(lang === "en"));
}

function setLang(next) { lang = next; render(); }
render();
</script>
</body>
</html>
`

const target = resolve(here, "changelog-preview.html")
writeFileSync(target, html, "utf8")
console.log(`已生成预览：${target}`)
console.log(`  版本 ${version} / ${date}`)
console.log(`  中文 ${zh.length} 条，英文 ${en.length} 条`)
