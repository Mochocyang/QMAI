const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/project-meta-MMji4_D3.js","assets/fs-BDHmzykM.js","assets/rolldown-runtime-hePW80VL.js","assets/react-vendor-12KA6iUw.js","assets/milkdown-vendor-SOXARy2Z.js","assets/katex-vendor-yNnXLKZx.js","assets/platform-Mr9sdFYe.js","assets/core-DwCO7X_4.js","assets/path-utils-DetyJ9DL.js","assets/katex-vendor-DEcVZfaU.css","assets/milkdown-vendor-iU1xDGNM.css"])))=>i.map(i=>d[i]);
import{n as e}from"./rolldown-runtime-hePW80VL.js";import{mr as t}from"./react-vendor-12KA6iUw.js";import{d as n,f as r,g as i,n as a,p as o,s,t as c,u as l}from"./wiki-store-CoU5K6QY.js";import{o as u,r as d,s as ee}from"./visual-style-settings-BKLBYttx.js";import{i as f,n as p}from"./llm-context-size-BWtS5ts7.js";import{_ as m,m as h,o as g,w as _}from"./fs-BDHmzykM.js";import{l as v}from"./path-utils-DetyJ9DL.js";import{t as te}from"./codex-cli-timeout-CG84Lw_6.js";import{r as ne}from"./codex-cli-model-D9Zdv3FK.js";var re=`qm-uitest-skin`,ie=[{id:`jing`,name:`静水`,hint:`浅鼠尾草绿 · 留白开阔`},{id:`zhi`,name:`纸间`,hint:`暖纸底色 · 界面退后`},{id:`xing`,name:`星夜`,hint:`低对比夜间 · 看见故事`}];function ae(){if(typeof localStorage>`u`)return`jing`;let e=localStorage.getItem(re);return e===`zhi`||e===`xing`||e===`jing`?e:`jing`}function oe(e){typeof localStorage>`u`||localStorage.setItem(re,e)}var y={enabled:!1,requestedFirstThree:!1},se=[/生成前三章/,/写前三章/,/黄金三章/],ce=[/第一章/,/第\s*1\s*章/,/开篇章节/,/小说开头/,/(写|生成|创作|撰写|开始)(一?个)?(小说)?(开篇|开局|首章|开头)/],le=[/第二章/,/第\s*2\s*章/],ue=[/第三章/,/第\s*3\s*章/];function de(e,t){let n=e.trim();if(!n)return y;let r=se.some(e=>e.test(n));return typeof t==`number`&&t>0?t===1?{enabled:!0,targetChapter:1,outputMode:`first_chapter_with_directions`,requestedFirstThree:r}:t===2||t===3?{enabled:!0,targetChapter:t,outputMode:`chapter_only`,requestedFirstThree:!1}:y:/下一章|下1章|下章|新的?一章/.test(n.replace(/\s+/g,``))?y:r||ce.some(e=>e.test(n))?{enabled:!0,targetChapter:1,outputMode:`first_chapter_with_directions`,requestedFirstThree:r}:le.some(e=>e.test(n))?{enabled:!0,targetChapter:2,outputMode:`chapter_only`,requestedFirstThree:!1}:ue.some(e=>e.test(n))?{enabled:!0,targetChapter:3,outputMode:`chapter_only`,requestedFirstThree:!1}:y}function fe(e){return!e?.enabled||!e.targetChapter||!e.outputMode?``:[`## 黄金三章写作约束`,...e.outputMode===`first_chapter_with_directions`?[`输出策略：只生成第一章正文，正文结束后给出“第二章写作方向”和“第三章写作方向”。`,`第二章写作方向：强调冲突升级、阻力加重、代价扩大，让主角必须继续行动。`,`第三章写作方向：明确阶段主线，建立长期期待，并让读者知道后续故事追什么、怕什么、盼什么。`]:[`输出策略：只生成第${e.targetChapter}章正文，不输出后续方向、分析、说明或写作建议。`],`硬性边界：`,`- 前 300-500 字内必须进入主体事件、危机、任务、冲突或异常。`,`- 主角必须尽早登场，并用行动推动局面变化。`,`- 穿越、前世、背景、设定只一笔带过，不展开成独立剧情。`,`- 禁止长环境描写、长氛围描写、长心理描写和大段世界观说明。`,`- 每段必须推动故事、冲突、人物关系、行动或期待。`,`- 第一章结尾必须留下可承接第二章的钩子。`].join(`
`)}var pe=`# 中文小说去 AI 味补充规则

## 一、AI味识别清单（必须消除）

### 1. 禁用词汇（Slop Words）
**总结腔**：这一切、显然、事实上、实际上、毫无疑问、无可否认
**解释腔**：其实、说白了、换句话说、简单来说、通俗点讲
**模板句首**：与此同时、紧接着、就在这时、恰在此时、正当此刻
**空洞形容**：复杂、微妙、深刻、独特、特殊、某种程度上
**转折滥用**：然而、但是、不过、可是（每段都用）
**AI特征词**：似乎、仿佛、如同、宛如、犹如（过度使用）

### 2. 机械句式（必须打破）
- 每段都是"起承转合"四段式
- 连续3句以上相同句式结构
- "目光交汇的瞬间"
- "空气仿佛凝固"
- "心中五味杂陈"
- "眼神变得坚定"
- 机械排比：既...又...、不仅...还...（工整过度）

### 3. 叙事缺陷（必须修复）
- 过度解释动机："他这么做是因为..."
- 总结情绪："她感到失望/欣慰/复杂"
- 固定场景模板：环境→人物→对话→内心
- 无意义转场："时间一分一秒过去"
- 概括式冲突："双方陷入僵持"
- 同义反复：同一层恨意、同一套气氛词、同一个动作翻来覆去写
- 无效热闹：气氛循环、重复心理、重复打趣赶路，剧情原地踏步
- 空修饰堆叠：连续空形容词、悬浮大词，没有落到可见动作或后果
- 单手法循环：整章只剩对线、独白或打斗一种形式

## 二、去AI味核心方法

### 方法1：删减原则
**必删内容**：
- Filler短语：可以说、某种意义上、在某种程度上
- 多余情绪总结：用动作和对白代替
- 重复转折词：一段内不超过1个"但是"
- 装饰性副词：缓缓、慢慢、轻轻（除非必要）
- 无效铺垫：删掉不影响理解的句子

### 方法2：具体化
**用具体替代抽象**：
❌ 他很生气 → ✅ 他拍桌而起
❌ 她很难过 → ✅ 她别过脸去
❌ 气氛紧张 → ✅ 没人说话，只有钟摆声
❌ 他很犹豫 → ✅ 他攥紧又松开拳头

### 方法3：断句
**长句拆分**：
❌ 他看着她，眼神复杂，既有愧疚又有无奈，还夹杂着一丝不甘
✅ 他看着她。愧疚，无奈，还有不甘。

### 方法4：破坏工整
- 段落长度不对称
- 句式结构不整齐
- 允许单句成段
- 允许突然转场
- 允许留白和省略

### 方法5：对话真实化
- 人物说半句话，不把话说完整
- 答非所问、顾左右而言他
- 紧张时重复、结巴
- 保留"呃""嗯""那个"
- 不解释潜台词，让读者自己体会

### 方法6：信息密度减法
执行顺序：先删重复层 → 再压空修饰 → 再打散单一手法。这是去AI味补丁，不是重写课：只压缩同义反复和无效热闹，不补新剧情。

**1. 拒绝无效热闹（压缩，不扩写）**
热闹不等于进展。气氛循环、重复心理、重复打趣赶路，是同一层意思的第二遍、第三遍。

判断废句用三问（不是生成新情节的借口）：这句有没有新信息？人物关系变了没？矛盾更尖了，还是被挪走了？

章/段处理后，原文若已有进展（新信息、关系变化、冲突升级、目标接近或风险加深），应仍能指出来。原文若整章停在对峙或赶路，不要补秘密、约架、反转道具；只删第二遍渲染。

❌ 两人再对视一次。空气更凝固。周围人更不敢出声。
✅ 两人对视。她先把旧账摊到桌上。

**2. 具体化，砍空修饰**
- 空泛大词、悬浮形容词落到可见动作、生理反应或场面后果。
- 情绪点到为止：一两处具体反应够了，后半段同义抒情删。
- 同一对象上连续空形容词只留最有信息量的一个。
- 机械排比三连以上：弱的删，只留最有力的一组。
- 空泛比喻：同一喻体不反复。不为限额砍有效意象，不要套单章比喻硬顶。

❌ 他执行力强，杀意凛然，整个人陷入极度复杂的情绪。
✅ 闹钟一响他就坐起来。刀已经出鞘。

**3. 细节三问（留门，不是全删）**
先删替读者贴标签的句子，例如“他此时非常愤怒”。其余细节只要满足其一就留：
1. 让读者对某个角色产生情感偏向（讨厌、心疼、崇拜等）
2. 让人设更立体
3. 让后文反转更站得住

三问都空的才删。设定解释、伏笔、必要因果按保留边界豁免，不拿三问砍。不要为了“过三问”新编原文没有的反差动作。

**4. 手法不要单轨**
同一章若连续大段只剩一种形式（纯对线循环 / 纯独白绕圈 / 纯打斗无信息），把原文已有的动作、对话、环境、心理、旁观反应穿插起来，用上两三种即可。不为“交叉”补原文没有的道具、旁观者或环境镜头。对线循环（同一句指控和否认来回）压成有效交锋，不改双方立场。

## 三、执行流程

### 步骤1：识别文本功能
先判断这段是什么：
- **叙事推进** → 精简直接，删除修饰
- **人物对白** → 口语化，避免书面腔
- **心理描写** → 感官细节代替"他觉得"
- **场景描写** → 选择性描写，不面面俱到
- **动作场面** → 短句、动词、节奏快
- **情绪爆发** → 破坏平衡，允许突兀
- **悬疑铺垫** → 留白，不解释
- **章节收束** → 悬念钩子，不总结

### 步骤2：逐句检查
- 这句删了影响理解吗？→ 不影响就删
- 同义重复了吗？→ 删一个
- 铺垫过度了吗？→ 直接进入正题
- 这句是第二遍气氛、心理或赶路吗？→ 是就删
- 这处细节能过三问之一吗？→ 都不能且不是设定/伏笔，就删

### 步骤3：变化句式
- 禁止连续3句主谓宾
- 主语可省略（中文特性）
- 允许倒装、插入、破折号

### 步骤4：信任读者
- 不解释显而易见的情绪
- 不总结已经发生的事
- 不提醒读者应该有的感受

## 四、保留内容（不可删改）

**必须保留**：
1. 剧情事实、人物关系、时间线
2. 视角人称、角色声线
3. 伏笔、章节钩子
4. 原有对话和关键动作
5. 不增删剧情点，只改写作方式。原文没有进展，就压缩重复，不编进展。

**中文小说适配注意**：
- 保留角色声线、对白毛边、叙事节奏和必要停顿
- 不要按非虚构文章规则硬删副词或压缩到固定字数
- 小说中的"似乎""仿佛""缓缓"等词在特定语境下是风格，不是AI味
- 情感描写可以有一定修饰，不必强制精简到极致

## 五、最终检查

处理完后逐条确认：
1. ✓ 删除了禁用词汇
2. ✓ 打破了工整句式
3. ✓ 情绪用动作/环境表现而非总结
4. ✓ 对话保留口语特征和潜台词
5. ✓ 没有每段转折、每句修饰
6. ✓ 快慢节奏有变化，没有一种形式撑全章
7. ✓ 保留了原有剧情、人物、伏笔
8. ✓ 章节钩子没被删除
9. ✓ 没为了"自然"、"有进展"或"交叉手法"增加新情节
10. ✓ 读起来不像AI，也不刻意反AI
11. ✓ 同一层意思没有反复写；没有靠第二遍气氛、心理或赶路撑字数
12. ✓ 空修饰已压，有效意象还在
13. ✓ 留下的细节能过三问之一，或属于设定/伏笔豁免
14. ✓ 信息密度提高了，有效信息没有被削成提纲

---

**核心理念**：好的去AI味是让文字为故事服务。删掉一切不推进故事、不塑造人物、不制造氛围的东西。`,b=3e3,me=2200,he=3500,x=1e3,S=1e4,C={targetChars:b,minChars:me,draftMaxChars:he};function ge(e){let t=Number.isFinite(e)&&e>0?Math.max(x,Math.min(S,Math.round(e))):b;return t===3e3?C:{targetChars:t,minChars:Math.max(300,Math.round(me/b*t)),draftMaxChars:t+500}}function w(e){return`目标约 ${e.targetChars} 字；低于 ${e.minChars} 字视为正文初稿未完成。`}function T(e,t){return[e,`上下文：`,t].filter(Boolean).join(`
`)}function E(e){return e?.trim()??``}function _e(e,t,n,r,i,a=C,o,s,c){let l=s&&s.trim()?[``,`## 用户确认计划的执行清单`,`以下执行清单是本阶段写作任务书的权威依据。不得重新设计剧情，只能把清单落实到正文。`,``,s.trim()].join(`
`):``,u=!l&&o&&o.trim()?[``,`## 用户已确认的章节计划执行摘要`,`以下计划摘要来自用户确认的完整章节计划，是本阶段写作任务书的权威依据。`,`严格遵循计划中的场景序列、信息流、伏笔动作、边界禁忌与结尾钩子；不得推翻或新增冲突情节，只补执行细节。`,``,o.trim()].join(`
`):``,d=[`硬性要求：`,`1. 只输出任务书，不要写故事片段。`,`2. 任务书必须逐项承接执行清单中的 S 场景、必须执行、禁止违背和章末钩子。`,`3. 不得重新设计剧情，不得合并、跳过或调换 S 场景顺序。`,`4. 后续正文必须按完整章节规划，${w(a)}`].join(`
`),ee=[`硬性要求：`,`1. 只输出任务书，不要写故事片段。`,`2. 以用户确认的计划为骨架逐场景落地：必须完成、禁止违背、角色状态、伏笔推进、结尾钩子都与计划一致。`,`3. 若计划摘要含 S1/S2/S3，任务书必须逐条展开 S1/S2/S3，不得合并、跳过或调换顺序。`,`4. 不新增计划未涵盖的主线推进、伏笔动作或人物变化；计划有缺失时只给最小补全方向。`,`5. 后续正文必须按完整章节规划，${w(a)}`,`6. 任务书必须覆盖场景推进、冲突升级、人物互动、细节描写、章节节奏曲线、爽点/期待点、对话目标和开头/结尾执行要求。`].join(`
`),f=[`硬性要求：`,`1. 只输出任务书，不要写故事片段。`,`2. 必须列出本章必须完成、禁止违背、角色状态、伏笔推进、结尾钩子。`,`3. 如果上下文不足，写明缺失项，并给出最小补全方向。`,`4. 后续正文必须按完整章节规划，${w(a)}`,`5. 任务书必须覆盖场景推进、冲突升级、人物互动、细节描写、章节节奏曲线、爽点/期待点、主要对话目标、开头承接方式和结尾钩子执行方式。`].join(`
`),p=l?d:o&&o.trim()?[ee].join(`
`):f;return[T(e,t),``,E(c),`你是小说写作任务规划助手。`,`请基于上述上下文输出一份写作任务书，供后续创作使用。`,``,p,``,r?`目标章节：第${r}章`:`目标章节：用户请求中的章节`,`用户请求：${n}`,D(i),l||u].filter(Boolean).join(`
`)}function ve(e,t,n,r,i,a,o=C,s){return[T(e,t),``,E(s),`你是专业小说正文写作助手。`,`请严格根据上述上下文和下方写作任务书起草章节正文。`,``,`输出要求：`,`1. 只输出可直接保存到章节库的小说正文。`,`2. ${O()}`,`3. 不要输出分析、任务书、审稿说明、引用来源或后续建议。`,`4. 严格承接上一章结尾，遵守大纲、记忆、人设、伏笔和时间线。`,`5. 结尾必须留下适合下一章继续推进的钩子。`,`6. 字数必须接近完整章节长度：${w(o)}阶段3正文草稿最多 ${o.draftMaxChars} 字，写到完整结尾后立即停止；不能提前收尾，也不能为了补细节新增额外场景。`,`7. 必须写成完整章节，不要只写片段；包含场景铺陈、行动推进、对话交锋、情绪变化、冲突升级和结尾钩子。`,`8. 禁止复读、循环输出、重复同一段落或用相同句式堆字数；写到完整结尾后立即停止。`,`9. 不要写成说明文：不解释设计、不替角色总结动机、不用旁白概括冲突；信息必须通过动作、对话、场景细节、人物反应呈现。`,`10. 开头承接上一章并立刻给当前问题；结尾完成阶段结果，并留下下一章必须解决的动作、信息或危险。`,`11. 对话必须有目标和攻防，通过试探、隐瞒、压迫、诱导或回避推动关系或信息状态变化，禁止无用闲聊。`,``,i?`目标章节：第${i}章`:`目标章节：用户请求中的章节`,`用户请求：${r}`,D(a),``,`写作任务书：`,n].filter(Boolean).join(`
`)}function ye(e,t,n,r,i,a,o,s,c){return[T(e,t),``,E(c),`你是小说正文返修助手。`,`请根据审稿问题返修章节正文。`,``,`硬性要求：`,`1. 只输出返修后的小说正文。`,`2. ${O()}`,`3. 不要输出解释、审稿说明、修改清单或后续建议。`,`4. 优先修复审稿指出的问题，不要无关改写。`,`5. 必须继续遵守写作任务书和上下文。`,`6. 不再强制调整到固定字数区间；只修复审稿指出的阻断问题，并保留当前章节的有效剧情容量。`,`7. 禁止复读、循环输出、重复同一段落或用相同句式堆字数；写到完整结尾后立即停止。`,``,o?`目标章节：第${o}章`:`目标章节：用户请求中的章节`,`用户请求：${a}`,D(s),``,`写作任务书：`,n,``,`审稿问题：`,Se(i),``,`原始初稿：`,r].filter(Boolean).join(`
`)}function be(e,t,n,r,i,a,o,s=C){return[T(e,t),``,`你是小说正文扩写补足助手。`,`当前章节正文明显过短，请在不推翻已有内容的前提下扩写补足为完整章节。`,``,`硬性要求：`,`1. 只输出扩写补足后的完整小说正文。`,`2. ${O()}`,`3. 必须保留并自然融合原有正文的有效内容，不要输出解释、分析或修改说明。`,`4. ${w(s)}`,`5. 扩写时补足场景铺陈、动作细节、对话交锋、心理变化、冲突升级和结尾钩子。`,`6. 必须严格遵守写作任务书、上下文、人物状态、伏笔和时间线，不要新增会推翻设定的剧情。`,`7. 禁止复读、循环输出、重复同一段落或用相同句式堆字数；写到完整结尾后立即停止。`,``,a?`目标章节：第${a}章`:`目标章节：用户请求中的章节`,`用户请求：${i}`,D(o),``,`写作任务书：`,n,``,`当前过短正文：`,r].filter(Boolean).join(`
`)}function xe(e,t,n,r,i,a,o,s){let c=s&&s.trim()?s.trim():pe;return[T(e,t),``,`你是小说正文最终质检与去AI味助手。`,`请对二次审查/返修后的章节做最后一遍简单审查，并进行去AI味处理。`,``,`处理目标：`,`1. 检查是否存在明显复读、循环段落、前后矛盾、突兀跳转、解释腔和机械套话。`,`2. 去掉 AI 味：减少总结腔、模板句、过度解释、相同句式堆叠和空泛形容。`,`3. 保留原有剧情事实、人物关系、时间线、伏笔和章节结尾钩子，不要另起新剧情。`,`4. 只做必要的自然化、顺滑化和轻量修补，不要大幅重写。`,`5. 不再强制压缩到固定字数区间；只做必要的自然化、顺滑化和轻量修补，禁止为了凑字数复读。`,`6. ${O()}`,`7. 只输出最终可保存的小说正文，不要输出审查报告、解释或修改说明。`,``,c,``,a?`目标章节：第${a}章`:`目标章节：用户请求中的章节`,`用户请求：${i}`,D(o),``,`写作任务书：`,n,``,`待最终简单审查与去AI味正文：`,r].filter(Boolean).join(`
`)}function D(e){return fe(e)}function O(){return`正文第一行必须是章节标题，格式为：# 第X章 标题名（标题4-12字，概括本章核心内容）。`}function Se(e){return e.length===0?`未发现问题。`:e.map((e,t)=>[`${t+1}. [${e.severity}] ${e.message}`,e.evidence?`证据：${e.evidence}`:``,e.relatedMemory?`相关记忆：${e.relatedMemory}`:``,e.suggestion?`建议：${e.suggestion}`:``].filter(Boolean).join(`
`)).join(`

`)}var Ce=e({getLastProject:()=>Te,getRecentProjects:()=>we,loadActivePresetId:()=>it,loadAiChatModel:()=>Je,loadAiOutlineModel:()=>Xe,loadAiWorkflowMode:()=>Ze,loadDefaultLlmModel:()=>R,loadEmbeddingConfig:()=>pt,loadLanguage:()=>St,loadLastReadChapter:()=>$,loadLlmConfig:()=>Ke,loadMaxHistoryMessages:()=>en,loadMcpConfig:()=>ut,loadNovelConfig:()=>Lt,loadNovelMode:()=>kt,loadOutlineWorkflowMode:()=>$e,loadProviderConfigs:()=>nt,loadProxyConfig:()=>vt,loadRerankConfig:()=>Vt,loadRevisionFeedbackWindowConfig:()=>Mt,loadSearchApiConfig:()=>st,loadTheme:()=>Wt,loadUiFontFamily:()=>Qt,loadVisualStyle:()=>Kt,removeFromRecentProjects:()=>yt,saveActivePresetId:()=>rt,saveAiChatModel:()=>qe,saveAiOutlineModel:()=>Ye,saveAiWorkflowMode:()=>L,saveDefaultLlmModel:()=>et,saveEmbeddingConfig:()=>ft,saveLanguage:()=>xt,saveLastProject:()=>Ee,saveLastReadChapter:()=>nn,saveLlmConfig:()=>Ge,saveMaxHistoryMessages:()=>$t,saveMcpConfig:()=>lt,saveMultimodalConfig:()=>ht,saveNovelConfig:()=>G,saveOutlineWorkflowMode:()=>Qe,saveOutputLanguage:()=>Tt,saveProviderConfigs:()=>tt,saveProxyConfig:()=>_t,saveRerankConfig:()=>Bt,saveRevisionFeedbackWindowConfig:()=>jt,saveSearchApiConfig:()=>ot,saveTheme:()=>Ut,saveUiFontFamily:()=>Zt,saveUiFontSizeScale:()=>Xt,saveVisualStyle:()=>Gt}),k=`recentProjects__uiTest`,A=`lastProject__uiTest`;async function we(){return await(await _()).get(k)??[]}async function Te(){return await(await _()).get(A)??null}async function Ee(e){await(await _()).set(A,e),await De(e)}async function De(e){let t=await _(),n=[e,...(await t.get(k)??[]).filter(t=>t.path!==e.path)].slice(0,10);await t.set(k,n)}var j=`llmConfig`,Oe={llmConfig:`deepseekWindowMigratedV1.llmConfig`,providerConfigs:`deepseekWindowMigratedV1.providerConfigs`},ke={llmConfig:`codexCliTimeoutMigratedV1.llmConfig`,providerConfigs:`codexCliTimeoutMigratedV1.providerConfigs`},Ae={llmConfig:`codexCliModelMigratedV1.llmConfig`,providerConfigs:`codexCliModelMigratedV1.providerConfigs`},M=1e6,je=`deepseek`,N=`codex-cli`;function Me(e){return typeof e==`string`&&/api\.deepseek\.com/i.test(e)}async function Ne(e){return await(await _()).get(Oe[e])===!0}async function Pe(e){await(await _()).set(Oe[e],!0)}async function Fe(e){return await(await _()).get(ke[e])===!0}async function Ie(e){await(await _()).set(ke[e],!0)}async function Le(e){return await(await _()).get(Ae[e])===!0}async function Re(e){await(await _()).set(Ae[e],!0)}var ze=`aiChatModel`,P=`aiOutlineModel`,Be=`aiWorkflowMode`,Ve=`outlineWorkflowMode`,F=0,He=``,Ue=`defaultLlmModel`,I=`providerConfigs`,We=`activePresetId`;async function Ge(e){await(await _()).set(j,f(e))}async function Ke(){let e=await _(),t=await e.get(j)??null;if(!t)return null;let n=f(t);if(await Ne(`llmConfig`)||(Me(n.customEndpoint)&&n.maxContextSize<M&&(n={...n,maxContextSize:M}),await Pe(`llmConfig`)),!await Fe(`llmConfig`)){if(n.provider===`codex-cli`){let e=te(n.codexCliTimeoutMinutes);e!==n.codexCliTimeoutMinutes&&(n={...n,codexCliTimeoutMinutes:e})}await Ie(`llmConfig`)}if(!await Le(`llmConfig`)){if(n.provider===`codex-cli`){let e=ne(n.model);e!==n.model&&(n={...n,model:e})}await Re(`llmConfig`)}return n!==t&&await e.set(j,n),n}async function qe(e){await(await _()).set(ze,e)}async function Je(){return await(await _()).get(ze)??null}async function Ye(e){let t=++F;He=e;let n=await _();await n.set(P,e);let r=t;for(;r!==F;)r=F,await n.set(P,He)}async function Xe(){return await(await _()).get(P)??null}async function L(e){await(await _()).set(Be,r(e))}async function Ze(){let e=await(await _()).get(Be);return l(e)?e:null}async function Qe(e){await(await _()).set(Ve,o(e))}async function $e(){let e=await(await _()).get(Ve);return n(e)?e:null}async function et(e){let t=await _();await t.set(Ue,e),await t.save()}async function R(){return await(await _()).get(Ue)??null}async function tt(e){await(await _()).set(I,p(e))}async function nt(){let e=await _(),t=await e.get(I)??null;if(!t)return null;let n=p(t);if(!await Ne(`providerConfigs`)){let e=n[je];e&&e.maxContextSize!==void 0&&e.maxContextSize<M&&(n={...n,[je]:{...e,maxContextSize:M}}),await Pe(`providerConfigs`)}if(!await Fe(`providerConfigs`)){let e=n[N];if(e){let t=te(e.codexCliTimeoutMinutes);t!==e.codexCliTimeoutMinutes&&(n={...n,[N]:{...e,codexCliTimeoutMinutes:t}})}await Ie(`providerConfigs`)}if(!await Le(`providerConfigs`)){let e=n[N];if(e){let t=ne(e.model);t!==e.model&&(n={...n,[N]:{...e,model:t}})}await Re(`providerConfigs`)}return n!==t&&await e.set(I,n),n}async function rt(e){await(await _()).set(We,e)}async function it(){return await(await _()).get(We)??null}var at=`searchApiConfig`;async function ot(e){await(await _()).set(at,e)}async function st(){return await(await _()).get(at)??null}var ct=`mcpConfig`;async function lt(e){let t=await _();await t.set(ct,s(e)),await t.save()}async function ut(){let e=await _();return s(await e.get(ct))}var dt=`embeddingConfig`;async function ft(e){await(await _()).set(dt,e)}async function pt(){return await(await _()).get(dt)??null}var mt=`multimodalConfig`;async function ht(e){await(await _()).set(mt,e)}var gt=`proxyConfig`;async function _t(e){let t=await _();await t.set(gt,e),await t.save()}async function vt(){return await(await _()).get(gt)??null}async function yt(e){let t=await _(),n=(await t.get(k)??[]).filter(t=>t.path!==e);await t.set(k,n);let r=await t.get(A);r&&r.path===e&&await t.delete(A)}var bt=`language`;async function xt(e){await(await _()).set(bt,e)}async function St(){return await(await _()).get(bt)??null}var Ct=`outputLanguage`,wt=`projectOutputLanguages`;async function Tt(e,t){let n=await _();if(t){let r=await n.get(wt)??{};await n.set(wt,{...r,[t]:e})}await n.set(Ct,e)}var Et=`novelMode`,Dt=`projectNovelModes`,Ot=`revisionFeedbackWindowConfig`,z=`projectRevisionFeedbackWindowConfigs`;async function kt(e,n){if(n)try{let{loadNovelProjectMeta:e}=await t(async()=>{let{loadNovelProjectMeta:e}=await import(`./project-meta-MMji4_D3.js`);return{loadNovelProjectMeta:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10])),r=await e(n);if(r&&typeof r.novelMode==`boolean`)return r.novelMode}catch{}let r=await _();if(e){let t=await r.get(Dt);return t&&typeof t[e]==`boolean`?t[e]:null}return await r.get(Et)??null}var B={currentChapterIncludeShouldImprove:!0,previousChapterCarryEnabled:!0,lookbackChapterCount:2,lookbackIncludeMustFixOnly:!0},At=`.qmai/revision-feedback-config.json`;function V(e){return`${v(e)}/${At}`}async function jt(e,t,n){let r=await _();if(t){let n=await r.get(z)??{};await r.set(z,{...n,[t]:e})}if(await r.set(Ot,e),n)try{await m(V(n),JSON.stringify(e,null,2))}catch{}}async function Mt(e,t){if(t)try{let e=V(t);if(await g(e)){let t=await h(e);return H(JSON.parse(t))}}catch{}let n=await _(),r=null;if(e){let t=await n.get(z);t&&t[e]&&(r=H(t[e]))}if(r||=H(await n.get(Ot)),r&&t)try{await m(V(t),JSON.stringify(r,null,2))}catch{}return r}function H(e){return{currentChapterIncludeShouldImprove:e?.currentChapterIncludeShouldImprove??B.currentChapterIncludeShouldImprove,previousChapterCarryEnabled:e?.previousChapterCarryEnabled??B.previousChapterCarryEnabled,lookbackChapterCount:Math.max(0,e?.lookbackChapterCount??B.lookbackChapterCount),lookbackIncludeMustFixOnly:e?.lookbackIncludeMustFixOnly??B.lookbackIncludeMustFixOnly}}var Nt=`novelConfig`,U=`projectNovelConfigs`,Pt=`.qmai/novel-config.json`;function W(e){return`${v(e)}/${Pt}`}async function G(e,t,n){let r=X(e);if(!r)return;let i=await _();if(t){let e=await i.get(U)??{};await i.set(U,{...e,[t]:r})}if(await i.set(Nt,r),n)try{await m(W(n),JSON.stringify(r,null,2))}catch{}}function Ft(e){return!!e&&typeof e==`object`&&Object.prototype.hasOwnProperty.call(e,`defaultLlmModel`)}async function It(e,t,n,r=!1){if(r||e.defaultLlmModel.trim())return e;let i=await R();if(!i?.trim())return e;let a={...e,defaultLlmModel:i.trim()};return await G(a,t,n),a}async function Lt(e,t){if(t)try{let n=W(t);if(await g(n)){let r=await h(n),i=JSON.parse(r),a=X(i);return a?It(a,e,t,Ft(i)):null}}catch{}let n=await _(),r=null,i;if(e){let t=await n.get(U);t&&t[e]&&(i=t[e],r=X(t[e]))}if(r||=(i=await n.get(Nt),X(i)),r&&t)try{await m(W(t),JSON.stringify(r,null,2))}catch{}return r?It(r,e,t,Ft(i)):null}var Rt=`rerankConfig`,K=`projectRerankConfigs`,zt=`.qmai/rerank-config.json`;function q(e){return`${v(e)}/${zt}`}async function Bt(e,t,n){let r=await _();if(t){let n=await r.get(K)??{};await r.set(K,{...n,[t]:e})}if(await r.set(Rt,e),n)try{await m(q(n),JSON.stringify(e,null,2))}catch{}}async function Vt(e,t){if(t)try{let e=q(t);if(await g(e)){let t=await h(e);return Z(JSON.parse(t))}}catch{}let n=await _(),r=null;if(e){let t=await n.get(K);t&&t[e]&&(r=Z(t[e]))}if(r||=Z(await n.get(Rt)),r&&t)try{await m(q(t),JSON.stringify(r,null,2))}catch{}return r}var Ht=`theme__uiTest`,J=`visualStyle`,Y=`visualStyleVersion`;async function Ut(e){await(await _()).set(Ht,e)}async function Wt(){return await(await _()).get(Ht)??null}async function Gt(e){let t=await _();await t.set(J,u(e)),await t.set(Y,d),await t.save()}async function Kt(){let e=await _(),t=await e.get(J);if(!t)return null;let n=await e.get(Y),r=u(t),i=ee(t,n);return(t!==i||i!==r||n!==`fangzheng-20260707`)&&(await e.set(J,i),await e.set(Y,d),await e.save()),i}var qt=`uiFontSizeScale`,Jt=`uiFontFamily`,Yt=`maxHistoryMessages`;async function Xt(e,t,n){let r=await _();await r.set(qt,e),await r.save()}async function Zt(e){let t=await _();await t.set(Jt,i(e)),await t.save()}async function Qt(){let e=await(await _()).get(Jt);return e?i(e):null}async function $t(e,t,n){let r=await _();await r.set(Yt,e),await r.save()}async function en(e,t){return await(await _()).get(Yt)??null}function X(e){return e?{contextTokenBudget:0,recentSummaryWindow:Math.max(1,Math.min(30,e.recentSummaryWindow??c.recentSummaryWindow)),searchTopK:Math.max(1,Math.min(20,e.searchTopK??c.searchTopK)),chapterTargetChars:Math.max(x,Math.min(S,e.chapterTargetChars??c.chapterTargetChars)),autoIngestOnSave:e.autoIngestOnSave??c.autoIngestOnSave,autoExtractOnImport:e.autoExtractOnImport??c.autoExtractOnImport,deepPreviousChaptersAnalysis:e.deepPreviousChaptersAnalysis??c.deepPreviousChaptersAnalysis,writingWebSearchEnabled:e.writingWebSearchEnabled??c.writingWebSearchEnabled,reviewReasoningEffort:e.reviewReasoningEffort??c.reviewReasoningEffort,defaultLlmModel:e.defaultLlmModel??c.defaultLlmModel,writingModel:e.writingModel??c.writingModel,reviewModel:e.reviewModel??c.reviewModel,summaryModel:e.summaryModel??c.summaryModel,extractModel:e.extractModel??c.extractModel,deAiModel:e.deAiModel??c.deAiModel,deAiBatchConcurrency:Math.max(1,Math.min(5,Math.floor(e.deAiBatchConcurrency??c.deAiBatchConcurrency))),communitySummaryEnabled:e.communitySummaryEnabled??c.communitySummaryEnabled,communitySummaryInterval:Math.max(1,Math.min(50,e.communitySummaryInterval??c.communitySummaryInterval)),communitySummaryAsync:e.communitySummaryAsync??c.communitySummaryAsync,autoGenerateChapterTitle:e.autoGenerateChapterTitle??c.autoGenerateChapterTitle}:null}function Z(e){return e?{enabled:e.enabled??a.enabled,useMainLlm:e.useMainLlm??a.useMainLlm,provider:e.provider??a.provider,apiKey:e.apiKey??a.apiKey,model:e.model??a.model,ollamaUrl:e.ollamaUrl??a.ollamaUrl,customEndpoint:e.customEndpoint??a.customEndpoint,apiMode:e.apiMode??a.apiMode,maxCandidates:Math.max(3,Math.min(30,e.maxCandidates??a.maxCandidates))}:null}var tn=`lastReadChapter`,Q=`projectLastReadChapters`;async function nn(e,t){let n=await _();if(t){let r=await n.get(Q)??{};await n.set(Q,{...r,[t]:e})}await n.set(tn,e)}async function $(e){let t=await _();if(e){let n=(await t.get(Q))?.[e];if(typeof n==`string`&&n)return n}return await t.get(tn)??null}export{ae as $,et as A,Ut as B,Qt as C,qe as D,yt as E,$t as F,be as G,x as H,G as I,T as J,xe as K,Qe as L,Ee as M,nn as N,Ye as O,Ge as P,ie as Q,Tt as R,Wt as S,Ce as T,_e as U,S as V,ve as W,fe as X,ge as Y,de as Z,nt as _,Xe as a,Mt as b,pt as c,Ke as d,oe as et,en as f,$e as g,kt as h,Je as i,xt as j,L as k,St as l,Lt as m,we as n,Ze as o,ut as p,ye as q,it as r,R as s,Te as t,$ as u,vt as v,Kt as w,st as x,Vt as y,jt as z};