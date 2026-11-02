/**
 * 把 legal-site 下的两份 markdown 条款渲染成单页 HTML。
 *
 * 为什么用脚本而不是手写两份：手写必然漂移。此前就发生过
 * 「md 已修好、线上 index.html 还是旧版」的事故 —— 修复没有落地到真正对外发布的那份，
 * 用户和监管看到的仍是被改掉的问题文本。同一份源生成，才不会再次分叉。
 *
 * 只支持这两份文档实际用到的语法：# / ## / ###、段落、- 列表、1. 列表、表格、
 * > 引用、**加粗**、`代码`、--- 分隔线。不引第三方库，避免为一个静态页加依赖。
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.argv[2] ?? process.cwd()
const SITE = join(ROOT, "cloudflare", "legal-site")

/** 行内标记：先转义再处理，避免内容里的尖括号破坏结构。 */
function inline(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    // 条款内链：把「第X条」不处理，只处理 markdown 链接
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

function slugify(index) {
  return `sec-${index}`
}

/**
 * 解析 markdown 为块序列。
 * 标题生成 id 供右侧目录跳转；表格整块解析，避免逐行判断。
 */
function parse(markdown) {
  const lines = markdown.split(/\r?\n/)
  const blocks = []
  let i = 0
  let sectionIndex = 0
  let inFrontMatter = true

  while (i < lines.length) {
    const line = lines[i]

    // 跳过开头的元信息（版本/生效日期以标题下的粗体行呈现，这里只跳过 --- 分隔）
    if (inFrontMatter && line.trim() === "---") {
      i += 1
      continue
    }
    if (line.trim() !== "") inFrontMatter = false

    if (!line.trim()) {
      i += 1
      continue
    }

    // 一级标题
    if (line.startsWith("# ")) {
      blocks.push({ type: "h1", text: line.slice(2).trim() })
      i += 1
      continue
    }

    // 二级标题 → 编号成章节，带锚点
    if (line.startsWith("## ")) {
      sectionIndex += 1
      blocks.push({ type: "h2", id: slugify(sectionIndex), text: line.slice(3).trim() })
      i += 1
      continue
    }

    // 三级标题
    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: line.slice(4).trim() })
      i += 1
      continue
    }

    // 引用块：连续 > 行合并
    if (line.startsWith(">")) {
      const buf = []
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""))
        i += 1
      }
      blocks.push({ type: "quote", text: buf.join(" ") })
      continue
    }

    // 表格
    if (line.startsWith("|")) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].trim())
        i += 1
      }
      const cells = rows
        .filter((row) => !/^\|[\s:|-]+\|$/.test(row))
        .map((row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
      if (cells.length > 0) {
        const [head, ...body] = cells
        blocks.push({ type: "table", head, body })
      }
      continue
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""))
        i += 1
      }
      blocks.push({ type: "ul", items })
      continue
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""))
        i += 1
      }
      blocks.push({ type: "ol", items })
      continue
    }

    // 分隔线
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "hr" })
      i += 1
      continue
    }

    // 段落：连续非空行合并
    const buf = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|>|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      buf.push(lines[i].trim())
      i += 1
    }
    if (buf.length > 0) blocks.push({ type: "p", text: buf.join(" ") })
  }

  return blocks
}

function renderBlocks(blocks) {
  const out = []
  let toc = []
  for (const block of blocks) {
    if (block.type === "h1") {
      out.push(`<h1>${inline(block.text)}</h1>`)
    } else if (block.type === "h2") {
      // 目录项去掉「一、」这类编号，只留正文
      toc.push({ id: block.id, text: block.text.replace(/^[一二三四五六七八九十百]+、/, "") })
      out.push(`<h2 id="${block.id}">${inline(block.text)}</h2>`)
    } else if (block.type === "h3") {
      out.push(`<h3>${inline(block.text)}</h3>`)
    } else if (block.type === "quote") {
      out.push(`<blockquote>${inline(block.text)}</blockquote>`)
    } else if (block.type === "p") {
      const html = inline(block.text)
      // 「摘要」那一段用醒目的摘要样式
      if (block.text.includes("摘要")) out.push(`<div class="summary">${html}</div>`)
      else out.push(`<p>${html}</p>`)
    } else if (block.type === "ul") {
      out.push(`<ul>${block.items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`)
    } else if (block.type === "ol") {
      out.push(`<ol>${block.items.map((it) => `<li>${inline(it)}</li>`).join("")}</ol>`)
    } else if (block.type === "hr") {
      out.push(`<hr />`)
    } else if (block.type === "table") {
      const head = `<tr>${block.head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>`
      const body = block.body
        .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")
      out.push(`<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`)
    }
  }
  return { html: out.join("\n"), toc }
}

