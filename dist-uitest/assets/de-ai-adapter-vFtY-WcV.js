import{n as e}from"./rolldown-runtime-hePW80VL.js";import{m as t}from"./fs-BDHmzykM.js";import{r as n,t as r}from"./path-BqSAZZDo.js";var i=`---\r
name: de-AI-writing\r
description: 中文写作、改写、润色、翻译和审阅的去 AI 味技能。用于保留原意和原文风格，减少路标词、讲义腔、模板句式、协作口吻和 AI 痕迹。默认轻量加载，按任务只读取必要参考章节。\r
allowed-tools:\r
  - Read\r
  - Write\r
  - Edit\r
  - AskUserQuestion\r
metadata:\r
  trigger: 去AI味、像人写的、保留原意改写、中文润色、结构保真翻译、检查中文稿 AI 痕迹\r
---\r
\r
# de-AI-writing\r
\r
## 读取策略\r
\r
默认先只读本文件。不要一上来读取完整 \`references/ai-trace-detector.md\`。\r
\r
- 普通改写、润色、续写：只用本文件的核心规则；需要定位具体 AI 痕迹时，先读 \`references/ai-trace-index.md\`，再按索引读取 \`references/ai-trace-detector.md\` 的相关章节。\r
- 翻译：只读 \`references/translation-guardrails.md\`。\r
- 审阅、评分、找问题：先读 \`references/ai-trace-index.md\`，只围绕 Top 5-10 个最影响读感的问题读取详细章节。\r
- 任何任务都禁止把参考文件整篇复制给用户；参考资料只用于判断和修补。\r
\r
## 目标\r
\r
这是一个去 AI 味补丁工具，不规定新文风。原文是现代白话、口语、评论、科普或学术风格，改完仍保持原风格。\r
\r
默认目标很窄：\r
\r
- 保留原意、信息厚度和核心判断。\r
- 不新增事实、案例、数据、结论。\r
- 不删除原文核心论证链。\r
- 只删掉让读者意识到“这是模型在组织答案”的结构痕迹。\r
- 不主动注入半文半白、文言虚词、书卷气、知识分子腔等风格，除非用户明确要求。\r
\r
## 任务分流\r
\r
- 改写/润色/续写：默认保真改写。先处理段落同构、路标词、二分对照、协作口吻和模板句式。\r
- 翻译：结构保真优先。不额外加标题，不补观点，不把原文改成中文评论。\r
- 审阅/评分/找问题：只列 Top 5-10 个最影响读感的问题，并给出修法；不做全量黑名单报告。\r
\r
不确定是否需要全文改写时，先做最小可用修补。只有用户明确要求“自由改写/允许增删重组”时，才重排结构。\r
\r
## 默认交付\r
\r
- 默认只输出最终正文，不输出流程、清单、自检记录或代码块。\r
- 生成、改写、精修任务可以给标题；翻译任务保留原文标题，不另起标题。\r
- 标题不超过 20 字，避免 SEO 腔、悬念标题和工整对仗。\r
- 小标题按内容自然需要使用。短文通常不需要小标题；长文每个小标题下至少覆盖 2 段正文。\r
\r
## 核心硬门槛\r
\r
最终交付前至少检查以下项目：\r
\r
1. 二分对照壳：默认清理 \`不是 A 而是 B\`、\`不在于 A 而在于 B\` 等讲义式纠错结构。逐字引文或原文自然表达最多保留 1 处。\r
2. 冒号：按实际语义使用，不把 \`概念：解释\`、\`问题：答案\`、\`原因：结论\` 当固定模板。\r
3. 二人称：默认不用 \`你/你会\`；确需读者推演时，最多 1 次 \`试想\` 或 \`当你\`。\r
4. 路标词：\`更关键/更要命/换句话说/事实上/值得注意/总之/与此同时\` 全文合计不超过 2 次。\r
5. 协作口吻：清理 \`作为AI\`、\`截至我的知识\`、\`希望这能帮助你\`、\`接下来我们将\`、\`我们先来看\`、\`下面我们\`。\r
6. 讲义动作：删掉 \`拆一拆/盘一盘/捋一捋/聊一聊/划重点/敲黑板\`，以及无必要的 \`说白了/本质上/归根结底/简单来说\`。\r
7. 高频分析词：\`拆解/梳理/剖析/解构/聚焦/洞察/深耕/赋能/助力/践行/驱动/构建/打造\` 不要堆叠。\r
8. 高频句式：\`一旦……就……\`、\`只有……才……\`、\`无论……都……\`、\`随着……的发展/推进\`、\`正是因为……所以……\`、\`通过……来……\` 全文合计不超过 2 次。\r
9. 戏剧化揭露：清理 \`遮羞布/面具/外衣/揭开真面目/戳穿真相\` 这类替读者宣布真相的修辞。\r
10. 段落结构：避免连续 3 段都是“观点句 + 解释 + 段尾总结”。修法是改变信息进入方式，而不是替换段首词。\r
11. 段落厚度：避免每段长度、句数、功能都接近。允许短段、中段、厚段按阅读节奏交替。\r
12. 段尾收束：不要每段都补一句抽象结论。能停在事实、场景、引语、具体后果上，就不要再概括。\r
\r
## 修补顺序\r
\r
1. 先看结构：段落是否等厚、是否每段都在讲一个小论点、是否像提纲扩写。\r
2. 再看语气：是否有模型协作口吻、讲义动作、路标词。\r
3. 再看句式：是否有二分对照、条件句堆叠、定义式判断堆叠。\r
4. 最后看词语：只清理最显眼的 AI 高频词，不做机械同义词替换。\r
\r
如果结构本身坏掉，可以整段重写；如果只是局部异味，只做局部修补。\r
\r
## 参考文件\r
\r
- \`references/ai-trace-index.md\`：轻量索引，先读它。\r
- \`references/ai-trace-detector.md\`：详细 AI 痕迹与修法，只按索引读取相关章节。\r
- \`references/translation-guardrails.md\`：翻译任务规则。\r
`,a=e({buildDeAiRewriteMessages:()=>u,buildDeAiSkillSystemPrompt:()=>c,buildQmQuaiSystemPrompt:()=>s,injectDeAiDirective:()=>f,loadSmartDeAiSkill:()=>g}),o=i.trim();function s(e){return e&&e.trim()?e.trim():o}function c(e){return s(e||void 0)}function l(e,t){if(!e.trim())throw Error(`去AI味内容为空，无法处理`);return[{role:`system`,content:s(t)},{role:`user`,content:`请严格按照 QM-QUAI skill 规则处理下面正文。

输出仅返回改写后的正文，不要解释。

正文如下：

`+e}]}function u(e,t){return l(e,t)}var d=[`请保持剧情一致，并用更自然、更像真人网文作者的方式输出。`,`减少套话、总结腔和机械解释。`,`压缩同义反复和无效热闹，提高信息密度；不要为了有进展而编造剧情。`,`注意中文小说适配：保留角色声线、对白毛边、叙事节奏和必要停顿，不要按非虚构文章规则硬删副词或压缩到固定字数。`,``,`任务内容：`,``].join(`
`);function f(e,t){return t?d+e:e}function p(e,t){if(/翻译|translate|译文|英译中|中译英/.test(e))return`translation`;if(/科普|科学普及|知识分享|科技解读/.test(e))return`popular-science`;if(/评论|书评|影评|观点|散文|随笔/.test(e))return`commentary`;if(t?.outline){let e=t.outline.match(/genre:\s*(\w+)/i);if(e){let t=e[1].toLowerCase();if([`xuanhuan`,`wuxia`,`xianxia`,`dushi`].includes(t))return`web-novel`}}return`web-novel`}function m(e){switch(e){case`commentary`:case`popular-science`:return`skills/good-writing/SKILL.md`;default:return`skills/de-ai-writing/SKILL.md`}}async function h(e){try{let i=await n(),a=await r(i,e);return(await t(a)).trim()||null}catch{return null}}async function g(e,n,i){if(!e)return null;try{let n=await r(e,`de-ai-skill.txt`),i=(await t(n)).trim();if(i)return i}catch{}return await h(m(p(n,i)))||null}export{f as a,a as i,c as n,s as r,u as t};