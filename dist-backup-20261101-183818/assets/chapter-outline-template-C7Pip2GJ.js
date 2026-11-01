import{_ as e,c as t,d as n,f as r,o as i}from"./fs-CFNVvTIG.js";import{u as a}from"./path-utils-CA6G028g.js";import{l as o}from"./chapter-utils-Ds6_VTzw.js";import{ci as s,li as c}from"./index-CE8VBiZA.js";var l=`<!DOCTYPE html>\r
<html lang="zh-CN" data-qmai-layout="editorial-v2">\r
<head>\r
<meta charset="UTF-8">\r
<meta name="viewport" content="width=device-width, initial-scale=1">\r
<title>章纲卡片流</title>\r
<style>\r
:root{\r
  --bg:#FFFFFF;--surface:#FBF8F5;--surface2:#F4EEE8;--ink:#241E1A;--ink2:#4A3F38;--muted:#7A6C63;\r
  --border:#E2D8CF;--brand:#B8551D;--brand-soft:#FBF0E9;--brand-soft2:#F6E0D2;--brand-text:#8A3F13;--on-brand:#FFFFFF;\r
  --qi:#8E6E63;--cheng:#D97757;--zhuan:#B8551D;--he:#F59E42;\r
  --ok:#3C7A3C;--ok-soft:#EEF7EE;--ok-border:#B7DFB7;--warn:#96601A;--warn-soft:#FFF7E6;--danger:#A8071A;--danger-soft:#FFF1F0;--danger-border:#FFCCC7;\r
  --day:#7FB07F;\r
  --k-qi-bg:#F1EDE9;--k-qi-ink:#5F4A3E;--k-cheng-bg:#FBEDE6;--k-cheng-ink:#A8451C;--k-he-bg:#FEF3E2;--k-he-ink:#96601A;\r
  --beat-flat-bg:#F4EEE8;--beat-flat-border:#E2D8CF;--beat-flat-ink:#5F4A3E;\r
  --beat-rise-bg:#FBEDE6;--beat-rise-border:#F0CDB8;--beat-rise-ink:#A8451C;\r
  --beat-tight-bg:#F6E0D2;--beat-tight-border:#E0A87E;--beat-tight-ink:#8A3F13;\r
  --beat-fall-bg:#EFEAE6;--beat-fall-border:#D8CCC2;--beat-fall-ink:#6B5548;\r
  --beat-hang-bg:#FFF7E6;--beat-hang-ink:#96601A;\r
}\r
*{box-sizing:border-box}\r
html,body{margin:0;padding:0}\r
body{background:var(--bg);color:var(--ink);\r
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC",-apple-system,"Segoe UI",sans-serif;\r
  font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased}\r
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}\r
.intro{background:var(--brand-soft);border-bottom:1px solid var(--border);padding:40px 0 32px}\r
.intro .eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--brand-text);font-weight:600;margin:0 0 12px}\r
.intro h1{margin:0 0 12px;font-size:26px;line-height:1.35}\r
.chip{display:inline-flex;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:4px 11px;font-size:12px;color:var(--ink2);margin:10px 6px 0 0}\r
.chip b{color:var(--brand-text)}\r
\r
/* 故事骨架卡 */\r
.story-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:12px}\r
.story-card .kv{border-bottom:none;padding:3px 0}\r
.story-card .beatrow{display:flex;gap:10px;align-items:flex-start;padding:4px 0 2px;flex-wrap:wrap}\r
.story-card .kk{flex:none;width:72px;color:var(--muted);font-size:11.5px}\r
\r
/* 面板 */\r
.panels{margin:14px 0 0}\r
.panel{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px 16px 16px;margin-bottom:12px}\r
.panel h2{margin:0 0 10px;font-size:14.5px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}\r
.panel h2 .pn{font-size:11.5px;font-weight:400;color:var(--muted)}\r
.panel .empty{margin:0;font-size:12.5px;color:var(--warn);background:var(--warn-soft);border:1px dashed var(--he);border-radius:8px;padding:8px 10px}\r
.panel .hint{margin:0;font-size:12px;color:var(--muted)}\r
.panel .okbox{margin:0;font-size:12.5px;color:var(--ok);background:var(--ok-soft);border:1px solid var(--ok-border);border-radius:8px;padding:10px 12px}\r
\r
/* 键值行 */\r
.kv{display:flex;gap:10px;align-items:baseline;padding:5px 9px;border-bottom:1px dashed var(--border);font-size:12.5px;line-height:1.6}\r
.kv:last-child{border-bottom:none}\r
.kv .kk{flex:none;width:86px;color:var(--muted);font-size:11.5px}\r
.kv .vv{flex:1;min-width:0;color:var(--ink2)}\r
\r
/* 表格 */\r
.mxwrap{overflow:auto;border:1px solid var(--border);border-radius:9px;margin-top:4px}\r
table.mx{border-collapse:collapse;width:100%;font-size:12px}\r
table.mx th,table.mx td{border-bottom:1px solid var(--border);padding:5px 8px;text-align:left;vertical-align:top;line-height:1.55}\r
table.mx thead th{background:var(--surface);color:var(--muted);font-weight:600;font-size:11px;white-space:nowrap;position:sticky;top:0}\r
table.mx tbody tr:last-child td{border-bottom:none}\r
table.mx td{color:var(--ink2)}\r
table.mx td.mxh,table.mx th.mxh{font-weight:600;color:var(--ink);white-space:nowrap;background:var(--surface)}\r
\r
/* 锚点导航 */\r
.nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin:14px 0 0}\r
.nav .navt{font-size:11.5px;color:var(--muted);margin-right:4px}\r
.navlink{display:inline-flex;gap:6px;align-items:baseline;font-size:12px;color:var(--ink2);text-decoration:none;border:1px solid var(--border);border-radius:999px;padding:2px 10px;background:var(--surface);max-width:260px;overflow:hidden;white-space:nowrap}\r
.navlink b{font-size:10.5px;color:var(--on-brand);background:var(--brand);border-radius:4px;padding:0 5px;flex:none}\r
.navlink:hover{border-color:var(--brand);color:var(--brand-text)}\r
\r
/* 章节卡流 */\r
.cards{margin:14px 0 40px;display:flex;flex-direction:column;gap:10px}\r
details.cc{background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden}\r
details.cc[open]{border-color:var(--brand)}\r
details.cc>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:11px 14px;background:var(--surface)}\r
details.cc>summary::-webkit-details-marker{display:none}\r
details.cc>summary::marker{content:""}\r
details.cc>summary::before{content:"▸";color:var(--muted);font-size:11px}\r
details.cc[open]>summary::before{content:"▾"}\r
details.cc>summary:hover{background:var(--surface2)}\r
.cno{font-size:11px;font-weight:700;color:var(--on-brand);background:var(--brand);border-radius:5px;padding:1px 8px;flex:none}\r
.ct{font-weight:600;font-size:14px}\r
.cgoal{font-size:12px;color:var(--muted);flex:1;min-width:200px}\r
.cbody{padding:6px 14px 14px}\r
.csec{padding:8px 0;border-bottom:1px dashed var(--border)}\r
.csec:last-child{border-bottom:none}\r
.csec h4{margin:0 0 6px;font-size:12.5px;color:var(--brand-text)}\r
.clist{margin:0;padding-left:20px;font-size:12.5px;color:var(--ink2);line-height:1.65}\r
.clist li{margin:2px 0}\r
details.cc:target{outline:2px solid var(--brand);outline-offset:2px}\r
\r
/* 标签 */\r
.tag{font-size:10.5px;border-radius:999px;padding:1px 8px;border:1px solid var(--border);color:var(--muted);background:var(--surface);flex:none}\r
.tag.exp{background:var(--warn-soft);border-color:var(--he);color:var(--warn);font-weight:600}\r
.tag.attr{background:var(--brand-soft2);border-color:var(--brand);color:var(--brand-text);font-weight:600}\r
.tag.mood{background:var(--k-qi-bg);border-color:var(--border);color:var(--k-qi-ink)}\r
.tag.chap{background:var(--surface2);color:var(--ink2);font-weight:600}\r
\r
/* 节拍 */\r
.beats{display:flex;flex-wrap:wrap;gap:4px;padding:4px 0}\r
.bt{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;border:1px solid var(--border);border-radius:6px;padding:2px 7px;background:var(--bg);line-height:1.5}\r
.bt[data-b="平"],.bt[data-b="缓"]{background:var(--beat-flat-bg);border-color:var(--beat-flat-border);color:var(--beat-flat-ink)}\r
.bt[data-b="升"],.bt[data-b="起"]{background:var(--beat-rise-bg);border-color:var(--beat-rise-border);color:var(--beat-rise-ink)}\r
.bt[data-b="紧"]{background:var(--beat-tight-bg);border-color:var(--beat-tight-border);color:var(--beat-tight-ink)}\r
.bt[data-b="顶"]{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}\r
.bt[data-b="落"]{background:var(--beat-fall-bg);border-color:var(--beat-fall-border);color:var(--beat-fall-ink)}\r
.bt[data-b="悬"]{background:var(--beat-hang-bg);border-color:var(--he);color:var(--beat-hang-ink)}\r
\r
/* 情绪曲线 */\r
.svgwrap{overflow:auto;border:1px solid var(--border);border-radius:9px;background:var(--surface)}\r
.svgwrap svg{display:block;width:100%;min-width:880px;height:220px}\r
svg .cg{stroke:var(--border);stroke-width:1}\r
svg .ct{fill:var(--muted);font-size:11px}\r
svg .cl{fill:none;stroke:var(--brand);stroke-width:2}\r
svg .ca{fill:var(--brand-soft);opacity:.7}\r
svg .cp{fill:var(--he);stroke:var(--bg);stroke-width:1}\r
.ecap{margin:8px 0 0;font-size:12px;color:var(--muted);line-height:1.6}\r
\r
/* 一致性体检 */\r
.chk{padding:6px 9px;border-bottom:1px dashed var(--border)}\r
.chk:last-child{border-bottom:none}\r
.chkh{font-size:11.5px;font-weight:700;color:var(--brand-text);margin-bottom:2px}\r
.issues{margin:0;padding-left:18px;font-size:12px;color:var(--danger);line-height:1.6}\r
.issues li{margin:2px 0}\r
\r
/* 第二版批准方案：保留原有结构化面板、曲线与折叠树，只对齐阅读语言。 */\r
:root{--font-heading:"Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun",serif;--bg:#fffefa;--surface:#f5f3ed;--surface2:#e7ebdf;--ink:#253a42;--ink2:#435852;--muted:#596863;--border:#d9d9ce;--brand:#876533;--brand-text:#765929;--brand-soft:#ede8da;--brand-soft2:#dfd4bd;--on-brand:#fffefa}\r
body{background:var(--surface);line-height:1.9}.wrap{max-width:1280px;padding:0 30px}.intro{background:var(--surface);padding:38px 0 28px}.intro h1{font:600 36px/1.5 var(--font-heading);letter-spacing:.05em}.intro .eyebrow{font-size:11px;letter-spacing:.16em}.intro p{max-width:80ch;line-height:1.95}.panel{padding:22px 24px;border-radius:3px;box-shadow:none;margin-bottom:20px}.panel h2{font-family:var(--font-heading);font-size:21px}.tree,details.cc{border-radius:3px;box-shadow:none}.nav{padding:16px 20px;border-radius:3px}.navlink{line-height:1.9}.navlink:focus-visible,summary:focus-visible{outline:2px solid var(--brand);outline-offset:3px}.kv{font-size:13px;line-height:1.9;padding-top:7px;padding-bottom:7px}table.mx th,table.mx td{padding:10px 12px;line-height:1.9;overflow-wrap:anywhere}.mxwrap{max-width:100%;overflow:auto}.cards{margin-bottom:45px}\r
@media (max-width: 760px){.wrap{padding:0 17px}.intro{padding:26px 0}.intro h1{font-size:28px}.panel{padding:17px}.mxwrap table{min-width:540px}.kv .kk{max-width:35%}}\r
@media print{.wrap{max-width:none;padding:0}.panel,.tree,details.cc{box-shadow:none}.mxwrap{overflow:visible}.mxwrap table{min-width:0}.intro{padding:12px 0}details::details-content{content-visibility:visible!important;block-size:auto!important;height:auto!important}}\r
</style>\r
</head>\r
<body>\r
\r
<header class="intro">\r
  <div class="wrap">\r
    <p class="eyebrow">章纲卡片流 · 17 节标准 × 卷纲骨架对齐</p>\r
    <h1>__CHAPTER_TITLE__</h1>\r
    __CHAPTER_SUMMARY__\r
    <div>__CHAPTER_CHIPS__</div>\r
  </div>\r
</header>\r
\r
<div class="wrap">\r
  <section class="panels">\r
__CHAPTER_ALIGN__\r
__CHAPTER_EXPECT__\r
__CHAPTER_FORES__\r
__CHAPTER_SCENE__\r
__CHAPTER_CURVE__\r
__CHAPTER_CHECK__\r
  </section>\r
  __CHAPTER_NAV__\r
  <main class="cards">\r
__CHAPTER_CARDS__\r
  </main>\r
</div>\r
\r
</body>\r
</html>`,u=`<!DOCTYPE html>\r
<html lang="zh-CN" data-qmai-layout="editorial-v2">\r
<head>\r
<meta charset="UTF-8">\r
<meta name="viewport" content="width=device-width, initial-scale=1">\r
<title>卷纲</title>\r
<style>\r
:root{\r
  --bg:#fffefa;--surface:#f5f3ed;--surface2:#e7ebdf;--ink:#253a42;--ink2:#435852;--muted:#596863;\r
  --border:#d9d9ce;--brand:#876533;--brand-text:#765929;--brand-soft:#ede8da;--brand-soft2:#dfd4bd;--on-brand:#fffefa;\r
  --qi:#8E6E63;--cheng:#D97757;--zhuan:#B8551D;--he:#F59E42;\r
  --day:#7FB07F;--warn:#96601A;--warn-soft:#FFF7E6;\r
  --k-qi-bg:#e9e6de;--k-qi-ink:#5F4A3E;--k-cheng-bg:#f0e4d8;--k-cheng-ink:#A8451C;--k-he-bg:#f6ecd9;--k-he-ink:#96601A;\r
  --font-heading:"Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun",serif;\r
}\r
*{box-sizing:border-box}\r
html,body{margin:0;padding:0}\r
body{background:var(--surface);color:var(--ink);font-size:15px;line-height:1.9;\r
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC",-apple-system,"Segoe UI",sans-serif;\r
  -webkit-font-smoothing:antialiased}\r
.wrap{max-width:1280px;margin:0 auto;padding:0 30px}\r
.intro{background:var(--surface);padding:38px 0 28px}\r
.intro .eyebrow{font-size:11px;letter-spacing:.16em;color:var(--brand-text);font-weight:600;margin:0 0 10px}\r
.intro h1{margin:0 0 10px;font:600 36px/1.5 var(--font-heading);letter-spacing:.05em}\r
.intro .goal{margin:0;max-width:80ch;color:var(--ink2);line-height:1.95}\r
.chip{display:inline-flex;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:3px 11px;font-size:12px;color:var(--ink2);margin:10px 6px 0 0}\r
.chip b{color:var(--brand-text)}\r
\r
/* 故事目录 */\r
.nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:14px 18px;margin:0 0 16px}\r
.nav .navt{font-size:11.5px;color:var(--muted);margin-right:4px}\r
.navlink{display:inline-flex;gap:6px;align-items:baseline;font-size:12px;color:var(--ink2);text-decoration:none;border:1px solid var(--border);border-radius:999px;padding:2px 10px;background:var(--surface)}\r
.navlink b{font-size:10.5px;color:var(--on-brand);background:var(--brand);border-radius:4px;padding:0 5px}\r
.navlink:hover{border-color:var(--brand);color:var(--brand-text)}\r
.navlink:focus-visible,summary:focus-visible{outline:2px solid var(--brand);outline-offset:3px}\r
\r
/* 折叠树（原生 details，全部默认展开） */\r
.tree{background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:14px 20px 26px;margin:0 0 45px}\r
.story-wrap{padding:6px 0 14px;border-bottom:1px dashed var(--border)}\r
.story-wrap:last-child{border-bottom:none}\r
.story-wrap:target{outline:2px solid var(--brand);outline-offset:2px;background:var(--brand-soft);border-radius:6px}\r
details.nd{margin:0}\r
details.nd>summary{list-style:none;cursor:pointer;display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:6px}\r
details.nd>summary::-webkit-details-marker{display:none}\r
details.nd>summary::marker{content:""}\r
details.nd>summary::before{content:"▾";width:16px;flex:none;color:var(--muted);font-size:11px;margin-top:5px;text-align:center}\r
details.nd:not([open])>summary::before{content:"▸"}\r
details.nd>summary:hover{background:var(--surface)}\r
details.nd>.kids{padding-left:22px;position:relative}\r
details.nd>.kids::before{content:"";position:absolute;left:8px;top:0;bottom:6px;width:1px;background:var(--border)}\r
.line{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}\r
.k{font-size:10.5px;font-weight:700;border-radius:4px;padding:1px 7px;flex:none;letter-spacing:.02em}\r
.k-s{background:var(--brand-soft2);color:var(--brand-text);border:1px solid var(--brand)}\r
.k-qi{background:var(--k-qi-bg);color:var(--k-qi-ink)}\r
.k-cheng{background:var(--k-cheng-bg);color:var(--k-cheng-ink)}\r
.k-zhuan{background:var(--brand-soft2);color:var(--brand-text)}\r
.k-he{background:var(--k-he-bg);color:var(--k-he-ink)}\r
.t{font:600 17px/1.6 var(--font-heading)}\r
.t2{font-weight:600;font-size:14px}\r
.tag{font-size:10.5px;border-radius:999px;padding:1px 8px;border:1px solid var(--border);color:var(--muted);background:var(--surface);flex:none}\r
.tag.chap{background:var(--surface2);border-color:var(--border);color:var(--ink2);font-weight:600}\r
.who{display:flex;gap:7px;flex-wrap:wrap;align-items:baseline;font-size:12.5px;color:var(--ink2);margin:2px 8px 6px;padding:4px 9px;background:var(--surface);border-left:2px solid var(--brand);border-radius:0 5px 5px 0}\r
.who .lb{font-size:10px;font-weight:700;color:var(--on-brand);background:var(--brand);border-radius:3px;padding:0 5px;flex:none}\r
.who .nm{font-weight:600;color:var(--ink)}\r
.txt{margin:0 0 4px;padding:2px 9px 2px 12px;font-size:13px;color:var(--ink2);line-height:1.85;position:relative}\r
.txt::before{content:"";position:absolute;left:3px;top:12px;width:4px;height:4px;border-radius:50%;background:var(--border)}\r
.empty{margin:6px 8px;padding:8px 10px;font-size:12.5px;color:var(--warn);background:var(--warn-soft);border:1px dashed var(--he);border-radius:6px}\r
\r
@media (max-width:760px){\r
  .wrap{padding:0 17px}\r
  .intro{padding:26px 0}\r
  .intro h1{font-size:28px}\r
  .tree{padding:12px}\r
}\r
@media print{\r
  .wrap{max-width:none;padding:0}\r
  .nav{display:none}\r
  details::details-content{content-visibility:visible!important;block-size:auto!important;height:auto!important}\r
}\r
</style>\r
</head>\r
<body>\r
\r
<header class="intro">\r
  <div class="wrap">\r
    <p class="eyebrow">卷纲 · 10 个故事 · 每故事 10 个环节</p>\r
    <h1>__VOLUME_TITLE__</h1>\r
    <p class="goal">__VOLUME_GOAL__</p>\r
    <div>__VOLUME_CHIPS__</div>\r
  </div>\r
</header>\r
\r
<div class="wrap">\r
  __VOLUME_NAV__\r
  <main class="tree">\r
__VOLUME_TREE__\r
  </main>\r
</div>\r
\r
</body>\r
</html>\r
`,d=[`平`,`升`,`起`,`落`,`缓`,`紧`,`顶`,`悬`],f={平:1,缓:1.6,落:2.2,升:2.8,起:3.2,紧:4.2,悬:4.6,顶:5};function p(e){let t=Array.from(e||``),n=[];t.length!==12&&n.push(`节拍数 ${t.length}（标准为 12）`);for(let e=2;e<t.length;e+=1)t[e]===t[e-1]&&t[e]===t[e-2]&&t[e]!==`顶`&&n.push(`第 ${e-1}–${e+1} 章连续 3 章同为「${t[e]}」`);let r=0;t.forEach((e,t)=>{r=e===`顶`?r+1:0,e===`顶`&&r>2&&n.push(`第 ${t+1} 章「顶」三连（最多 2 连）`)});for(let e=0;e<t.length-1;e+=1){let r=t[e+1],i=r===`悬`&&e+1===t.length-1;t[e]===`顶`&&![`落`,`缓`].includes(r)&&!i&&n.push(`第 ${e+1} 章「顶」后接「${r}」（应接 落 / 缓，收尾的 顶→悬 除外）`)}t.forEach((e,r)=>{e===`悬`&&r!==t.length-1&&n.push(`第 ${r+1} 章出现「悬」，但悬只能落在末章`)});let i=[...new Set(t.filter(e=>!d.includes(e)))];return i.length&&n.push(`出现未知节拍「${i.join(``)}」`),[...new Set(n)]}var m=[`__VOLUME_TITLE__`,`__VOLUME_GOAL__`,`__VOLUME_CHIPS__`,`__VOLUME_NAV__`,`__VOLUME_TREE__`],h=[`skills/SkillHub/DagangSkill/juangangzhedieshu/template.html`,`_up_/skills/SkillHub/DagangSkill/juangangzhedieshu/template.html`],g=`.qmai/卷纲模板.html`;async function _(){let e=[];try{e.push(a(await t()))}catch{}try{e.push(a(await n()))}catch{}return e}async function v(t){let n=[];t?.trim()&&n.push(`${a(t)}/${g}`);for(let e of await _())for(let t of h)n.push(`${e}/${t}`);for(let t of n)try{if(!await i(t))continue;let n=await e(t);if(m.every(e=>n.includes(e)))return}catch{}}var y=[`起①`,`起②`,`起③`,`承①`,`承②`,`承③`,`转①`,`转②`,`合①`,`合②`],ee=10,te=10,ne=3;function b(e){return!!e&&typeof e==`object`&&!Array.isArray(e)}function x(e){return typeof e==`string`?e.trim():typeof e==`number`&&Number.isFinite(e)?String(e):``}function re(e,t){if(typeof e==`number`&&Number.isFinite(e)&&e>0)return Math.round(e);let n=x(e).match(/\d+/)?.[0],r=n?Number.parseInt(n,10):NaN;return Number.isFinite(r)&&r>0?r:t}function ie(e){return Array.isArray(e)?e.map(e=>x(e)).filter(Boolean).join(``):``}var S=[{id:`起①`,k:`qi`,name:`常态与破口`},{id:`起②`,k:`qi`,name:`人物站定`},{id:`起③`,k:`qi`,name:`目标与代价`},{id:`承①`,k:`cheng`,name:`尝试与失败`},{id:`承②`,k:`cheng`,name:`资源拼图`},{id:`承③`,k:`cheng`,name:`中点反转`},{id:`转①`,k:`zhuan`,name:`认知反转`},{id:`转②`,k:`zhuan`,name:`代价抉择`},{id:`合①`,k:`he`,name:`小高潮`},{id:`合②`,k:`he`,name:`引线与余震`}],C={"起①":`第 1 章`,"起②":`第 2 章`,"起③":`第 3 章`,"承①":`第 4–5 章`,"承②":`第 6–7 章`,"承③":`第 8–9 章`,"转①":`第 10 章`,"转②":`第 11 章`,"合①":`第 11–12 章`,"合②":`第 12 章`};function ae(e){let t=[`# ${c(e.title||`卷纲`)}`,``];return e.goal?.trim()&&t.push(`> ${c(e.goal)}`,``),e.stories.forEach(e=>{t.push(`## 故事${e.id}${e.title?`：${c(e.title)}`:``}`,``),e.range?.trim()&&t.push(`- **章号范围：** ${c(e.range)}`),e.beats?.trim()&&t.push(`- **章情节拍：** ${c(e.beats)}`),t.push(``),e.st.forEach((e,n)=>{let r=S.find(t=>t.id===e.stage)??S[n],i=r?.name?`${e.stage||r.id} ${r.name}`:e.stage||r?.id||``,a=e.label?.trim()&&e.label.trim()!==r?.name?` · ${c(e.label)}`:``,o=e.p.map(e=>c(e)).filter(Boolean);(o.length!==0||e.who?.trim())&&(t.push(`### ${c(i)}${a}`,``),e.who?.trim()&&t.push(`- **人物：** ${c(e.who)}`),o.forEach(e=>t.push(`- ${e}`)),t.push(``))})}),t.join(`
`).trimEnd()+`
`}function w(e){if(!b(e))return null;let t=(Array.isArray(e.stories)?e.stories:[]).filter(b).map((e,t)=>{let n=(Array.isArray(e.st)?e.st:[]).filter(b).map(e=>({stage:x(e.stage)||x(e.k)||x(e.stageId)||x(e.key)||x(e.phase)||x(e.id),label:x(e.name)||x(e.label)||x(e.title),who:x(e.who),p:(Array.isArray(e.p)?e.p:[e.p]).map(e=>b(e)?x(e.v)||x(e.text):x(e)).filter(Boolean)}));return{id:re(e.id,t+1),range:x(e.range),title:x(e.title)||x(e.name),beats:x(e.beats)||ie(e.beats),st:n}});if(t.length===0)return null;let n=(Array.isArray(e.cast)?e.cast:[]).filter(b).map(e=>({n:x(e.n),role:x(e.role),stories:x(e.stories),u:x(e.u)})).filter(e=>e.n),r=(Array.isArray(e.rivals)?e.rivals:[]).filter(b).map(e=>({n:x(e.n),moves:(Array.isArray(e.moves)?e.moves:[]).filter(b).map((e,t)=>({id:typeof e.id==`number`?e.id:t+1,v:x(e.v)})).filter(e=>e.v)})).filter(e=>e.n),i=(Array.isArray(e.foreshadows)?e.foreshadows:[]).filter(b).map(e=>({v:x(e.v),seed:x(e.seed),pay:x(e.pay)})).filter(e=>e.v||e.seed||e.pay);return{title:x(e.title)||`卷纲`,...x(e.goal)?{goal:x(e.goal)}:{},stories:t,...n.length?{cast:n}:{},...r.length?{rivals:r}:{},...i.length?{foreshadows:i}:{}}}function oe(e,t=``){let n=[];return e?(e.stories.length<ee&&n.push(`故事数量不足 10 个（当前 ${e.stories.length} 个）。`),e.stories.forEach((e,t)=>{let r=`第 ${t+1} 个故事`;e.title||n.push(`${r}缺少故事标题。`),e.range||n.push(`${r}缺少章号范围 range。`),e.st.length<te&&n.push(`${r}环节不足 10 个（当前 ${e.st.length} 个）。`);let i=e.st.map(e=>e.stage);for(let e of y)i.includes(e)||n.push(`${r}缺少环节「${e}」。`);e.st.forEach(e=>{e.p.length<ne&&n.push(`${r}「${e.stage||`未知环节`}」内容不足 3 条（当前 ${e.p.length} 条）。`)})}),{ok:n.length===0,problems:n}):(n.push(t.trim()?`未解析到卷纲结构化数据（volumeOutlineData），无法渲染 HTML。`:`未解析到卷纲结构化数据（volumeOutlineData），无法生成卷纲。`),{ok:!1,problems:n})}function se(e,t){let n=0,r=!1,i=!1;for(let a=t;a<e.length;a+=1){let o=e[a];if(r){i?i=!1:o===`\\`?i=!0:o===`"`&&(r=!1);continue}if(o===`"`)r=!0;else if(o===`{`)n+=1;else if(o===`}`&&(--n,n===0))return e.slice(t,a+1)}return null}function T(e){let t=[];for(let n of e.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi))/volumeOutlineData/i.test(n[1])&&t.push(n[1]);t.length===0&&/volumeOutlineData/i.test(e)&&t.push(e);let n=[],r=new Set;for(let e of t){let t=0,i=e.indexOf(`{`,t);for(;i>=0;){let a=se(e,i);if(!a)break;try{let e=JSON.parse(a),o=w(b(e)&&b(e.volumeOutlineData)?e.volumeOutlineData:e);if(o){let e=`${o.title}|${o.stories.length}|${o.stories[0]?.range??``}`;r.has(e)||(r.add(e),n.push(o))}t=i+a.length}catch{t=i+1}i=e.indexOf(`{`,t)}}return n}function ce(e){let t=String(e??``),n=t.match(/第\s*(\d+|[零〇一二三四五六七八九十百千万两]+)\s*卷/)??t.match(/卷\s*(\d+|[零〇一二三四五六七八九十百千万两]+)/);if(!n)return null;let r=n[1];return/^\d+$/.test(r)?Number(r):o(r)}function le(e){return e.stories.length*1e3+e.stories.reduce((e,t)=>e+t.st.length*20+t.st.reduce((e,t)=>e+t.p.length,0),0)}function ue(e,t){let n=T(e);if(n.length===0)return null;if(n.length===1)return n[0];let r=[t.fileName,t.sourceIntent].map(e=>ce(e??``)).filter(e=>e!==null);if(r.length>0){let e=n.find(e=>{let t=ce(e.title);return t!==null&&r.includes(t)});if(e)return e}return[...n].sort((e,t)=>le(t)-le(e))[0]}function de(e){let t=T(e);return t.length>0?t[0]:null}m.every(e=>u.includes(e));var fe=`wiki/outlines/卷纲`;async function pe(t){if(!t?.trim())return[];let n=`${a(t)}/${fe}`,i=[];try{i=await r(n)}catch{return[]}let o=i.filter(e=>!e.is_dir&&/\.json$/i.test(e.name)),s=[];for(let t of o)try{let n=w(JSON.parse(await e(t.path)));n&&s.push(n)}catch{}return s}function me(e){let t=[];return e.forEach(e=>{e.stories.forEach(n=>{let r=n.beats?`｜节拍：${n.beats}`:``;t.push(`- 卷《${e.title||`未命名卷`}》故事${n.id}${n.title?` ${n.title}`:``}｜章号区间：${n.range||`未填`}${r}`)})}),t.length===0?[`【卷纲骨架】项目里还没有可用的卷纲结构化数据（伴生 .json）。`,`此时 story 骨架（index / name / range / beats）必须从卷纲 MD 原文**逐字抄写**，不得改写或自创。`].join(`
`):[`【卷纲真骨架（必须原样使用）】本次要拆的故事必须从下面清单里选一个，story 字段（index / name / range / beats）必须**逐字原样复制**，禁止改写、拼接或自创：`,...t,`若清单里没有你要拆的故事，说明该卷纲还没用新版保存过，此时才允许从卷纲 MD 原文逐字抄写。`].join(`
`)}var E=null;function he(){return E??``}async function ge(e){if(!e?.trim()){E=null;return}try{let t=await pe(e);E=t.length>0?me(t):null}catch{E=null}}var D=`__CHAPTER_TITLE__`,O=`__CHAPTER_SUMMARY__`,k=`__CHAPTER_CHIPS__`,A=`__CHAPTER_NAV__`,j=`__CHAPTER_ALIGN__`,M=`__CHAPTER_EXPECT__`,N=`__CHAPTER_FORES__`,P=`__CHAPTER_SCENE__`,F=`__CHAPTER_CURVE__`,I=`__CHAPTER_CHECK__`,L=`__CHAPTER_CARDS__`,R=[D,O,k,A,j,M,N,P,F,I,L],_e=[`skills/SkillHub/ZhanggangSkill/zhanggangjiegouhua/template.html`,`_up_/skills/SkillHub/ZhanggangSkill/zhanggangjiegouhua/template.html`],ve=`.qmai/章纲模板.html`,z=null;function ye(){return z??`<!DOCTYPE html>\r
<html lang="zh-CN" data-qmai-layout="editorial-v2">\r
<head>\r
<meta charset="UTF-8">\r
<meta name="viewport" content="width=device-width, initial-scale=1">\r
<title>章纲卡片流</title>\r
<style>\r
:root{\r
  --bg:#FFFFFF;--surface:#FBF8F5;--surface2:#F4EEE8;--ink:#241E1A;--ink2:#4A3F38;--muted:#7A6C63;\r
  --border:#E2D8CF;--brand:#B8551D;--brand-soft:#FBF0E9;--brand-soft2:#F6E0D2;--brand-text:#8A3F13;--on-brand:#FFFFFF;\r
  --qi:#8E6E63;--cheng:#D97757;--zhuan:#B8551D;--he:#F59E42;\r
  --ok:#3C7A3C;--ok-soft:#EEF7EE;--ok-border:#B7DFB7;--warn:#96601A;--warn-soft:#FFF7E6;--danger:#A8071A;--danger-soft:#FFF1F0;--danger-border:#FFCCC7;\r
  --day:#7FB07F;\r
  --k-qi-bg:#F1EDE9;--k-qi-ink:#5F4A3E;--k-cheng-bg:#FBEDE6;--k-cheng-ink:#A8451C;--k-he-bg:#FEF3E2;--k-he-ink:#96601A;\r
  --beat-flat-bg:#F4EEE8;--beat-flat-border:#E2D8CF;--beat-flat-ink:#5F4A3E;\r
  --beat-rise-bg:#FBEDE6;--beat-rise-border:#F0CDB8;--beat-rise-ink:#A8451C;\r
  --beat-tight-bg:#F6E0D2;--beat-tight-border:#E0A87E;--beat-tight-ink:#8A3F13;\r
  --beat-fall-bg:#EFEAE6;--beat-fall-border:#D8CCC2;--beat-fall-ink:#6B5548;\r
  --beat-hang-bg:#FFF7E6;--beat-hang-ink:#96601A;\r
}\r
*{box-sizing:border-box}\r
html,body{margin:0;padding:0}\r
body{background:var(--bg);color:var(--ink);\r
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC",-apple-system,"Segoe UI",sans-serif;\r
  font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased}\r
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}\r
.intro{background:var(--brand-soft);border-bottom:1px solid var(--border);padding:40px 0 32px}\r
.intro .eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--brand-text);font-weight:600;margin:0 0 12px}\r
.intro h1{margin:0 0 12px;font-size:26px;line-height:1.35}\r
.chip{display:inline-flex;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:4px 11px;font-size:12px;color:var(--ink2);margin:10px 6px 0 0}\r
.chip b{color:var(--brand-text)}\r
\r
/* 故事骨架卡 */\r
.story-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:12px}\r
.story-card .kv{border-bottom:none;padding:3px 0}\r
.story-card .beatrow{display:flex;gap:10px;align-items:flex-start;padding:4px 0 2px;flex-wrap:wrap}\r
.story-card .kk{flex:none;width:72px;color:var(--muted);font-size:11.5px}\r
\r
/* 面板 */\r
.panels{margin:14px 0 0}\r
.panel{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px 16px 16px;margin-bottom:12px}\r
.panel h2{margin:0 0 10px;font-size:14.5px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}\r
.panel h2 .pn{font-size:11.5px;font-weight:400;color:var(--muted)}\r
.panel .empty{margin:0;font-size:12.5px;color:var(--warn);background:var(--warn-soft);border:1px dashed var(--he);border-radius:8px;padding:8px 10px}\r
.panel .hint{margin:0;font-size:12px;color:var(--muted)}\r
.panel .okbox{margin:0;font-size:12.5px;color:var(--ok);background:var(--ok-soft);border:1px solid var(--ok-border);border-radius:8px;padding:10px 12px}\r
\r
/* 键值行 */\r
.kv{display:flex;gap:10px;align-items:baseline;padding:5px 9px;border-bottom:1px dashed var(--border);font-size:12.5px;line-height:1.6}\r
.kv:last-child{border-bottom:none}\r
.kv .kk{flex:none;width:86px;color:var(--muted);font-size:11.5px}\r
.kv .vv{flex:1;min-width:0;color:var(--ink2)}\r
\r
/* 表格 */\r
.mxwrap{overflow:auto;border:1px solid var(--border);border-radius:9px;margin-top:4px}\r
table.mx{border-collapse:collapse;width:100%;font-size:12px}\r
table.mx th,table.mx td{border-bottom:1px solid var(--border);padding:5px 8px;text-align:left;vertical-align:top;line-height:1.55}\r
table.mx thead th{background:var(--surface);color:var(--muted);font-weight:600;font-size:11px;white-space:nowrap;position:sticky;top:0}\r
table.mx tbody tr:last-child td{border-bottom:none}\r
table.mx td{color:var(--ink2)}\r
table.mx td.mxh,table.mx th.mxh{font-weight:600;color:var(--ink);white-space:nowrap;background:var(--surface)}\r
\r
/* 锚点导航 */\r
.nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin:14px 0 0}\r
.nav .navt{font-size:11.5px;color:var(--muted);margin-right:4px}\r
.navlink{display:inline-flex;gap:6px;align-items:baseline;font-size:12px;color:var(--ink2);text-decoration:none;border:1px solid var(--border);border-radius:999px;padding:2px 10px;background:var(--surface);max-width:260px;overflow:hidden;white-space:nowrap}\r
.navlink b{font-size:10.5px;color:var(--on-brand);background:var(--brand);border-radius:4px;padding:0 5px;flex:none}\r
.navlink:hover{border-color:var(--brand);color:var(--brand-text)}\r
\r
/* 章节卡流 */\r
.cards{margin:14px 0 40px;display:flex;flex-direction:column;gap:10px}\r
details.cc{background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden}\r
details.cc[open]{border-color:var(--brand)}\r
details.cc>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:11px 14px;background:var(--surface)}\r
details.cc>summary::-webkit-details-marker{display:none}\r
details.cc>summary::marker{content:""}\r
details.cc>summary::before{content:"▸";color:var(--muted);font-size:11px}\r
details.cc[open]>summary::before{content:"▾"}\r
details.cc>summary:hover{background:var(--surface2)}\r
.cno{font-size:11px;font-weight:700;color:var(--on-brand);background:var(--brand);border-radius:5px;padding:1px 8px;flex:none}\r
.ct{font-weight:600;font-size:14px}\r
.cgoal{font-size:12px;color:var(--muted);flex:1;min-width:200px}\r
.cbody{padding:6px 14px 14px}\r
.csec{padding:8px 0;border-bottom:1px dashed var(--border)}\r
.csec:last-child{border-bottom:none}\r
.csec h4{margin:0 0 6px;font-size:12.5px;color:var(--brand-text)}\r
.clist{margin:0;padding-left:20px;font-size:12.5px;color:var(--ink2);line-height:1.65}\r
.clist li{margin:2px 0}\r
details.cc:target{outline:2px solid var(--brand);outline-offset:2px}\r
\r
/* 标签 */\r
.tag{font-size:10.5px;border-radius:999px;padding:1px 8px;border:1px solid var(--border);color:var(--muted);background:var(--surface);flex:none}\r
.tag.exp{background:var(--warn-soft);border-color:var(--he);color:var(--warn);font-weight:600}\r
.tag.attr{background:var(--brand-soft2);border-color:var(--brand);color:var(--brand-text);font-weight:600}\r
.tag.mood{background:var(--k-qi-bg);border-color:var(--border);color:var(--k-qi-ink)}\r
.tag.chap{background:var(--surface2);color:var(--ink2);font-weight:600}\r
\r
/* 节拍 */\r
.beats{display:flex;flex-wrap:wrap;gap:4px;padding:4px 0}\r
.bt{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;border:1px solid var(--border);border-radius:6px;padding:2px 7px;background:var(--bg);line-height:1.5}\r
.bt[data-b="平"],.bt[data-b="缓"]{background:var(--beat-flat-bg);border-color:var(--beat-flat-border);color:var(--beat-flat-ink)}\r
.bt[data-b="升"],.bt[data-b="起"]{background:var(--beat-rise-bg);border-color:var(--beat-rise-border);color:var(--beat-rise-ink)}\r
.bt[data-b="紧"]{background:var(--beat-tight-bg);border-color:var(--beat-tight-border);color:var(--beat-tight-ink)}\r
.bt[data-b="顶"]{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}\r
.bt[data-b="落"]{background:var(--beat-fall-bg);border-color:var(--beat-fall-border);color:var(--beat-fall-ink)}\r
.bt[data-b="悬"]{background:var(--beat-hang-bg);border-color:var(--he);color:var(--beat-hang-ink)}\r
\r
/* 情绪曲线 */\r
.svgwrap{overflow:auto;border:1px solid var(--border);border-radius:9px;background:var(--surface)}\r
.svgwrap svg{display:block;width:100%;min-width:880px;height:220px}\r
svg .cg{stroke:var(--border);stroke-width:1}\r
svg .ct{fill:var(--muted);font-size:11px}\r
svg .cl{fill:none;stroke:var(--brand);stroke-width:2}\r
svg .ca{fill:var(--brand-soft);opacity:.7}\r
svg .cp{fill:var(--he);stroke:var(--bg);stroke-width:1}\r
.ecap{margin:8px 0 0;font-size:12px;color:var(--muted);line-height:1.6}\r
\r
/* 一致性体检 */\r
.chk{padding:6px 9px;border-bottom:1px dashed var(--border)}\r
.chk:last-child{border-bottom:none}\r
.chkh{font-size:11.5px;font-weight:700;color:var(--brand-text);margin-bottom:2px}\r
.issues{margin:0;padding-left:18px;font-size:12px;color:var(--danger);line-height:1.6}\r
.issues li{margin:2px 0}\r
\r
/* 第二版批准方案：保留原有结构化面板、曲线与折叠树，只对齐阅读语言。 */\r
:root{--font-heading:"Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun",serif;--bg:#fffefa;--surface:#f5f3ed;--surface2:#e7ebdf;--ink:#253a42;--ink2:#435852;--muted:#596863;--border:#d9d9ce;--brand:#876533;--brand-text:#765929;--brand-soft:#ede8da;--brand-soft2:#dfd4bd;--on-brand:#fffefa}\r
body{background:var(--surface);line-height:1.9}.wrap{max-width:1280px;padding:0 30px}.intro{background:var(--surface);padding:38px 0 28px}.intro h1{font:600 36px/1.5 var(--font-heading);letter-spacing:.05em}.intro .eyebrow{font-size:11px;letter-spacing:.16em}.intro p{max-width:80ch;line-height:1.95}.panel{padding:22px 24px;border-radius:3px;box-shadow:none;margin-bottom:20px}.panel h2{font-family:var(--font-heading);font-size:21px}.tree,details.cc{border-radius:3px;box-shadow:none}.nav{padding:16px 20px;border-radius:3px}.navlink{line-height:1.9}.navlink:focus-visible,summary:focus-visible{outline:2px solid var(--brand);outline-offset:3px}.kv{font-size:13px;line-height:1.9;padding-top:7px;padding-bottom:7px}table.mx th,table.mx td{padding:10px 12px;line-height:1.9;overflow-wrap:anywhere}.mxwrap{max-width:100%;overflow:auto}.cards{margin-bottom:45px}\r
@media (max-width: 760px){.wrap{padding:0 17px}.intro{padding:26px 0}.intro h1{font-size:28px}.panel{padding:17px}.mxwrap table{min-width:540px}.kv .kk{max-width:35%}}\r
@media print{.wrap{max-width:none;padding:0}.panel,.tree,details.cc{box-shadow:none}.mxwrap{overflow:visible}.mxwrap table{min-width:0}.intro{padding:12px 0}details::details-content{content-visibility:visible!important;block-size:auto!important;height:auto!important}}\r
</style>\r
</head>\r
<body>\r
\r
<header class="intro">\r
  <div class="wrap">\r
    <p class="eyebrow">章纲卡片流 · 17 节标准 × 卷纲骨架对齐</p>\r
    <h1>__CHAPTER_TITLE__</h1>\r
    __CHAPTER_SUMMARY__\r
    <div>__CHAPTER_CHIPS__</div>\r
  </div>\r
</header>\r
\r
<div class="wrap">\r
  <section class="panels">\r
__CHAPTER_ALIGN__\r
__CHAPTER_EXPECT__\r
__CHAPTER_FORES__\r
__CHAPTER_SCENE__\r
__CHAPTER_CURVE__\r
__CHAPTER_CHECK__\r
  </section>\r
  __CHAPTER_NAV__\r
  <main class="cards">\r
__CHAPTER_CARDS__\r
  </main>\r
</div>\r
\r
</body>\r
</html>`}async function be(){let e=[];try{e.push(a(await t()))}catch{}try{e.push(a(await n()))}catch{}return e}async function xe(t){let n=[];t?.trim()&&n.push(`${a(t)}/${ve}`);for(let e of await be())for(let t of _e)n.push(`${e}/${t}`);for(let t of n)try{if(!await i(t))continue;let n=await e(t);if(R.every(e=>n.includes(e))){z=n;return}}catch{}z=null}R.every(e=>l.includes(e));var Se=1,B=4,V=.2,Ce=500,we=[{label:`三行内入戏`,keywords:[`入戏`]},{label:`有明确变化`,keywords:[`变化`]},{label:`事件链有因果`,keywords:[`因果`]},{label:`有核心记忆点`,keywords:[`记忆点`]},{label:`有动作微细节`,keywords:[`微细节`]},{label:`有爽点`,keywords:[`爽点`]},{label:`回收旧信息`,keywords:[`回收`]},{label:`埋新信息`,keywords:[`埋`]},{label:`有追读钩子`,keywords:[`钩子`]},{label:`已写明下一章交接`,keywords:[`交接`]}],Te=[`起①`,`起②`,`起③`,`承①`,`承②`,`承③`,`转①`,`转②`,`合①`,`合②`];function H(e){return!!e&&typeof e==`object`&&!Array.isArray(e)}function U(e){return typeof e==`string`?e.trim():typeof e==`number`&&Number.isFinite(e)?String(e):``}function Ee(e){if(typeof e==`number`&&Number.isFinite(e))return e;let t=U(e).match(/\d+/)?.[0];return t?Number.parseInt(t,10):0}function De(e,t){if(typeof e==`number`&&Number.isFinite(e)&&e>0)return Math.round(e);let n=U(e).match(/\d+/)?.[0],r=n?Number.parseInt(n,10):NaN;return Number.isFinite(r)&&r>0?r:t}function W(e){return(Array.isArray(e)?e:[]).filter(H)}function G(e){return String(e??``).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}function K(e){return e.split(/[、,，；;\/]/).map(e=>e.trim()).filter(Boolean)}function Oe(e,t){let n=e.match(/^第\s*(\d+|[零〇一二三四五六七八九十百千万两]+)\s*[章节]\s*[：:、.．·,，—-]?\s*/);if(!n)return e;let r=n[1],i=/^\d+$/.test(r)?Number(r):o(r);return!Number.isFinite(i)||i!==t?e:e.slice(n[0].length).trim()||e}function q(e){if(!H(e))return null;let t=H(e.story)?e.story:{},n=W(e.chapters).map((e,t)=>{let n=De(e.n,t+1),r=H(e.info)?e.info:{},i=H(e.carry)?e.carry:{},a=H(e.position)?e.position:{},o=H(e.keywords)?e.keywords:{},s=H(e.conditions)?e.conditions:{},c=H(e.fourBeat)?e.fourBeat:{},l=H(e.sell)?e.sell:{},u=H(e.visual)?e.visual:{},d=H(e.foreshadow)?e.foreshadow:{},f=H(e.worldUpdate)?e.worldUpdate:{},p=H(e.rules)?e.rules:{},m=H(e.handover)?e.handover:{};return{n,title:Oe(U(e.title),n),stage:U(e.stage),beat:U(e.beat),expect:U(e.expect),time:U(e.time),place:U(e.place),seedFores:U(e.seedFores),payFores:U(e.payFores),info:{attr:U(r.attr),mood:U(r.mood),words:U(r.words),goal:U(r.goal)},carry:{hook:U(i.hook),left:U(i.left),heroState:U(i.heroState),castState:U(i.castState),fores:U(i.fores),expect:U(i.expect)},position:{main:U(a.main),advance:U(a.advance),charArc:U(a.charArc),relation:U(a.relation),whyRead:U(a.whyRead),newExpect:U(a.newExpect)},digest:U(e.digest),events:W(e.events).map(e=>({what:U(e.what),cause:U(e.cause),action:U(e.action),result:U(e.result),use:U(e.use)})),keywords:{scene:U(o.scene),mood:U(o.mood),props:U(o.props),relation:U(o.relation),sell:U(o.sell)},conditions:{enter:U(s.enter),trigger:U(s.trigger),interact:U(s.interact),result:U(s.result)},fourBeat:{open:U(c.open),clash:U(c.clash),burst:U(c.burst),close:U(c.close)},moodCurve:W(e.moodCurve).map(e=>({node:U(e.node),state:U(e.state),trigger:U(e.trigger),feel:U(e.feel)})),sell:{first:U(l.first),main:U(l.main),build:U(l.build),release:U(l.release),react:U(l.react),after:U(l.after),fit:U(l.fit)},expand:W(e.expand).map(e=>({info:U(e.info),how:U(e.how),skill:U(e.skill),effect:U(e.effect)})),visual:{env:U(u.env),micro:U(u.micro),hint:U(u.hint),replace:U(u.replace),memory:U(u.memory)},foreshadow:{payFrom:U(d.payFrom),payHow:U(d.payHow),payLevel:U(d.payLevel),seedNew:U(d.seedNew),seedAt:U(d.seedAt),seedUse:U(d.seedUse),hookType:U(d.hookType),readerAsk:U(d.readerAsk),nextMust:U(d.nextMust)},castChanges:W(e.castChanges).map(e=>({who:U(e.who),role:U(e.role),inState:U(e.inState),outState:U(e.outState),relation:U(e.relation)})),worldUpdate:{setting:U(f.setting),place:U(f.place),faction:U(f.faction),item:U(f.item),writeBack:U(f.writeBack)},rules:{must:U(p.must),forbid:U(p.forbid),secret:U(p.secret),pace:U(p.pace),style:U(p.style),sellPoint:U(p.sellPoint)},handover:{nextStart:U(m.nextStart),nextSolve:U(m.nextSolve),nextDelay:U(m.nextDelay),nextMood:U(m.nextMood),nextHook:U(m.nextHook)},checks:(Array.isArray(e.checks)?e.checks:[]).map(U).filter(Boolean)}});return n.length===0?null:{title:U(e.title)||`章纲`,story:{index:typeof t.index==`number`?t.index:1,name:U(t.name),range:U(t.range),beats:U(t.beats)},chapters:n,words:Ee(e.words)}}function J(e,t,n){let r=t?`<span class="pn">${G(t)}</span>`:``;return`<section class="panel"><h2>${G(e)}${r}</h2>${n}</section>`}function Y(e){return`<p class="empty">${G(e)}</p>`}function X(e,t){let n=t.trim()||`未填`;return`<div class="kv"><span class="kk">${G(e)}</span><span class="vv">${G(n)}</span></div>`}function ke(e){return e.length===0?`<p class="hint">未填</p>`:`<ul class="clist">${e.map(e=>`<li>${G(e)}</li>`).join(``)}</ul>`}function Z(e,t){return t.length===0?`<p class="hint">未填</p>`:`<div class="mxwrap"><table class="mx"><thead><tr>${e.map(e=>`<th>${G(e)}</th>`).join(``)}</tr></thead><tbody>${t.map(e=>`<tr>${e.map((e,t)=>`<td${t===0?` class="mxh"`:``}>${G(e)}</td>`).join(``)}</tr>`).join(``)}</tbody></table></div>`}var Ae=[{id:`s1`,title:`§1 基础信息`,rows:[{kind:`kv`,label:`章节编号`,get:e=>`第 ${String(e.n).padStart(3,`0`)} 章`},{kind:`kv`,label:`章节标题`,get:e=>e.title},{kind:`kv`,label:`所属环节`,get:e=>`${e.stage}${C[e.stage]?`（${C[e.stage]}）`:``}`},{kind:`kv`,label:`本章节拍`,get:e=>e.beat},{kind:`kv`,label:`字数目标`,get:e=>e.info.words},{kind:`kv`,label:`章节属性`,get:e=>e.info.attr},{kind:`kv`,label:`核心情绪`,get:e=>e.info.mood},{kind:`kv`,label:`主期待感`,get:e=>e.expect},{kind:`kv`,label:`章内时间`,get:e=>e.time},{kind:`kv`,label:`主要地点`,get:e=>e.place},{kind:`kv`,label:`一句话目标`,get:e=>e.info.goal}]},{id:`s2`,title:`§2 上章承接`,rows:[{kind:`kv`,label:`上章结尾钩子`,get:e=>e.carry.hook},{kind:`kv`,label:`上章遗留问题`,get:e=>e.carry.left},{kind:`kv`,label:`主角当前状态`,get:e=>e.carry.heroState},{kind:`kv`,label:`角色当前状态`,get:e=>e.carry.castState},{kind:`kv`,label:`未回收伏笔`,get:e=>e.carry.fores},{kind:`kv`,label:`必须承接的期待`,get:e=>e.carry.expect}]},{id:`s3`,title:`§3 本章定位`,rows:[{kind:`kv`,label:`主线承接`,get:e=>e.position.main},{kind:`kv`,label:`主线推进`,get:e=>e.position.advance},{kind:`kv`,label:`人物变化`,get:e=>e.position.charArc},{kind:`kv`,label:`关系变化`,get:e=>e.position.relation},{kind:`kv`,label:`读者追读目的`,get:e=>e.position.whyRead},{kind:`kv`,label:`结束后新期待`,get:e=>e.position.newExpect}]},{id:`s4`,title:`§4 浓缩剧情`,rows:[{kind:`kv`,label:`一句话公式`,get:e=>e.digest}]},{id:`s5`,title:`§5 核心事件链`,rows:[{kind:`table`,label:`事件因果链`,head:[`事件`,`起因`,`行动`,`结果`,`作用`],get:e=>e.events.map(e=>[e.what,e.cause,e.action,e.result,e.use])}]},{id:`s6`,title:`§6 关键词与必要条件`,rows:[{kind:`kv`,label:`场景关键词`,get:e=>e.keywords.scene},{kind:`kv`,label:`情绪关键词`,get:e=>e.keywords.mood},{kind:`kv`,label:`道具线索`,get:e=>e.keywords.props},{kind:`kv`,label:`关系关键词`,get:e=>e.keywords.relation},{kind:`kv`,label:`爽点冲突`,get:e=>e.keywords.sell},{kind:`table`,label:`必要条件`,head:[`类型`,`内容`],get:e=>[[`入场条件`,e.conditions.enter],[`触发条件`,e.conditions.trigger],[`互动条件`,e.conditions.interact],[`结果条件`,e.conditions.result]]}]},{id:`s7`,title:`§7 四段式章纲`,rows:[{kind:`kv`,label:`开篇入戏`,get:e=>e.fourBeat.open},{kind:`kv`,label:`中段冲突`,get:e=>e.fourBeat.clash},{kind:`kv`,label:`核心爆点`,get:e=>e.fourBeat.burst},{kind:`kv`,label:`强钩收尾`,get:e=>e.fourBeat.close}]},{id:`s8`,title:`§8 情绪曲线`,rows:[{kind:`table`,label:`四节点情绪`,head:[`节点`,`情绪状态`,`触发事件`,`读者感受`],get:e=>e.moodCurve.map(e=>[e.node,e.state,e.trigger,e.feel])}]},{id:`s9`,title:`§9 爽点与看点`,rows:[{kind:`kv`,label:`章首看点`,get:e=>e.sell.first},{kind:`kv`,label:`主要爽点`,get:e=>e.sell.main},{kind:`kv`,label:`爽点铺垫`,get:e=>e.sell.build},{kind:`kv`,label:`爽点释放`,get:e=>e.sell.release},{kind:`kv`,label:`反应层对象`,get:e=>e.sell.react},{kind:`kv`,label:`之后的新期待`,get:e=>e.sell.after},{kind:`kv`,label:`与核心卖点一致`,get:e=>e.sell.fit}]},{id:`s10`,title:`§10 关键信息与扩写方式`,rows:[{kind:`table`,label:`信息 → 场景`,head:[`关键信息`,`如何扩写`,`扩写技法`,`情绪作用`],get:e=>e.expand.map(e=>[e.info,e.how,e.skill,e.effect])}]},{id:`s11`,title:`§11 画面细节`,rows:[{kind:`kv`,label:`环境细节`,get:e=>e.visual.env},{kind:`kv`,label:`动作微细节`,get:e=>e.visual.micro},{kind:`kv`,label:`信息暗线`,get:e=>e.visual.hint},{kind:`kv`,label:`可替代心理`,get:e=>e.visual.replace},{kind:`kv`,label:`视觉记忆点`,get:e=>e.visual.memory}]},{id:`s12`,title:`§12 伏笔与钩子`,rows:[{kind:`kv`,label:`本章预埋伏笔`,get:e=>e.seedFores},{kind:`kv`,label:`本章回收伏笔`,get:e=>e.payFores},{kind:`kv`,label:`回收来源`,get:e=>e.foreshadow.payFrom},{kind:`kv`,label:`如何回收`,get:e=>e.foreshadow.payHow},{kind:`kv`,label:`回收程度`,get:e=>e.foreshadow.payLevel},{kind:`kv`,label:`新伏笔`,get:e=>e.foreshadow.seedNew},{kind:`kv`,label:`埋设位置`,get:e=>e.foreshadow.seedAt},{kind:`kv`,label:`后续用途`,get:e=>e.foreshadow.seedUse},{kind:`kv`,label:`钩子类型`,get:e=>e.foreshadow.hookType},{kind:`kv`,label:`读者会问`,get:e=>e.foreshadow.readerAsk},{kind:`kv`,label:`下章必须回应`,get:e=>e.foreshadow.nextMust}]},{id:`s13`,title:`§13 出场角色与状态变化`,rows:[{kind:`table`,label:`角色状态`,head:[`角色`,`本章作用`,`入场状态`,`结束状态`,`关系变化`],get:e=>e.castChanges.map(e=>[e.who,e.role,e.inState,e.outState,e.relation])}]},{id:`s14`,title:`§14 设定 / 世界观 / 道具更新`,rows:[{kind:`kv`,label:`新增设定`,get:e=>e.worldUpdate.setting},{kind:`kv`,label:`新增地点`,get:e=>e.worldUpdate.place},{kind:`kv`,label:`新增势力`,get:e=>e.worldUpdate.faction},{kind:`kv`,label:`新增道具`,get:e=>e.worldUpdate.item},{kind:`kv`,label:`需写回设定`,get:e=>e.worldUpdate.writeBack}]},{id:`s15`,title:`§15 写作约束`,rows:[{kind:`kv`,label:`必须写`,get:e=>e.rules.must},{kind:`kv`,label:`禁止写`,get:e=>e.rules.forbid},{kind:`kv`,label:`不能泄露`,get:e=>e.rules.secret},{kind:`kv`,label:`节奏要求`,get:e=>e.rules.pace},{kind:`kv`,label:`文风要求`,get:e=>e.rules.style},{kind:`kv`,label:`不可偏离卖点`,get:e=>e.rules.sellPoint}]},{id:`s16`,title:`§16 下一章交接`,rows:[{kind:`kv`,label:`下章须承接`,get:e=>e.handover.nextStart},{kind:`kv`,label:`下章须解决`,get:e=>e.handover.nextSolve},{kind:`kv`,label:`可延迟揭示`,get:e=>e.handover.nextDelay},{kind:`kv`,label:`推荐情绪`,get:e=>e.handover.nextMood},{kind:`kv`,label:`推荐章尾钩子`,get:e=>e.handover.nextHook}]},{id:`s17`,title:`§17 写作检查清单`,rows:[{kind:`list`,label:`已覆盖条目`,get:e=>e.checks}]}];function je(e){let t=[`# ${c(e.title||`章纲`)}`,``],n=e.story;if(n?.name||n?.range){let e=[n?.name?`故事${n.index} ${c(n.name)}`:``,n?.range?c(n.range):``].filter(Boolean).join(` · `);e&&t.push(`> ${e}`,...n?.beats?[`>`,`> 章情节拍：${c(n.beats)}`]:[],``)}return e.chapters.forEach(e=>{t.push(`## 第 ${e.n} 章 ${c(e.title||``)}`.trim(),``),Ae.forEach(n=>{let r=[],i=``,a=!1,o=e=>{a&&r.length>0&&r.push(``),a=!1,r.push(e)};n.rows.forEach(t=>{if(i&&i!==t.kind&&(a=!0),i=t.kind,t.kind===`kv`){let n=c(String(t.get(e)??``));n&&o(`- **${t.label}：** ${n}`);return}if(t.kind===`list`){(t.get(e)??[]).map(e=>c(String(e??``))).filter(Boolean).forEach(e=>o(`- ${e}`));return}let n=(t.get(e)??[]).filter(e=>(t.head.length>1?e.slice(1):e).some(e=>String(e??``).trim()));if(n.length===0)return;let r=e=>s(String(e??``));o(`| ${t.head.join(` | `)} |`),o(`| ${t.head.map(()=>`---`).join(` | `)} |`),n.forEach(e=>o(`| ${e.map(r).join(` | `)} |`))}),r.length!==0&&t.push(`### ${n.title}`,``,...r,``)})}),t.join(`
`).trimEnd()+`
`}function Me(e,t){return e.rows.map(e=>e.kind===`kv`?X(e.label,e.get(t)):e.kind===`list`?ke(e.get(t)):Z(e.head,e.get(t))).join(``)}function Ne(e,t){let n=C[e.stage]??``,r=[`<span class="cno">第 ${G(String(e.n))} 章</span>`,`<span class="ct">${G(e.title||`未命名`)}</span>`,e.info.attr?`<span class="tag attr">${G(e.info.attr)}</span>`:``,e.info.mood?`<span class="tag mood">${G(e.info.mood)}</span>`:``,e.expect?`<span class="tag exp">期待 · ${G(e.expect)}</span>`:``,e.stage?`<span class="tag chap" title="${G(n||e.stage)}">${G(e.stage)}</span>`:``,e.beat?`<span class="bt" data-b="${G(e.beat)}">${G(e.beat)}</span>`:``,e.info.goal?`<span class="cgoal">${G(e.info.goal)}</span>`:``].filter(Boolean).join(``),i=Ae.map(t=>`<div class="csec" id="ch-${G(String(e.n))}-${t.id}"><h4>${G(t.title)}</h4>${Me(t,e)}</div>`).join(``);return`<details class="cc" id="ch-${G(String(e.n))}"${t?` open`:``}><summary>${r}</summary><div class="cbody">${i}</div></details>`}function Pe(e){return e.chapters.length===0?Y(`未包含章纲数据（chapters 为空），请重新生成章纲。`):e.chapters.map((e,t)=>Ne(e,t===0)).join(``)}function Fe(e){let t=e.story,n=Array.from(t.beats||``),r=n.length?n.map(e=>`<span class="bt" data-b="${G(e)}">${G(e)}</span>`).join(``):`<span class="hint">骨架节拍未填</span>`;return`<div class="story-card">${[X(`所属故事`,t.name?`故事${t.index}：${t.name}`:`故事${t.index}`),X(`章号区间`,t.range||`${e.chapters.length} 章`),X(`字数目标`,e.words?`约 ${(e.words/1e4).toFixed(1)} 万字`:`未填`),X(`章节数`,`${e.chapters.length} 章`)].join(``)}<div class="beatrow"><span class="kk">骨架节拍</span><div class="beats">${r}</div></div></div>`}function Ie(e){let t=e.chapters,n=t.reduce((e,t)=>e+t.events.length,0),r=t.reduce((e,t)=>e+K(t.seedFores).length,0),i=t.reduce((e,t)=>e+K(t.payFores).length,0),a=t.filter(e=>e.beat===`顶`).length,o=e.words||t.reduce((e,t)=>e+Number(t.info.words.replace(/[^\d]/g,``))||0,0);return[`<span class="chip"><b>${t.length}</b> 章</span>`,o?`<span class="chip"><b>约 ${(o/1e4).toFixed(1)}</b> 万字</span>`:``,`<span class="chip"><b>${n}</b> 个事件</span>`,`<span class="chip"><b>${r}</b> 埋 / <b>${i}</b> 收 伏笔</span>`,`<span class="chip"><b>${a}</b> 个峰值（顶）</span>`].filter(Boolean).join(``)}function Le(e){return e.chapters.length===0?``:`<nav class="nav"><span class="navt">跳到章节</span>${e.chapters.map(e=>`<a class="navlink" href="#ch-${G(String(e.n))}"><b>${G(String(e.n))}</b>${G(e.title||`未命名`)}</a>`).join(``)}</nav>`}function Re(e){let t=e.chapters;if(t.length===0)return``;let n=t.map((t,n)=>[`第 ${t.n} 章`,t.stage||`未填`,t.beat||`未填`,e.story.beats[n]??`—`,t.expect||`未填`,t.info.attr||`未填`]),r=Z([`章号`,`所属环节`,`本章节拍`,`骨架节拍`,`主期待感`,`章节属性`],n),i=e.story.beats?n.every(e=>e[2]===e[3])?`节拍与骨架逐字对齐`:`存在节拍不一致，见体检面板`:`骨架节拍未填`,a=Z([`章号`,`字数目标`,`本章`,`累计`],t.map((e,n)=>{let r=Number(e.info.words.replace(/[^\d]/g,``))||0,i=t.slice(0,n+1).reduce((e,t)=>e+(Number(t.info.words.replace(/[^\d]/g,``))||0),0);return[`第 ${e.n} 章`,e.info.words||`未填`,r?`${(r/1e4).toFixed(2)} 万`:`—`,`${(i/1e4).toFixed(2)} 万`]}));return[J(`章 × 环节 × 节拍 对照`,i,r),J(`字数配比`,e.words?`故事目标 约 ${(e.words/1e4).toFixed(1)} 万字`:``,a)].join(``)}function ze(e){let t=e.chapters;if(t.length===0)return``;let n=Z([`章号`,`承接上章的期待`,`本章主期待`,`章尾钩子类型`,`读者会问`,`下章必须回应`],t.map(e=>[`第 ${e.n} 章`,e.carry.expect||`—`,e.expect||`未填`,e.foreshadow.hookType||`未填`,e.foreshadow.readerAsk||`—`,e.foreshadow.nextMust||`—`])),r=Z([`章号`,`章首看点`,`主要爽点`,`反应层对象`,`爽点后新期待`],t.map(e=>[`第 ${e.n} 章`,e.sell.first||`—`,e.sell.main||`未填`,e.sell.react||`—`,e.sell.after||`—`]));return[J(`期待与钩子链`,`承接 → 本章期待 → 章尾钩子 → 交给下一章`,n),J(`爽点节奏表`,``,r)].join(``)}function Be(e){let t=e.chapters;if(t.length===0)return``;let n=[],r=new Set,i=0;if(t.forEach(e=>{K(e.seedFores).forEach(t=>{r.has(t)||r.add(t),n.push([`第 ${e.n} 章 · 埋`,t,e.foreshadow.seedAt||`—`,e.foreshadow.seedUse||`—`])}),K(e.payFores).forEach(t=>{let a=r.has(t);a||(i+=1),n.push([`第 ${e.n} 章 · 收`,t,e.foreshadow.payLevel||`—`,a?`闭环保内`:`无同故事埋点`])})}),n.length===0)return J(`伏笔账本`,``,Y(`本次未生成伏笔埋收数据（技能要求每章填 seedFores / payFores）。`));let a=Z([`动作`,`伏笔`,`说明`,`程度 / 用途`],n);return J(`伏笔账本`,i>0?`${n.length} 条记录 · ${i} 条回收在本故事内找不到埋点`:`${n.length} 条记录 · 本故事内埋收闭环`,a)}function Ve(e){let t=e.chapters;if(t.length===0)return``;let n=[];t.forEach(e=>{e.castChanges.forEach(t=>{n.push([`第 ${e.n} 章`,t.who,t.role,t.inState,t.outState,t.relation])})});let r=n.length?Z([`章号`,`角色`,`本章作用`,`入场状态`,`结束状态`,`关系变化`],n):Y(`本次未生成角色状态变化（技能要求每章填 castChanges）。`),i=Z([`章号`,`主要地点`,`章内时间`],t.map(e=>[`第 ${e.n} 章`,e.place||`未填`,e.time||`未填`]));return[J(`人物出场与状态变化`,n.length?`${n.length} 条`:``,r),J(`地点与时间切换`,``,i)].join(``)}function He(e){let t=e.chapters;if(t.length<2)return J(`情绪曲线`,``,Y(`章节不足 2 章，无法绘制曲线。`));let n=t.map(e=>f[e.beat]??2.5),r=e=>46+1138*e/(n.length-1),i=e=>22+184*(1-(e-1)/4),a=n.map((e,t)=>`${r(t).toFixed(1)},${i(e).toFixed(1)}`).join(` `),o=`46,${206 .toFixed(1)} ${a} ${1184 .toFixed(1)},${206 .toFixed(1)}`,s=[{value:5,label:`顶`},{value:3.2,label:`起`},{value:1,label:`平`}].map(e=>[`<line class="cg" x1="46" x2="1184" y1="${i(e.value).toFixed(1)}" y2="${i(e.value).toFixed(1)}"/>`,`<text class="ct" x="38" y="${(i(e.value)+4).toFixed(1)}" text-anchor="end">${e.label}</text>`].join(``)).join(``),c=t.map((e,t)=>`<text class="ct" x="${r(t).toFixed(1)}" y="230" text-anchor="middle">${G(String(e.n))}</text>`).join(``),l=n.map((e,t)=>e===5?`<circle class="cp" cx="${r(t).toFixed(1)}" cy="${i(5).toFixed(1)}" r="3"/>`:``).join(``),u=[`<div class="svgwrap"><svg viewBox="0 0 1200 240" role="img" aria-label="逐章情绪强度曲线">`,s,`<polygon class="ca" points="${o}"/>`,`<polyline class="cl" points="${a}"/>`,l,c,`</svg></div>`].join(``);return J(`情绪曲线`,`${t.length} 章 · 峰值 ${n.filter(e=>e===5).length} 次`,u+`<p class="ecap">纵轴＝本章节拍强度（平 1 → 顶 5），横轴＝章号。低谷（平/落/缓）用来交代与消化代价，峰值（顶）用来收账。</p>`)}function Ue(e){let t=Ge(e).problems,n=[],r=Array.from(e.story.beats||``);r.length>0&&r.length!==e.chapters.length&&n.push(`骨架节拍 ${r.length} 拍与章纲 ${e.chapters.length} 章数量不等，请确认卷纲口径。`);let i=n.length?`<p class="hint">${G(n.join(` `))}</p>`:``;if(t.length===0)return J(`一致性体检`,`全部通过`,`<p class="okbox">章数、章号连续性、节拍对齐、环节顺序、伏笔闭环、日常落拍、事件链因果、必要条件、章间交接链、写作约束与字数配比均通过校验。</p>${i}`);let a=new Map;t.forEach(e=>{let t=e.match(/^第 \d+ 章/)?.[0]??`整体`,n=a.get(t)??[];n.push(e),a.set(t,n)});let o=[...a.entries()].map(([e,t])=>`<div class="chk"><div class="chkh">${G(e)}</div><ul class="issues">${t.map(e=>`<li>${G(e)}</li>`).join(``)}</ul></div>`).join(``);return J(`一致性体检`,`${t.length} 项待修`,o+i)}function We(e,t=ye()){let n={[D]:G(e.title||`章纲`),[O]:Fe(e),[k]:Ie(e),[A]:Le(e),[j]:Re(e),[M]:ze(e),[N]:Be(e),[P]:Ve(e),[F]:He(e),[I]:Ue(e),[L]:Pe(e)};return Object.entries(n).reduce((e,[t,n])=>e.replace(t,()=>n),t)}function Ge(e){let t=[];if(!e)return t.push(`未解析到章纲结构化数据（chapterOutlineData），无法渲染 HTML。`),{ok:!1,problems:t};let n=e.chapters;if(n.length<Se)return t.push(`章纲未包含任何章节。`),{ok:!1,problems:t};let r=Ke(e.story.range);if(r&&r!==n.length&&t.push(`章节数与故事骨架不一致：骨架 ${r} 章，实际 ${n.length} 章。`),n.forEach((e,r)=>{r>0&&e.n!==n[r-1].n+1&&t.push(`第 ${e.n} 章的章号不连续（上一章为第 ${n[r-1].n} 章）。`)}),e.story.beats){let r=Array.from(e.story.beats);n.forEach((e,n)=>{let i=r[n];i&&e.beat&&e.beat!==i&&t.push(`第 ${e.n} 章节拍「${e.beat}」与骨架节拍「${i}」不一致。`)})}let i=-1;n.forEach(e=>{if(!e.stage){t.push(`第 ${e.n} 章缺少所属环节（stage）。`);return}let n=Te.indexOf(e.stage);if(n<0){t.push(`第 ${e.n} 章的环节「${e.stage}」不在 10 环节体系内。`);return}n<i&&t.push(`第 ${e.n} 章的环节「${e.stage}」出现回退，不符合 10 环节前进顺序。`),i=n}),p(n.map(e=>e.beat).join(``)).filter(e=>!e.startsWith(`节拍数`)).forEach(e=>t.push(`节拍纪律：${e}。`));let a=new Map;n.forEach(e=>{K(e.payFores).forEach(n=>{let r=a.get(n);r===void 0?t.push(`第 ${e.n} 章回收的伏笔「${n}」在本故事内没有更早的埋点。`):r>=e.n&&t.push(`第 ${e.n} 章回收的伏笔「${n}」埋点章号（第 ${r} 章）不早于回收章。`)}),K(e.seedFores).forEach(t=>{a.has(t)||a.set(t,e.n)})});let o=[`平`,`落`,`缓`,`悬`];n.forEach(e=>{(/日常/.test(e.position.advance)||/日常/.test(e.position.main))&&!o.includes(e.beat)&&t.push(`第 ${e.n} 章为日常章，但节拍是「${e.beat}」（日常只能落在 平/落/缓/悬）。`)}),n.forEach(e=>{e.events.length<6&&t.push(`第 ${e.n} 章核心事件链不足 6 条（当前 ${e.events.length} 条）。`),e.events.forEach((n,r)=>{n.cause.trim()||t.push(`第 ${e.n} 章第 ${r+1} 个事件缺少起因，不构成因果链。`),n.result.trim()||t.push(`第 ${e.n} 章第 ${r+1} 个事件缺少结果，不构成因果链。`)})}),n.forEach(e=>{let n=[[`入场条件`,e.conditions.enter],[`触发条件`,e.conditions.trigger],[`互动条件`,e.conditions.interact],[`结果条件`,e.conditions.result]].filter(([,e])=>!e.trim()).map(([e])=>e);n.length>0&&t.push(`第 ${e.n} 章缺少必要条件：${n.join(` / `)}。`)}),n.forEach((e,r)=>{let i=n[r+1];i&&(e.handover.nextStart.trim()||t.push(`第 ${e.n} 章缺少「下一章交接」，第 ${i.n} 章会断档。`),i.carry.hook.trim()||t.push(`第 ${i.n} 章缺少「上章结尾钩子」，与第 ${e.n} 章接不上。`))}),n.forEach(e=>{!e.rules.must.trim()&&!e.rules.forbid.trim()&&t.push(`第 ${e.n} 章缺少写作约束（§15）。`),e.checks.length===0&&t.push(`第 ${e.n} 章缺少写作检查清单（§17）。`)});let s=0;n.forEach(e=>{if(e.checks.length===0)return;let n=we.filter(t=>!e.checks.some(e=>t.keywords.some(t=>e.includes(t)))).map(e=>e.label);n.length!==0&&(s+=1,s<=3&&t.push(`第 ${e.n} 章写作检查清单（§17）缺少固定项：${n.slice(0,5).join(` / `)}。`))}),s>3&&t.push(`另有 ${s-3} 章的 §17 检查清单缺少固定项。`),n.forEach(e=>{e.moodCurve.length<B&&t.push(`第 ${e.n} 章情绪曲线（§8）不足 ${B} 个节点（当前 ${e.moodCurve.length} 个）。`),(e.expand.length===0||e.expand.some(e=>!e.info.trim()||!e.how.trim()))&&t.push(`第 ${e.n} 章关键信息与扩写方式（§10）缺失或没写清扩写方式。`),(!e.visual.env.trim()||!e.visual.memory.trim())&&t.push(`第 ${e.n} 章画面细节（§11）缺少环境或记忆点。`),e.castChanges.length===0&&t.push(`第 ${e.n} 章缺少出场角色与状态变化（§13）。`),[e.worldUpdate.setting,e.worldUpdate.place,e.worldUpdate.faction,e.worldUpdate.item,e.worldUpdate.writeBack].some(e=>e.trim().length>0)||t.push(`第 ${e.n} 章缺少设定 / 世界观 / 道具更新（§14）。`)});let c=n.reduce((e,t)=>e+(Number(t.info.words.replace(/[^\d]/g,``))||0),0);return e.words>=Ce&&c>0&&Math.abs(c-e.words)/e.words>V&&t.push(`逐章字数合计 ${c} 与故事字数目标 ${e.words} 偏差超过 ${V*100}%。`),{ok:t.length===0,problems:t}}function Ke(e){let t=String(e).match(/\d+/g);if(!t||t.length===0)return null;let n=Number(t[0]),r=t.length>1?Number(t[1]):n;return!Number.isFinite(n)||!Number.isFinite(r)||r<n?null:r-n+1}function qe(e,t){let n=0,r=!1,i=!1;for(let a=t;a<e.length;a+=1){let o=e[a];if(r){i?i=!1:o===`\\`?i=!0:o===`"`&&(r=!1);continue}if(o===`"`)r=!0;else if(o===`{`)n+=1;else if(o===`}`&&(--n,n===0))return e.slice(t,a+1)}return null}function Je(e){if(!H(e))return null;let t=q(e);if(t)return t;for(let t of Object.values(e)){if(!H(t))continue;let e=q(t);if(e)return e}return null}function Ye(e){let t=/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi,n=[];for(let r of e.matchAll(t))r[1].includes(`{`)&&n.push(r[1]);n.length===0&&e.includes(`{`)&&n.push(e);for(let e of n){let t=e.indexOf(`{`);for(;t>=0;){let n=qe(e,t);if(n)try{let e=Je(JSON.parse(n));if(e)return e}catch{}t=e.indexOf(`{`,t+1)}}return null}function Xe(e,t){let n=[];for(let r of e.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi))new RegExp(t,`i`).test(r[1])&&n.push(r[1]);n.length===0&&new RegExp(t,`i`).test(e)&&n.push(e);for(let e of n){let t=e.indexOf(`{`);if(t<0)continue;let n=0,r=!1,i=!1;for(let a=t;a<e.length;a+=1){let o=e[a];if(r){i?i=!1:o===`\\`?i=!0:o===`"`&&(r=!1);continue}if(o===`"`)r=!0;else if(o===`{`)n+=1;else if(o===`}`&&(--n,n===0))try{return JSON.parse(e.slice(t,a+1))}catch{return null}}}return null}function Ze(e){return e.replace(/```(?:json)?[ \t]*\r?\n[\s\S]*?```/gi,``).trim()}function Qe(e){let t=Xe(e,`chapterOutlineBatch`);if(!H(t))return null;let n=q(H(t.chapterOutlineBatch)?t.chapterOutlineBatch:t);return n?{data:n,md:Ze(e)}:null}function Q(e){let t=String(e).match(/\d+/g);if(!t||t.length===0)return null;let n=Number(t[0]),r=t.length>1?Number(t[1]):n;return!Number.isFinite(n)||!Number.isFinite(r)||r<n?null:{start:n,end:r}}function $e(e){let t=new Map;e.forEach(e=>{e.chapters.forEach(e=>t.set(e.n,e))});let n=[...t.values()].sort((e,t)=>e.n-t.n),r=e[0],i=n.reduce((e,t)=>e+(Number(t.info.words.replace(/[^\d]/g,``))||0),0);return{title:r?.title??`章纲`,story:r?.story??{index:1,name:``,range:``,beats:``},chapters:n,words:r?.words&&r.words>0?r.words:i}}function et(e,t=3){let n=Q(e.story.range),r=e.chapters.reduce((e,t)=>Math.max(e,t.n),0),i=r>0?r:n?n.start-1:0;if(i<=0)return null;let a=n?n.end:i+e.chapters.length,o=i+1;if(o>a)return null;let s=a-o+1,c=Math.max(1,Math.ceil(s/Math.ceil(s/t)));return{from:o,to:Math.min(o+c-1,a)}}function tt(e){return e.chapters.length===0?`（本批是第一批，无已完成内容）`:e.chapters.map(e=>[`第 ${e.n} 章《${e.title||`未命名`}》`,`环节 ${e.stage||`未填`} / 节拍 ${e.beat||`未填`} / 期待 ${e.expect||`未填`}`,`预埋伏笔：${e.seedFores||`无`}`,`回收伏笔：${e.payFores||`无`}`,`下一章须承接：${e.handover.nextStart||`未填`}`,`章尾钩子类型：${e.foreshadow.hookType||`未填`}`].join(`；`)).join(`
`)}function nt(e){let{data:t,batch:n,problems:r}=e,i=JSON.stringify({title:t.title,story:t.story,words:t.words,doneChapters:t.chapters.map(e=>e.n)}),a=r?.length?[``,`## 上一轮校验发现的问题（本批必须修好，共 ${r.length} 项）`,...r.slice(0,12).map(e=>`- ${e}`),r.length>12?`- （另有 ${r.length-12} 项同类问题，按同样方式修好）`:``].join(`
`):``;return[`继续生成章纲的第 ${n.from}–${n.to} 章（只写这一批，不要重复已完成的章节）。`,``,`## 故事骨架（不得改动，story.range / story.beats 必须与卷纲一致）`,"```json",i,"```",``,`## 已完成章节摘要（用于承接：伏笔埋收、章间交接、人物与地点连续性）`,tt(t),``,`## 本批要求`,`1. 只写第 ${n.from} 章到第 ${n.to} 章，每章必须写满 17 节（§1 基础信息 / §2 上章承接 / §3 本章定位 / §4 浓缩剧情 / §5 核心事件链（≥6 条且每条含 what/cause/action/result/use）/ §6 关键词与必要条件（enter/trigger/interact/result 四类齐全）/ §7 四段式 / §8 情绪曲线（4 节点）/ §9 爽点与看点 / §10 关键信息与扩写方式 / §11 画面细节 / §12 伏笔与钩子 / §13 出场角色与状态变化（至少 1 条）/ §14 设定与道具更新 / §15 写作约束 / §16 下一章交接 / §17 写作检查清单）。`,`2. 每章必须带对齐字段：stage（所属环节）/ beat（本章节拍，必须等于骨架 beats 对应位置的字符）/ expect（本章主期待感）/ time / place / seedFores / payFores。`,`3. 第 N 章的 handover.nextStart 必须与第 N+1 章的 carry.hook 呼应；payFores 必须在更早章节的 seedFores 出现过。`,"4. 输出顺序：只写一个 ```json 围栏，顶层字段固定为 chapterOutlineBatch（结构与 chapterOutlineData 相同，chapters 只含本批章节）。**不要写 MD 正文**——17 节内容与 JSON 完全重复，软件会用数据生成 MD。",`5. 本批**不要**输出 outlineSaveRequest（软件会在最后一批之后合并并统一保存），不要输出 HTML，不要用「…」「同上」等省略写法。`,`6. 关键节不得留空：§8 moodCurve 写满 4 个节点；§10 expand 至少 1 条且含 info/how；§11 visual.env 与 visual.memory 必须有内容；§13 castChanges 至少 1 条；§14 worldUpdate 至少一项有内容（确无新增就写「无新增」）。`,`7. §17 checks 必须覆盖 10 条固定项：三行内入戏 / 有明确变化 / 事件链有因果 / 有核心记忆点 / 有动作微细节 / 有爽点 / 回收旧信息 / 埋新信息 / 有追读钩子 / 已写明下一章交接。`,a].filter(Boolean).join(`
`)}function rt(e){let t=new Set;return e.forEach(e=>{for(let n of e.matchAll(/第\s*(\d+)\s*章/g)){let e=Number(n[1]);Number.isFinite(e)&&e>0&&t.add(e)}}),[...t].sort((e,t)=>e-t)}function it(e,t){let n=e.chapters.map(e=>e.n),r=n.length?Math.min(...n):1,i=n.length?Math.max(...n):1,a=e=>String(e).padStart(2,`0`);return{targetFolder:`章纲`,fileName:`章纲-第${a(r)}–${a(i)}章.md`,fileType:`chapter-outline`,writeMode:`create`,referencedSkills:[`ZhanggangSkill/zhanggangjiegouhua`],sourceIntent:`生成${e.story.name?`故事${e.story.index} ${e.story.name}`:`章纲`}的章纲`,content:t,htmlContent:We(e)}}function at(e){let t=new Set,n=String(e??``);for(let e of n.matchAll(/(\d+)\s*[-—–－~～至到]\s*(\d+)/g)){let n=Number(e[1]),r=Number(e[2]);if(!(!Number.isFinite(n)||!Number.isFinite(r)||r<n))for(let e=n;e<=r;e+=1)t.add(e)}for(let e of n.replace(/\d+\s*[-—–－~～至到]\s*\d+/g,` `).matchAll(/\d+/g))t.add(Number(e[0]));return[...t]}function ot(e,t){if(!t||t<=0)return!1;let n=String(e??``).replace(/\s+/g,``),r=t<=10?`(?:${t}|${[`零`,`一`,`二`,`三`,`四`,`五`,`六`,`七`,`八`,`九`,`十`][t]})`:String(t);return RegExp(`故事${r}(?![0-9一二三四五六七八九十])`).test(n)}function st(e,t){let n=String(e??``).replace(/[（(].*?[)）]/g,``).trim();if(n.length<2||!t)return!1;if(t.includes(n))return!0;let r=n.slice(-2);return r.length>=2&&t.includes(r)}var $={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};function ct(e){let t=String(e??``).trim().match(/^第\s*(\d+|[一二三四五六七八九十]+)\s*(?:日|天)/);if(!t)return null;let n=t[1];return/^\d+$/.test(n)?Number(n):n===`十`?10:n.startsWith(`十`)?10+($[n[1]]??0):n.length===2&&n[1]===`十`?($[n[0]]??0)*10:n.length===3&&n[1]===`十`?($[n[0]]??0)*10+($[n[2]]??0):$[n]??null}function lt(e){return String(e??``).split(/[（(：:，,、]/)[0].trim()}function ut(e){return[e.castChanges.map(e=>`${e.who} ${e.role} ${e.inState} ${e.outState}`).join(` `),e.position.main,e.position.advance,e.position.charArc,e.position.relation,e.carry.hook,e.carry.castState,e.digest,e.events.map(e=>`${e.what} ${e.action} ${e.result}`).join(` `)].join(` `)}function dt(e,t){let n=e.story.index,r=e.story.range.trim(),i=t.stories.find(e=>e.id===n)??(r?t.stories.find(e=>e.range.trim()===r):void 0);if(!i)return null;let a=[],o=`故事${i.id}${i.title?` ${i.title}`:``}`;r&&i.range.trim()&&r!==i.range.trim()&&a.push(`章纲骨架的章号区间「${r}」与卷纲「${i.range}」不一致（卷纲：${o}）。`);let s=Array.from(e.story.beats||``),c=Array.from(i.beats||``),l=Math.min(s.length,c.length);if(l>0){let e=Array.from({length:l}).findIndex((e,t)=>s[t]!==c[t]);e>=0&&a.push(`章纲骨架节拍的顺序与卷纲不一致：第 ${e+1} 位是「${s[e]||`空`}」，卷纲是「${c[e]}」。`)}let u=Q(r)??Q(i.range);if(u){let t=e.chapters.filter(e=>e.n<u.start||e.n>u.end).map(e=>e.n);t.length>0&&a.push(`章纲章号 ${t.join(`、`)} 超出卷纲该故事的范围（第 ${u.start}–${u.end} 章）。`)}let d=e.chapters.map(e=>({chapter:e,ordinal:ct(e.time)}));for(let e=1;e<d.length;e+=1){let t=d[e-1],n=d[e];if(t.ordinal!==null&&n.ordinal!==null&&n.ordinal<t.ordinal){a.push(`章节时间线倒退：第 ${n.chapter.n} 章「${n.chapter.time}」早于第 ${t.chapter.n} 章「${t.chapter.time}」。`);break}}let f=e.chapters.map(ut).join(` `),p=(t.cast??[]).filter(e=>at(e.stories).includes(n)).filter(e=>!st(e.n,f)).map(e=>e.n);p.slice(0,3).forEach(e=>{a.push(`卷纲人物出场表写明「${e}」在故事${n}出场，但章纲里找不到该人物。`)}),p.length>3&&a.push(`另有 ${p.length-3} 个卷纲人物在章纲里找不到（人物出场表对齐）。`);let m=(t.rivals??[]).filter(e=>(e.moves??[]).some(e=>e.id===n));if(m.length>0){let t=e.chapters.some(e=>e.castChanges.some(e=>/阻力|对手|反派|敌人|敌方|障碍/.test(`${e.role}${e.who}`))),r=m.some(e=>st(e.n,f));!t&&!r&&a.push(`卷纲在故事${n}安排了对手出手（${m.map(e=>e.n).join(`、`)}），但章纲没有任何阻力/对手角色。`)}let h=e.chapters.flatMap(e=>K(e.seedFores)),g=e.chapters.flatMap(e=>K(e.payFores)),_=(e,t)=>e.some(e=>e.includes(t)||t.includes(e)),v=[],y=[];for(let e of t.foreshadows??[]){let t=lt(e.v);t.length<2||(ot(e.seed,n)&&!_(h,t)&&v.push(`卷纲伏笔「${t}」计划在故事${n}埋下，但章纲 seedFores 里没有。`),ot(e.pay,n)&&!_(g,t)&&y.push(`卷纲伏笔「${t}」计划在故事${n}回收，但章纲 payFores 里没有。`))}return a.push(...v.slice(0,2),...y.slice(0,2)),v.length+y.length>4&&a.push(`另有 ${v.length+y.length-4} 条卷纲伏笔在章纲里没有对应埋收。`),a}export{v as _,Qe as a,oe as b,et as c,je as d,Ge as f,ue as g,pe as h,dt as i,q as l,he as m,it as n,Ye as o,de as p,rt as r,$e as s,nt as t,xe as u,ge as v,ae as y};