const terms = parse(readFileSync(join(SITE, "terms.md"), "utf8"))
const privacy = parse(readFileSync(join(SITE, "privacy.md"), "utf8"))
const termsRendered = renderBlocks(terms)
const privacyRendered = renderBlocks(privacy)

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>服务条款与隐私政策 · 青幕AI写作</title>
<meta name="description" content="青幕AI写作（QMAI）服务条款与隐私政策" />
<style>
:root{--muted-bg:#f6f8f7;--text:#1c2320;--text-2:#4a5750;--text-3:#7c8a83;--border:#e3e8e5;--accent:#3b6e4f;--accent-soft:#eef5f0;--warn-bg:#fffbeb;--warn-border:#fde68a;--warn-text:#92400e}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;background:var(--muted-bg);color:var(--text);font-size:15px;line-height:1.85;-webkit-font-smoothing:antialiased}
.topbar{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.92);backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--border)}
.topbar-inner{max-width:960px;margin:0 auto;padding:0 24px;display:flex;align-items:center;gap:20px;height:58px}
.brand{display:flex;align-items:center;gap:9px;font-weight:650;font-size:15px}
.brand .logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--accent),#5f9b76);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
.tabs{display:flex;gap:4px;margin-left:auto}
.tabs button{border:none;background:none;padding:7px 15px;border-radius:8px;font-size:14px;color:var(--text-3);cursor:pointer;font-family:inherit;transition:all .15s}
.tabs button:hover{background:var(--accent-soft);color:var(--accent)}
.tabs button.active{background:var(--accent);color:#fff;font-weight:500}
.layout{max-width:960px;margin:0 auto;padding:28px 24px 80px;display:grid;grid-template-columns:215px 1fr;gap:34px}
@media(max-width:880px){.layout{grid-template-columns:1fr;gap:0;padding:20px 14px 60px}.toc{display:none}}
.toc{position:sticky;top:82px;align-self:start;max-height:calc(100vh - 110px);overflow-y:auto;font-size:13px;scrollbar-width:thin}
.toc .toc-title{font-size:11px;font-weight:650;letter-spacing:1.4px;color:var(--text-3);margin:0 0 10px;padding-left:11px}
.toc a{display:block;padding:5px 11px;color:var(--text-2);text-decoration:none;border-left:2px solid transparent;border-radius:0 6px 6px 0;line-height:1.5;transition:all .12s}
.toc a:hover{background:var(--accent-soft);color:var(--accent)}
.toc a.active{border-left-color:var(--accent);background:var(--accent-soft);color:var(--accent);font-weight:500}
.doc{background:#fff;border:1px solid var(--border);border-radius:14px;padding:40px 46px 52px;box-shadow:0 1px 3px rgba(16,24,20,.04),0 12px 32px -16px rgba(16,24,20,.08)}
@media(max-width:880px){.doc{padding:26px 20px 36px;border-radius:12px}}
.doc h1{font-size:27px;font-weight:700;margin:0 0 6px;letter-spacing:-.3px;line-height:1.35}
.doc h2{font-size:18.5px;font-weight:650;margin:42px 0 14px;padding-top:22px;border-top:1px solid var(--border);scroll-margin-top:78px;letter-spacing:-.2px}
.doc h2:first-of-type{border-top:none;padding-top:0;margin-top:0}
.doc h3{font-size:15px;font-weight:600;margin:26px 0 8px}
.doc p{margin:0 0 12px;color:var(--text-2)}
.doc strong{color:var(--text);font-weight:600}
.doc ul,.doc ol{margin:0 0 14px;padding-left:22px;color:var(--text-2)}
.doc li{margin:5px 0}
.doc code{background:#eef2ef;border-radius:4px;padding:1px 5px;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#2c4034}
.doc hr{border:none;border-top:1px dashed var(--border);margin:32px 0}
.summary{background:var(--accent-soft);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 30px;font-size:13.5px;color:#2c4034;line-height:1.8}
.summary strong{color:var(--accent)}
.doc blockquote{margin:16px 0;padding:12px 18px;border-left:3px solid var(--accent-soft);background:#fafcfb;border-radius:0 8px 8px 0;color:var(--text-2);font-size:14px}
.table-wrap{overflow-x:auto;margin:16px 0 22px;border:1px solid var(--border);border-radius:10px}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:460px}
thead th{background:var(--muted-bg);text-align:left;padding:10px 13px;font-weight:600;color:var(--text);border-bottom:1px solid var(--border);white-space:nowrap}
tbody td{padding:10px 13px;border-bottom:1px solid #f0f3f1;color:var(--text-2);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:#fafcfb}
.doc-footer{margin-top:46px;padding-top:20px;border-top:1px dashed var(--border);font-size:12.5px;color:var(--text-3);text-align:center}
.site-footer{max-width:960px;margin:0 auto;padding:0 24px 50px;font-size:12.5px;color:var(--text-3);text-align:center;line-height:2}
.site-footer a{color:var(--accent);text-decoration:none}
.site-footer a:hover{text-decoration:underline}
.hidden{display:none!important}
@media print{body{background:#fff}.topbar,.toc,.site-footer{display:none}.layout{grid-template-columns:1fr;padding:0;max-width:none}.doc{border:none;box-shadow:none;padding:0}.doc h2{page-break-after:avoid}.table-wrap,.summary{page-break-inside:avoid}}
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-inner">
    <div class="brand"><span class="logo">青</span>青幕AI写作</div>
    <div class="tabs">
      <button data-doc="terms" class="active">服务条款</button>
      <button data-doc="privacy">隐私政策</button>
    </div>
  </div>
</div>

<div class="layout">
  <nav class="toc" id="toc" aria-label="目录"></nav>

  <article class="doc" id="doc-terms">
${termsRendered.html}
    <div class="doc-footer">青幕AI写作（QMAI）· 2026 年 11 月</div>
  </article>

  <article class="doc hidden" id="doc-privacy">
${privacyRendered.html}
    <div class="doc-footer">青幕AI写作（QMAI）· 2026 年 11 月</div>
  </article>
</div>

<footer class="site-footer">
  青幕AI写作（QMAI）· 本页面内容为法律文本，不构成法律意见<br />
  联系：<a href="mailto:mochocyang@gmail.com">mochocyang@gmail.com</a>
</footer>

<script>
  var TOC = ${JSON.stringify({ terms: termsRendered.toc, privacy: privacyRendered.toc })};
  var tabs = document.querySelectorAll('.tabs button');
  var docs = { terms: document.getElementById('doc-terms'), privacy: document.getElementById('doc-privacy') };
  var toc = document.getElementById('toc');
  var observer = null;

  function buildToc(key) {
    toc.innerHTML = '<div class="toc-title">目录</div>';
    TOC[key].forEach(function (item) {
      var a = document.createElement('a');
      a.href = '#' + item.id;
      a.textContent = item.text;
      a.dataset.target = item.id;
      toc.appendChild(a);
    });
    observe();
  }

  function observe() {
    if (observer) observer.disconnect();
    var links = Array.prototype.slice.call(toc.querySelectorAll('a'));
    var map = {};
    links.forEach(function (a) { map[a.dataset.target] = a; });
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('active'); });
        var active = map[entry.target.id];
        if (active) {
          active.classList.add('active');
          toc.scrollTo({ top: Math.max(0, active.offsetTop - toc.clientHeight / 2), behavior: 'smooth' });
        }
      });
    }, { rootMargin: '-70px 0px -70% 0px', threshold: 0 });
    document.querySelectorAll('.doc:not(.hidden) h2[id]').forEach(function (h) { observer.observe(h); });
  }

  function switchDoc(key) {
    tabs.forEach(function (b) { b.classList.toggle('active', b.dataset.doc === key); });
    Object.keys(docs).forEach(function (k) { docs[k].classList.toggle('hidden', k !== key); });
    buildToc(key);
    history.replaceState(null, '', '#' + key);
  }

  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () { switchDoc(btn.dataset.doc); window.scrollTo(0, 0); });
  });

  switchDoc(location.hash.replace('#', '') === 'privacy' ? 'privacy' : 'terms');
