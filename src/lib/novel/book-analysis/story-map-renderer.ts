/**
 * 拆书故事导图 HTML 渲染器（chaishugushidaotu 分支）
 *
 * 把 StoryMap 渲染为自包含 HTML（内联 CSS，无外部依赖）：
 * - 顶部：书名 + 主线名 + 主线一句话
 * - 主体：按章纵向的主线时间轴；每章可展开主线事件编号列表
 * - 每章下方列分支（带类型标签），标明「由哪一主线环节触发」
 * - 使用 <details> 折叠，长内容不超屏、可滚动
 */

import type { StoryMap, StoryBranch, StoryEvent } from "./story-map-types"
import { STORY_BRANCH_KIND_LABELS } from "./story-map-types"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const BRANCH_KIND_COLORS: Record<string, string> = {
  sub: "#4f8cff",
  task: "#37c9a0",
  foreshadow: "#ffb454",
  world: "#b07cff",
  emotion: "#ff7ba9",
}

function renderEvent(event: StoryEvent, prefix: string): string {
  const beats = event.beats.length > 0
    ? `<ul class="beats">${event.beats.map((beat) => `<li>${escapeHtml(beat)}</li>`).join("")}</ul>`
    : ""
  const characters = event.characters.length > 0
    ? `<div class="chars">涉及：${event.characters.map(escapeHtml).join("、")}</div>`
    : ""
  const spinoff = event.spinoff
    ? `<div class="spinoff">延伸悬念：${escapeHtml(event.spinoff)}</div>`
    : ""
  return `<div class="event"><div class="event-label">${prefix}${escapeHtml(event.label)}</div>${beats}${characters}${spinoff}</div>`
}

function renderBranch(branch: StoryBranch): string {
  const color = BRANCH_KIND_COLORS[branch.kind] ?? "#4f8cff"
  const events = branch.events.length > 0
    ? branch.events.map((event, index) => renderEvent(event, `${index + 1}. `)).join("")
    : ""
  return `<div class="branch" style="--branch-color:${color}">
  <div class="branch-head">
    <span class="branch-kind" style="background:${color}1a;color:${color}">${STORY_BRANCH_KIND_LABELS[branch.kind]}</span>
    <span class="branch-label">${escapeHtml(branch.label)}</span>
  </div>
  ${branch.triggeredBy ? `<div class="branch-trigger">触发环节：${escapeHtml(branch.triggeredBy)}</div>` : ""}
  ${events}
</div>`
}

export function renderStoryMapHtml(map: StoryMap): string {
  const chapters = map.chapters.map((chapter) => {
    const mainEvents = chapter.mainEvents.length > 0
      ? chapter.mainEvents.map((event, index) => renderEvent(event, `${index + 1}. `)).join("")
      : `<div class="empty">（本章未提取到主线事件）</div>`
    const branches = chapter.branches.length > 0
      ? chapter.branches.map(renderBranch).join("")
      : ""
    return `<details class="chapter" open>
  <summary>
    <span class="chapter-order">第 ${chapter.order} 章</span>
    <span class="chapter-title">${escapeHtml(chapter.title)}</span>
    <span class="chapter-count">${chapter.mainEvents.length} 主线 · ${chapter.branches.length} 分支</span>
  </summary>
  <div class="chapter-body">
    <p class="chapter-summary">${escapeHtml(chapter.summary)}</p>
    <div class="section-title">主线事件</div>
    <div class="main-events">${mainEvents}</div>
    ${chapter.branches.length > 0 ? `<div class="section-title">分支（由主线环节生发）</div><div class="branches">${branches}</div>` : ""}
  </div>
</details>`
  }).join("\n")

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>《${escapeHtml(map.bookTitle)}》故事导图</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: #f6f7fa; color: #23272f;
    font-family: "Microsoft YaHei", "PingFang SC", -apple-system, sans-serif; line-height: 1.7;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  header.map-header { border-left: 4px solid #4f8cff; padding-left: 14px; margin-bottom: 8px; }
  h1 { font-size: 20px; margin: 0; }
  .mainline { margin: 6px 0 0; color: #4f8cff; font-weight: 600; font-size: 14px; }
  .main-summary { margin: 2px 0 0; color: #6b7280; font-size: 13px; }
  .meta { color: #9aa3b2; font-size: 12px; margin: 8px 0 20px; }
  .chapter {
    background: #fff; border: 1px solid #e5e8ef; border-radius: 10px;
    margin-bottom: 12px; overflow: hidden;
  }
  .chapter summary {
    cursor: pointer; list-style: none; padding: 12px 16px;
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  }
  .chapter summary::-webkit-details-marker { display: none; }
  .chapter summary::before { content: "▸"; color: #9aa3b2; transition: transform .15s; }
  .chapter[open] summary::before { transform: rotate(90deg); }
  .chapter-order { font-weight: 700; color: #4f8cff; white-space: nowrap; }
  .chapter-title { font-weight: 600; }
  .chapter-count { margin-left: auto; color: #9aa3b2; font-size: 12px; white-space: nowrap; }
  .chapter-body { padding: 4px 16px 16px; border-top: 1px dashed #e5e8ef; }
  .chapter-summary { color: #4b5563; font-size: 13px; margin: 10px 0; }
  .section-title {
    font-size: 12px; font-weight: 700; color: #6b7280; letter-spacing: 1px;
    margin: 14px 0 8px;
  }
  .event { border-left: 2px solid #cdd6e4; padding-left: 12px; margin: 10px 0; }
  .event-label { font-weight: 600; font-size: 14px; }
  .beats { margin: 4px 0 0; padding-left: 18px; color: #4b5563; font-size: 13px; }
  .chars, .spinoff { color: #6b7280; font-size: 12px; margin-top: 2px; }
  .spinoff { color: #b45309; }
  .empty { color: #9aa3b2; font-size: 13px; }
  .branches { display: grid; gap: 10px; }
  .branch {
    border: 1px solid #e5e8ef; border-left: 3px solid var(--branch-color, #4f8cff);
    border-radius: 8px; padding: 10px 12px; background: #fbfcfe;
  }
  .branch-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .branch-kind {
    font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; white-space: nowrap;
  }
  .branch-label { font-weight: 600; font-size: 13px; }
  .branch-trigger { color: #6b7280; font-size: 12px; margin-top: 2px; }
  footer { color: #9aa3b2; font-size: 12px; text-align: center; margin-top: 24px; }
  @media (max-width: 640px) { body { padding: 12px; } .chapter-count { display: none; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="map-header">
    <h1>《${escapeHtml(map.bookTitle)}》故事导图</h1>
    <div class="mainline">主线：${escapeHtml(map.mainLineLabel)}</div>
    ${map.mainSummary ? `<p class="main-summary">${escapeHtml(map.mainSummary)}</p>` : ""}
  </header>
  <div class="meta">共 ${map.chapters.length} 章 · 主线事件 ${map.chapters.reduce((sum, c) => sum + c.mainEvents.length, 0)} 条 · 分支 ${map.chapters.reduce((sum, c) => sum + c.branches.length, 0)} 条 · 生成于 ${new Date(map.createdAt).toLocaleString("zh-CN")}</div>
  <main>
${chapters || '<div class="empty">（未提取到章节内容）</div>'}
  </main>
  <footer>本导图由 QMaiWrite 拆书库生成 · 仅供结构参考，禁止复用原作人物、设定与表达</footer>
</div>
</body>
</html>`
}
