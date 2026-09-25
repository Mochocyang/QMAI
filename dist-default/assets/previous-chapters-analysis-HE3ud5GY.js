const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/llm-client-GTZJkY7i.js","assets/rolldown-runtime-hePW80VL.js","assets/react-vendor-Dspsx2kC.js","assets/milkdown-vendor-SOXARy2Z.js","assets/katex-vendor-yNnXLKZx.js","assets/llm-providers-BxOB-vCA.js","assets/llm-context-size-BWtS5ts7.js","assets/platform-BUZW9IaB.js","assets/core-DwCO7X_4.js","assets/tauri-fetch-ClPCrsyL.js","assets/cursor-cli-proxy-CODjmbTM.js","assets/katex-vendor-DEcVZfaU.css","assets/milkdown-vendor-iU1xDGNM.css"])))=>i.map(i=>d[i]);
import{n as e}from"./rolldown-runtime-hePW80VL.js";import{Cr as t}from"./react-vendor-Dspsx2kC.js";import{n,o as r,x as i,y as a}from"./llm-providers-BxOB-vCA.js";import{m as o}from"./fs-CVLb6Yqq.js";import{t as s}from"./search-Co4_NnZr.js";var c=e({analyzePreviousChapters:()=>p,readPreviousChapterBodies:()=>f}),l=.5,u=800;function d(e,t){let n=e.trim();if(n.length<=t)return n;let r=Math.max(200,t-18),i=Math.ceil(r*.6),a=r-i;return`${n.slice(0,i).trimEnd()}

[中间内容已省略，保留首尾]

${a>0?n.slice(-a).trimStart():``}`}async function f(e,t,n=3,r){if(t<=1)return[];let i=[];for(let a=Math.max(1,t-n);a<t;a++){if(r?.aborted)throw Error(`已停止生成`);try{let t=await s(e,`chapter_number:${a}`);if(t.length>0){let e=await o(t[0].path),n=e.indexOf(`---`,4),r=n>=0?e.slice(n+3).trim():e;r&&i.push({number:a,content:r})}}catch{}}return i}async function p(e,o,s,c=3,p){let h=await f(e,o,c,p);if(h.length===0)return``;let{maxCtx:g}=a(s.maxContextSize),_=Math.floor(g*l),v=Math.max(u,Math.floor(_/h.length)),y=m(h.map(e=>({number:e.number,content:d(e.content,v)})),o),{streamChat:b}=await t(async()=>{let{streamChat:e}=await import(`./llm-client-GTZJkY7i.js`).then(e=>e.i);return{streamChat:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12])),x=i({maxContextSize:s.maxContextSize,stage:`analysis`,maxOutputTokens:n(s),thinkingFloorTokens:r(s.reasoning??{mode:`auto`})}),S=``;if(await b(s,[{role:`user`,content:y}],{onToken:e=>{S+=e},onDone:()=>{},onError:()=>{}},p,{max_tokens:x.outputTokens}),p?.aborted)throw Error(`已停止生成`);return S.trim()}function m(e,t){let n=e.map(e=>`## 第${e.number}章完整正文\n\n${e.content}`).join(`

---

`);return`你是小说前情分析专家。请仔细阅读并分析以下章节的完整正文，为第${t}章的写作提供准确的前情上下文。

**分析要求**：
1. **逐章摘要**：用2-3句话总结每一章的核心剧情和关键事件
2. **关键节点提取**：列出重要的剧情转折、冲突、决策和伏笔
3. **最近一章详细分析**（第${t-1}章）：
   - 章节结尾：最后发生了什么？人物在做什么？场景在哪里？
   - 人物状态：每个出场人物的当前状态、情绪、处境
   - 剧情推进：本章推进了什么主线/支线？
   - 未解伏笔：有哪些伏笔被提及但未回收？
4. **连贯性要点**：第${t}章开头必须衔接什么？

**注意**：
- 必须基于实际正文内容，不要脑补
- 保留细节（人物对话、动作、场景描述）
- 关注逻辑链条：因果关系、时间顺序、空间位置

---

${n}

---

请按照上述4点要求输出分析结果。`}export{f as n,c as t};