</script>
</body>
</html>
`

writeFileSync(join(SITE, "index.html"), html, "utf8")

/*
 * 同时产出一份可内嵌进 Worker 的条款模块。
 *
 * 为什么需要它：条款必须挂在 qmai.pro 上。pages.dev 是 Cloudflare 默认域名，
 * 中国大陆访问不稳定，而 qmai.pro 是已在百度开放平台登记的正式域名 ——
 * 用户点「同意」时的可读入口必须是它。
 *
 * 主站是 Pages 项目 qmai（无源码在本仓库），不能直接往里塞页面；
 * 但 qmai-account Worker 已经挂了同域的 qmai.pro/terms、qmai.pro/privacy 路由，
 * 让它在 qmai.pro/legal 直接返回这份 HTML 即可，仍在 qmai.pro 域名之下。
 *
 * 内容从同一份 md 生成，所以 Pages 站点、Worker 内嵌、md 三者永远一致。
 */
const workerModule = `/**
 * 条款页（qmai.pro/legal）的 HTML。
 *
 * ⚠️ 本文件由 scripts/build-legal-site.mjs 自动生成，请勿手改。
 * 修改条款请改 cloudflare/legal-site/terms.md 与 privacy.md，
 * 然后执行：node scripts/build-legal-site.mjs
 */
