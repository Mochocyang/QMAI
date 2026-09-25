const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/character-aura-C5NNuaAi.js","assets/rolldown-runtime-hePW80VL.js","assets/react-vendor-Dspsx2kC.js","assets/milkdown-vendor-SOXARy2Z.js","assets/katex-vendor-yNnXLKZx.js","assets/wiki-store-CHXUlDsN.js","assets/source-watch-config-CHv6VGFk.js","assets/visual-style-settings-BKLBYttx.js","assets/llm-context-size-BWtS5ts7.js","assets/platform-BUZW9IaB.js","assets/fs-CVLb6Yqq.js","assets/core-DwCO7X_4.js","assets/path-utils-DetyJ9DL.js","assets/llm-client-GTZJkY7i.js","assets/llm-providers-BxOB-vCA.js","assets/tauri-fetch-ClPCrsyL.js","assets/cursor-cli-proxy-CODjmbTM.js","assets/search-Co4_NnZr.js","assets/frontmatter-DhEpdY1e.js","assets/model-resolver-CMKFF2mW.js","assets/codex-cli-timeout-CG84Lw_6.js","assets/codex-cli-model-D9Zdv3FK.js","assets/codex-cli-speed-Cen1ZKV1.js","assets/web-search-FhV_LOdB.js","assets/pinyin-vendor-CoF0LJwL.js","assets/opencc-vendor-CZJW-_mM.js","assets/katex-vendor-DEcVZfaU.css","assets/milkdown-vendor-iU1xDGNM.css"])))=>i.map(i=>d[i]);
import{Cr as e}from"./react-vendor-Dspsx2kC.js";import{T as t}from"./llm-providers-BxOB-vCA.js";import{i as n}from"./wiki-store-CHXUlDsN.js";import{a as r}from"./llm-client-GTZJkY7i.js";import{n as i,r as a}from"./output-language-C8TR2RU0.js";import{a as o,f as s}from"./model-resolver-CMKFF2mW.js";import{t as c}from"./chapter-excerpts-CE0iQYNA.js";import{n as l,t as u}from"./context-engine-BkcboKNX.js";var d=`已停止生成`;function f(e){if(e?.aborted)throw Error(d)}function p(e,t){return t?.aborted?!0:e instanceof Error?e.message===`已停止生成`||e.name===`AbortError`||/request cancelled|request canceled|aborted/i.test(e.message):!1}function m(e,t){if(p(e,t))throw Error(d)}var h=[`是否人设崩坏`,`是否人物动机不一致`,`是否角色脱离记忆库设定`,`是否提前泄露秘密`,`是否角色知道了不该知道的信息`],g=[`是否违背总大纲`,`是否违背分卷大纲`,`是否违背章节目标`,`本章必须完成项是否已完成`,`本章避免违背项是否存在违背`,`下一章推进建议是否被忽略或反向推进`,`是否人设崩坏`,`是否人物动机不一致`,`是否角色脱离记忆库设定`,`是否时间线错误`,`是否地点错误`,`是否能力体系崩坏`,`是否伏笔遗忘`,`是否提前泄露秘密`,`是否角色知道了不该知道的信息`,`是否新增未登记设定`,`是否剧情水文`,`是否缺少章节钩子`],_=`是否偏离用户已确认的章节计划（场景序列、信息流、伏笔动作、结尾钩子）`,v=[`阶段1：审查任务识别`,`阶段2：上下文检索`,`阶段3：章节目标对齐`,`阶段4：事实与记忆核对`,`阶段5：逐维度审查`,`阶段6：阻断判定`,`阶段7：二次复核`],y=c,b=3,x=3e5,S=`审稿模型输出超时`;function C(e){if(e.length<=y)return[e];let t=[];for(let n=0;n<e.length&&t.length<b;n+=y)t.push(e.slice(n,n+y));let n=b*y;return t.length===b&&e.length>n&&(t[2]+=e.slice(n)),t}function w(e,n,r=!1,i,a){let o=r?h:g,s=!r&&i&&i.trim()?[...o,_]:o,u=r?`角色一致性专项审查`:`阶段式深度审查工作流`,d=r?[`阶段1：角色提取`,`阶段2：记忆库对照`,`阶段3：脱离判定`,`阶段4：二次复核`]:v,f=i&&i.trim()?[``,`用户已确认的章节计划（偏离即 error）：`,`正文必须遵循以下计划中的场景序列、信息流设计、伏笔动作和结尾钩子。`,`若正文在计划覆盖的维度上出现偏离（场景被跳过/互换、信息泄露与计划信息差矛盾、`,`伏笔动作未执行或执行方向相反、结尾钩子与计划设计不一致），必须标为 error，`,`evidence 引用正文偏离片段，relatedMemory 引用计划原文。`,``,i.trim()].join(`
`):``;return`${l(e,void 0,{maxContextSize:a})}

${u}：
${d.map(e=>`- ${e}：必须使用高级 thinking，先分析证据，再给结论。`).join(`
`)}

${r?`角色一致性专项审查要求：`:`阶段要求：`}
${r?[`1. 角色提取：从本章正文中提取所有出现的角色名（含别名、昵称），列出角色清单。`,`2. 记忆库对照：逐个角色对照上下文中的角色光环/灵魂、人物状态、角色认知状态字段，标注命中状态。`,`3. 脱离判定：角色行为若违背光环设定、人物状态、认知状态、大纲人物小传，视为脱离记忆库，按严重程度标为 error 或 warning。`,`4. 二次复核：删除没有正文证据或没有记忆/大纲依据的主观评价，补上遗漏的阻断问题。`].join(`
`):[`1. 审查任务识别：确认目标章节、章纲节点、正文范围、是否缺少必要上下文。`,`2. 上下文检索：结合大纲、节点、上一章结尾、下一章建议、记忆库、人物信息、伏笔、时间线、角色认知状态。`,`3. 章节目标对齐：判断正文是否完成本章必须推进项，是否偏离章纲或反向推进。`,`4. 事实与记忆核对：逐项对照已登记设定、人物认知、伏笔状态、历史事件和相关检索结果。`,`5. 逐维度审查：每个维度都必须有 pass 或 issue，不要只检查明显错误。`,`6. 阻断判定：把会影响正式章节保存、后续生成、主线事实或人物一致性的问题标为 error。`,`7. 二次复核：删除没有正文证据或没有记忆/大纲依据的主观评价，补上遗漏的阻断问题。`].join(`
`)}

${t.t(`novel.reviewPrompt.reviewChapterInstruction`)}
${s.map((e,n)=>`${n+1}. ${t.t(e)}`).join(`
`)}

${r?``:`${t.t(`novel.reviewPrompt.specialChecksTitle`)}
- ${t.t(`novel.reviewPrompt.specialChecks.mustDo`)}
- ${t.t(`novel.reviewPrompt.specialChecks.mustAvoid`)}
- ${t.t(`novel.reviewPrompt.specialChecks.nextChapterAdvice`)}

`}

角色命中记忆库检查（必须执行）：
${f}

1. 角色提取：先从本章正文中提取所有出现的角色名（含别名、昵称），列出角色清单。
2. 记忆库对照：逐个角色对照上下文中的"角色光环/灵魂"、"人物状态"、"角色认知状态"字段：
   - 标注该角色是否命中记忆库（已注入光环 / 仅有状态 / 完全缺失）。
   - 若角色已命中记忆库，检查正文行为是否符合光环设定（说话方式、心智模型、决策启发式、价值观反模式、诚实边界）。
   - 若角色未命中记忆库但在大纲/人物小传中存在，标注"未命中但应命中"。
3. 脱离判定：角色行为若违背光环设定、人物状态、认知状态（知道/不知道什么）、大纲人物小传，视为"脱离记忆库"，按严重程度标为 error 或 warning。
4. 输出要求：在审查 JSON 中，角色相关问题 type 使用 "character_consistency"，relatedMemory 必须引用对应的光环/状态/认知/大纲原文。

${t.t(`novel.reviewPrompt.chapterContent`)}
${n.slice(0,c)}

${t.t(`novel.reviewPrompt.outputFormat`)}
[
  {
    "severity": "error|warning|info",
    "type": "character_consistency|timeline|foreshadowing|setting|plot|style",
    "message": "问题描述",
    "evidence": "正文片段",
    "relatedMemory": "相关记忆引用",
    "suggestion": "修改建议"
  }
]

${t.t(`novel.reviewPrompt.emptyArrayFallback`)}`}async function T(t,r,c,l={},d){if(d?.aborted)throw Error(`已停止生成`);let f=n.getState(),p=o(f.llmConfig,f.novelConfig,`review`);if(!s(p,f.providerConfigs)){if(l.throwOnFailure)throw Error(`未配置可用的审稿模型`);return[]}if(!f.novelMode){if(l.throwOnFailure)throw Error(`当前项目未启用小说模式`);return[]}let h=l.contextPack??await u(t,`审稿第${c||`?`}章`,c),g=h;try{let{buildCharacterAuraContext:n}=await e(async()=>{let{buildCharacterAuraContext:e}=await import(`./character-aura-C5NNuaAi.js`).then(e=>e.a);return{buildCharacterAuraContext:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27])),i=await n(t,h.task,{matchingText:[h.chapterGoal,h.outline,h.characterStates,h.cognitionStates,r].filter(Boolean).join(`

`)});i&&i!==h.characterAuras&&(g={...h,characterAuras:i})}catch(e){console.error(`[Novel Review] 重新匹配角色光环失败，沿用阶段1的光环:`,e)}if(d?.aborted)throw Error(`已停止生成`);let _=a(),v=i(_),y=n.getState().novelConfig.reviewReasoningEffort??`high`,b=`你是一个专业的小说审稿编辑。你的任务是检查章节内容是否存在连贯性问题。
请在一次回复里先完成分阶段审查分析，再在最后只输出最终审查 JSON 数组，JSON 之外不要有多余内容。
${v}`,x=C(r),S=new Map,T=new AbortController,k=d?O(d,T.signal):T.signal;try{return(await Promise.all(x.map(async(e,t)=>{try{if(k.aborted)throw Error(`已停止生成`);let n=x.length>1?`【第${t+1}段/共${x.length}段】\n${e}`:e,r=w(g,n,l.characterOnly,l.planBlueprint,p.maxContextSize),i=x.length>1?l.characterOnly?`角色一致性审查（第${t+1}/${x.length}段）`:`深度审查（第${t+1}/${x.length}段）`:l.characterOnly?`角色一致性审查`:`深度审查`,a=await D(p,b,[r,``,`请在同一次回复中依次完成阶段1-7和上方全部审查维度：`,`- 先逐阶段、逐维度列出已核对依据与结论（每个维度给出 pass 或 issue）。`,`- 再做阶段7二次复核：删除没有正文证据或没有上下文 / 记忆 / 大纲依据的主观评价，补上遗漏的阻断问题。`,``,`最终审查 JSON：`,`在完成上述全部分析之后，最后只输出最终 JSON 数组，不要输出解释、标题或 markdown。`].join(`
`),i,l,S,k,y),o=E(a);if(!o){if(console.warn(`[Novel Review] No JSON array found in chunk ${t+1}:`,a.slice(0,500)),l.throwOnFailure)throw Error(`第 ${t+1} 段审稿未返回结构化 JSON 结果`);return[]}let s=JSON.parse(o);if(!Array.isArray(s)){if(console.warn(`[Novel Review] Parsed result is not an array in chunk ${t+1}:`,s),l.throwOnFailure)throw Error(`第 ${t+1} 段审稿结果不是 JSON 数组`);return[]}return s.map(e=>({severity:j(e.severity),type:String(e.type||`unknown`),message:String(e.message||``),evidence:String(e.evidence||``),relatedMemory:String(e.relatedMemory||``),suggestion:String(e.suggestion||``)}))}catch(e){throw T.abort(),e}}))).flat()}catch(e){if(m(e,d),console.error(`[Novel Review] Failed:`,e),l.throwOnFailure)throw e instanceof Error?e:Error(String(e));return[]}}function E(e){let t=e.lastIndexOf(`]`);if(t===-1)return null;let n=0;for(let r=t;r>=0;--r){let i=e[r];if(i===`]`)n+=1;else if(i===`[`&&(--n,n===0))return e.slice(r,t+1)}let r=e.match(/\[[\s\S]*\]/);return r?r[0]:null}async function D(e,t,n,i,a,o,s,c=`high`,l=0){k(o,a,i,`正在分析...`);let u=[{role:`system`,content:t},{role:`user`,content:n}],d=``,f=``,p=()=>{s?.aborted||k(o,a,i,(f?`${f}${d?`\n\n${d}`:``}`:d)||`正在分析...`)},m={onToken:e=>{s?.aborted||(d+=e,p())},onReasoningToken:e=>{s?.aborted||(f+=e,p())},onDone:()=>{},onError:e=>{console.error(`[Novel Review] Stream error:`,e)},onRequestTrace:a.onRequestTrace},h=!1,g=new AbortController,_=setTimeout(()=>{h=!0,g.abort()},x),v=s?O(s,g.signal):g.signal;try{await r(e,u,m,v,{reasoning:{mode:c}}),clearTimeout(_)}catch(r){if(clearTimeout(_),s?.aborted)throw Error(`已停止生成`);if(h)throw Error(S);if(l<2)return console.warn(`[Novel Review] Stage "${i}" failed, retrying (${l+1}/2)...`),k(o,a,i,`网络波动，正在重试...`),await new Promise(e=>setTimeout(e,2e3)),D(e,t,n,i,a,o,s,c,l+1);throw r}if(s?.aborted)throw Error(`已停止生成`);if(h)throw Error(S);return d.trim()}function O(e,t){let n=new AbortController,r=()=>n.abort();for(let i of[e,t]){if(i.aborted)return n.abort(),n.signal;i.addEventListener(`abort`,r,{once:!0})}return n.signal}function k(e,t,n,r){e.set(n,A(n,r)),t.onThinking?.(Array.from(e.values()).join(`

`))}function A(e,t){return`## ${e}\n${t.trim()}`}function j(e){return e===`error`||e===`warning`||e===`info`?e:`warning`}export{f as i,d as n,m as r,T as t};