export const LEGAL_PAGE_HTML = ${JSON.stringify(html)}
`

writeFileSync(join(ROOT, "account-worker", "src", "legal-page.ts"), workerModule, "utf8")

/*
 * 再产出一份**客户端内嵌**用的条款数据。
 *
 * 为什么客户端要自带一份：
 *   · qmai.pro 走 Cloudflare 全球节点，中国大陆访问不稳定；
 *     用户点「同意」时若打不开，等于没给可读入口 —— 法律上同意不成立。
 *   · 客户端又无法感知「外部浏览器是否加载成功」（那是系统浏览器，不是我们的 WebView），
 *     所以「打不开就自动回退到备用链接」这种自动方案做不到。
 *   · 最可靠的办法是：条款直接打进安装包，软件内打开，**完全不依赖网络**。
 *
 * 数据只含正文结构（标题/段落/列表/表格），不含样式与脚本，由客户端组件自行渲染。
 * 与网页版同源于同一份 md，不会出现两边内容不一致。
 */
/**
 * 把解析块归一化成客户端类型（LegalBlock）。
 *
 * 解析器为了渲染网页方便，区分了 ul / ol / p / hr；客户端只需要
 * 「是不是列表、有没有内容」这些粗粒度信息，所以在这里收敛：
 * · ul 与 ol 统一成 list（有序无序对阅读条款没有实质差别）；
 * · p 改成 paragraph（与 LegalBlock 命名对齐）；
 * · hr 直接丢弃（只是视觉分隔，客户端用 CSS 处理）。
 */
function toClientBlocks(blocks) {
  const out = []
  for (const block of blocks) {
    if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
      out.push(block)
    } else if (block.type === "quote") {
      out.push(block)
    } else if (block.type === "table") {
      out.push(block)
    } else if (block.type === "ul" || block.type === "ol") {
      // 紧挨着的两个列表合并成一个，避免客户端出现「一个项目一个 list」的碎片。
      const last = out[out.length - 1]
      if (last && last.type === "list") last.items.push(...block.items)
      else out.push({ type: "list", items: [...block.items] })
    } else if (block.type === "p") {
      out.push({ type: "paragraph", text: block.text })
    }
    // hr：丢弃。
  }
  return out
}

const clientModule = `/**
 * 软件内展示的条款内容（服务条款 + 隐私政策）。
 *
 * ⚠️ 本文件由 scripts/build-legal-site.mjs 自动生成，请勿手改。
 * 修改条款请改 cloudflare/legal-site/terms.md 与 privacy.md，然后重新生成。
 */
import type { LegalBlock } from "./legal-block-types"

export const LEGAL_TERMS_VERSION_BUILT = ${JSON.stringify(process.env.LEGAL_VERSION ?? "v1.1")}

export const TERMS_BLOCKS: LegalBlock[] = ${JSON.stringify(toClientBlocks(terms))}

export const PRIVACY_BLOCKS: LegalBlock[] = ${JSON.stringify(toClientBlocks(privacy))}
`

writeFileSync(join(ROOT, "src", "lib", "account", "legal-content.ts"), clientModule, "utf8")

console.log(`✓ index.html 已生成：服务条款 ${termsRendered.toc.length} 章、隐私政策 ${privacyRendered.toc.length} 章`)
console.log(`✓ account-worker/src/legal-page.ts 已同步（qmai.pro/legal 使用）`)
console.log(`✓ src/lib/account/legal-content.ts 已同步（软件内展示使用）`)

