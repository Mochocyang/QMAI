import{d as e,m as t,v as n}from"./fs-E_T3zoiZ.js";import{t as r}from"./path-BqSAZZDo.js";import{S as i}from"./de-ai-skill-library-BycCUBGZ.js";import{s as a}from"./skill-route-registry-DrTgrRMN.js";var o=`﻿---\r
name: outline-final-assembler\r
description: Use when all major novel outline components exist and need to be merged into a complete usable outline, or when checking whether the outline is ready for the opening three chapters. Trigger on 合并大纲, 完整大纲, 黄金三章, 开篇检查, outline assembly. Do not use before plot, hook, goals, character, cast, and worldbuilding are present.\r
---\r
\r
# Webnovel Outline Assembler\r
\r
## Core Principle\r
\r
The outline is complete when it can support the opening three chapters and the next major arcs. Do not keep expanding settings just because the document feels unfinished.\r
\r
## Inputs Required\r
\r
- Plot seed\r
- Selling point\r
- Goal ladder\r
- Protagonist design\r
- Supporting cast\r
- Worldbuilding\r
\r
If one input is missing, ask for it or synthesize a clearly marked draft before assembly.\r
\r
## Execution\r
\r
1. **Merge without contradiction**\r
   - Remove duplicate names, incompatible motivations, and unsupported settings.\r
\r
2. **Produce a readable complete outline**\r
   - Make it useful for writing, not just for storage.\r
\r
3. **Check golden-three-chapter readiness**\r
   - Chapter 1 must show protagonist, problem, hook, and immediate tension.\r
   - Chapter 2 must escalate the contradiction or reveal the power/constraint.\r
   - Chapter 3 must deliver an early payoff and open the next question.\r
\r
4. **List remaining decisions**\r
   - Only include decisions that block writing.\r
\r
## Output Format\r
\r
\`\`\`markdown\r
# 小说大纲\r
\r
## 作品暂名\r
\r
## 类型和读者预期\r
\r
## 一句话钩子\r
\r
## 剧情骨架\r
\r
## 核心卖点\r
\r
## 阶段目标\r
\r
## 主角人设\r
\r
## 关键配角\r
\r
## 世界观设定\r
\r
## 黄金三章设计\r
\r
## 待确认问题\r
\`\`\`\r
\r
## Boundary\r
\r
- Do not write the full novel unless asked.\r
- Do not turn the outline into a rigid chapter-by-chapter plan unless the user requests chapter planning.\r
- Do not hide contradictions; call them out and propose fixes.\r
\r
## Source Trace\r
\r
From \`大纲如何写.mp3\`: “做完以上的步骤后，你们就可以开始写黄金三章了。”\r
\r
`,s=`﻿---\r
name: outline-master-builder\r
description: Use when the user wants to write genre fiction, serial fiction, or a novel outline and needs AI to guide them from a rough idea to a usable complete outline. Also use when the user says 大纲, 小说大纲, 网文大纲, 开书, 设定太乱, 不知道怎么写大纲. Do not use for pure summary, literary critique, or editing finished prose.\r
---\r
\r
# Novel Outline Builder\r
\r
## Core Principle\r
\r
Guide the user through a low-burden outline workflow. Do not dump a large template. Build the outline in order: plot seed, selling point, goal ladder, character fit, supporting cast, worldbuilding, final assembly.\r
\r
## Required Sub-Skills\r
\r
Use these skills in order:\r
\r
1. \`story-plot-seed\`\r
2. \`story-selling-point\`\r
3. \`story-goal-ladder\`\r
4. \`protagonist-plot-fit\`\r
5. \`outline-supporting-cast\`\r
6. \`worldbuilding-outline-last\`\r
7. \`outline-final-assembler\`\r
\r
If the environment cannot load sub-skills automatically, follow their documented steps manually in the same order.\r
\r
## Workflow\r
\r
1. **Collect the minimum premise**\r
   - Ask for genre, protagonist seed, desired tone, and any must-have idea.\r
   - If the user has no idea, offer 3 concise premise options and let them choose.\r
\r
2. **Run each step once**\r
   - Keep intermediate outputs visible.\r
   - Do not skip to worldbuilding.\r
   - Do not create chapter-by-chapter detail until the outline is assembled.\r
\r
3. **Merge only after all components exist**\r
   - The final output must include: title placeholder, one-sentence hook, 500-word plot skeleton, selling point, staged goals, protagonist, supporting cast, worldbuilding rules, and golden-three-chapter readiness.\r
\r
## Output Contract\r
\r
Produce a complete outline in Chinese unless the user asks otherwise:\r
\r
- 作品暂名\r
- 类型和读者预期\r
- 一句话钩子\r
- 剧情骨架\r
- 核心卖点\r
- 阶段目标\r
- 主角人设\r
- 关键配角\r
- 世界观设定\r
- 黄金三章开篇检查\r
- 仍需作者确认的问题\r
\r
## Guardrails\r
\r
- Do not turn the request into a generic writing lecture.\r
- Do not make the user fill a huge form.\r
- Do not start with world history, power levels, maps, or long lore.\r
- Do not invent extra complexity if the user only needs a practical first outline.\r
\r
## Source Trace\r
\r
From \`大纲如何写.mp3\`: “剧情，加卖点，加人设，加目标，加世界观，每一步只需要几百字” and “做完以上的步骤后，你们就可以开始写黄金三章了。”\r
\r
`,c=`﻿---\r
name: outline-supporting-cast\r
description: Use when a novel outline needs supporting characters that serve the protagonist and mainline, including mentor, love interest, benefactor, loyal subordinate, rival, antagonist, or partner. Trigger on 配角, 角色关系, 师傅, 女主, 贵人, 下属, 反派, supporting cast. Do not use before protagonist design exists.\r
---\r
\r
# Webnovel Supporting Cast\r
\r
## Core Principle\r
\r
Supporting characters are not decoration. They should fill the protagonist’s missing resources, expose weaknesses, create pressure, or amplify the selling point.\r
\r
## Execution\r
\r
1. **List protagonist gaps**\r
   - Skill gap, emotional gap, resource gap, moral pressure, social access, antagonist pressure.\r
\r
2. **Assign only necessary roles**\r
   - Mentor: teaches or opens a door.\r
   - Love interest: creates emotional stakes or contrast.\r
   - Benefactor: provides rare access or protection.\r
   - Loyal subordinate: executes and reflects protagonist growth.\r
   - Rival: mirrors or challenges the protagonist path.\r
   - Antagonist: blocks the current stage goal.\r
   - Partner: enables a repeated selling-point scene.\r
\r
3. **Tie each role to a function**\r
   - Delete or merge roles with no function.\r
\r
## Output Format\r
\r
\`\`\`markdown\r
## 关键配角\r
\r
| 角色类型 | 暂名 | 服务的主角缺口 | 与主线关系 | 首次登场作用 |\r
|---|---|---|---|---|\r
\`\`\`\r
\r
## Source Trace\r
\r
From \`大纲如何写.mp3\`: “配角角色一定要服务于主角，主角缺什么就来什么。”\r
\r
`,l=`﻿---\r
name: protagonist-plot-fit\r
description: Use when a novel protagonist or main character needs to be designed from the plot, hook, and power system rather than from generic traits. Trigger on 主角人设, 角色设定, 人设服务剧情, 主角性格, character fit. Do not use for full cast planning; use supporting-cast for配角.\r
---\r
\r
# Webnovel Character Fit\r
\r
## Core Principle\r
\r
Character design must serve the plot engine and selling point. Start from what the story requires the protagonist to do repeatedly, then infer personality, weakness, strategy, and growth.\r
\r
## Execution\r
\r
1. **Read the plot and hook**\r
   - Ask: what behavior will this story reward?\r
\r
2. **Infer the protagonist engine**\r
   - If the hook rewards indirect control, the protagonist may be cautious, clever, shameless, or strategic.\r
   - If the hook rewards confrontation, they may be decisive, hot-blooded, or stubborn.\r
\r
3. **Add contradiction**\r
   - Give the protagonist a useful trait and a flaw created by the same trait.\r
\r
4. **Define repeated behavior**\r
   - Describe what the protagonist does again and again that makes the book recognizable.\r
\r
## Output Format\r
\r
\`\`\`markdown\r
## 主角人设\r
\r
### 核心定位\r
\r
### 性格发动机\r
\r
### 优势和缺陷\r
\r
### 与卖点的关系\r
\r
### 成长方向\r
\`\`\`\r
\r
## Source Trace\r
\r
From \`大纲如何写.mp3\`: “人设要服务于剧情...既然都用灵虫作战了，是不是就可以不那么热血？”\r
\r
`,ee=`﻿---\r
name: story-goal-ladder\r
description: Use when a novel outline needs staged goals, mainline progression, arc milestones, long-form serial structure, or a way to keep the protagonist moving. Trigger on 阶段目标, 主线推进, 十万字目标, 篇章目标, 长篇结构, goal ladder. Do not use for isolated scene polishing.\r
---\r
\r
# Webnovel Goal Ladder\r
\r
## Core Principle\r
\r
Use staged goals to make the mainline visible. A long webnovel should not be a pile of events; each stage should give the protagonist a concrete target, obstacle, payoff, and escalation.\r
\r
## Execution\r
\r
1. **Choose the scale**\r
   - Default to every 100k words for long webnovels.\r
   - For shorter works, use acts or arcs instead.\r
\r
2. **Build escalating goals**\r
   - Each goal must be bigger than the previous one.\r
   - Each goal must force action, not just describe growth.\r
\r
3. **Attach blockers and stakes**\r
   - For each stage, add the main antagonist pressure, resource shortage, or deadline.\r
\r
4. **Check continuity**\r
   - If a later goal does not depend on earlier wins, revise.\r
\r
## Output Format\r
\r
\`\`\`markdown\r
## 阶段目标\r
\r
| 阶段 | 篇幅/章节 | 主角目标 | 主要阻力 | 阶段爽点 | 进入下一阶段的钩子 |\r
|---|---|---|---|---|---|\r
\`\`\`\r
\r
## Source Trace\r
\r
From \`大纲如何写.mp3\`: “每十万字设置一个大目标...征服所在的宗门...征服帝国...征服整片大陆。”\r
\r
`,te=`﻿---\r
name: story-plot-seed\r
description: Use when the user has a novel or webnovel idea but lacks a clear plot skeleton, story premise, or 500-word outline seed. Trigger on 剧情骨架, 故事梗概, 小说创意, 不知道主线, 开头想法, premise. Do not use for detailed chapter outlines or worldbuilding-first requests.\r
---\r
\r
# Webnovel Plot Seed\r
\r
## Core Principle\r
\r
Turn a vague idea into a compact plot skeleton before any detailed settings. The plot seed must answer: who the protagonist is, where they start, what changes, what they pursue, what blocks them, and what final direction the story promises.\r
\r
## Inputs\r
\r
Ask only for missing essentials:\r
\r
- 类型：玄幻、都市、言情、悬疑、科幻、历史等。\r
- 主角：身份、处境、缺口。\r
- 触发事件：意外获得什么、失去什么、被迫面对什么。\r
- 终局方向：登顶、复仇、破案、创业、守护、逃离等。\r
\r
## Execution\r
\r
1. **Extract the story engine**\r
   - Identify protagonist, starting weakness, opportunity, conflict, and long-term direction.\r
\r
2. **Write the 500-word plot skeleton**\r
   - Keep it broad enough to expand.\r
   - Include the main contradiction and the promise of escalation.\r
\r
3. **Check completeness**\r
   - If no protagonist action exists, revise.\r
   - If it reads like only a setting, revise.\r
\r
## Output Format\r
\r
\`\`\`markdown\r
## 剧情骨架\r
\r
### 一句话梗概\r
\r
### 500 字剧情骨架\r
\r
### 主线驱动力\r
\r
### 当前缺口\r
\`\`\`\r
\r
## Common Mistakes\r
\r
- Writing world history instead of plot.\r
- Giving only mood and aesthetics.\r
- Creating too many factions before the protagonist has a goal.\r
\r
## Source Trace\r
\r
From \`大纲如何写.mp3\`: “第一步是剧情...主角是修仙世界的普通人，意外获得系统，开启人生外挂，登顶修仙顶峰。”\r
\r
`,ne=`﻿---\r
name: story-selling-point\r
description: Use when a novel idea has a basic plot but lacks a clear hook, differentiator, commercial selling point, or answer to 为什么读者要看这本. Trigger on 卖点, 爽点, 亮点, 差异化, 凭什么看, hook. Do not use before there is at least a rough plot seed.\r
---\r
\r
# Webnovel Selling Point\r
\r
## Core Principle\r
\r
The selling point answers: “同题材这么多，读者凭什么看这一本？” It must grow from the plot, not be pasted on as a random gimmick.\r
\r
## Execution\r
\r
1. **Name the category baseline**\r
   - State what readers normally expect from this genre.\r
\r
2. **Find the twist**\r
   - Change the power source, method, relationship, constraint, or perspective.\r
   - Example pattern: not “打怪升级”, but “养灵虫代替主角作战”.\r
\r
3. **Turn it into repeatable scenes**\r
   - A selling point is usable only if it can generate many scenes.\r
\r
4. **Reject weak hooks**\r
   - If the hook can be said about any novel, revise.\r
\r
## Output Format\r
\r
\`\`\`markdown\r
## 核心卖点\r
\r
### 同类作品默认写法\r
\r
### 本书差异化钩子\r
\r
### 可反复出现的爽点场景\r
\r
### 一句话卖点\r
\`\`\`\r
\r
## Boundary\r
\r
- Do not force novelty that breaks the user’s chosen genre promise.\r
- Do not add five hooks. Pick one main hook and 1-2 supporting hooks.\r
\r
## Source Trace\r
\r
From \`大纲如何写.mp3\`: “别人都写修仙，凭啥看你的呢？” and “你的小说有什么东西值得拿出来卖呢？”\r
\r
`,re=`﻿---\r
name: worldbuilding-outline-last\r
description: Use when a novel outline needs worldbuilding after plot, hook, goals, and characters are known, or when the user is overbuilding lore before the story works. Trigger on 世界观, 设定太多, 境界, 等级, 宗门, 背景故事, worldbuilding. Do not use to create lore before the story premise exists.\r
---\r
\r
# Webnovel Worldbuilding Last\r
\r
## Core Principle\r
\r
Worldbuilding comes last. Add only settings that support the plot, selling point, goal ladder, and character functions. Do not write an encyclopedia before the story can move.\r
\r
## Execution\r
\r
1. **Read prior components**\r
   - Plot seed, selling point, goals, protagonist, and supporting cast must exist.\r
\r
2. **Derive necessary settings**\r
   - What rules make the selling point work?\r
   - What institutions create the stage goals?\r
   - What locations enable the first arcs?\r
   - What limits prevent the protagonist from solving everything too easily?\r
\r
3. **Write minimum viable worldbuilding**\r
   - Keep only rules that will appear in early story or drive conflict.\r
\r
4. **Cut decorative lore**\r
   - If a setting does not affect choices, conflict, or reader expectation, mark it as later.\r
\r
## Output Format\r
\r
\`\`\`markdown\r
## 世界观设定\r
\r
### 必要规则\r
\r
### 势力和地点\r
\r
### 等级或资源体系\r
\r
### 与卖点的连接\r
\r
### 暂不展开的设定\r
\`\`\`\r
\r
## Source Trace\r
\r
From \`大纲如何写.mp3\`: “最后一步，才是世界观...不要把精力浪费在这上面...一定要根据前面的内容来设定。”\r
\r
`,ie=`﻿---\r
name: character-design\r
description: Use when designing protagonists, heroines, villains, supporting roles, motivations, fears, beliefs, flaws, or character arcs.\r
---\r
\r
# 角色设计\r
\r
## 适用范围\r
\r
男主、女主、男配、女配、反派、导师、盟友、工具人反工具化。\r
\r
完整角色文件必须遵循上级目录的 \`CHARACTER_PROFILE_STANDARD.md\`。角色设计不是只写人物小传，而是生成可供章纲和正文读取的角色状态卡、语言风格卡和出场追踪卡。\r
\r
## 动机三角\r
\r
每个重要角色都要有：\r
\r
1. 想要：当前具体目标。\r
2. 害怕：最怕失去什么或发生什么。\r
3. 信念：他相信世界、自己和他人是什么样。\r
\r
## 设计规则\r
\r
- 主角的缺陷要能制造剧情，不只是性格标签。\r
- 反派要有独立目标和资源，不为推动剧情而发疯。\r
- 配角要补主角缺口：信息、情绪、资源、冲突、镜像、背叛。\r
- 每次重大选择必须能追溯到动机三角。\r
- 重要角色必须写清故事功能、情绪功能、当前状态、语言风格和写作使用规则。\r
- 缺少原文信息时写“原文未明确”或“待后续补充”，不能编造成已确认事实。\r
\r
## 章纲要求\r
\r
- 写清本章出场人物的目标、行动、结果。\r
- 标注人物关系变化和认知变化。\r
- 防止角色为了剧情需要突然变蠢或变善。\r
\r
## 输出要求\r
\r
输出角色信息时必须包含：\r
\r
- 基本信息\r
- 角色定位\r
- 外在表现\r
- 内在分析\r
- 语言风格\r
- 关系网络\r
- 出场记录\r
- 状态追踪\r
- 写作使用规则\r
- 别名\r
\r
\r
`,ae=`﻿---\r
name: relationship-emotion\r
description: Use when designing romance lines, relationship tension, CP progression, emotional beats, trust, betrayal, or push-pull dynamics.\r
---\r
\r
# 关系与情绪线\r
\r
## 适用范围\r
\r
感情线、CP、追妻、甜宠、误会、信任危机、关系拉扯、女频情绪线。\r
\r
涉及角色文件生成或更新时，必须遵循上级目录的 \`CHARACTER_PROFILE_STANDARD.md\`，同步记录关系网络、关系阶段、最近变化、面对不同对象的说话差异和状态追踪。\r
\r
## 好感推进门槛\r
\r
1. 注意到对方。\r
2. 特殊待遇。\r
3. 信任行为。\r
4. 安抚行为。\r
5. 优先特权。\r
6. 主权行为。\r
7. 关系确认或共同承担。\r
\r
## 设计规则\r
\r
- 关系推进要靠行动证据，不靠作者宣布。\r
- 拉近和拉开交替，不能只甜或只虐。\r
- 每次误会必须有现实原因和后续代价。\r
- 女频长篇每段虐后要给反转、糖或女主成长。\r
- 关系变化必须写回双方角色文件，至少更新当前关系状态、最近变化和后续可能。\r
- 情感型角色不能只有“喜欢主角”，必须有独立目标、情绪触发器和关系阶段。\r
\r
## 章纲要求\r
\r
- 标注本章关系状态：拉近、拉开、试探、信任、误会、确认。\r
- 情绪变化要落到动作、物件、台词和选择。\r
- 章尾钩子优先放在关系临界点。\r
\r
## 角色文件更新要求\r
\r
- 更新 \`关系网络\`：当前关系、关系阶段、最近变化、后续可能。\r
- 更新 \`语言风格\`：亲近、误会、冲突后说话方式是否变化。\r
- 更新 \`状态追踪\`：当前关系状态和最近一次变化。\r
\r
\r
`,oe=`﻿---\r
name: supporting-cast\r
description: Use when designing supporting cast, allies, rivals, mentors, villains, group dynamics, or role functions around the protagonist.\r
---\r
\r
# 配角配置\r
\r
## 适用范围\r
\r
配角、反派、导师、队友、家族成员、同门、同事、观众、工具角色升级。\r
\r
生成或补全配角、反派、导师、盟友、上级、工具型配角时，必须遵循上级目录的 \`CHARACTER_PROFILE_STANDARD.md\`。配角文件要能说明这个角色为什么存在、如何推动剧情、如何制造情绪，以及何时退场或升级。\r
\r
## 配角功能\r
\r
- 资源型：给主角资源或入口。\r
- 压力型：制造阻碍和评价。\r
- 镜像型：映照主角可能走向。\r
- 情绪型：提供信任、背叛、陪伴、误解。\r
- 信息型：掌握线索或世界规则。\r
- 反派型：与主角目标冲突。\r
\r
## 设计规则\r
\r
1. 每个重要配角必须有自己的目标。\r
2. 配角不能只在主角需要时出现。\r
3. 反派层级要递升，小反派服务大反派或大规则。\r
4. 导师不能太强，也不能替主角解决关键问题。\r
5. 工具型配角只要反复出现，就必须补足独立目标、语言风格和状态追踪。\r
6. 反派必须记录攻击手段、资源层级、失败节点和是否有洗白空间。\r
\r
## 章纲要求\r
\r
- 写清配角本章推动了哪个核心事件。\r
- 如果配角只说话不改变局面，应删除或合并。\r
- 群像场景要给每个关键人一个行动功能。\r
\r
## 输出要求\r
\r
- 配角必须写清剧情功能和情绪功能。\r
- 反派必须写清利益动机、压迫方式、退场方式。\r
- 导师/上级必须写清权限资源、庇护或压制方式、不能替主角解决的问题。\r
- 情感型配角必须写清情绪触发器和主题连接。\r
\r
\r
`,se=`---\r
name: outline-quality-check\r
description: Use when AI outline, chapter outline, character, setting, foreshadowing, or outline save requests need quality review before storage or follow-up generation.\r
---\r
\r
# 大纲质量检查\r
\r
## 适用范围\r
\r
用于检查 AI 大纲体系中的题材卡、总纲、卷纲、章纲、人物小传、设定文件、伏笔文件和保存请求。不要生成正文。\r
\r
## 必读标准\r
\r
- \`AI_OUTLINE_OUTPUT_PROTOCOL.md\`\r
- \`OUTLINE_FOLDER_STORAGE_STANDARD.md\`\r
- \`TicaiSkill/GENRE_ROUTE_STANDARD.md\`\r
- \`ZhanggangSkill/CHAPTER_OUTLINE_STANDARD.md\`\r
- \`JueseSkill/CHARACTER_PROFILE_STANDARD.md\`\r
- \`SheDingSkill/SETTING_PROFILE_STANDARD.md\`\r
\r
## 检查输出格式\r
\r
\`\`\`markdown\r
# 质量检查报告\r
\r
## 检查对象\r
- 文件名：\r
- 文件类型：\r
- 引用 Skill：\r
\r
## 结论\r
- 结果：通过 / 需修改 / 不通过\r
- 核心原因：\r
\r
## 问题清单\r
| 序号 | 问题类型 | 位置 | 影响 | 修正建议 |\r
|---|---|---|---|---|\r
\r
## 必改项\r
- ...\r
\r
## 可选优化\r
- ...\r
\r
## 保存建议\r
- targetFolder：\r
- fileName：\r
- writeMode：\r
\`\`\`\r
\r
## 题材卡检查\r
\r
- 是否同时确认篇幅类型、受众方向、题材分类、用户灵感和目标输出。\r
- 是否区分男频/女频，没有使用男女频融合。\r
- 是否写出读者承诺、核心卖点、情绪缺口、最终满足。\r
- 是否说明大纲、章纲、人物、设定分别要怎么生成。\r
- 是否没有覆盖用户灵感。\r
\r
## 总纲检查\r
\r
- 主线目标是否只有一个主轴，支线是否服务主轴。\r
- 核心梗是否能循环，不是一两个桥段写完就结束。\r
- 主角欲望、缺陷、压力和成长是否能推动剧情。\r
- 反派或阻力是否分层，不是单一工具人。\r
- 设定是否服务冲突，不是资料堆砌。\r
- 题材承诺是否和用户选择一致。\r
\r
## 章纲检查\r
\r
- 文件名是否为 \`章纲-第001章.md\` 这类格式。\r
- 是否包含上章承接、本章定位、核心事件链、情绪曲线、角色状态、设定更新、伏笔、下一章交接。\r
- 核心事件是否有因果链，不是片段罗列。\r
- 本章是否有明确变化：信息变化、关系变化、目标变化、局势变化至少一项。\r
- 章尾是否有钩子或交接，不让下一章断开。\r
- 是否能直接给正文协作区读取使用。\r
\r
## 人物检查\r
\r
- 是否包含基本信息、角色定位、欲望、恐惧、信念、缺陷。\r
- 是否记录语言风格、关系网络、当前状态、出场记录。\r
- 是否说明角色在大纲和章纲中的功能。\r
- 反派是否有自洽动机，不只是作恶工具。\r
\r
## 设定检查\r
\r
- 世界观、力量体系、势力、地图、伏笔是否有边界、代价、限制和更新规则。\r
- 金手指是否有触发条件、消耗、风险、反制方式。\r
- 势力和地图是否能支撑阶段递升。\r
- 伏笔是否记录埋设位置、回收条件和回收章节。\r
\r
## 保存协议检查\r
\r
- 是否包含 \`outlineSaveRequest\` 或 \`outlineSaveRequests\`。\r
- 是否包含 \`targetFolder\`、\`fileName\`、\`fileType\`、\`writeMode\`、\`referencedSkills\`、\`content\`。\r
- \`targetFolder\` 是否符合文件夹保存规范。\r
- \`writeMode=replace\` 是否有用户明确授权。\r
- 是否把正文内容误存为大纲内容。\r
\r
## 判定规则\r
\r
- 通过：没有必改项，可以保存或进入下一步。\r
- 需修改：存在 1-3 个必改项，但主结构可保留。\r
- 不通过：题材路由错误、章纲不可执行、保存协议缺失，或生成了正文。\r
`,ce=`﻿---\r
name: faction-system\r
description: Use when designing factions, sects, families, companies, agencies, organizations, camps, rivals, or political power structures.\r
---\r
\r
# 势力系统\r
\r
## 适用范围\r
\r
门派、家族、公司、官方机构、地下组织、反派阵营、宫廷、宗门。\r
\r
输出势力、组织、阵营文件时必须遵循上级目录的 \`SETTING_PROFILE_STANDARD.md\`，重点写清势力目标、资源来源、内部矛盾、外部关系、代表人物和剧情功能。\r
\r
## 设计清单\r
\r
1. 势力目标：它当前最想得到什么。\r
2. 资源来源：金钱、武力、情报、人脉、地盘、制度、技术。\r
3. 内部矛盾：继承权、派系、利益差、理念差。\r
4. 外部对手：竞争、合作、互相利用或仇恨。\r
5. 主角关系：加入、利用、反抗、被追杀、继承因果。\r
6. 剧情功能：提供资源、压力、试炼、反转、伏笔或升级通道。\r
7. 更新记录：势力立场或资源变化必须记录。\r
\r
## 章纲要求\r
\r
- 势力登场必须推动一个核心事件。\r
- 势力要有代表人物和可见行动。\r
- 不要连续刷同类势力事件，至少保留节奏变化。\r
\r
## 文件要求\r
\r
- 独立势力默认输出到 \`设定/势力/{势力名}.md\`。\r
- 组织型势力也可输出到 \`设定/组织/{组织名}.md\`。\r
- 势力不能只有名字，必须有目标、资源和代表人物。\r
\r
\r
`,le=`﻿---\r
name: foreshadowing-suspense\r
description: Use when designing foreshadowing, clues, suspense, reveals, mystery payoff, hidden identity, or information-release rhythm.\r
---\r
\r
# 伏笔与悬念\r
\r
## 适用范围\r
\r
伏笔、线索、隐藏身份、旧案、规则真相、反转、悬念节奏、回收计划。\r
\r
输出伏笔或悬念追踪文件时必须遵循上级目录的 \`SETTING_PROFILE_STANDARD.md\`，重点写清伏笔状态、预计回收、回收方式、回收后果和过期处理。\r
\r
## 生命周期\r
\r
1. 埋设：自然出现，不解释。\r
2. 推进：重复出现但换角度。\r
3. 提示：回收前让线索汇聚。\r
4. 回收：产生“原来如此”的情绪。\r
5. 后果：回收后改变人物关系、规则或主线。\r
6. 追踪：每个伏笔必须有状态，不能只写灵感。\r
\r
## 章纲要求\r
\r
- 每章标注新增、推进、回收、延后处理的伏笔。\r
- 如果本章无新增伏笔，也要明确写“本章无新增伏笔”。\r
- 伏笔回收必须影响后续剧情，不能回收完就消失。\r
\r
## 文件要求\r
\r
- 伏笔默认输出到 \`追踪/伏笔.md\`。\r
- 状态使用：未埋 / 已埋 / 推进中 / 已回收 / 已过期。\r
- 过期伏笔必须标注补回收、延后、转长线或放弃并说明。\r
\r
\r
`,ue=`﻿---\r
name: idea-market-positioning\r
description: Use when turning a raw story idea into genre positioning, audience promise, selling points, emotional direction, or project-start evaluation.\r
---\r
\r
# 灵感与市场定位\r
\r
## 适用范围\r
\r
创建新书、题材选择、核心卖点、读者承诺、灵感整理、开书评估。\r
\r
输出题材定位文件时必须遵循上级目录的 \`SETTING_PROFILE_STANDARD.md\`，重点写清题材类型、核心梗、读者承诺、已验证爽点模块、续写定调和风险避坑。\r
\r
## 使用规则\r
\r
1. 把用户灵感拆成：题材标签、人物标签、冲突标签、爽点/虐点、反转点、世界观元素。\r
2. 用一句话确认读者承诺：读者打开这本书最想看什么。\r
3. 核心卖点最多 3 个，超过 3 个要合并或降级。\r
4. 判断题材是否有长线骨架：能否拆出 5 个以上不重复剧情方向。\r
5. 输出时必须说明：主情绪、目标读者、首卷卖点、前三章承诺。\r
6. 题材定位必须能约束后续大纲、章纲和正文，不能只写市场标签。\r
\r
## 大纲字段\r
\r
- 题材定位\r
- 目标读者\r
- 核心卖点\r
- 主情绪\r
- 差异化点\r
- 开篇承诺\r
- 风险与避坑\r
\r
## 文件要求\r
\r
- 默认输出到 \`设定/题材定位.md\`。\r
- 必须包含表层卖点、深层爽点、长线钩子。\r
- 必须写清“不能偏移的核心情绪”。\r
\r
\r
`,de=`﻿---\r
name: map-progression\r
description: Use when designing maps, location changes, new stages, city-to-world expansion, dungeon progression, or environment upgrades.\r
---\r
\r
# 地图推进\r
\r
## 适用范围\r
\r
换地图、新地图、阶段地图、学校、宗门、城市、副本、领地、星际、秘境。\r
\r
输出地图或场景文件时必须遵循上级目录的 \`SETTING_PROFILE_STANDARD.md\`，重点写清进入条件、离开条件、环境规则、资源、危险、新旧地图关联和阶段作用。\r
\r
## 设计规则\r
\r
1. 新地图必须带来新环境、新角色、新规则、新目标和新冲突。\r
2. 新旧地图要有关联：上级、仇怨、资源流向、历史因果或旧伏笔。\r
3. 换地图前，旧地图核心冲突至少阶段性解决。\r
4. 换地图后前 5 章快速建立代入感、资源目标和主要压力源。\r
5. 地位升高时，环境危险度也要同步升高。\r
6. 地图变化必须改变行动规则，不能只是地名变化。\r
\r
## 章纲要求\r
\r
- 本章若换地图，要写清旧地图收束和新地图期待。\r
- 地图不能只是地名变化，必须改变行动规则。\r
- 章尾钩子优先投放新地图传说、危险或资源。\r
\r
## 文件要求\r
\r
- 独立地图默认输出到 \`设定/地图/{地图名}.md\`。\r
- 关键场景可写入背景设定；反复出现并影响多章时独立成文件。\r
- 新地图前 5 章必须建立新目标、新压力和新规则。\r
\r
\r
`,fe=`﻿---\r
name: power-system\r
description: Use when designing power systems, golden fingers, abilities, cultivation levels, systems, upgrades, costs, or countermeasures.\r
---\r
\r
# 力量体系与金手指\r
\r
## 适用范围\r
\r
修炼体系、异能、系统、金手指、等级、功法、道具、职业能力。\r
\r
输出力量体系或金手指文件时必须遵循上级目录的 \`SETTING_PROFILE_STANDARD.md\`，重点写清获取方式、任务/成长机制、限制、代价、反制点和防崩坏写作约束。\r
\r
## 设计清单\r
\r
1. 核心能力：一句话说明主角最有趣的能力用法。\r
2. 获取方式：天赋、系统、传承、训练、资源、契约或代价。\r
3. 限制：触发条件、消耗、冷却、风险、暴露、反制。\r
4. 成长路径：能力如何升级，升级后解决什么新问题。\r
5. 爽点循环：压力出现、能力触发、选择、兑现、引发更大压力。\r
6. 使用史：每次解锁、任务、奖励或突破都要能追踪。\r
\r
## 章纲要求\r
\r
- 本章能力使用必须产生具体结果。\r
- 不能只写“突破”，要写突破的原因、代价和后续影响。\r
- 敌人必须有可见反制或误判。\r
\r
## 文件要求\r
\r
- 力量体系默认输出到 \`设定/世界观/力量体系.md\`。\r
- 金手指默认输出到 \`设定/世界观/金手指.md\`。\r
- 金手指不能直接替主角跳过关键过程。\r
\r
\r
`,pe=`﻿---\r
name: world-rules\r
description: Use when designing world rules, taboos, social systems, supernatural laws, setting consistency, or rule constraints for outlines.\r
---\r
\r
# 世界规则\r
\r
## 适用范围\r
\r
世界观、规则怪谈、修仙法则、社会制度、禁忌、信息公开度、设定一致性。\r
\r
输出世界观、背景设定或规则文件时必须遵循上级目录的 \`SETTING_PROFILE_STANDARD.md\`，重点写清核心定义、运行规则、剧情功能和写作约束。\r
\r
## 设计清单\r
\r
1. 规则来源：自然法则、制度、神明、系统、宗门、国家、家族或副本。\r
2. 规则边界：能做什么，不能做什么，违反后代价是什么。\r
3. 信息公开度：读者知道、主角知道、配角知道、反派知道分别是什么。\r
4. 反制方式：规则是否能被绕开、利用、误读或升级。\r
5. 长期影响：规则会如何影响势力、地图、人物目标和伏笔回收。\r
6. 使用边界：哪些问题不能靠这个规则临时解决。\r
\r
## 章纲要求\r
\r
- 每次使用规则，都要写明规则依据和代价。\r
- 新增规则必须服务本章冲突或伏笔。\r
- 禁止临时新增万能规则解决剧情。\r
\r
## 文件要求\r
\r
- 背景设定默认输出到 \`设定/世界观/背景设定.md\`。\r
- 规则体系默认输出到 \`设定/世界观/规则体系.md\`。\r
- 影响多章的规则必须写更新记录。\r
\r
\r
`,me=`﻿---\r
name: entertainment-livestream-esports\r
description: Use when generating or analyzing entertainment industry, livestream, account operation, esports, performance, or public-feedback outlines.\r
---\r
\r
# 文娱直播电竞\r
\r
## 适用范围\r
\r
文娱娱乐圈、直播文、账号运营、电竞、舞台、比赛、围观反馈型爽文。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 才华展示或战术执行带来公开反馈。\r
- 数据、榜单、播放量、排名、赛果、舆论反转可量化。\r
- 主角不是闭门变强，而是在观众、评委、粉丝、对手面前兑现。\r
- 事业线和人际线互相影响。\r
\r
## 大纲生成规则\r
\r
1. 先定义赛道评价体系：平台、榜单、比赛、合同、舆论、资本或战队。\r
2. 每卷设一个量化目标：涨粉、晋级、夺冠、爆款、合同、口碑翻盘。\r
3. 展示章节必须包含“准备、执行、反馈、反转、收益”五步。\r
4. 舆论不能只有夸，要有质疑、误解、黑料、反证和二次传播。\r
5. 卷末必须兑现一个公开成绩，并抬高下一卷目标。\r
\r
## 章纲生成重点\r
\r
- 本章要写清可量化变化：数据、赛果、评分、热搜、粉丝反应。\r
- 对手或观众反应链要分层：普通观众、专业人士、竞争者、平台方。\r
- 章尾钩子优先：负面舆论、新赛制、隐藏强敌、平台规则变化。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/idea-market-positioning\`\r
- \`JueseSkill/supporting-cast\`\r
\r
\r
`,u=`﻿---\r
name: family-drama-short\r
description: Use when generating or analyzing short family-drama, social reality, revenge-face-slap, ordinary-person counterattack, or世情 short outlines.\r
---\r
\r
# 世情短篇\r
\r
## 适用范围\r
\r
世情、家庭矛盾、极品亲戚、婚恋背叛、弱者反击、现实向短篇。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 现实细节让读者代入，恶行要具体。\r
- 主角前期被欺压，后期反击要解气。\r
- 反派恶有恶报，善良者获得尊严或新生活。\r
- 靠细节和反转，不靠空泛大事件。\r
\r
## 大纲生成规则\r
\r
1. 三幕结构：建压、爆点、落定。\r
2. 建压阶段写具体委屈：钱、房、孩子、养老、彩礼、工作、名声。\r
3. 爆点阶段安排背叛、落井下石、证据暴露或身份反转。\r
4. 落定阶段要有清算和余味，不只是吵赢。\r
5. 每 1500-2000 字至少一个信息差或情绪钩子。\r
\r
## 章纲生成重点\r
\r
- 短篇章纲按小节写，每节有目标情绪和反转点。\r
- 反派台词要贴近日常逻辑，不能脸谱化。\r
- 章尾钩子优先：证据出现、亲人站队、身份反转、主角平静摊牌。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/character-design\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
\r
\r
`,d=`﻿---\r
name: farming-business-adventure\r
description: Use when generating or analyzing farming, business, management, trade, merchant, settlement, or adventure-economy outlines.\r
---\r
\r
# 种田经营冒险\r
\r
## 适用范围\r
\r
种田、经营、商旅、领地建设、冒险经营、资源流转、家族/村镇发展。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 从贫弱资源起步，逐步建立稳定资产。\r
- 爽点来自经营成果可见：产量、收入、人口、地盘、口碑、技术。\r
- 外部压力来自天灾、人祸、竞争者、政策、市场和运输风险。\r
- 发展不能只有赚钱，还要改变人物关系和势力格局。\r
\r
## 大纲生成规则\r
\r
1. 先定义初始资源：土地、技术、人脉、商品、店铺、领地或特殊能力。\r
2. 建立资源循环：投入 → 生产 → 交易 → 升级 → 招人 → 新压力。\r
3. 每卷至少一次经营成果公开兑现。\r
4. 反派不是单纯找茬，要争夺资源、渠道、政策或声誉。\r
5. 地图升级要带来新市场、新规则和新风险。\r
\r
## 章纲生成重点\r
\r
- 本章必须写明资源变化和经营结果。\r
- 冲突要围绕价格、渠道、货源、人手、信誉、路途或政策。\r
- 章尾钩子优先：订单暴涨、对手截胡、天灾、市场规则变化。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/faction-system\`\r
- \`SheDingSkill/map-progression\`\r
- \`JueseSkill/supporting-cast\`\r
\r
\r
`,f=`---\r
name: female-book-transmigration\r
description: Use when generating or analyzing female-oriented book transmigration, cannon-fodder awakening, plot correction, villain rescue, or original-story reversal outlines and chapter outlines.\r
---\r
\r
# 女频穿书\r
\r
## 适用范围\r
\r
穿书、炮灰觉醒、恶毒女配改命、拯救反派、剧情偏移、原书女主/男主博弈。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 女主知道原书命运，但必须通过主动选择改变结局。\r
- 原剧情不能机械复述，要成为压力、误导和反转来源。\r
- 角色不能只按“原书标签”行动，必须逐步长出真实动机。\r
- 感情线来自重新认识和互相成就，不是靠知道剧情直接攻略。\r
\r
## 大纲生成规则\r
\r
1. 先确定穿书身份：炮灰、女配、路人、反派亲属、原书结局受害者。\r
2. 设计原书剧情节点和偏移后果。\r
3. 女主每次改剧情都要付出代价或引发新变量。\r
4. 反派/男主/原女主必须有独立动机，不能完全工具化。\r
5. 终局要解决原书命运、系统/剧情约束或世界真相。\r
\r
## 章纲生成重点\r
\r
- 本章标注原书节点、女主选择和剧情偏移。\r
- 每次偏移都要带来关系变化或新危机。\r
- 伏笔优先服务原书真相、身份误解、系统规则或人物反差。\r
- 章尾钩子优先：剧情反噬、原角色异常、命运节点提前。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`JueseSkill/relationship-emotion\`\r
`,p=`﻿---\r
name: female-chasing-wife\r
description: Use when generating or analyzing female-oriented chasing-wife, regret, crematorium romance, dog-blood romance, or hurt-comfort reversal outlines.\r
---\r
\r
# 女频追妻火葬场\r
\r
## 适用范围\r
\r
追妻火葬场、狗血言情、虐后翻盘、带球跑、重生退婚、反转暗恋。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 前期虐要具体，后期悔要有代价。\r
- 女主心死离开是关键，不是闹脾气。\r
- 男主追悔不能轻易成功，必须多次求而不得。\r
- 结局可以复合、开放或不回头，但女主必须拿回主动权。\r
\r
## 大纲生成规则\r
\r
1. 建压阶段写出具体伤害：冷暴力、误解、偏袒、背叛、身份压制、资源剥夺。\r
2. 女主觉醒要有最后一根稻草，并平静离开。\r
3. 男主追悔要分层：不适应、发现真相、失去资源、失去情感、公开低头。\r
4. 女主新生活要有事业或关系成长，不能只等男主醒悟。\r
5. 每次拉扯都要改变关系权力，不重复哭求。\r
\r
## 章纲生成重点\r
\r
- 本章标注情绪阶段：建压、心死、离开、新生、追悔、拒绝、清算、余韵。\r
- 男主悔恨要用行动代价，不只独白。\r
- 章尾钩子优先：女主离开证据、男主发现真相、追妻被拒、旧物反转。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
\r
\r
`,m=`---\r
name: female-family-pampering-child\r
description: Use when generating or analyzing female-oriented family pampering,团宠, cute child, found family, mistaken identity, or healing family outlines and chapter outlines.\r
---\r
\r
# 女频团宠萌宝\r
\r
## 适用范围\r
\r
团宠、萌宝、真假千金亲情线、找回家人、全员宠、亲情治愈、带崽改命。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自被珍视、被保护、被家人坚定选择。\r
- 团宠不能只有夸奖，要通过行动解决主角现实困境。\r
- 萌宝必须推动关系和事件，不只是可爱装饰。\r
- 亲情线要有误会、补偿、选择和安全感。\r
\r
## 大纲生成规则\r
\r
1. 先确定主角/萌宝的缺失：身份、亲情、名声、安全、资源。\r
2. 配置家人群像，每个家人有不同保护方式和关系门槛。\r
3. 每卷安排一次身份推进或亲情确认。\r
4. 反派阻力来自错认、利益、偏心、舆论或家族秘密。\r
5. 终局完成身份归位、情感补偿和新家庭秩序。\r
\r
## 章纲生成重点\r
\r
- 本章必须有亲情或保护行为推进。\r
- 萌宝/主角行动要推动事件，不只卖萌。\r
- 关系变化要标注：试探、保护、误会、确认、补偿。\r
- 章尾钩子优先：身份线索、亲子鉴定、旧秘密、家人站队。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/supporting-cast\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,h=`---\r
name: female-farming-business\r
description: Use when generating or analyzing female-oriented farming, business building, household management, countryside entrepreneurship, or ancient/period commerce outlines and chapter outlines.\r
---\r
\r
# 女频种田经商\r
\r
## 适用范围\r
\r
女频种田、经商、穿越经营、古代开店、年代创业、家庭经营、事业线成长。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自从低处起家、靠能力挣钱、改善生活和打脸对照组。\r
- 事业线必须可见增长：产品、客源、渠道、口碑、资产。\r
- 感情线服务女主成长，不吞掉事业主线。\r
- 家庭和熟人社会阻力要真实，不全靠极品脸谱。\r
\r
## 大纲生成规则\r
\r
1. 先确定起点困境：贫穷、被分家、名声差、资源少、技术缺口。\r
2. 设计经营成长线：小产品、小店、稳定渠道、品牌/产业、区域影响。\r
3. 每卷安排一次事业升级和一次关系/家庭阻力。\r
4. 女主能力来源要自洽，不能凭空全能。\r
5. 终局完成事业独立、关系归位和生活质量跃迁。\r
\r
## 章纲生成重点\r
\r
- 本章必须有一个经营动作或资产变化。\r
- 冲突来自成本、货源、竞争、家人阻力、口碑或政策环境。\r
- 感情互动要服务事业或成长节点。\r
- 章尾钩子优先：新订单、竞争对手、货源危机、贵人发现。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/faction-system\`\r
- \`SheDingSkill/map-progression\`\r
- \`JueseSkill/supporting-cast\`\r
`,g=`﻿---\r
name: female-house-palace\r
description: Use when generating or analyzing female-oriented ancient romance, house fighting, palace fighting, rebirth revenge, or power-in-family outlines.\r
---\r
\r
# 女频宅斗宫斗古言\r
\r
## 适用范围\r
\r
古言、宅斗、宫斗、庶女上位、重生复仇、家族权谋、后宅生存。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 女主在规则压迫中识破阴谋、掌握资源、逐步上位。\r
- 斗争不是吵架，而是信息、身份、礼法、资源和人心的博弈。\r
- 每次反击要有证据链和后果。\r
- 感情线必须服务权力线或安全感。\r
\r
## 大纲生成规则\r
\r
1. 先定义压迫系统：嫡庶、宫规、家族利益、婚姻、名声、继承权。\r
2. 反派分梯度：小丫鬟/姨娘/姐妹/夫人/权臣/皇权。\r
3. 女主的优势可以是前世记忆、审时度势、经商、医术、人脉、信息差。\r
4. 每卷一次清算，但不能一次清空所有敌人。\r
5. 证据、物证、证人和舆论要进入伏笔表。\r
\r
## 章纲生成重点\r
\r
- 本章写清谁在规则内压迫谁。\r
- 反击要设计证据链：线索、布局、诱导、公开、后果。\r
- 章尾钩子优先：证据失踪、身份暴露、婚约变化、上位者介入。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/faction-system\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`JueseSkill/supporting-cast\`\r
\r
\r
`,_=`﻿---\r
name: female-modern-romance\r
description: Use when generating or analyzing female-oriented modern romance, modern imagination, relationship, marriage, or contemporary emotional outlines.\r
---\r
\r
# 女频现言\r
\r
## 适用范围\r
\r
现言、现言脑洞、现代婚恋、都市情感、现代女性成长。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 女主有代入感、主动性和安全感。\r
- 情绪产品明确：被认可、被珍视、被尊重、被看见。\r
- 感情线和成长线双轴推进，不能只靠误会拖剧情。\r
- 虐点之后必须给反转或成长，不让女主长期无力。\r
\r
## 大纲生成规则\r
\r
1. 先定义女主现实困境：婚姻、职场、家庭、经济、身份、情感不平等。\r
2. 男主或关键异性角色必须提供冲突和情绪价值，不只是身份标签。\r
3. 每卷给女主一个可见成长：事业成果、关系主动权、真相掌控、生活选择。\r
4. 反派或阻力来自现实逻辑：利益、面子、阶层、家庭、舆论、资源。\r
5. 简介、开篇和主线承诺必须一致，避免甜宠外壳写成纯虐。\r
\r
## 章纲生成重点\r
\r
- 本章要写清女主的主动选择。\r
- 感情推进必须有行为证据：特殊待遇、信任、安抚、优先权、主权行为。\r
- 章尾钩子优先：关系误判、真相露头、女主反击、男主态度转变。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`JueseSkill/character-design\`\r
\r
\r
`,v=`﻿---\r
name: female-mystery-republic\r
description: Use when generating or analyzing female-oriented suspense, mystery romance, Republican-era romance, investigation romance, or emotional mystery outlines.\r
---\r
\r
# 女频悬疑民国\r
\r
## 适用范围\r
\r
女频悬疑、民国言情、探案情感线、身份秘密、旧案、家国与爱情。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 悬疑线和感情线互相推进，不是两条互不相干的线。\r
- 真相揭开要改变人物关系。\r
- 民国或时代背景要产生身份、阵营、家族、舆论和生死压力。\r
- 女主必须参与破局，而不是等待男主解释。\r
\r
## 大纲生成规则\r
\r
1. 先定义核心秘密：旧案、身份、家族罪、卧底、背叛、遗书、照片、信物。\r
2. 每卷安排一条案件线和一条关系线，卷末必须交叉。\r
3. 线索投放要同时服务推理和情绪。\r
4. 阵营选择要有代价，不能只是口号。\r
5. 感情推进必须经过信任危机和共同承担。\r
\r
## 章纲生成重点\r
\r
- 本章至少推进一条线索或一次关系信任变化。\r
- 场景要写明时代压力：身份审查、家族名声、军警、报馆、租界、地下组织。\r
- 章尾钩子优先：旧案证据、身份暴露、阵营误判、亲密者嫌疑。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`SheDingSkill/faction-system\`\r
- \`JueseSkill/relationship-emotion\`\r
\r
\r
`,y=`---\r
name: female-period-rebirth\r
description: Use when generating or analyzing female-oriented period,年代, rebirth, family counterattack, marriage choice, or era-specific romance outlines and chapter outlines.\r
---\r
\r
# 女频年代重生\r
\r
## 适用范围\r
\r
年代文、重生年代、八零/七零/九零、换亲、知青、军婚、医术复仇、家庭反击。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 女主利用前世信息差改命，拿回婚姻、事业、家庭和尊严主动权。\r
- 年代细节要具体，不能只贴标签。\r
- 感情线要给安全感，男主价值要通过行动体现。\r
- 极品家人或渣男必须有现实利益动机和对应报应。\r
\r
## 大纲生成规则\r
\r
1. 先确定重生节点和前世最大遗憾。\r
2. 设计三条线：改命线、家庭反击线、感情/事业成长线。\r
3. 年代物件、政策、职业、票证、单位和村镇关系要进入事件。\r
4. 女主每卷至少一次主动选择，不被婚姻或家庭推着走。\r
5. 反派清算要和其恶行对应，不能只靠突然掉马。\r
\r
## 章纲生成重点\r
\r
- 本章必须有年代细节承载冲突。\r
- 女主行动要利用前世信息差或当下判断。\r
- 感情推进不能跳阶段，要有信任来源。\r
- 章尾钩子优先：前世记忆反转、身份线索、证据出现、婚姻选择。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/idea-market-positioning\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`JueseSkill/supporting-cast\`\r
`,b=`---\r
name: female-possessive-romance\r
description: Use when generating or analyzing female-oriented possessive romance, forced love, power-difference romance, emotional control, or strong push-pull outlines and chapter outlines.\r
---\r
\r
# 女频强取豪夺\r
\r
## 适用范围\r
\r
强取豪夺、强势占有、身份压制、权力差恋爱、虐恋拉扯、反向掌控。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 核心张力来自权力差、欲望压迫、反抗和反向掌控。\r
- 女主必须有主体性，不能长期无选择权。\r
- 男主强势要有边界和代价，不能只有伤害。\r
- 虐点后必须给安全感、反转或女主筹码。\r
\r
## 大纲生成规则\r
\r
1. 先确定权力差来源：身份、财富、家族、秘密、救命债、契约。\r
2. 设计四阶段：压迫相遇、反抗拉扯、筹码互换、关系重塑。\r
3. 女主每卷至少获得一项筹码：证据、事业、盟友、身份、情感主动权。\r
4. 男主占有欲必须被事件检验和修正。\r
5. 终局要完成女主主动选择，不默认屈服。\r
\r
## 章纲生成重点\r
\r
- 本章必须标注关系权力变化。\r
- 冲突要有压迫、反抗、交换或试探。\r
- 女主行动必须体现主体性或筹码积累。\r
- 章尾钩子优先：关系失控、筹码曝光、身份压制升级。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`JueseSkill/character-design\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,x=`---\r
name: female-rebirth-revenge\r
description: Use when generating or analyzing female-oriented rebirth revenge, information-gap counterattack, family betrayal, marriage reversal, or layered revenge outlines and chapter outlines.\r
---\r
\r
# 女频重生复仇\r
\r
## 适用范围\r
\r
重生复仇、前世惨死、家族背叛、婚恋背叛、宅斗复仇、商战复仇、信息差打脸。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 女主带着前世记忆清醒改命，反派逐层付出代价。\r
- 复仇要有证据、布局和公开打脸，不是单纯开挂碾压。\r
- 女主不能重复前世被动，必须主动选择、设局、止损。\r
- 感情线要服务信任重建和命运改写。\r
\r
## 大纲生成规则\r
\r
1. 先确定前世惨死原因、最大误判和重生节点。\r
2. 反派分层：小反派、中层操盘者、终极受益者。\r
3. 每卷清算一类债：名声、财产、亲情、婚姻、生命威胁。\r
4. 前世记忆只能提供信息差，不能替代行动逻辑。\r
5. 终局要完成复仇、改命和新生活确认。\r
\r
## 章纲生成重点\r
\r
- 本章必须写明女主利用了哪条前世信息。\r
- 打脸要有证据链、见证人或利益结果。\r
- 反派反扑要逐步升级，不能一直低级犯蠢。\r
- 章尾钩子优先：前世隐藏真相、更大反派、证据反转。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/character-design\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,S=`﻿---\r
name: female-rich-family-ceo\r
description: Use when generating or analyzing female-oriented rich-family, CEO, elite romance, arranged marriage, or sweet-pet power romance outlines.\r
---\r
\r
# 女频豪门总裁\r
\r
## 适用范围\r
\r
豪门总裁、霸总甜宠、先婚后爱、契约婚、联姻、上流社会情感线。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 权力差带来压迫和保护，但女主不能是花瓶。\r
- 宠要有独特方式：别人做不到，男主为女主改变资源分配。\r
- 甜宠要有外部阻力，否则只有糖没有追读。\r
- 豪门规则、家族利益、商业压力要服务感情选择。\r
\r
## 大纲生成规则\r
\r
1. 先定关系入口：联姻、契约、误会相遇、救助、身份错认、商业合作。\r
2. 男主强势但必须有情感软肋和行动代价。\r
3. 女主必须有不可替代价值：能力、信念、秘密、审美、事业、善意或破局能力。\r
4. 阻力来自家族、前任、商业对手、舆论、身份差或契约边界。\r
5. 每卷至少一次“男主公开站队”或“女主主动翻盘”。\r
\r
## 章纲生成重点\r
\r
- 本章写清权力关系变化：谁掌握主动权，谁让步，谁付出代价。\r
- 甜点要具体到行为，不用空泛“宠她”。\r
- 章尾钩子优先：契约变化、家族施压、公开偏爱、前任/竞争者登场。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`JueseSkill/character-design\`\r
- \`SheDingSkill/faction-system\`\r
\r
\r
`,C=`---\r
name: female-secret-love-reunion\r
description: Use when generating or analyzing female-oriented secret love, long-time crush, reunion romance, broken mirror, second chance, or emotional healing outlines and chapter outlines.\r
---\r
\r
# 女频暗恋破镜重圆\r
\r
## 适用范围\r
\r
暗恋、久别重逢、破镜重圆、双向暗恋、遗憾弥补、成年后重逢、情感治愈。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自旧情未断、误会解开、细节回收和迟来的双向奔赴。\r
- 过去的分开必须有真实原因，不靠误会硬拖。\r
- 感情推进靠细节、选择和信任重建，不靠突然表白。\r
- 结尾要弥补遗憾或完成成熟选择。\r
\r
## 大纲生成规则\r
\r
1. 先确定旧关系：暗恋、前任、错过、误会、现实阻隔。\r
2. 设计过去线和现在线交替揭示。\r
3. 每卷回收一个旧细节，并推进一个现在选择。\r
4. 误会解除必须改变双方行动。\r
5. 终局要完成关系确认和旧遗憾处理。\r
\r
## 章纲生成重点\r
\r
- 本章必须有旧细节或旧伤口被触发。\r
- 关系推进要标注：重逢、试探、拉开、靠近、坦白、确认。\r
- 对话和动作要承载未说出口的情绪。\r
- 章尾钩子优先：旧物、旧话、误会真相、迟来的告白。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`JueseSkill/character-design\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,w=`﻿---\r
name: female-substitute-romance\r
description: Use when generating or analyzing substitute romance, white-moonlight, mistaken identity, identity reversal, or self-worth awakening outlines.\r
---\r
\r
# 女频替身文\r
\r
## 适用范围\r
\r
替身文、白月光、身份错认、替身觉醒、真身反转、追妻火葬场变体。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 女主从“被替代”到“不可替代”。\r
- 替身真相必须有蛛丝马迹和确认瞬间。\r
- 男主的混淆、逃避和后悔要分阶段。\r
- 女主离开后要找回自我价值。\r
\r
## 大纲生成规则\r
\r
1. 设计五阶段：不自知、察觉、确认、决绝、放下。\r
2. 白月光或原型不能只是工具，要制造价值判断冲突。\r
3. 替身线索分批投放：物品、称呼、习惯、照片、地点、朋友反应。\r
4. 真相揭开后，女主必须做主动选择。\r
5. 反转可以是女主才是真正白月光，但不能抵消前期伤害。\r
\r
## 章纲生成重点\r
\r
- 本章必须推进一条替身线索或自我觉醒。\r
- 情绪重点是“被看见”和“自我价值重建”。\r
- 章尾钩子优先：关键物证、错误称呼、白月光出现、女主确认真相。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
\r
\r
`,T=`﻿---\r
name: female-workplace-youth-sweet\r
description: Use when generating or analyzing workplace romance, youth sweet romance, campus romance, healing romance, or soft emotional growth outlines.\r
---\r
\r
# 女频职场青春甜宠\r
\r
## 适用范围\r
\r
职场婚恋、青春甜宠、校园、治愈、双向奔赴、轻甜成长。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 轻甜不等于无冲突，冲突来自成长、误会、目标差异和外部压力。\r
- 甜点要通过细节兑现，不靠堆形容词。\r
- 两人互相成就，不能只有一方拯救另一方。\r
- 安全感强，但仍要有阶段钩子。\r
\r
## 大纲生成规则\r
\r
1. 先定义关系入口：同事、同学、搭档、暗恋、重逢、误会合作。\r
2. 每阶段安排一个共同任务，让关系在行动中升温。\r
3. 好感度推进不能跨级：关注、特殊待遇、信任、安抚、优先、确认。\r
4. 职场线要有真实目标：项目、晋升、客户、比赛、作品、评价。\r
5. 青春线要有选择压力：升学、梦想、家庭、友情、异地。\r
\r
## 章纲生成重点\r
\r
- 本章明确关系状态和成长目标。\r
- 甜点必须具体：动作、物件、台词、偏爱、默契。\r
- 章尾钩子优先：误会、共同任务升级、告白临界、事业危机。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`JueseSkill/character-design\`\r
\r
\r
`,E=`﻿---\r
name: female-xuanhuan-fantasy\r
description: Use when generating or analyzing female-oriented fantasy, xianxia romance, fantasy romance, or cultivation romance outlines and chapter outlines.\r
---\r
\r
# 女频玄幻幻想言情\r
\r
## 适用范围\r
\r
幻想言情、仙侠情缘、女频玄幻、沙雕修真、带感情线的修仙/玄幻故事。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 女主不是被世界推着走，而是主动做选择。\r
- 世界观服务人物关系、命运反抗和情绪兑现。\r
- 感情线与成长线双轴推进，不能只升级或只谈恋爱。\r
- 虐点必须给安全感锚点：每卷至少有一次女主可见成长或翻盘。\r
\r
## 大纲生成规则\r
\r
1. 先定女主核心困境：身份压制、天赋误判、命运诅咒、情感错位、宗门/家族规训。\r
2. 男主或关键关系不是奖励品，必须和女主成长目标发生冲突或互相成就。\r
3. 力量体系要写清，但不要淹没情绪线；重要规则必须能制造关系误会、牺牲或选择。\r
4. 每卷安排一次感情状态变化：试探、信任、误会、并肩、确认、危机、升华。\r
5. 反派不能只嫉妒女主，要有利益、权力、身份或规则层面的压迫来源。\r
\r
## 章纲生成重点\r
\r
- 本章必须写明女主主动行动。\r
- 场景顺序里要标注关系推进：拉近、拉开、误解、保护、试探、确认。\r
- 伏笔优先服务身份、前世、命契、血脉、师门秘密或情感误判。\r
- 章尾钩子优先：关系误判、身份线索、规则代价、命运选择。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/power-system\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
\r
\r
`,D=`---\r
name: male-beast-taming\r
description: Use when generating or analyzing male-oriented beast taming, pet evolution, monster partner, creature collection, or battle companion outlines and chapter outlines.\r
---\r
\r
# 男频御兽\r
\r
## 适用范围\r
\r
御兽、宠兽进化、契约灵兽、怪物收集、宠物流升级、学院/秘境/联赛型御兽故事。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自低估宠兽进化、隐藏血脉、技能组合、比赛碾压和稀有资源争夺。\r
- 宠兽必须有独立定位，不只是主角技能栏。\r
- 进化路线要清晰，阶段收获要可视化。\r
- 人和宠兽之间要有信任、配合、羁绊和战术成长。\r
\r
## 大纲生成规则\r
\r
1. 先确定御兽世界评价体系：资质、属性、血脉、技能、进化路线、御兽师等级。\r
2. 主角初始宠兽必须有被低估理由和翻盘空间。\r
3. 每卷至少一次公开验证：考试、联赛、秘境、拍卖、任务、官方认证。\r
4. 宠兽成长不能只靠吞资源，要有训练、战斗、环境和羁绊触发。\r
5. 地图递升从学院/城市到秘境/战区，再到异界生态或古老血脉源头。\r
\r
## 章纲生成重点\r
\r
- 本章必须写明宠兽能力变化、战术变化或关系变化。\r
- 战斗要体现属性克制、技能组合、环境利用和对手误判。\r
- 资源获取要有代价、竞争者和后续影响。\r
- 章尾钩子优先：进化征兆、血脉异常、新秘境、强敌盯上。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/power-system\`\r
- \`SheDingSkill/map-progression\`\r
- \`JueseSkill/supporting-cast\`\r
`,O=`---\r
name: male-behind-the-scenes\r
description: Use when generating or analyzing male-oriented behind-the-scenes, mastermind, hidden controller, organization puppet, or secret-layout outlines and chapter outlines.\r
---\r
\r
# 男频幕后流\r
\r
## 适用范围\r
\r
幕后流、黑手流、组织马甲、暗中布局、操盘世界、扶持棋子、隐藏身份。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自主角暗中布局、他人误判、棋子行动和真相揭露。\r
- 主角不能只躲在幕后，必须通过布局改变局势。\r
- 马甲、组织和棋子要有边界，不能无限套娃。\r
- 读者要比局中人更早看见主角的操盘价值。\r
\r
## 大纲生成规则\r
\r
1. 先确定主角幕后能力：情报、组织、预言、系统、资源、身份或规则漏洞。\r
2. 设计三层局：小棋局、势力棋局、世界棋局。\r
3. 每卷至少一次布局兑现，让读者确认主角不是空想。\r
4. 棋子必须有独立欲望，不能只是主角工具。\r
5. 终局要处理身份暴露、组织反噬或世界级真相。\r
\r
## 章纲生成重点\r
\r
- 本章必须标注主角明面行动和暗线布局。\r
- 他人误判要有合理信息来源。\r
- 伏笔优先服务马甲、组织、棋子动机和真相揭露。\r
- 章尾钩子优先：布局兑现、棋子失控、身份暴露风险。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`JueseSkill/supporting-cast\`\r
- \`SheDingSkill/faction-system\`\r
`,k=`﻿---\r
name: male-history-alt-history\r
description: Use when generating or analyzing history, alternate history, war spy, period, or knowledge-gap driven outlines.\r
---\r
\r
# 历史架空年代\r
\r
## 适用范围\r
\r
历史、历史脑洞、架空历史、年代、抗战谍战、穿越改命、信息差经营。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 主角用现代认知、历史信息差、组织能力或技术知识改写困境。\r
- 历史外壳服务爽点，不被考据拖死。\r
- 关键事件必须有时代压力：制度、身份、资源、战争、舆论、家族。\r
- 读者要看到“如果我知道未来，我能怎么赢”。\r
\r
## 大纲生成规则\r
\r
1. 先定历史节点或架空压力：乱世、科举、商战、军史、谍战、年代家庭。\r
2. 主角优势必须落地：信息差、技术、组织、商业、军事、文化输出。\r
3. 反派不是现代傻子，要有时代资源和制度优势。\r
4. 每卷安排一次公开评价逆转：考中、立功、破案、赚钱、救人、翻案。\r
5. 时代细节只写与冲突有关的，不做资料堆砌。\r
\r
## 章纲生成重点\r
\r
- 本章写明主角用什么时代差或认知差解决问题。\r
- 场景中必须有制度阻力或资源限制。\r
- 章尾钩子优先：新政令、身份暴露、敌方布局、历史节点提前。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/idea-market-positioning\`\r
- \`SheDingSkill/faction-system\`\r
- \`JueseSkill/supporting-cast\`\r
\r
\r
`,A=`﻿---\r
name: male-infinite-sci-fi-apocalypse\r
description: Use when generating or analyzing infinite-flow, sci-fi, apocalypse, survival, game-instance, or mission-based speculative outlines.\r
---\r
\r
# 无限科幻末世\r
\r
## 适用范围\r
\r
无限流、科幻、末世、游戏副本、求生、任务制世界。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 每个副本或灾变阶段有独立目标和规则。\r
- 主角靠信息、准备、团队、资源管理和关键选择活下去。\r
- 压力来自时间、物资、规则、敌人和同伴信任。\r
- 长篇必须有现实主线或终极真相串联副本。\r
\r
## 大纲生成规则\r
\r
1. 先设计主线机制：副本来源、任务发布者、末世成因、科技/异常边界。\r
2. 每卷一个副本或灾变阶段，卷内目标一句话可表达。\r
3. 每个副本必须有资源约束、死亡条件、隐藏奖励、错误通关线。\r
4. 团队角色按功能配置：观察、战斗、医疗、谈判、破译、背叛风险。\r
5. 卷末回收阶段真相，同时扩大世界问题。\r
\r
## 章纲生成重点\r
\r
- 本章必须推进任务进度或生存压力，不能纯聊天。\r
- 场景要写明资源变化：弹药、食物、时间、权限、信任、伤势。\r
- 科幻设定要服务选择，不做长篇说明书。\r
- 章尾钩子优先：倒计时、任务变更、队友异常、资源失效、真相反转。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`SheDingSkill/map-progression\`\r
- \`JueseSkill/supporting-cast\`\r
\r
\r
`,j=`---\r
name: male-longevity-flow\r
description: Use when generating or analyzing male-oriented longevity, immortal watcher, time-span, generation change, or long-life cultivation outlines and chapter outlines.\r
---\r
\r
# 男频长生流\r
\r
## 适用范围\r
\r
长生流、长生看世事、时代更替、代际传承、凡俗到修行、时间碾压。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自时间尺度、沧海桑田、旁人争斗和主角稳定积累。\r
- 主角长生必须带来代价：孤独、隐忍、身份迁移、因果牵连。\r
- 凡俗阶段要有质感，不能过早变成普通升级文。\r
- 时代变化要改变人物关系、势力格局和主角选择。\r
\r
## 大纲生成规则\r
\r
1. 先确定长生规则、限制、暴露风险和修行方式。\r
2. 设计多个时代段，每段有不同人、势力和核心矛盾。\r
3. 主角目标不能只是“活着”，要有守护、求道、避劫或见证。\r
4. 每卷体现时间收益和时间代价。\r
5. 终局处理长生来源、天地限制或主角最终选择。\r
\r
## 章纲生成重点\r
\r
- 本章必须体现时间带来的信息差或关系差。\r
- 配角命运要能反衬主角长生观。\r
- 伏笔优先服务代际回收、旧物重现、身份更替。\r
- 章尾钩子优先：故人后代、旧因果回归、身份暴露。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/map-progression\`\r
- \`JueseSkill/supporting-cast\`\r
`,M=`---\r
name: male-lord-building\r
description: Use when generating or analyzing male-oriented lord, territory building, kingdom management, base construction, farming-war, or infrastructure expansion outlines and chapter outlines.\r
---\r
\r
# 男频领主基建\r
\r
## 适用范围\r
\r
领主文、基建文、种田争霸、领地经营、城邦扩张、末世基地、异界建国。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自荒地变强城、小势力吞并大势力、资源循环和制度优势碾压。\r
- 每次建设都要改变领地实力、人口、军力、经济或科技。\r
- 主角必须面对资源短缺、外敌、内政和人才缺口。\r
- 扩张不能只堆建筑，要有政治、军事、商业和民心变化。\r
\r
## 大纲生成规则\r
\r
1. 先确定初始领地劣势：贫瘠、人口少、外敌压境、制度落后、资源被封锁。\r
2. 设计四条成长线：资源、人口、军队、制度。\r
3. 每卷设置一个建设目标和一个外部威胁。\r
4. 人才配置要分工明确：内政、军事、商业、技术、外交。\r
5. 地图递升从村镇、城邦、区域联盟到王国或跨界势力。\r
\r
## 章纲生成重点\r
\r
- 本章必须有一个可见经营变化或势力变化。\r
- 冲突要来自资源、民心、外敌、叛徒、贸易或制度阻力。\r
- 新建筑/制度/技术必须带来后续剧情，不做装饰设定。\r
- 章尾钩子优先：外敌来袭、资源发现、人才投奔、制度反噬。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/faction-system\`\r
- \`SheDingSkill/map-progression\`\r
- \`JueseSkill/supporting-cast\`\r
`,N=`---\r
name: male-mortal-cultivation\r
description: Use when generating or analyzing male-oriented mortal cultivation, cautious survival, low-talent progression, resource calculation, or凡人流 outlines and chapter outlines.\r
---\r
\r
# 男频凡人流\r
\r
## 适用范围\r
\r
凡人流、低天赋修仙、谨慎生存、资源算计、利弊权衡、慢热伏笔型升级。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自谨慎准备、信息优势、资源利用和小人物逆袭。\r
- 主角不能嘴上谨慎、行为莽撞。\r
- 金手指弱或有限，成长靠算计、耐心和选择。\r
- 配角要有独立利益，不围着主角降智。\r
\r
## 大纲生成规则\r
\r
1. 先确定主角低位处境、有限优势和不可越界风险。\r
2. 每卷设置资源目标、风险目标和撤退条件。\r
3. 副本进入前必须有利益权衡和情报铺垫。\r
4. 爽点来自准备兑现，不靠突然爆种。\r
5. 地图递升要保留旧因果和伏笔回收。\r
\r
## 章纲生成重点\r
\r
- 本章必须写明主角的利弊判断。\r
- 冲突要有准备、试探、后手和撤退方案。\r
- 资源收获要具体，不能只写“变强”。\r
- 章尾钩子优先：隐藏风险、旧伏笔、收益超预期。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/power-system\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,P=`---\r
name: male-simulator-loop\r
description: Use when generating or analyzing male-oriented simulator, life simulation, repeated deduction, future preview, save-load, or loop-based outlines and chapter outlines.\r
---\r
\r
# 男频模拟器\r
\r
## 适用范围\r
\r
模拟器、人生模拟、未来预演、读档重来、循环推演、死亡回溯、情报差破局。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自提前知道危机、低成本试错、现实兑现奖励和反杀未知命运。\r
- 模拟不能只是剧透，必须带来新代价、新误判和现实选择。\r
- 每轮模拟要获得一个关键信息或能力，但也暴露更大问题。\r
- 现实推进必须消耗模拟成果，不能永远停在推演里。\r
\r
## 大纲生成规则\r
\r
1. 先确定模拟规则：触发条件、消耗、时间范围、可带回内容、失败代价。\r
2. 每卷设置一个现实大危机，用多轮模拟逐步拆解。\r
3. 模拟结果要有真假混杂，避免主角无脑全知。\r
4. 奖励要服务现实行动：能力、情报、人脉、物品、路线选择。\r
5. 终局要揭示模拟器来源、限制或幕后代价。\r
\r
## 章纲生成重点\r
\r
- 本章标注模拟段和现实段的功能差异。\r
- 每次模拟必须带出新信息、新风险或新选择。\r
- 现实行动要验证或修正模拟结论。\r
- 章尾钩子优先：模拟失败、现实偏差、隐藏条件、代价显现。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`SheDingSkill/power-system\`\r
`,F=`---\r
name: male-son-in-law-counterattack\r
description: Use when generating or analyzing male-oriented son-in-law, hidden identity, family humiliation, counterattack, or social face-slap outlines and chapter outlines.\r
---\r
\r
# 男频赘婿反击\r
\r
## 适用范围\r
\r
赘婿、隐忍身份、家族羞辱、隐藏实力、婚姻压迫、社会打脸反击。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自被轻视后的身份、实力、资源或人脉反转。\r
- 隐忍必须有理由，不是无意义受辱。\r
- 婚姻关系要明确：守护、交易、误解、互相成就或彻底切割。\r
- 打脸要有社会评价变化和实际利益变化。\r
\r
## 大纲生成规则\r
\r
1. 先确定主角隐藏身份/能力和不能暴露的理由。\r
2. 设计三层羞辱：家庭、商业/社会、强敌势力。\r
3. 每卷安排一次公开身份或资源反转。\r
4. 女主或婚姻对象不能只是奖励，要有独立立场变化。\r
5. 终局处理身份公开、家族清算和关系归位。\r
\r
## 章纲生成重点\r
\r
- 本章必须有轻视、误判或身份压制。\r
- 反击要改变他人评价或资源分配。\r
- 关系线要标注信任、误解、保护或切割。\r
- 章尾钩子优先：身份线索暴露、大人物登场、家族反扑。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`SheDingSkill/idea-market-positioning\`\r
- \`JueseSkill/supporting-cast\`\r
`,I=`﻿---\r
name: male-urban-highmartial\r
description: Use when generating or analyzing male-oriented urban, urban ability, urban high-martial, spiritual-revival, or modern power fantasy outlines.\r
---\r
\r
# 男频都市高武\r
\r
## 适用范围\r
\r
都市、都市异能、都市高武、神明复苏、灵气复苏、现代武道、隐藏高手。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 现代身份低位和超凡能力反差。\r
- 金钱、排名、考试、比赛、任务、官方评价体系带来可量化爽点。\r
- 主角从被轻视到被官方、学校、武馆、组织认可。\r
- 都市日常和高武冲突交替，不能只有打架。\r
\r
## 大纲生成规则\r
\r
1. 建立现代评价体系：学校、武馆、平台、官方、榜单、薪酬、资源兑换。\r
2. 主角早期压力要具体：贫穷、考试、家人、校霸、资源被抢、能力被误判。\r
3. 每卷至少一次公开展示：考试、联赛、任务、救援、直播或官方认证。\r
4. 地图从学校/社区到武馆/治安局，再到城市、全国、异界或神明战场。\r
5. 反派层级从同学、教练、地下势力、邪教、异兽、神明代理逐步递升。\r
\r
## 章纲生成重点\r
\r
- 本章要有可见评价变化：分数、排名、奖金、身份、称号、舆论。\r
- 战斗要写出环境利用、能力边界、对手误判和围观反应。\r
- 日常桥段必须服务家庭压力、资源目标、身份隐藏或人际认可。\r
- 章尾钩子优先：新榜单、新任务、更强对手、身份暴露风险。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/power-system\`\r
- \`SheDingSkill/map-progression\`\r
- \`JueseSkill/character-design\`\r
\r
\r
`,L=`﻿---\r
name: male-urban-system\r
description: Use when generating or analyzing male-oriented urban imagination, system-flow, cheat, golden-finger, or concept-driven serial-fiction outlines.\r
---\r
\r
# 男频都市脑洞系统流\r
\r
## 适用范围\r
\r
都市脑洞、系统流、签到、加点、模拟、错位系统、职业流、金手指驱动故事。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 核心梗一句话能说清。\r
- 系统不是外挂说明书，而是制造情绪缺口和爽点循环的发动机。\r
- 每章至少有期待点、爽点或期待到爽点之间的推进。\r
- 主角使用系统解决现实压力，并引发更大压力。\r
\r
## 大纲生成规则\r
\r
1. 先定义系统核心玩法：触发条件、奖励类型、限制、惩罚、升级方式。\r
2. 明确核心循环：压力出现 → 系统触发 → 主角选择 → 爽点兑现 → 新问题扩大。\r
3. 系统功能不要过多，首卷只保留 1 个主能力和 1 个辅助能力。\r
4. 微创新不超过 3 个，优先在人设、关系、情节里创新，不乱改底层题材期待。\r
5. 每卷扩展系统边界，但不能破坏最初卖点。\r
\r
## 章纲生成重点\r
\r
- 本章要写清系统触发点和现实压力。\r
- 奖励必须改变主角处境，不能只是堆数据。\r
- 反派或旁观者要产生认知差：主角觉得正常，别人觉得不可思议。\r
- 章尾钩子优先：新任务、新限制、奖励副作用、系统来源线索。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/idea-market-positioning\`\r
- \`SheDingSkill/power-system\`\r
- \`SheDingSkill/world-rules\`\r
\r
\r
`,R=`---\r
name: male-villain-protagonist\r
description: Use when generating or analyzing male-oriented villain protagonist, counter-fate, anti-hero, fate stealing, or original-protagonist opposition outlines and chapter outlines.\r
---\r
\r
# 男频反派流\r
\r
## 适用范围\r
\r
反派流、穿成反派、逆天改命、夺取气运、对抗原主角、反套路爽文。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 爽点来自识破原主角套路、夺取资源、反向布局和命运反杀。\r
- 主角可以反派身份，但行为逻辑要自洽，有目标和底线。\r
- 原主角不能降智，要有气运、盟友和反扑能力。\r
- 气运/命运规则必须清楚，不能随意改。\r
\r
## 大纲生成规则\r
\r
1. 先确定反派身份、必死命运和改命目标。\r
2. 设计原主角优势：气运、系统、身份、人脉、道德光环。\r
3. 每卷夺取一类资源：人脉、机缘、名声、势力、关键人物。\r
4. 反派行为要有代价和风险，不能无脑作恶。\r
5. 终局处理命运规则、原主角最终反扑和主角身份重塑。\r
\r
## 章纲生成重点\r
\r
- 本章必须标注主角在改哪一条原命运线。\r
- 冲突要体现原主角光环或惯性。\r
- 夺取资源要有操作过程和后续代价。\r
- 章尾钩子优先：气运反噬、原主角警觉、命运线变动。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/character-design\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`SheDingSkill/world-rules\`\r
`,z=`﻿---\r
name: male-xuanhuan-xianxia\r
description: Use when generating or analyzing male-oriented xuanhuan, xianxia, cultivation, high-martial, or upgrade fantasy outlines and chapter outlines.\r
---\r
\r
# 男频玄幻仙侠\r
\r
## 适用范围\r
\r
玄幻、修仙、仙侠、高武、西幻升级流。用于总纲、卷纲、章纲、核心卖点、黄金三章和升级节奏设计。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 主角从低位被压迫状态崛起。\r
- 力量体系清晰，等级、功法、资源、代价可追踪。\r
- 爽点来自突破、越级、打脸、夺宝、换地图和更高层敌人压迫。\r
- 每个阶段都有新目标，不让升级变成机械刷数值。\r
\r
## 大纲生成规则\r
\r
1. 先确定主线目标：复仇、登顶、救人、破局、改命，只选一个主轴。\r
2. 设计四层压力：同辈压迫、家族/宗门压迫、地图级势力压迫、天道/世界规则压迫。\r
3. 金手指必须有限制：触发条件、消耗、冷却、暴露风险、反制方式。\r
4. 地图逐级展开，每换地图要带走至少一个旧伏笔、旧敌人或旧情感资产。\r
5. 阶段目标必须递升：资源价值、敌人层级、认知反转、影响范围至少一项升级。\r
\r
## 章纲生成重点\r
\r
- 本章目标：突破、夺宝、试炼、打脸、追杀、拜师、换地图、揭示规则。\r
- 核心事件不少于 6 条，事件之间必须有因果链。\r
- 战斗不能只写数值碾压，要有策略、代价、误判、底牌。\r
- 章尾钩子优先：更强敌人出现、规则反噬、隐藏身份暴露、资源争夺升级。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/power-system\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/faction-system\`\r
- \`SheDingSkill/map-progression\`\r
\r
\r
`,he=`﻿---\r
name: rule-mystery-suspense\r
description: Use when generating or analyzing rule mystery, strange rules, suspense, supernatural suspense, investigation, or puzzle-solving outlines.\r
---\r
\r
# 规则怪谈悬疑\r
\r
## 适用范围\r
\r
规则怪谈、悬疑、悬疑灵异、规则副本、调查解谜、怪异空间。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 规则看似荒谬，但背后有自洽逻辑。\r
- 主角通过观察、试探、代价、推理破解规则。\r
- 恐惧来自“不知道哪条规则是真的”，爽点来自“看懂规则后反制”。\r
- 每个副本都有背景故事、通关线、死亡线和隐藏真相。\r
\r
## 大纲生成规则\r
\r
1. 每个副本先写三层规则：表层规则、隐藏例外、真相规则。\r
2. 死亡或惩罚必须可回溯，不能随机吓人。\r
3. 线索投放按“误导、验证、反证、汇聚、揭示”推进。\r
4. 主角可以有能力，但能力只能帮助观察或试错，不能直接无视规则。\r
5. 卷末必须回收一个核心规则，并开启更高层规则问题。\r
\r
## 章纲生成重点\r
\r
- 本章至少推进一条规则验证或反证。\r
- 场景顺序要标明：发现异常、触碰边界、付出代价、获得线索、调整判断。\r
- 伏笔必须记录：规则文本、异常行为、受害者差异、场景细节。\r
- 章尾钩子优先：规则冲突、同伴违规、看似安全的规则被推翻。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`SheDingSkill/map-progression\`\r
\r
\r
`,ge=`---\r
name: short-death-regret\r
description: Use when generating or analyzing short death-regret, after-death remorse, soul witness, irreversible loss, or late-truth emotional outlines and chapter outlines.\r
---\r
\r
# 短篇死人文学\r
\r
## 适用范围\r
\r
死人文学、死后追悔、灵魂旁观、来不及、虐后真相、不可逆失去。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 核心情绪是“来不及”，不是单纯虐惨。\r
- 死亡或不可逆失去要尽早成立，后续靠真相和追悔推进。\r
- 生者后悔必须有证据冲击和行为崩塌。\r
- 结尾要有余韵、安静画面或因果落点。\r
\r
## 大纲生成规则\r
\r
1. 三幕结构：死亡/失去成立、真相逐层揭开、追悔与余韵落定。\r
2. 前 20% 明确不可逆代价。\r
3. 真相用物件、证据、旧话、监控、日记或第三方补全。\r
4. 追悔对象的崩溃必须逐层升级，不能一句“我错了”结束。\r
5. 结尾不强行圆满，优先保留意难平或释然。\r
\r
## 章纲生成重点\r
\r
- 小节目标标注：死亡事实、旁观无力、证据浮出、真相反转、追悔崩塌、余韵。\r
- 每节必须有新的情感证据或认知反转。\r
- 避免大段哭诉，用动作、物件、称呼变化承载情绪。\r
- 章尾钩子优先：旧物反转、死亡真相、迟来的电话、无人回应。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/relationship-emotion\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,_e=`---\r
name: short-marriage-betrayal\r
description: Use when generating or analyzing short marriage betrayal, affair, property transfer, spouse counterattack, divorce revenge, or emotional evidence-chain outlines and chapter outlines.\r
---\r
\r
# 短篇婚恋背叛\r
\r
## 适用范围\r
\r
婚恋背叛、出轨、财产转移、婆家算计、离婚反击、证据链复仇。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 主角发现背叛后冷静布局，最终拿回财产、尊严和主动权。\r
- 背叛要具体：钱、孩子、房子、工作、名声、身体代价。\r
- 证据链是核心爽点，摊牌要有公开性或法律/经济后果。\r
- 反派下场必须和恶行对应。\r
\r
## 大纲生成规则\r
\r
1. 三幕结构：异常发现、暗中取证和布局、公开清算和新生。\r
2. 开头用异常物件、账单、聊天记录、称呼变化或行为反常进入。\r
3. 主角不要立刻崩溃，先冷静判断和收集证据。\r
4. 中段安排对方反扑或继续伪装，制造戏剧张力。\r
5. 结尾要有清算结果，不只情绪吵赢。\r
\r
## 章纲生成重点\r
\r
- 小节目标标注：异常、确认、取证、布局、反扑、摊牌、清算。\r
- 每节至少推进一个证据或关系认知。\r
- 对话要贴近日常，反派不能全程脸谱化。\r
- 章尾钩子优先：新证据、财产漏洞、第三者现身、主角反向设局。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/character-design\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,ve=`---\r
name: short-public-trial-face-slap\r
description: Use when generating or analyzing short public trial, public face-slap, evidence reveal, reputation reversal, judgment scene, or staged confrontation outlines and chapter outlines.\r
---\r
\r
# 短篇公开审判式打脸\r
\r
## 适用范围\r
\r
公开审判式打脸、证据连环揭露、名誉反转、家族/公司/婚礼/直播公开对峙。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 反派先在公开场合占上风，主角再逐层翻盘。\r
- 证据释放要递进，不能一次倒完。\r
- 围观者态度反转是爽点的重要组成。\r
- 主角越冷静，反派越崩溃，形成情绪对比。\r
\r
## 大纲生成规则\r
\r
1. 三幕结构：公开压迫、证据递进、审判清算。\r
2. 先设计公开场：婚礼、寿宴、股东会、发布会、直播、学校大会。\r
3. 反派必须先赢一小段，推高读者不爽。\r
4. 证据按轻到重释放，每次改变围观认知。\r
5. 结尾要有明确驱逐、处罚、断亲、封杀或身份重置。\r
\r
## 章纲生成重点\r
\r
- 小节目标标注：登场、羞辱、第一证据、二次反转、权威确认、最终清算。\r
- 每个证据必须对应一个反派谎言。\r
- 围观者反应要递进：怀疑、沉默、震惊、倒戈。\r
- 章尾钩子优先：最大证据未放、权威人物到场、反派自爆。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/supporting-cast\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,ye=`---\r
name: short-rebirth-revenge\r
description: Use when generating or analyzing short rebirth revenge, first-choice reversal, information-gap counterattack, quick face-slap, or regret correction outlines and chapter outlines.\r
---\r
\r
# 短篇重生复仇\r
\r
## 适用范围\r
\r
短篇重生复仇、重生改命、第一选择反转、前世信息差、快速打脸。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 开头快速完成前世惨局和重生节点。\r
- 主角第一件事要做前世绝不会做的选择。\r
- 爽点来自信息差、反向布局和公开打脸。\r
- 篇幅短，复仇对象不能过多，必须集中清算。\r
\r
## 大纲生成规则\r
\r
1. 三幕结构：重生认知、反向布局、集中清算。\r
2. 前 10% 交代前世最大伤害和重生当下危机。\r
3. 主角第一选择必须立刻改变局势。\r
4. 反派反扑不超过两轮，避免短篇拖散。\r
5. 结尾用新生活、漠视或公开审判收束。\r
\r
## 章纲生成重点\r
\r
- 小节目标标注：前世、重生、反常选择、布局、反扑、打脸、收束。\r
- 每节都要利用一条前世信息差。\r
- 打脸必须有证据或利益结果。\r
- 章尾钩子优先：前世未知真相、反派提前失控、底牌公开。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/character-design\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
`,be=`---\r
name: short-soul-perspective\r
description: Use when generating or analyzing short soul-perspective, ghost witness, powerless observer, posthumous truth, or supernatural emotional outlines and chapter outlines.\r
---\r
\r
# 短篇灵魂视角\r
\r
## 适用范围\r
\r
灵魂视角、死后旁观、鬼视角、无力阻止、身后真相、亲情/婚恋虐文。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 核心冲击来自“看得到但阻止不了”。\r
- 灵魂视角要提供信息差，不只是换个旁白身份。\r
- 生者态度变化和真相揭露是主要推进力。\r
- 结尾要有审判、转生、放下或意难平余韵。\r
\r
## 大纲生成规则\r
\r
1. 三幕结构：灵魂出现、旁观真相、证据审判或余韵。\r
2. 开头尽快建立死亡/离体/旁观规则。\r
3. 灵魂不能随意干预现实，规则越清楚越有张力。\r
4. 真相通过生者行为、旧物、证据和旁观对比揭开。\r
5. 结尾用动作或意象收束，不做长篇说理。\r
\r
## 章纲生成重点\r
\r
- 小节目标标注：离体、旁观、无力、证据、崩溃、审判、余韵。\r
- 每节必须利用灵魂视角看到一层新信息。\r
- 现实线和回忆线要互相补充，不堆解释。\r
- 章尾钩子优先：遗物、监控、日记、迟来的发现。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`JueseSkill/relationship-emotion\`\r
`,xe=`﻿---\r
name: western-fantasy-cosmic-dark\r
description: Use when generating or analyzing western fantasy, knight fantasy, cosmic horror, Cthulhu-like, dark, conquest, or domination-oriented outlines.\r
---\r
\r
# 西幻克苏鲁黑暗题材\r
\r
## 适用范围\r
\r
西幻、骑士、巫师、克苏鲁、黑暗流、征服流、吞噬进化、支配爽。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 西幻必须有晋升体系和环境危险度，不只是换皮玄幻。\r
- 克苏鲁必须有不可知、污染、代价和规则升级。\r
- 黑暗题材要有支配、征服、吞噬或碾压爽，但主角目标要稳定。\r
- 氛围和规则必须贯穿，不能中途变普通升级文。\r
\r
## 大纲生成规则\r
\r
1. 先定世界底色：骑士晋升、巫师规则、神秘污染、黑暗秩序或领地征服。\r
2. 主角能力必须和世界压迫匹配。\r
3. 每卷设置一个不可逆代价：理智、血脉、关系、领地、名誉或信仰。\r
4. 克苏鲁线索按异常、污染、代价、真相、升级推进。\r
5. 黑暗流要写势力扩张和秩序建立，不只写杀戮。\r
\r
## 章纲生成重点\r
\r
- 本章必须有规则触碰、代价兑现或势力推进。\r
- 氛围描写要服务危险判断，不做纯装饰。\r
- 章尾钩子优先：污染扩散、神秘契约、敌人臣服、上位存在注视。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`SheDingSkill/world-rules\`\r
- \`SheDingSkill/power-system\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
- \`SheDingSkill/faction-system\`\r
\r
\r
`,Se=`﻿---\r
name: zhihu-short\r
description: Use when generating or analyzing Zhihu-style short fiction, high-hook short stories, emotional judgment, reversal, or first-person confession outlines.\r
---\r
\r
# 知乎短篇\r
\r
## 适用范围\r
\r
知乎短篇、第一人称短篇、强钩子、反转审判、情绪宣泄、信息差故事。\r
\r
## AI 大纲路由约束\r
\r
- 使用本 Skill 前必须先读取上级目录的 \`GENRE_ROUTE_STANDARD.md\`。\r
- 必须先输出题材卡，再进入总纲、章纲、人物或设定生成。\r
- 本 Skill 只服务 AI 大纲体系，不处理正文协作区的正文生成。\r
\r
## 核心读者期待\r
\r
- 开头快速抛出反常问题或结果。\r
- 第一人称在场感强，情绪判断明确。\r
- 反转必须改变读者对前文的理解。\r
- 结尾有审判、释然、打脸、遗憾或余韵。\r
\r
## 大纲生成规则\r
\r
1. 开头 200 字内必须有问题、冲突或反常事实。\r
2. 三幕结构：提出反常、推进证据、真相反转。\r
3. 主角叙述可以带主观审判，但不能写成空泛讲理。\r
4. 伏笔要小而具体：一句话、照片、账单、聊天记录、动作、称呼。\r
5. 结尾只收最关键情绪，不做长篇解释。\r
\r
## 章纲生成重点\r
\r
- 小节目标要写清：误导、建压、证据、反转、审判、余韵。\r
- 每节至少一个“继续看”的信息缺口。\r
- 章尾钩子优先：新证据、旧话反转、主角真实计划、对方崩溃。\r
\r
## AI 大纲联动\r
\r
- \`DagangSkill\`\r
- \`ZhanggangSkill\`\r
- \`JueseSkill/character-design\`\r
- \`SheDingSkill/foreshadowing-suspense\`\r
\r
\r
`,Ce=`---\r
name: chapter-attribute-positioning\r
description: 当单章缺少清晰的情绪标签、章节属性、章节功能、读者期待或存在理由时使用；适用于章节定位、情绪标签、章节属性、这一章该写什么、过渡章、高潮章、反转章等请求；不用于正文润色。\r
---\r
\r
# 章节定位\r
\r
## 核心原则\r
\r
写章纲前，先确定读者应该感受到什么，以及这一章带来什么变化。章节属性 = 情绪标签 + 功能定位。\r
\r
## 执行步骤\r
\r
1. **选择一个核心情绪标签**\r
   - 可选方向：逆袭、打脸、悬念、憋屈、反转、糖点、燃点、紧张、共情。\r
   - 只选一个主标签，辅助情绪必须服务主标签。\r
\r
2. **选择一个章节属性**\r
   - 可选方向：铺垫章、冲突章、反转章、低谷章、蓄力章、高潮章、过渡章。\r
   - 属性决定节奏：高潮章不能平，过渡章也必须有实际变化。\r
\r
3. **定义四个功能**\r
   - 主线承接：承接上一章的剧情状态，不能断档。\r
   - 主线推进：本章完成了什么进度、破局、时刻或线索。\r
   - 人物变化：主角心态、能力、认知、短板或关系发生什么变化。\r
   - 追读目的：解决上一章什么疑问，又埋下下一章什么期待。\r
\r
4. **用五句话以内写清定位**\r
   - 写不短，通常说明这一章不够聚焦。\r
\r
## 输出格式\r
\r
\`\`\`\r
## 章节定位\r
\r
### 核心情绪标签\r
\r
### 章节属性\r
\r
### 主线承接\r
\r
### 主线推进\r
\r
### 人物变化\r
\r
### 追读目的\r
\`\`\`\r
\r
## 常见问题\r
\r
- 一章想承载所有情绪，导致重点散。\r
- 把“过渡章”写成没有任何变化。\r
- 高潮章只有解释，没有冲突或爆点。\r
- 忘记结尾要制造读者期待。\r
`,we=`---\r
name: chapter-emotion-curve\r
description: 当单章需要设计情绪节奏、情绪起伏、读者感受控制，或需要修复章节太平、太炸、憋屈无释放等问题时使用；适用于情绪线、情绪曲线、情绪节奏、爽点释放等请求；不用于全书情绪规划。\r
---\r
\r
# 情绪曲线\r
\r
## 核心原则\r
\r
一章不能从头到尾停在同一种情绪里。使用顺滑曲线：开局状态、中段变化、峰值爆发、结尾沉淀并保留期待。\r
\r
## 四个节点\r
\r
1. **开局情绪**\r
   - 承接上一章情绪，不要突然切断。\r
   - 匹配章节属性和入场条件。\r
\r
2. **中段变化**\r
   - 让冲突推动情绪上升、下降、收紧或变得更不确定。\r
   - 用触发条件或互动条件制造情绪转折。\r
\r
3. **峰值爆发**\r
   - 最强情绪释放放在核心爆点，不要随意提前。\r
   - 峰值必须对齐本章核心记忆点。\r
\r
4. **结尾沉淀**\r
   - 让情绪有一点呼吸空间，但保留期待线。\r
   - 用结尾钩子保留一个未解决问题。\r
\r
## 常用曲线\r
\r
- 平开 -> 冲突上升 -> 高潮释放 -> 伏笔降落。\r
- 冲突开篇 -> 小解释缓冲 -> 再次上升 -> 反转收尾。\r
- 憋屈开篇 -> 压迫升级 -> 打脸释放 -> 新问题钩子。\r
\r
## 输出格式\r
\r
\`\`\`\r
## 情绪曲线\r
\r
| 节点 | 情绪状态 | 触发事件 | 读者感受 |\r
|---|---|---|---|\r
| 开局 |  |  |  |\r
| 中段 |  |  |  |\r
| 峰值 |  |  |  |\r
| 结尾 |  |  |  |\r
\`\`\`\r
\r
## 常见问题\r
\r
- 整章都很平，没有起伏。\r
- 整章都很炸，让读者疲劳。\r
- 情绪峰值早于冲突成熟。\r
- 结尾完全归零，没有期待线。\r
`,Te=`---\r
name: chapter-foreshadow-hook\r
description: 当单章需要设计伏笔、线索回收、下一章钩子、悬念结尾或追读理由时使用；适用于伏笔、钩子、结尾、追读、下一章、回收旧坑、挖新坑等请求；不用于不需要延续钩子的封闭独立场景。\r
---\r
\r
# 伏笔和钩子\r
\r
## 核心原则\r
\r
一章最好回收一个旧坑、埋下一个新坑、抛出一个结尾钩子。伏笔可以藏在中段，钩子必须在结尾让读者看见。\r
\r
## 三个动作\r
\r
1. **回收旧伏笔**\r
   - 解决或部分解释前文的线索、承诺、冲突或疑问。\r
   - 回收要让读者觉得“原来如此”，而不是更困惑。\r
\r
2. **预埋新伏笔**\r
   - 把后续要用的线索藏在物件、动作、对话、环境或异常细节里。\r
   - 现在不必完全显眼，但以后必须能回收。\r
   - 优先使用章节关键词或必须插入信息里的线索。\r
\r
3. **结尾强钩子**\r
   - 结尾留下未完全解决的事：发现、威胁、矛盾、邀请、新身份、失踪、突发证据、不可能事实。\r
   - 读者应该清楚知道自己下一章想看什么答案。\r
   - 钩子必须从本章结果里长出来，不能像额外贴上的段落。\r
\r
## 钩子规则\r
\r
- 结尾必须有缺口、未知或未完成结果。\r
- 视角角色已经知道答案时，不要制造假悬念。\r
- 钩子不是“发生了点事”，而是一个具体未答问题。\r
- 伏笔和钩子不同：伏笔可以隐，结尾钩子必须拉人。\r
\r
## 输出格式\r
\r
\`\`\`\r
## 伏笔和钩子\r
\r
### 回收旧伏笔\r
\r
### 预埋新伏笔\r
\r
### 结尾强钩子\r
\r
### 读者会问的问题\r
\`\`\`\r
\r
## 常见问题\r
\r
- 忘记前面埋过的线索。\r
- 结尾太圆满，没有追读动力。\r
- 新线索没有未来用途。\r
- 需要追读时，却用睡觉、休息、离场或场景关闭收尾。\r
`,Ee=`---\r
name: chapter-four-beat-flow\r
description: 当单章需要可执行的四段式结构、场景推进或节奏规划时使用；适用于四段式、开篇入戏、中段冲突、核心爆点、结尾钩子、章节节奏等请求；应在章节定位和浓缩剧情关键词明确后使用。\r
---\r
\r
# 四段式章纲\r
\r
## 核心原则\r
\r
用四段锁住单章节奏：开篇入戏、中段冲突、核心爆点、强钩收尾。每一段都有任务，不让章节滑成松散对话或说明书。\r
\r
## 输入\r
\r
- 章节定位\r
- 浓缩剧情\r
- 关键词\r
- 必要条件\r
- 必须插入的线索、道具或信息\r
\r
## 四段结构\r
\r
| 段落 | 默认篇幅 | 任务 |\r
|---|---:|---|\r
| 开篇入戏 | 500-800 字 | 承接上一章结尾状态，快速落到场景、人物处境和遗留矛盾 |\r
| 中段冲突 | 500-800 字 | 事件升级，矛盾显现，对手施压，现场发生变化 |\r
| 核心爆点 | 500-800 字 | 本章最高光时刻：打脸、反转、揭秘、崩溃、觉醒、胜利或线索突破 |\r
| 强钩收尾 | 500-800 字 | 情绪收束，主角状态更新，确定下一步行动，留下下一章钩子 |\r
\r
篇幅只是默认参考；用户指定字数时，按比例压缩或扩展。\r
\r
## 执行步骤\r
\r
1. **三行内入戏**\r
   - 快速进入场景，不做装饰性热身。\r
   - 使用 \`chapter-keyword-conditions\` 的入场条件。\r
\r
2. **中段必须改变局面**\r
   - 压力增加、信息改变、关系变化或有人采取行动。\r
   - 使用触发条件和互动条件制造变化。\r
\r
3. **给本章一个记忆点**\r
   - 读者应该记住一个强画面、揭示、胜利、损失或反转。\r
   - 从最强关键词或必须插入的信息里选择记忆点。\r
\r
4. **结尾制造继续阅读的理由**\r
   - 结尾留下具体未解决结果，而不是模糊的“欲知后事如何”。\r
   - 钩子要连到结果条件或必须插入的线索。\r
\r
## 输出格式\r
\r
\`\`\`\r
## 四段式章纲\r
\r
### 1. 开篇入戏\r
\r
### 2. 中段冲突\r
\r
### 3. 核心爆点\r
\r
### 4. 强钩收尾\r
\`\`\`\r
\r
## 常见问题\r
\r
- 开头铺设太久，迟迟不入戏。\r
- 中段只重复争吵，没有新压力或新信息。\r
- 核心爆点没有视觉记忆点。\r
- 结尾把问题全部解决，读者没有继续看的理由。\r
`,De=`---\r
name: chapter-keyword-conditions\r
description: 当单章已有大概目的，但缺少可落地的浓缩剧情、关键词、必要条件、相遇逻辑、意外原因、关键道具或场景材料时使用；适用于关键词、必要条件、浓缩剧情、场景条件、相遇设计、意外原因等请求；应在章节定位明确后使用。\r
---\r
\r
# 浓缩剧情和关键词条件\r
\r
## 核心原则\r
\r
可写作的章纲必须有“浓缩剧情 + 关键词 + 必要条件”。章节定位决定这一章的功能，关键词条件决定这一章里面必须出现哪些可写材料。\r
\r
## 执行步骤\r
\r
1. **写浓缩剧情**\r
   - 把本章压缩成一句清楚的剧情句。\r
   - 句式可参考：“角色因为某个条件进入某个场景，在某个意外或冲突中产生某个变化。”\r
\r
2. **提取 3-6 个关键词**\r
   - 可包含：场景、事件、情绪、道具、关系、特殊画面。\r
   - 避免“精彩”“推进”“铺垫”这类空泛词。\r
\r
3. **补齐必要条件**\r
   - 入场条件：角色为什么必须进入这个场景。\r
   - 触发条件：什么意外、压力、邀请、陷阱或发现启动事件。\r
   - 互动条件：角色如何相遇、碰撞、误会、合作或对抗。\r
   - 结果条件：本章结束时发生什么变化。\r
\r
4. **判断套路或反套路**\r
   - 如果使用常见套路，要明确读者期待的爽点或情绪回报。\r
   - 如果反套路，要明确用什么替代原本的期待回报。\r
\r
5. **分配必须插入的信息**\r
   - 可加入线索、道具、台词、目击者、伤口、雨、信件、信物、期限、背景事实。\r
   - 只保留会影响剧情、情绪、钩子或后续回收的信息。\r
\r
## 输出格式\r
\r
\`\`\`\r
## 浓缩剧情和关键词\r
\r
### 浓缩剧情\r
\r
### 关键词\r
\r
### 必要条件\r
\r
| 类型 | 内容 | 作用 |\r
|---|---|---|\r
| 入场条件 |  |  |\r
| 触发条件 |  |  |\r
| 互动条件 |  |  |\r
| 结果条件 |  |  |\r
\r
### 套路或反套路处理\r
\r
### 必须插入的伏笔/道具/信息\r
\`\`\`\r
\r
## 常见问题\r
\r
- 有章节功能，但没有具体可写的场景材料。\r
- 关键词太多，导致本章失焦。\r
- 道具或线索出现后没有后续用途。\r
- 意外事件只服务作者安排，没有角色动因或现场逻辑。\r
`,Oe=`---\r
name: chapter-outline-assembler\r
description: 当章节定位、浓缩剧情关键词、四段式、情绪曲线、画面细节、伏笔钩子需要合并成一个可写作章纲时使用；适用于汇总章纲、完整章纲、合并章纲、可写作章纲等请求；应在主要组件存在后使用。\r
---\r
\r
# 章纲汇总\r
\r
## 核心原则\r
\r
最终章纲要短到能直接拿来写，又完整到不容易写散。它必须显示本章发生什么变化、读者感受到什么、读者记住什么画面，以及为什么继续看下一章。\r
\r
汇总时必须对齐上级目录的 \`CHAPTER_OUTLINE_STANDARD.md\`。如果输入组件只包含旧版简版细纲字段，先补齐缺失项，再输出章纲。\r
\r
## 必要输入\r
\r
- 上章承接和当前状态\r
- 章节定位\r
- 浓缩剧情和关键词条件\r
- 核心事件因果链\r
- 四段式章纲\r
- 情绪曲线\r
- 爽点与看点\r
- 关键信息与扩写方式\r
- 画面细节\r
- 伏笔和钩子方案\r
- 角色状态变化\r
- 设定/世界观/道具更新\r
- 下一章交接\r
\r
缺少某一部分时，先补齐或合成一版“假设稿”，并明确标注假设来源。\r
\r
## 执行步骤\r
\r
1. **合并时消除矛盾**\r
   - 章节属性、情绪曲线、核心爆点、结尾钩子必须指向同一个阅读效果。\r
\r
2. **保持可写作**\r
   - 使用具体场景指令，不写抽象建议。\r
   - 保留关键词、必要条件和必须插入线索，让写作者有材料可落笔。\r
\r
3. **检查章节价值**\r
   - 本章至少有一个可见变化。\r
   - 本章至少有一个记忆点。\r
   - 本章必须有一个继续阅读的理由。\r
\r
4. **处理连续章节交接**\r
   - 如果输出多章，每章末尾都写明“交给下一章的问题”。\r
   - 下一章开头必须承接上一章钩子，不能另起一套无关冲突。\r
\r
## 输出格式\r
\r
\`\`\`\r
# 章纲-第001章：{章节标题}\r
\r
## 1. 基础信息\r
\r
## 2. 上章承接\r
\r
## 3. 本章定位\r
\r
## 4. 浓缩剧情\r
\r
## 5. 核心事件链\r
\r
## 6. 关键词与必要条件\r
\r
## 7. 四段式章纲\r
\r
## 8. 情绪曲线\r
\r
## 9. 爽点与看点\r
\r
## 10. 关键信息与扩写方式\r
\r
## 11. 画面细节\r
\r
## 12. 伏笔与钩子\r
\r
## 13. 出场角色与状态变化\r
\r
## 14. 设定/世界观/道具更新\r
\r
## 15. 写作约束\r
\r
## 16. 下一章交接\r
\r
## 17. 写作检查清单\r
\r
- [ ] 三行内入戏\r
- [ ] 本章有变化\r
- [ ] 核心事件链有因果\r
- [ ] 一个核心记忆点\r
- [ ] 至少一个动作微细节\r
- [ ] 至少一个爽点/看点/情绪触动点\r
- [ ] 回收一个旧信息或旧问题\r
- [ ] 埋下一个新信息或新问题\r
- [ ] 结尾有明确追读钩子\r
- [ ] 已写明下一章交接\r
\`\`\`\r
\r
## 边界\r
\r
- 不写完整正文，除非用户明确要求。\r
- 不扩展成全书大纲。\r
- 不隐藏缺失组件；缺什么就标注假设。\r
- 不输出只有摘要、没有行动指令的章纲。\r
`,ke=`---\r
name: chapter-outline-builder\r
description: 当用户需要把小说大纲、分卷大纲、上一章状态或一个章节灵感整理成可写作的单章章纲时使用；适用于章纲、单章细纲、章节推进、下一章怎么写、这一章怎么写等请求；不用于全书大纲或正文润色。\r
---\r
\r
# 章纲总控\r
\r
## 核心原则\r
\r
章纲是小说的单章执行单元。它要回答四件事：这一章让读者感受到什么、剧情发生什么变化、读者记住什么、为什么继续看下一章。\r
\r
完整输出必须遵循上级目录的 \`CHAPTER_OUTLINE_STANDARD.md\`。旧称“细纲”的单章内容统一升级为“章纲”，文件名使用 \`章纲-第001章.md\` 这类格式。\r
\r
## 调用顺序\r
\r
始终按顺序调用或手动执行以下技能。用户已经提供的部分可以复用，但最终必须进入 \`chapter-outline-assembler\` 汇总。\r
\r
| 顺序 | 技能 | 产出 |\r
|---|---|---|\r
| 1 | \`chapter-attribute-positioning\` | 情绪标签、章节属性、主线承接、主线推进、人物变化、追读目的 |\r
| 2 | \`chapter-keyword-conditions\` | 浓缩剧情、关键词、必要条件、必须插入的信息 |\r
| 3 | \`chapter-four-beat-flow\` | 开篇入戏、中段冲突、核心爆点、强钩收尾 |\r
| 4 | \`chapter-emotion-curve\` | 开局情绪、中段变化、峰值爆发、结尾沉淀 |\r
| 5 | \`chapter-visual-detail\` | 环境细节、动作微细节、信息暗线细节 |\r
| 6 | \`chapter-foreshadow-hook\` | 回收旧伏笔、预埋新伏笔、结尾强钩子 |\r
| 7 | \`chapter-outline-assembler\` | 完整章纲和写作检查清单 |\r
\r
## 必要输入\r
\r
- 上一章结尾状态\r
- 当前大纲阶段目标\r
- 本章想完成的剧情进度\r
- 主角当前处境和情绪\r
- 需要回收或埋下的伏笔\r
- 下一章希望读者期待什么\r
\r
## 缺失信息处理\r
\r
缺失信息不多时，最多问 3 个短问题。用户想快速推进时，直接做“明确标注的假设”，不要卡住。\r
\r
优先补齐这三类信息：\r
\r
1. 上一章结尾留下了什么问题。\r
2. 本章必须发生什么变化。\r
3. 结尾要让读者期待什么。\r
\r
## 连续章节处理\r
\r
用户要求连续生成多章章纲时，逐章重复完整流程。每章都要保留：\r
\r
- 上一章钩子的承接。\r
- 本章的独立变化。\r
- 下一章的新钩子。\r
- 旧伏笔和新伏笔的交接关系。\r
\r
不要把多章写成一个拉长的剧情摘要；每章都必须有自己的情绪标签、章节属性、核心记忆点和追读理由。\r
\r
## 最终交付要求\r
\r
输出中文章纲，必须包含：\r
\r
- 基础信息和文件命名\r
- 上章承接\r
- 本章一句话目标\r
- 情绪标签和章节属性\r
- 本章推进定位\r
- 核心事件因果链\r
- 浓缩剧情和关键词\r
- 四段式章纲\r
- 情绪曲线\r
- 爽点与看点\r
- 关键信息与扩写方式\r
- 画面细节\r
- 伏笔和钩子\r
- 出场角色与状态变化\r
- 设定/世界观/道具更新\r
- 写作约束\r
- 下一章交接\r
- 写作检查清单\r
\r
## 质量门\r
\r
交付前逐项检查：\r
\r
- 三行内能入戏。\r
- 本章至少有一个明确变化。\r
- 有一个核心记忆点。\r
- 至少有一个动作微细节。\r
- 至少回收一个旧信息或旧问题。\r
- 至少埋下一个新信息或新问题。\r
- 结尾有明确追读钩子。\r
- 浓缩剧情、关键词、必要条件能支撑正文写作。\r
- 关键信息与扩写方式已经区分“传递什么信息”和“如何写成场景”。\r
- 上章承接和下一章交接都存在，连续章节不会断档。\r
- 角色入场状态、结束状态和关系变化能支持后续状态更新。\r
\r
## 边界\r
\r
- 不直接写正文，除非用户明确要求。\r
- 不把解释说明写成整章主体。\r
- 不让过渡章变成“什么都没发生”。\r
- 浓缩剧情和必要条件不清楚时，不进入四段式拆分。\r
- 除非用户明确要求安静收束，否则不要用睡觉、离场、完全解决作为结尾。\r
- 一章只保留一个主属性，不要同时承担铺垫、高潮、反转、过渡等所有功能。\r
`,Ae=`---\r
name: chapter-visual-detail\r
description: 当章纲或场景缺少画面感、具体细节、动作微细节、环境情绪或信息暗线时使用；适用于画面感、细节、动作细节、环境细节、暗线细节、写得空等请求；不单独用于抽象剧情规划。\r
---\r
\r
# 画面细节\r
\r
## 核心原则\r
\r
读者需要看到画面，而不只是读到解释。画面感来自三类细节：环境细节、动作微细节、信息暗线细节。\r
\r
## 三类细节\r
\r
| 类型 | 作用 | 用法示例 |\r
|---|---|---|\r
| 环境细节 | 托住情绪和处境 | 暴雨压抑、烛火摇晃、长街空冷 |\r
| 动作微细节 | 用身体表现心理 | 攥拳、指尖发白、肩膀轻颤、避开视线 |\r
| 信息暗线细节 | 隐藏线索和伏笔 | 异常物件、破绽、旁人一句无心台词 |\r
\r
## 执行步骤\r
\r
1. **用可观察行为替代抽象心理**\r
   - 弱：“他很生气。”\r
   - 强：“他低着头，指节一点点收紧，指尖泛白。”\r
\r
2. **让环境绑定情绪**\r
   - 不写装饰性天气；环境要形成压力、反差或情绪揭示。\r
   - 优先使用章节关键词里已经暗示的环境。\r
\r
3. **把有用信息藏进细节**\r
   - 让读者回头看时觉得“原来如此”。\r
   - 使用关键词条件里的必须插入线索和道具。\r
\r
4. **每章至少放一个动作微细节**\r
   - 优先放在情绪转折或核心爆点附近。\r
   - 最强微细节放在峰值或反转处。\r
\r
## 输出格式\r
\r
\`\`\`\r
## 画面细节\r
\r
### 环境细节\r
\r
### 动作微细节\r
\r
### 信息暗线细节\r
\r
### 可替换的抽象心理描写\r
\`\`\`\r
\r
## 常见问题\r
\r
- 解释情绪，而不是展示情绪。\r
- 加入无关风景，不能影响气氛。\r
- 场景里没有任何隐藏信息。\r
- 核心爆点只靠内心独白完成。\r
`,je=`﻿---\r
name: anti-ai-polish\r
description: Use when revising fiction to reduce AI-like prose, template phrasing, explanatory narration, generic summaries, or mechanical emotional writing.\r
---\r
\r
# 去 AI 味精修\r
\r
## 适用范围\r
\r
正文精修、短篇精修、去模板句、去解释腔、保留情绪和剧情。\r
\r
## 删除优先级\r
\r
1. 删除“这说明、这意味着、由此可见”等替读者总结。\r
2. 删除泛泛升华和机械排比。\r
3. 删除角色替作者解释设定的对话。\r
4. 删除无动作支撑的情绪词，以及“他此时非常愤怒”这类标签句。\r
5. 删除“仿佛整个世界都...”这类空泛氛围句。\r
6. 删除同一层意思的第二遍、第三遍：重复气氛、重复心理、重复打趣赶路。热闹不等于进展；原文没有进展，就压缩重复，不编进展。\r
7. 细节过不了三问（情感偏向 / 人设更立体 / 后文反转更站得住）且不是设定或伏笔的，删。\r
8. 整章只剩对线循环、独白绕圈或打斗无信息时，把原文已有的动作、对话、环境、心理穿插起来，不补新镜头。\r
\r
## 保留原则\r
\r
- 保留剧情事件、人物选择、伏笔信息和情绪烈度。\r
- 短篇可以保留主观审判句，只删无具体对象的空话。\r
- 空修饰压到具体动作，有效意象保留；不要按比喻数量硬砍。\r
- 修改后只输出正文，不解释已修改什么。\r
\r
\r
`,Me=`﻿---\r
name: combat-action\r
description: Use when writing combat, action scenes, duels, power display, tactical fights, or high-martial battle chapters.\r
---\r
\r
# 战斗与动作\r
\r
## 适用范围\r
\r
玄幻战斗、都市高武、动作戏、追逐、对决、比赛、打脸场景。\r
\r
## 战斗流程\r
\r
1. 目标：双方为什么打。\r
2. 差距：力量、信息、环境、资源差异。\r
3. 试探：第一轮行动暴露能力边界。\r
4. 变化：误判、底牌、环境利用或第三方介入。\r
5. 代价：伤势、消耗、身份暴露、资源损失。\r
6. 结果：胜负如何改变关系和主线。\r
\r
## 写作要求\r
\r
- 不只写招式名，要写动作、反应和结果。\r
- 爽点来自策略和反转，不只是数值更高。\r
- 围观反应要分层，不要全部喊“怎么可能”。\r
\r
\r
`,Ne=`﻿---\r
name: dialogue-emotion\r
description: Use when writing or revising dialogue, emotional beats, subtext, relationship tension, or character voice in fiction.\r
---\r
\r
# 对话与情绪\r
\r
## 适用范围\r
\r
对话、潜台词、情绪外化、关系拉扯、角色声线。\r
\r
## 对话规则\r
\r
1. 每句对话至少承担一个功能：试探、拒绝、隐瞒、攻击、安抚、推进信息。\r
2. 不让角色替作者解释设定。\r
3. 不同角色说话方式要有身份、关系、情绪差异。\r
4. 潜台词优先，能用动作和停顿表达的不要全说出来。\r
\r
## 情绪外化\r
\r
- 情绪词后必须接具体动作、物件或场景反应。\r
- 激烈情绪写短句和动作，沉淀情绪写具体细节。\r
- 不用“他很难过”结束段落，要写难过如何改变行动。\r
\r
\r
`,Pe=`﻿---\r
name: long-form-drafting\r
description: Use when writing long-form serial-fiction chapters from confirmed outlines, chapter outlines, previous chapter endings, or serial continuity constraints.\r
---\r
\r
# 长篇正文写作\r
\r
## 适用范围\r
\r
长篇正文、连载章节、按章纲写正文、承接上一章、推进主线。\r
\r
## 写作规则\r
\r
1. 先读取已确认章纲，严格遵循本章目标、核心事件、场景顺序和章尾钩子。\r
2. 开篇承接上一章人物位置、情绪、未解决事件和钩子。\r
3. 每个场景都要推进事件、人物或伏笔，不能只写气氛。\r
4. 爽点、虐点、信息点要有节奏，不要一章平铺。\r
5. 结尾必须制造下一章期待。\r
\r
## 禁止\r
\r
- 改写已确认章纲主事件。\r
- 临时新增万能设定解决冲突。\r
- 输出分析、说明、写作过程或 Skill 名称。\r
\r
`,Fe=`﻿---\r
name: short-form-drafting\r
description: Use when writing short fiction, Zhihu-style stories, emotional reversal shorts, or compact three-act story drafts.\r
---\r
\r
# 短篇正文写作\r
\r
## 适用范围\r
\r
知乎短篇、世情短篇、情绪反转短篇、短篇正文、小节式正文。\r
\r
## 写作规则\r
\r
1. 开头快速建立冲突或反常事实。\r
2. 三幕结构：建压、爆点、落定。\r
3. 情绪宁可明确，不要中性旁白。\r
4. 每小节有一个目标情绪和一个信息变化。\r
5. 结尾收束最关键情绪，不写长篇解释。\r
\r
## 格式要求\r
\r
- 输出纯正文。\r
- 小节之间保持清楚承接。\r
- 不输出创作说明、自检报告或模板标题。\r
\r
\r
`,B={writing:`skill-category:writing`,outline:`skill-category:outline`,setting:`skill-category:setting`,character:`skill-category:character`,worldbuilding:`skill-category:worldbuilding`,faction:`skill-category:faction`,foreshadowing:`skill-category:foreshadowing`,map:`skill-category:map`,topic:`skill-category:topic`},Ie=[{id:B.writing,name:`正文`},{id:B.outline,name:`大纲`},{id:B.setting,name:`设定`},{id:B.character,name:`角色`},{id:B.worldbuilding,name:`世界观`},{id:B.faction,name:`势力`},{id:B.foreshadowing,name:`伏笔`},{id:B.map,name:`地图`},{id:B.topic,name:`题材`}],Le=new Map(Object.entries(B).map(([e,t])=>[t,e])),V={writing:[`正文`,`去ai`,`去AI`,`改写`,`润色`,`场景描写`,`对话`,`转场`,`情绪渲染`,`金句`],outline:[`大纲`,`卷纲`,`章纲`,`细纲`,`章节计划`,`下一章计划`,`章节承接`,`承接`,`主线`,`剧情`,`节奏`,`钩子`,`悬念`,`冲突`],setting:[`设定`,`规则`,`体系`,`素材`,`能力`,`金手指`],character:[`人物`,`角色`,`男主`,`女主`,`男配`,`女配`,`反派`,`动机`,`出场`],worldbuilding:[`世界观`,`世界规则`,`世界构建`],faction:[`势力`,`组织`,`阵营`,`门派`,`家族`],foreshadowing:[`伏笔`,`线索`,`回收`],map:[`地图`,`地点`,`换地图`,`新地图`],topic:[`题材`,`男频`,`女频`,`玄幻`,`修仙`,`都市`,`系统流`,`规则怪谈`,`悬疑`,`世情`,`知乎短篇`,`豪门`,`总裁`,`追妻`]},H=[`worldbuilding`,`foreshadowing`,`character`,`faction`,`map`,`setting`,`topic`,`outline`,`writing`];function U(e){let t=Le.get(e.categoryId);if(t)return t;let n=[e.name,...e.tags].join(`
`);for(let e of H)if(V[e].some(e=>n.includes(e)))return e;for(let t of H)if(V[t].some(t=>e.description.includes(t)))return t;return null}function Re(e,t){return e.filter(e=>U(e)===t)}function ze(e,t){let n=new Set(t);return e.filter(e=>{let t=U(e);return t?n.has(t):!1})}var Be=Object.assign({"../../../skills/SkillHub/DagangSkill/outline-final-assembler/SKILL.md":o,"../../../skills/SkillHub/DagangSkill/outline-master-builder/SKILL.md":s,"../../../skills/SkillHub/DagangSkill/outline-supporting-cast/SKILL.md":c,"../../../skills/SkillHub/DagangSkill/protagonist-plot-fit/SKILL.md":l,"../../../skills/SkillHub/DagangSkill/story-goal-ladder/SKILL.md":ee,"../../../skills/SkillHub/DagangSkill/story-plot-seed/SKILL.md":te,"../../../skills/SkillHub/DagangSkill/story-selling-point/SKILL.md":ne,"../../../skills/SkillHub/DagangSkill/worldbuilding-outline-last/SKILL.md":re,"../../../skills/SkillHub/JueseSkill/character-design/SKILL.md":ie,"../../../skills/SkillHub/JueseSkill/relationship-emotion/SKILL.md":ae,"../../../skills/SkillHub/JueseSkill/supporting-cast/SKILL.md":oe,"../../../skills/SkillHub/QualitySkill/outline-quality-check/SKILL.md":se,"../../../skills/SkillHub/SheDingSkill/faction-system/SKILL.md":ce,"../../../skills/SkillHub/SheDingSkill/foreshadowing-suspense/SKILL.md":le,"../../../skills/SkillHub/SheDingSkill/idea-market-positioning/SKILL.md":ue,"../../../skills/SkillHub/SheDingSkill/map-progression/SKILL.md":de,"../../../skills/SkillHub/SheDingSkill/power-system/SKILL.md":fe,"../../../skills/SkillHub/SheDingSkill/world-rules/SKILL.md":pe,"../../../skills/SkillHub/TicaiSkill/entertainment-livestream-esports/SKILL.md":me,"../../../skills/SkillHub/TicaiSkill/family-drama-short/SKILL.md":u,"../../../skills/SkillHub/TicaiSkill/farming-business-adventure/SKILL.md":d,"../../../skills/SkillHub/TicaiSkill/female-book-transmigration/SKILL.md":f,"../../../skills/SkillHub/TicaiSkill/female-chasing-wife/SKILL.md":p,"../../../skills/SkillHub/TicaiSkill/female-family-pampering-child/SKILL.md":m,"../../../skills/SkillHub/TicaiSkill/female-farming-business/SKILL.md":h,"../../../skills/SkillHub/TicaiSkill/female-house-palace/SKILL.md":g,"../../../skills/SkillHub/TicaiSkill/female-modern-romance/SKILL.md":_,"../../../skills/SkillHub/TicaiSkill/female-mystery-republic/SKILL.md":v,"../../../skills/SkillHub/TicaiSkill/female-period-rebirth/SKILL.md":y,"../../../skills/SkillHub/TicaiSkill/female-possessive-romance/SKILL.md":b,"../../../skills/SkillHub/TicaiSkill/female-rebirth-revenge/SKILL.md":x,"../../../skills/SkillHub/TicaiSkill/female-rich-family-ceo/SKILL.md":S,"../../../skills/SkillHub/TicaiSkill/female-secret-love-reunion/SKILL.md":C,"../../../skills/SkillHub/TicaiSkill/female-substitute-romance/SKILL.md":w,"../../../skills/SkillHub/TicaiSkill/female-workplace-youth-sweet/SKILL.md":T,"../../../skills/SkillHub/TicaiSkill/female-xuanhuan-fantasy/SKILL.md":E,"../../../skills/SkillHub/TicaiSkill/male-beast-taming/SKILL.md":D,"../../../skills/SkillHub/TicaiSkill/male-behind-the-scenes/SKILL.md":O,"../../../skills/SkillHub/TicaiSkill/male-history-alt-history/SKILL.md":k,"../../../skills/SkillHub/TicaiSkill/male-infinite-sci-fi-apocalypse/SKILL.md":A,"../../../skills/SkillHub/TicaiSkill/male-longevity-flow/SKILL.md":j,"../../../skills/SkillHub/TicaiSkill/male-lord-building/SKILL.md":M,"../../../skills/SkillHub/TicaiSkill/male-mortal-cultivation/SKILL.md":N,"../../../skills/SkillHub/TicaiSkill/male-simulator-loop/SKILL.md":P,"../../../skills/SkillHub/TicaiSkill/male-son-in-law-counterattack/SKILL.md":F,"../../../skills/SkillHub/TicaiSkill/male-urban-highmartial/SKILL.md":I,"../../../skills/SkillHub/TicaiSkill/male-urban-system/SKILL.md":L,"../../../skills/SkillHub/TicaiSkill/male-villain-protagonist/SKILL.md":R,"../../../skills/SkillHub/TicaiSkill/male-xuanhuan-xianxia/SKILL.md":z,"../../../skills/SkillHub/TicaiSkill/rule-mystery-suspense/SKILL.md":he,"../../../skills/SkillHub/TicaiSkill/short-death-regret/SKILL.md":ge,"../../../skills/SkillHub/TicaiSkill/short-marriage-betrayal/SKILL.md":_e,"../../../skills/SkillHub/TicaiSkill/short-public-trial-face-slap/SKILL.md":ve,"../../../skills/SkillHub/TicaiSkill/short-rebirth-revenge/SKILL.md":ye,"../../../skills/SkillHub/TicaiSkill/short-soul-perspective/SKILL.md":be,"../../../skills/SkillHub/TicaiSkill/western-fantasy-cosmic-dark/SKILL.md":xe,"../../../skills/SkillHub/TicaiSkill/zhihu-short/SKILL.md":Se,"../../../skills/SkillHub/ZhanggangSkill/chapter-attribute-positioning/SKILL.md":Ce,"../../../skills/SkillHub/ZhanggangSkill/chapter-emotion-curve/SKILL.md":we,"../../../skills/SkillHub/ZhanggangSkill/chapter-foreshadow-hook/SKILL.md":Te,"../../../skills/SkillHub/ZhanggangSkill/chapter-four-beat-flow/SKILL.md":Ee,"../../../skills/SkillHub/ZhanggangSkill/chapter-keyword-conditions/SKILL.md":De,"../../../skills/SkillHub/ZhanggangSkill/chapter-outline-assembler/SKILL.md":Oe,"../../../skills/SkillHub/ZhanggangSkill/chapter-outline-builder/SKILL.md":ke,"../../../skills/SkillHub/ZhanggangSkill/chapter-visual-detail/SKILL.md":Ae,"../../../skills/SkillHub/ZhengwenSkill/anti-ai-polish/SKILL.md":je,"../../../skills/SkillHub/ZhengwenSkill/combat-action/SKILL.md":Me,"../../../skills/SkillHub/ZhengwenSkill/dialogue-emotion/SKILL.md":Ne,"../../../skills/SkillHub/ZhengwenSkill/long-form-drafting/SKILL.md":Pe,"../../../skills/SkillHub/ZhengwenSkill/short-form-drafting/SKILL.md":Fe});function Ve(e){let t=e.match(/^\uFEFF?---\s*\n([\s\S]*?)\n---\s*\n?/);if(!t)return null;let n=t[1],r=n.match(/^name:\s*(.+?)\s*$/m)?.[1]?.trim(),i=n.match(/^description:\s*(.+?)\s*$/m)?.[1]?.trim();return!r||!i?null:{name:r,description:i}}function W(e){return e.replace(/\\/g,`/`).match(/SkillHub\/([^/]+)\//)?.[1]??``}function He(e,t){let n=W(e);return n===`DagangSkill`||n===`ZhanggangSkill`||n===`QualitySkill`?B.outline:n===`TicaiSkill`?B.topic:n===`JueseSkill`?B.character:n===`ZhengwenSkill`?B.writing:n===`SheDingSkill`?t.includes(`world-rules`)?B.worldbuilding:t.includes(`faction`)?B.faction:t.includes(`foreshadowing`)?B.foreshadowing:t.includes(`map`)?B.map:B.setting:``}function Ue(e){let t=W(e);return t===`DagangSkill`?{kind:[`planning`,`structure`],stages:[`planning`,`output`],priority:12}:t===`ZhanggangSkill`?{kind:[`planning`,`structure`],stages:[`planning`,`output`],priority:14}:t===`TicaiSkill`?{kind:[`knowledge`,`planning`],stages:[`planning`],priority:18}:t===`QualitySkill`?{kind:[`planning`,`output`],stages:[`planning`,`output`],priority:16}:t===`ZhengwenSkill`?{kind:[`style`,`output`],stages:[`drafting`,`output`],priority:28}:{kind:[`knowledge`,`structure`],stages:[`planning`],priority:24}}var G=Object.entries(Be).map(([e,t])=>{let n=Ve(t);if(!n)return null;let r=Ue(e);return i({id:`skillhub:${n.name}`,name:n.name,description:n.description,kind:r.kind,stages:r.stages,modes:[`standard`,`strict`],content:t,source:`built-in`,priority:r.priority,tags:[W(e),n.name],categoryId:He(e,n.name)})}).filter(e=>!!e).sort((e,t)=>e.id.localeCompare(t.id)),K=a(G.map(e=>e.name));K.length>0&&console.error(`Skill 路由注册表包含不存在的 SkillHub 名称：`,K);var q=[i({id:`builtin:chapter-connection`,name:`章节承接`,description:`检查上一章结尾、人物状态、未解决事件和必须承接的情绪，提供承接强度分级和补强方法。`,kind:[`structure`],stages:[`planning`],modes:[`standard`,`strict`],content:`# 章节承接

## 核心目标

确保本章与上一章在人物、情节、情绪、设定四个维度上无缝衔接，避免出现"两章之间像断了一截"的阅读体验。

## 适用场景

- 每次开始写新一章正文前
- 上一章结尾有强悬念、强情绪或关键事件时
- 章节间时间跳跃或场景切换后

## 承接清单

逐项检查与上一章的衔接状态：

1. **人物位置**：上一章结束时每个人物在哪里？本章开头是否合理延续？
2. **人物情绪**：上一章结尾人物处于什么情绪状态？本章开头是否保持了情绪连续性？（情绪不会凭空消失，只能被新事件覆盖或转移）
3. **未解决事件**：上一章是否留下了未完成的对话、未做出的决定、未到达的目的地？本章是否该处理？
4. **道具/线索**：上一章出现的重要物品或线索，是否需要在开头提及或推进？
5. **时间线**：本章与上一章的时间间隔是多少？如果跳过了时间，需要交代跳过了什么。
6. **伏笔状态**：上一章埋了哪些伏笔？本章是否需要推进或暗示？
7. **章节钩子**：上一章结尾的钩子（悬念/反转/危机）是否被本章开头承接？

## 承接强度分级

- **强承接**：紧接上一章结尾，时间连续、场景连续。适用于高潮后的余波、关键对话未完、危机尚未解除。
- **中承接**：时间跳跃数小时到一天，通过简短回忆或状态描述自然过渡。适用于日常章节之间的切换。
- **弱承接**：时间跳跃数天以上，或场景大幅切换。需要用一个小的过渡段落交代"这段时间发生了什么"，但不要写成流水账。

## 弱承接补强方法

当无法强承接时，用以下方式补强衔接感：

1. **锚点回扣**：用一个细节（同一件物品、同一句话的余音、同一个身体感受）回扣上一章。
2. **情绪余波**：即使场景变了，人物的情绪应延续上一章的余波，再被新事件覆盖。
3. **因果链**：明确写出"因为上一章发生了X，所以本章出现Y"，哪怕是隐式的。
4. **钩子回收**：如果上一章结尾有钩子，本章必须在某个位置（不必是开头）回收。

## 禁止做法

- 上一章结尾人物在激烈冲突中，本章开头直接跳到平静日常，中间没有过渡
- 无视上一章埋下的伏笔和钩子，直接开新剧情
- 人物位置和情绪出现"跳跃"，上一章在A地愤怒，本章在B地平静，没有交代原因`,source:`built-in`,priority:25,tags:[`衔接`,`承接`]}),i({id:`builtin:next-chapter-plan`,name:`下一章计划`,description:`生成包含目标、冲突、人物、事件、情绪、伏笔、钩子的完整章节计划。`,kind:[`planning`],stages:[`planning`],modes:[`standard`,`strict`],content:`# 下一章计划

## 核心目标

在本章正文动笔之前，生成一份结构化、可执行的章节计划，明确本章要写什么、为什么写、怎么写。这不仅是提纲，更是对"这一章存在的理由"的确认。

## 适用场景

- 每次开始写新章节正文前
- 上一章写完后，需要规划下一章时
- 长篇小说中需要定期检查章节方向时

## 输入依赖

制定计划前，需要先读取以下信息：

1. 上一章结尾状态（人物、情绪、事件、钩子）
2. 当前故事主线进度
3. 已埋设的伏笔清单
4. 灵魂文档（soul.md）中的风格要求

## 生成步骤

按以下顺序逐步生成计划：

### 步骤1：确定本章目标
本章要达成的核心结果是什么？选一个最核心的：
- 推进主线（主角离目标更近/更远）
- 揭示信息（读者/角色知道了什么新东西）
- 人物成长（某个角色发生了什么变化）
- 制造转折（故事方向发生改变）
- 铺垫伏笔（为后续剧情打基础）

### 步骤2：确定核心冲突
本章的核心矛盾是什么？冲突必须具体、可感知：
- 人与人之间的冲突（利益、价值观、情感）
- 人与环境的冲突（规则、压力、资源限制）
- 人与自我的冲突（选择、信念、恐惧）

### 步骤3：列出出场人物
每个出场人物明确三件事：
- 他/她本章想要什么？
- 他/她做了什么来得到它？
- 他/她的行动如何影响主角或主线？

### 步骤4：安排关键事件顺序
按时间顺序列出本章的关键事件，每件事包含：
- 发生了什么（行为）
- 为什么发生（动因）
- 导致什么结果（后果，推动下一事件）

### 步骤5：设计情绪曲线
本章的情绪走向：
- 开头情绪基调是什么？
- 中间情绪如何变化？（上升/下降/波动）
- 结尾情绪落点在哪里？（给读者的感受）

### 步骤6：推进伏笔
- 本章需要推进哪些已有伏笔？
- 是否需要在暗中埋设新伏笔？
- 是否有伏笔到了该回收的时机？

### 步骤7：设计结尾钩子
本章结尾用什么方式让读者想继续看下一章？
- 选择钩子类型（悬念/反转/危机/情绪/关系变化）
- 钩子放在最后一句还是最后一段？

## 质量标准

好的章节计划应该满足：
- 每个事件都有明确的因果驱动，不是"发生了A然后发生了B"，而是"因为A所以B"
- 每个出场人物都推动了剧情或展现了性格，没有工具人
- 情绪曲线有起伏，不是从头平到尾
- 结尾有钩子，让读者有"下一章必须看"的冲动
- 本章内容服务于主线或重要支线，不是"水字数"

## 常见陷阱

- 计划太满：塞了太多事件，每个都写不深。一章只聚焦1-2个核心事件
- 计划太虚：只有"冲突升级""情绪推进"等抽象描述，没有具体内容
- 忽略节奏：一味推进事件，没有给人物反应、环境描写、心理活动留空间
- 结尾无力：事件写完了就结束，没有设计钩子`,source:`built-in`,priority:20,tags:[`计划`,`大纲`]}),i({id:`builtin:mainline-check`,name:`主线检查`,description:`诊断本章是否偏离主线，识别偏航类型并给出纠正建议。`,kind:[`structure`,`review`],stages:[`review`,`planning`],modes:[`strict`],content:`# 主线检查

## 核心目标

诊断本章内容是否服务于故事主线，识别"写偏了"的风险，并给出具体纠正建议。主线检查不是审稿，不做文笔评价，只判断"这章对主线有没有贡献"。

## 适用场景

- 章节计划完成后、正文动笔前
- 正文初稿完成后、精修前
- 写到中段感觉"好像跑偏了"时
- 支线剧情较多时，定期检查

## 诊断维度

从以下四个维度逐一检查本章内容：

### 维度1：主角目标推进
- 本章是否让主角离核心目标更近或更远？
- 如果主角没有出现，本章推进的是哪个关键角色的目标？
- 本章内容是否可以删除而不影响主角的主线？如果可以，那就是偏航。

### 维度2：主要冲突进展
- 本章是否涉及故事的核心冲突（主要对手/主要障碍/主要问题）？
- 冲突是否有实质进展（升级/转折/揭示新信息/改变力量对比）？
- 如果冲突维持原样没有推进，至少是否揭示了新的层面？

### 维度3：反派/压力源活跃度
- 反派或压力来源（可以是人、组织、环境、命运）本章是否在行动？
- 反派是否让主角的处境变得更难？如果不是，反派是否在被铺垫？
- 章内完全没有反派痕迹时，需要标记：是否在铺垫后续对抗？

### 维度4：阶段性转折
- 本章是否对故事走向产生了影响？
- 是否改变了读者对某个角色、某个事件、某个设定的认知？
- 是否产生了新的问题或收束了旧的悬念？

## 判断标准

### 主线服务度评分
- **高服务**：本章至少推进了上述4个维度中的2个，且有实质进展
- **中服务**：本章推进了至少1个维度，其余维度有铺垫
- **低服务**：本章只完成了场景过渡、气氛渲染、日常互动，对主线没有实质推进
- **无服务**：本章内容与主线无关，属于脱离主线的支线或"水章节"

### 偏航类型识别
- **支线膨胀**：支线情节占据了整章，主线被完全搁置
- **日常堆砌**：大量日常互动、场景描写，没有推进任何剧情
- **信息重复**：本章在重复读者已知的信息，没有新进展
- **铺垫过度**：为后续剧情铺垫太多，反而忘了本章本身该有内容
- **视角游离**：频繁切换视角，但没有一个视角在推进主线

## 纠正建议

针对不同偏航类型给出具体建议：

- **支线膨胀**：支线应该服务于主线。如果支线独立于主线，将其压缩为半章或更短，或推迟到主线需要时再写
- **日常堆砌**：日常互动只有在揭示人物关系变化或世界观时才有效。无效日常直接删除
- **信息重复**：确认本章是否有新的信息增量。如果没有，这章需要重写
- **铺垫过度**：铺垫应该是"边推进边铺垫"，不应单独占用一章。将铺垫融入主线事件中
- **视角游离**：选择与主线最相关的1-2个视角，其余视角的观察可以合并或后置

## 输出要求

检查结果以简洁的结论呈现：
- 如果不偏航：标注"主线服务度：高/中"
- 如果偏航：标注偏航类型 + 具体表现 + 纠正建议
- 不要输出长篇分析，只给关键判断`,source:`built-in`,priority:30,tags:[`主线`,`检查`]}),i({id:`builtin:character-motivation`,name:`人物动机`,description:`用动机三角模型检查人物行为的内在驱动力，防止OOC和工具人。`,kind:[`structure`],stages:[`planning`,`review`],modes:[`standard`,`strict`],content:`# 人物动机

## 核心目标

确保每个出场人物的行为都有内在驱动力，而非"因为剧情需要"。人物动机检查帮助作者发现"工具人行为"和"OOC（角色崩坏）"风险，让人物的每个选择都经得起推敲。

## 适用场景

- 章节计划阶段，安排人物行动前
- 正文完成后，检查人物行为是否合理
- 人物做出重大决定或转折时
- 多个角色互动时，确保各自有独立动机

## 动机三角模型

每个角色的每个行为，都应能从以下三个维度中找到至少一个驱动力：

### 1. 想要（Want）
人物当前最直接的目标是什么？
- 短期目标：本章内他想得到什么？
- 具体可感：不是抽象的"成功"，而是"拿到那封信""让某人相信自己"
- 可验证：读者能判断他是否达成了目标

### 2. 害怕（Fear）
人物害怕失去什么？害怕发生什么？
- 核心恐惧：他最深层的恐惧是什么？（背叛、孤独、失控、被遗忘、失去某人）
- 当前触发：本章的什么事件触发了这个恐惧？
- 防御行为：他为了不让自己害怕的事发生，会做什么？

### 3. 信念（Belief）
人物相信什么？即使这个信念可能是错的。
- 关于自己：他认为自己是什么样的人？（"我必须保护所有人""我不配被爱"）
- 关于世界：他认为世界是什么样的？（"弱肉强食""好人会有好报"）
- 关于他人：他对关键人物的判断是什么？（"他不可信""她比我强"）

## 行为-动机匹配检验

对本章每个人物的每个重要行为，做以下检验：

1. **行为是什么？** —— 具体描述人物的行动
2. **为什么这么做？** —— 从想要/害怕/信念中找到驱动源
3. **有没有更好的选择？** —— 在当前情境下，人物是否有其他合理选择？如果有，为什么选择了这个？
4. **与前文一致吗？** —— 这个行为是否符合已建立的人物性格？如果不符合，是否有充分的事件触发变化？

## 动机冲突处理

当多个人物互动时，动机冲突是戏剧张力的核心来源：

1. **目标冲突**：A想要X，B也想要X，但X只有一个 → 直接对抗
2. **方式冲突**：A和B目标一致，但对"怎么达成"有分歧 → 合作中的摩擦
3. **信息不对称**：A知道B不知道的信息，导致两人做出不同判断 → 误解与揭示
4. **价值冲突**：A认为X是对的，B认为X是错的 → 深层立场对立

## 常见问题及处理

- **工具人行为**：人物的行为只服务于剧情需要，没有自身动机。→ 给人物补充一个独立的"想要"
- **动机过强**：一个小事件引发了过度的情绪反应。→ 确认是否有积累的触发，如果没有，降低反应强度
- **动机突变**：人物的目标和行为突然改变，没有过渡。→ 加入触发事件和内心挣扎
- **动机单一**：人物只有一个驱动力，行为扁平。→ 引入"想要"和"害怕"的冲突，让人物面临两难
- **动机模糊**：读者不知道人物为什么这么做。→ 不一定要明说，但作者心里必须有答案

## 输出要求

- 不输出长篇心理分析报告
- 如果发现动机问题，直接指出：哪个角色、哪个行为、缺失什么动机、建议补什么
- 如果没有问题，不强制输出检查结果`,source:`built-in`,priority:30,tags:[`人物`,`动机`,`OOC检查`]}),i({id:`builtin:conflict-escalation`,name:`冲突升级`,description:`从五个层次构建冲突，设计升级路径，控制冲突节奏，确保章节有足够张力。`,kind:[`structure`],stages:[`planning`,`drafting`],modes:[`standard`,`strict`],content:`# 冲突升级

## 核心目标

确保本章有足够的矛盾和张力，让读者感到"有事正在发生"，而非平淡推进。冲突升级不是让每章都打起来，而是让矛盾在任何层面（关系、利益、心理、环境）都在持续加压。

## 适用场景

- 章节计划阶段，设计本章的冲突结构
- 发现章节"太平""太水"时，补充冲突元素
- 连载小说中防止"中段疲软"

## 冲突的五个层次

从轻到重，选择适合本章的冲突层次：

### 层次1：内心冲突
人物内心在两种选择、两种信念、两种情感之间摇摆。
- 示例：想救人但可能暴露自己 / 想相信他但过去的经验说不
- 关键：内心冲突需要通过行为、犹豫、微表情来外化，不要只靠内心独白

### 层次2：人际冲突
人物之间因目标、价值观、信息差产生摩擦。
- 示例：队友隐瞒了关键信息 / 两人对下一步行动的分歧
- 关键：人际冲突要有"升级空间"，从轻微的摩擦到严重的对立

### 层次3：群体冲突
人物与一个群体（家族、组织、社会）产生对抗。
- 示例：被族人排斥 / 挑战组织的规则
- 关键：群体冲突要有"具体代言人"，不要让主角对着一个抽象概念

### 层次4：规则冲突
人物与世界的规则、法则、禁忌产生冲突。
- 示例：修炼体系限制 / 社会阶级固化 / 某种不可违抗的律法
- 关键：规则冲突要有"代价"，违反规则要付出实质代价

### 层次5：生存冲突
人物面临生命威胁、存在危机。
- 示例：生死战斗 / 绝境求生 / 被世界规则抹杀
- 关键：生存冲突要真实可感，不要让读者觉得"反正主角不会死"

## 升级路径

冲突不是一步到位的，好的冲突有递进：

1. **触发**：一个事件打破现有的平衡（A发现B隐瞒了信息）
2. **对峙**：双方直接碰撞（A质问B，B辩解）
3. **升级**：冲突扩展到更大的范围（A和B的裂痕影响到团队决策）
4. **代价**：冲突产生不可逆的后果（A做出了伤害B的选择）
5. **收束或继续**：冲突暂时解决或进入下一个阶段

## 冲突节奏控制

- **一章内**：不要从头紧张到尾，读者需要喘息。紧张-释放-再紧张，交替进行
- **连续几章**：冲突持续升级时，中间插入一章相对缓和的"整理章"，让读者消化信息
- **冲突强度与字数**：高强度冲突（战斗、对峙）适合短章节；低强度冲突（心理、关系）可以写长一些

## 冲突的检验标准

完成本章后检查：
1. 本章是否有至少一个冲突在推进？（内心/人际/群体/规则/生存，至少一个）
2. 冲突是否产生了实质后果？（不只是"闹了一下又和好了"）
3. 冲突是否揭示了新信息？（人物隐藏的一面 / 世界观的新层面 / 关系的真相）
4. 冲突是否让读者产生了情绪？（紧张、愤怒、担忧、期待）

## 避坑指南

- **假冲突**：人物吵了一架但不影响任何事，下一章恢复原状
- **冲突过载**：一章塞了太多冲突，每个都没写透
- **冲突扁平**：只有一种冲突类型反复出现（比如每章都在打架）
- **代价缺失**：冲突没有真正的代价，人物不需要为选择付出什么
- **冲突与主线脱节**：冲突很精彩但跟主线无关，读者看完不知道这章有什么意义`,source:`built-in`,priority:25,tags:[`冲突`,`张力`,`节奏`]}),i({id:`builtin:foreshadowing-management`,name:`伏笔管理`,description:`系统管理伏笔的埋设、推进、提示和回收全生命周期，防止挖坑不填。`,kind:[`structure`,`review`],stages:[`planning`,`review`],modes:[`strict`],content:`# 伏笔管理

## 核心目标

系统化管理故事中的伏笔，确保每个伏笔都有完整的生命周期：埋设 → 推进 → 提示 → 回收。避免出现"挖坑不填"或"伏笔遗忘"的问题。

## 适用场景

- 章节计划阶段，决定本章需要推进或回收哪些伏笔
- 正文完成后，检查本章是否遗漏了该处理的伏笔
- 长篇小说写到中期，定期盘点伏笔状态

## 伏笔生命周期

每个伏笔在故事中经历以下阶段：

### 阶段1：埋设
在读者不注意的地方留下线索。
- 要求：自然、不刻意，让读者事后回想时能发现
- 方式：对话中的一句闲话 / 环境描写中的一个细节 / 人物反常的一个小动作
- 数量控制：一章埋设1-2个新伏笔即可，过多会让读者混乱

### 阶段2：推进
在后续章节中，在不揭示真相的前提下，让伏笔"发酵"。
- 方式：重复出现但每次换个角度 / 相关角色多了一个奇怪的反应 / 环境出现更多线索
- 频率：每个伏笔每隔3-5章至少推进一次，避免读者遗忘

### 阶段3：提示
在回收前，给读者一个"即将揭晓"的信号。
- 方式：线索突然汇聚 / 人物开始接近真相 / 读者开始能拼出部分答案
- 节奏：提示不要一次性给完，分2-3次逐步释放

### 阶段4：回收
揭示伏笔的真相。
- 要求：回收必须有"原来如此"的冲击力，不能是读者早就猜到的
- 回收后：伏笔回收后，其影响应持续，不能"回收了就没了"
- 时机：伏笔的回收时机应该在最能产生戏剧效果的节点

## 伏笔密度控制

- **活跃伏笔**：当前正在推进的伏笔，建议不超过5-8个
- **休眠伏笔**：已埋设但暂不推进的伏笔，定期检查不要遗忘
- **已回收伏笔**：记录回收时间和回收后的影响

## 伏笔分类

- **信息型伏笔**：隐藏的设定、世界观、人物背景信息
- **事件型伏笔**：为后续重大事件做的铺垫
- **人物型伏笔**：隐藏的人物关系、身份、动机
- **道具型伏笔**：看似普通的物品，后续有关键作用

## 伏笔遗忘处理

如果发现某个伏笔很久没有推进：
1. 确认是否还有必要保留？如果故事方向变了，可以放弃（但要在伏笔列表注明）
2. 如果仍需保留，在最近3章内找一个自然的机会推进
3. 如果该伏笔的回收时机已过，考虑修改回收方式，不要强行回收

## 输出要求

对本章的伏笔处理给出简洁判断：
- 本章需要推进的伏笔：列出并说明如何推进
- 本章需要回收的伏笔：列出并说明回收方式
- 被遗忘的伏笔提醒：列出太久未推进的伏笔
- 不要输出完整的伏笔清单，只给与本章相关的判断`,source:`built-in`,priority:35,tags:[`伏笔`,`线索`,`回收`]}),i({id:`builtin:rhythm-check`,name:`节奏检查`,description:`诊断章节节奏问题，识别拖沓、塌陷、仓促等常见节奏病并给出治疗方案。`,kind:[`review`],stages:[`review`],modes:[`strict`],content:`# 节奏检查

## 核心目标

诊断章节的叙事节奏，识别"拖沓""平淡""塌陷"等问题，确保章节有张有弛、快慢有致。节奏检查关注的是"读者阅读体验的时间感"，而非章节本身的字数。

## 适用场景

- 正文初稿完成后
- 读者反馈"节奏太慢"或"节奏太快"时
- 章节字数正常但读起来"累"或"空"时

## 节奏曲线模型

理想的一章应该有类似"波浪"的节奏曲线：

- **开头（10%-15%）**：快速建立场景，给出本章的"钩子"，让读者知道这章要发生什么
- **发展（40%-50%）**：事件逐步推进，节奏可以稍慢，但每个段落都必须有信息增量
- **高点（15%-20%）**：本章的情绪或事件高潮，节奏加快，句子更短，张力最强
- **收尾（10%-15%）**：高潮后的余波，处理后果，设置下一章的钩子

## 节奏问题诊断

### 问题1：开头太慢（慢热）
症状：读者看了好几段还不知道这章要发生什么。
原因：开头堆了大量环境描写、心理活动、无关对话。
治疗：把章内最核心的冲突或悬念提前到开头，用"发生了什么"直接开局。

### 问题2：中段塌陷
症状：中间部分读起来"空"，事件推进慢，描写重复。
原因：中段在"等"高潮，但等待期间没有有效内容。
治疗：要么加速推进到高潮，要么在中段插入新的冲突或信息揭示。

### 问题3：场景堆砌
症状：连续多个场景切换，每个都浅尝辄止。
原因：想写的东西太多，但没有在一个场景中写深。
治疗：减少场景数量，每个场景至少做到"推进了剧情 + 展现了人物 + 传递了信息"中的两项。

### 问题4：高潮乏力
症状：应该紧张的段落读起来平淡。
原因：高潮前铺垫不足 / 冲突太容易解决 / 缺少代价。
治疗：在高潮前增加"不可逆的选择"或"必须付出的代价"。

### 问题5：结尾仓促
症状：高潮结束后直接结束，没有处理后果。
原因：写作时精力耗尽，匆匆收尾。
治疗：高潮后至少留15%的篇幅处理"然后呢？"——人物的反应、事件的后果、下一章的钩子。

## 快慢节奏分布建议

- **快节奏段**：冲突、动作、对话、揭示信息。句子短，段落短，切换快。
- **中节奏段**：心理活动、关系互动、环境描写。句子适中，有一定深度。
- **慢节奏段**：氛围渲染、人物独白、世界观展开。句子可以长，但要有信息密度。

一章内的快慢比例建议 3:5:2（快:中:慢），避免全章匀速。

## 输出要求

- 如果节奏正常：标注"节奏正常"
- 如果发现问题：指出具体问题 + 所在位置 + 调整建议
- 不要输出完整的节奏分析，只给关键判断`,source:`built-in`,priority:40,tags:[`节奏`,`检查`]}),i({id:`builtin:ending-hook`,name:`结尾钩子`,description:`提供七种钩子类型和强度分级，根据章节类型选择最合适的结尾策略。`,kind:[`structure`,`planning`],stages:[`planning`,`drafting`],modes:[`strict`],content:`# 结尾钩子

## 核心目标

为本章设计一个让读者"必须看下一章"的结尾。结尾钩子不是附加品，而是章节的有机组成部分——它既是对本章的收束，也是对下一章的召唤。

## 适用场景

- 章节计划阶段，确定本章结尾策略
- 正文写到后半段时，开始设计具体的结尾钩子
- 发现本章结尾太平淡，需要加强

## 钩子的七种类型

### 类型1：悬念钩子
在结尾抛出一个读者不知道答案的问题。
- 做法：揭示一个信息，但这个信息带来的问题比答案更多
- 示例：门后露出一张不该出现的人的脸 / 信上写着"我知道你做了什么"
- 强度：★★★★★

### 类型2：反转钩子
在结尾推翻读者之前的认知。
- 做法：在结尾揭示一个真相，让读者重新审视整章内容
- 示例：一直帮助主角的人其实是卧底 / 所有人都以为死了的人出现了
- 强度：★★★★★

### 类型3：危机钩子
在结尾将主角置于危险之中。
- 做法：在结尾让主角面临一个无法回避的威胁
- 示例：主角听到身后传来脚步声 / 发现被人跟踪 / 被逼到绝路
- 强度：★★★★☆

### 类型4：决定钩子
在结尾让主角面临一个重大选择。
- 做法：在结尾清晰呈现两个（或更多）选项，每个都有代价
- 示例：救A还是救B / 说出真相还是继续隐瞒 / 离开还是留下
- 强度：★★★★☆

### 类型5：情绪钩子
在结尾让读者产生强烈的情绪共鸣。
- 做法：在结尾放一个充满情感的画面、对话或独白
- 示例：母亲终于见到失散多年的孩子 / 主角独自站在风中，想起过去的自己
- 强度：★★★☆☆

### 类型6：关系钩子
在结尾改变人物之间的关系状态。
- 做法：在结尾让一段关系发生质变
- 示例：告白被拒绝 / 朋友反目 / 对手变成盟友
- 强度：★★★☆☆

### 类型7：预告钩子
在结尾暗示即将到来的重大事件。
- 做法：在结尾给一个"风暴即将来临"的信号
- 示例：远处传来号角声 / 某人收到了一封密信 / 天空出现异象
- 强度：★★☆☆☆

## 钩子强度分级

- **强钩子**：读者必须立刻看下一章才能缓解焦虑。适用于高潮章、转折章。
- **中钩子**：读者好奇下一章会发生什么，但不焦虑。适用于推进章、日常章。
- **弱钩子**：读者可以自然停下来，但愿意继续看。适用于整理章、过渡章。

## 不同类型章节的钩子选择

- **高潮章**：强钩子（悬念/反转/危机），在最高潮处戛然而止
- **转折章**：强钩子（反转/决定），在揭示真相或做出选择处结束
- **推进章**：中钩子（危机/关系/情绪），在事件有进展但未完成处结束
- **日常章**：中钩子（情绪/关系/预告），在人物关系有微妙变化处结束
- **整理章**：弱钩子（预告/情绪），在暗示"接下来要开始了"处结束

## 钩子设计原则

1. **钩子服务于主线**：钩子应该是主线的延伸，不是独立的噱头
2. **钩子不宜过多**：一章一个钩子，不要堆叠
3. **钩子必须有回收**：本章结尾的钩子，下一章或下几章必须回收
4. **钩子不能是"假钩子"**：不要用"突然！"但下一章什么事都没有
5. **钩子放在最后一句**：最强的钩子放在真正的最后一句，而非倒数第二段

## 输出要求

- 给本章选择1-2个合适的钩子类型
- 给出具体的钩子写法建议（一句话/一段话）
- 说明这个钩子如何与本章内容衔接`,source:`built-in`,priority:30,tags:[`钩子`,`结尾`,`悬念`]}),i({id:`builtin:plot-self-check`,name:`剧情自检`,description:`端到端综合检查：承接、主线、动机、冲突、伏笔、节奏、风格七项评分。`,kind:[`review`],stages:[`review`],modes:[`standard`,`strict`],content:`# 剧情自检

## 核心目标

在正文初稿完成后，对本章进行全面的质量检查。本章是"端到端"综合检查，覆盖承接、主线、动机、冲突、伏笔、节奏、风格七个维度，确保本章质量达到发布标准。

## 适用场景

- 正文初稿完成后，精修之前
- 多章连续写完后，逐章追溯检查
- 准备发布前

## 七项检查及评分标准

### 检查1：章节承接 ✓
检查本章与上一章的衔接。
- 通过：人物位置、情绪、未解决事件、道具、钩子全部合理承接
- 需改进：有1-2个承接点断裂，但读者能自行脑补
- 不合格：多个承接点断裂，读者会明显感到"断档"

### 检查2：主线推进 ✓
检查本章是否推进了主线。
- 通过：至少推进了主线的一个维度（主角目标/核心冲突/反派/转折）
- 需改进：主线没有推进，但铺垫了后续的重要剧情
- 不合格：本章与主线完全无关，删掉不影响故事

### 检查3：人物动机 ✓
检查本章人物的行为是否有内在驱动力。
- 通过：每个重要行为都有明确的动机支撑
- 需改进：主要人物行为合理，次要人物有工具人嫌疑
- 不合格：核心人物出现OOC行为，或行为动机缺失

### 检查4：冲突强度 ✓
检查本章是否有足够的矛盾和张力。
- 通过：至少有一个冲突在推进，且产生了实质后果
- 需改进：有冲突但不够深入，或冲突没有产生后果
- 不合格：全章没有冲突，或者冲突是"假冲突"

### 检查5：伏笔处理 ✓
检查本章的伏笔推进和回收。
- 通过：推进了该推进的伏笔，没有遗忘重要伏笔
- 需改进：伏笔推进了但不够自然，或有轻微遗忘
- 不合格：完全忽略了伏笔系统，或者反复埋设同类型伏笔不回收

### 检查6：叙事节奏 ✓
检查本章的节奏是否合理。
- 通过：有张有弛，快慢交替，没有明显的拖沓或仓促
- 需改进：有1-2处节奏问题，但不影响整体阅读体验
- 不合格：节奏严重失衡，会影响读者的阅读体验

### 检查7：风格一致性 ✓
检查本章是否与soul.md的风格要求一致。
- 通过：叙述视角、语言风格、人物声线与soul.md设定一致
- 需改进：有局部偏离，但不影响整体风格
- 不合格：风格出现明显偏离，读者会感到"这章像别人写的"

## 问题优先级

- **P0 - 必须修改**：不合格项。直接影响读者体验，必须重写或大幅修改
- **P1 - 建议修改**：需改进项。影响阅读体验，建议修改
- **P2 - 可选优化**：无大问题但有优化空间，视时间决定

## 常见问题修正思路

- **承接断裂**：在开头加1-2句过渡，回扣上一章的重要信息
- **主线偏离**：找到本章中与主线最接近的内容，将其放大，删除无关内容
- **动机缺失**：给人物补充一个"想要"或"害怕"，用行为或对话暗示
- **冲突不足**：在现有场景中增加"阻力"——让人物达成目标变得更难
- **伏笔遗漏**：在当前场景中找一个自然的机会，插入伏笔的推进或提示
- **节奏失衡**：拖沓处删减描写，仓促处增加细节或心理活动
- **风格偏离**：对照soul.md，调整偏离处的用词、句式、叙述视角

## 输出要求

以简洁清单形式输出检查结果：
- 每项标注：通过 / 需改进 / 不合格
- 不合格项标注P0并给出具体修改建议
- 需改进项标注P1并给出调整方向
- 不要输出长篇分析`,source:`built-in`,priority:45,tags:[`自检`,`综合检查`]}),i({id:`builtin:basic-de-ai`,name:`基础去AI味`,description:`降低正文里的解释腔、总结腔、模板句、同义反复和无效热闹。`,kind:[`style`,`rewrite`],stages:[`rewrite`,`output`],modes:[`fast`,`standard`,`strict`],content:[`输出前进行基础去AI味：`,`1. 删除“这说明、这意味着、由此可见”等替读者总结的句子`,`2. 减少段尾升华、机械排比和模板化转折`,`3. 对话不要替作者解释设定或心理`,`4. 压缩同义反复和无效热闹，空修饰落到具体动作，细节过不了三问就删`,`5. 保留原剧情、人设、视角和信息密度；不编新进展`,`6. 最终只输出正文，不说明已去AI味`].join(`\\n`),source:`built-in`}),i({id:`builtin:review-revision`,name:`审稿返修`,description:`根据审稿发现的问题执行最小必要返修。`,kind:[`review`,`rewrite`],stages:[`review`,`rewrite`],modes:[`standard`,`strict`],content:[`返修时按以下顺序处理：`,`1. 先定位审稿指出的具体问题，不扩大到无关段落`,`2. 优先修复承接断裂、人物动机缺口、冲突不足和节奏塌陷`,`3. 保留已成立的剧情、设定、语气和伏笔`,`4. 每处修改都要服务审稿问题，不做额外润色`,`5. 返修后输出修正后的正文或修正片段`].join(`\\n`),source:`built-in`}),i({id:`builtin:post-revision-review`,name:`返修后复审`,description:`返修完成后检查问题是否闭环，避免新增回退。`,kind:[`review`,`output`],stages:[`review`,`output`],modes:[`standard`,`strict`],content:[`返修后复审检查：`,`1. 审稿指出的问题是否已经修到文本里`,`2. 修复是否引入新的人设、设定、时间线或伏笔冲突`,`3. 返修段落与前后文语气是否一致`,`4. 是否仍有解释腔、模板句或过程说明残留`,`5. 若复审通过，最终只输出正文，不输出复审清单`].join(`\\n`),source:`built-in`}),i({id:`builtin:output-protocol`,name:`正文输出协议`,description:`确保最终输出只包含纯净的章节正文，严格排除分析、Skill说明、元信息等过程内容。`,kind:[`output`],stages:[`output`],modes:[`fast`,`standard`,`strict`],content:`# 正文输出协议

## 核心目标

确保最终输出给用户的回复只包含纯净的章节正文，不混入任何过程信息、分析说明、Skill提示、检查结果或元信息。这个协议是"防火墙"，它保护的是读者的阅读体验。

## 适用范围

本协议在所有写作模式下生效（快速/标准/严格），在所有章节写作场景下生效（新写/续写/改写/润色）。

## 强制要求

### 必须包含的内容
1. **章节标题**：以"第X章"或用户指定的标题格式开头，独占一行
2. **章节正文**：标题之后，纯正文内容，段落之间用空行分隔
3. **正文中的对话**：保持对话格式，使用引号或其他用户指定的格式

### 必须排除的内容（禁止清单）
1. ❌ 分析过程："首先，我分析了上一章的内容……"
2. ❌ Skill使用说明："根据章节承接Skill，我检查了……"
3. ❌ 检查结果："剧情自检通过，以下7项全部合格……"
4. ❌ 元信息："本章字数：约3500字 / 本章耗时：……"
5. ❌ 协作口吻："以下是为您生成的章节内容……"
6. ❌ 代码块包装：不要用\`\`\`包裹正文
7. ❌ 总结或说明："本章主要讲述了……"
8. ❌ 建议或提示："下一章建议……"
9. ❌ 任何Markdown格式标记（除非正文本身需要）
10. ❌ 任何形式的"任务完成"通知

## 正向输出模板

正确的输出应该严格遵循以下格式：

	（第一行）第X章 章节标题
	（空一行）
	正文第一段内容……
	（空一行）
	正文第二段内容……
	（正文继续，段落之间空一行）

## 边界情况处理

### 情况1：用户要求看到分析过程
如果用户明确说"写出你的分析过程"，则输出分析过程，但分析过程与正文之间必须用明确的分隔标记区分（如"---"分隔线），并在正文之前标注"以下是正文："。

### 情况2：需要输出多条内容
如果用户同时要求章节正文和其他内容，先输出正文，再输出其他内容，中间用分隔线。

### 情况3：正文需要特殊格式
如果正文本身包含列表、引用、信件等特殊格式，可以使用Markdown格式，但仅限于正文内容。

## 自检清单

在输出最终回复前，逐条确认：
1. 回复的第一行是章节标题吗？
2. 标题之后直接是正文，没有过渡语吗？
3. 正文中没有出现"分析""检查""Skill""建议"等词吗？
4. 回复的最后一行是正文内容，不是"完成"或"请查收"吗？
5. 正文没有被包裹在代码块或其他标记中吗？
6. 如果用户要求了分析，分析是否与正文明确分隔？

如果以上任何一条不通过，修改回复直到全部通过。`,source:`built-in`,priority:10,tags:[`输出`,`格式`]}),i({id:`builtin:suspense-design`,name:`悬念设计`,description:`通过三个层级的悬念结构和藏三露一原则，系统设计信息释放节奏，制造持续的阅读张力。`,kind:[`structure`],stages:[`planning`,`drafting`],modes:[`strict`],content:`# 悬念设计

## 核心目标

通过有策略地隐藏和释放信息，让读者持续产生"想知道接下来会发生什么"的迫切感，从而保持阅读动力。悬念设计不是故弄玄虚，而是通过精准的信息控制，让读者的好奇心与故事节奏同步起伏。

## 适用场景

- 章节计划阶段，设计本章的悬念结构
- 正文写作中，需要制造紧张感或好奇心时
- 发现章节"太平淡"，需要增加钩子时
- 长篇小说的中段，防止读者疲劳

## 悬念的三个层级

### 层级1：表层疑问
读者一眼就能看到的问题，最直接的好奇心来源。
- 示例：门后面是谁？那封信里写了什么？他为什么要这么做？
- 特点：清晰、明确、有具体答案
- 作用：快速抓住读者注意力，让读者想继续读下去找答案

### 层级2：中层冲突
表面问题背后的矛盾和张力，比表层疑问更持久。
- 示例：A和B看似是朋友，但似乎各怀鬼胎 / 任务看起来简单，但处处透着不对劲
- 特点：答案不唯一，可能有多种可能性
- 作用：让读者开始猜测和推理，投入情感和智力

### 层级3：深层秘密
贯穿整个故事的核心谜团，最有力量的悬念。
- 示例：主角的真实身份 / 世界的真相 / 某件过去事件的完整经过
- 特点：揭示后会改变读者对整个故事的认知
- 作用：支撑长篇故事的整体吸引力，让读者追更到底

## 信息释放节奏

### 藏三露一原则
每揭示一个答案的同时，要埋下至少三个新的疑问。
- 正确做法：回答了"A是谁"的同时，引出"A为什么来""A和B什么关系""A的目的是什么"
- 错误做法：把所有答案一次性说完，读者没有继续读的动力
- 关键：新疑问必须和刚揭示的答案相关，不能凭空出现

### 悬念的加压与减压
- 加压：不断抛出新线索，让谜团越来越复杂
- 减压：适时给出部分答案，让读者获得满足感
- 节奏：加压-减压-再加压-再减压，循环往复，整体趋势向上
- 注意：减压不能减太多，否则悬念感消失；加压不能加太多，否则读者会放弃

## 误导与红鲱鱼

### 红鲱鱼的作用
故意放出虚假线索，引导读者往错误方向猜测，从而让真相揭示时更有冲击力。
- 示例：反复暗示A是凶手，最后发现是B
- 关键：红鲱鱼必须看起来合理，不能太刻意

### 误导的三个层次
1. **角色误导**：让故事中的角色也被误导，读者自然跟着角色走
2. **叙事误导**：通过叙述视角的局限性，选择性展示信息
3. **结构误导**：通过章节安排、时间线跳跃等结构手段制造错觉

### 误导的边界
- 不能欺骗读者：读者回看时应该能发现线索，而不是觉得被耍了
- 红鲱鱼要有解释：虚假线索最后要给出合理的解释
- 数量控制：一条主线悬念配1-2条红鲱鱼即可，太多会混乱

## 悬念回收时机

### 小悬念回收
- 表层疑问：1-3章内必须回收
- 回收方式：在合适的时机自然揭示答案
- 注意：如果小悬念拖太久，读者会忘记或失去兴趣

### 中悬念回收
- 中层冲突：5-10章内回收
- 回收方式：通过一个小高潮或转折事件揭示
- 注意：回收时要有一定的冲击力，不能太平淡

### 大悬念回收
- 深层秘密：贯穿大半本书，在关键节点部分揭示
- 回收方式：分多次逐步揭示，每次揭示一部分，最后完整揭晓
- 注意：大悬念不能一直吊着，每隔一段时间要给一点进展

## 常见陷阱

- **悬念过多**：一章塞了太多悬念，读者不知道该关心哪个。→ 一章聚焦1-2个核心悬念
- **悬念过虚**：悬念太抽象，读者不知道到底在问什么。→ 悬念要具体，有明确的问题指向
- **只埋不收**：只挖坑不填，读者觉得被骗。→ 每个悬念都要有回收计划
- **回收太快**：悬念刚抛出来就解答，读者还没来得及好奇。→ 至少给读者几页的猜测时间
- **回收太平**：悬念的答案很无聊，读者觉得"就这？"。→ 答案本身要有冲击力或引出新问题
- **假悬念**：用"突然！""没想到！"制造的虚假紧张，下一页什么事都没有。→ 悬念必须有实质内容`,source:`built-in`,priority:35,tags:[`悬念`,`节奏`,`钩子`]}),i({id:`builtin:character-intro`,name:`人物出场`,description:`通过四种出场方式和第一印象三要素，让人物首次出场就鲜明立体，同时为后续发展留足空间。`,kind:[`style`,`structure`],stages:[`planning`,`drafting`],modes:[`standard`,`strict`],content:`# 人物出场

## 核心目标

让读者在人物第一次出场时就形成鲜明、准确的第一印象，同时为后续的人物发展留出空间。好的人物出场不是"介绍"人物，而是让人物在读者心中"活"起来。

## 适用场景

- 重要人物第一次出场时
- 章节计划阶段，安排人物出场顺序和方式时
- 感觉人物出场太平淡、读者记不住时
- 需要重塑某个角色的形象时

## 首次出场的信息密度

### 不要一次说完
人物第一次出场时，只展示最核心、最有辨识度的3-5个特征，其他信息留到后续慢慢揭示。
- 第一次出场：外貌最显著的特征 + 一个标志性行为 + 一个性格侧面
- 后续出场：逐步补充背景、动机、秘密、成长
- 原因：信息太多读者记不住，慢慢揭示才有探索感

### 第一印象三要素

#### 要素1：外貌特征
不要写完整的容貌描写，只写最有辨识度的1-2个特征。
- 好的描写："他左手总是插在口袋里，说话时右眉会微微挑起"
- 坏的描写："他身高一米八五，剑眉星目，鼻梁高挺，嘴唇薄厚适中"
- 关键：特征要能反映性格，而不是单纯的容貌描述

#### 要素2：行为方式
人物出场时正在做什么？这个行为比外貌更能说明他是谁。
- 示例：在嘈杂环境中安静看书 / 一进场就和所有人打招呼 / 躲在角落观察别人
- 关键：行为要有独特性，能体现人物的核心特质

#### 要素3：他人反应
通过其他人对这个人物的态度，侧面塑造人物形象。
- 示例：他一进来，原本热闹的房间安静了 / 所有人都主动和他打招呼 / 有人看到他就紧张
- 关键：他人反应比直接描写更有说服力，因为读者会自己推导

## 出场方式分类

### 类型1：动作出场
人物一出场就在做某件事，通过动作展现性格。
- 适用：行动派、有特殊技能的人物
- 优势：直观、有冲击力，快速建立人物印象
- 注意：动作要和人物身份、性格一致

### 类型2：对话出场
人物还没露面，先听到他的声音或对话。
- 适用：语言有特色、地位特殊的人物
- 优势：制造期待感，让读者先好奇"这是谁"
- 注意：对话要能体现人物的说话风格和身份

### 类型3：侧面描写
通过其他人物的谈论、回忆、反应来介绍这个人物。
- 适用：神秘感强、地位重要的人物
- 优势：制造悬念，让读者对人物产生好奇
- 注意：侧面描写后要尽快让人物正式出场，不能吊太久

### 类型4：环境烘托
先描写人物所处的环境或拥有的物品，再引出人物本身。
- 适用：环境能反映人物特质的角色
- 优势：有氛围感，让读者通过环境推测人物
- 注意：环境描写要服务于人物塑造，不能为了写景而写景

## 重要人物的二次补全

第一次出场只给核心印象，在后续的2-3次出场中逐步补全人物。

### 补全内容
- 背景信息：他的过去、他的身份、他和其他人物的关系
- 内在动机：他想要什么？他害怕什么？他相信什么？
- 反差面：展示他与第一印象不同的一面，让人物更立体

### 补全节奏
- 第二次出场：补充一个背景信息 + 一个性格侧面
- 第三次出场：揭示一个动机或秘密
- 注意：补全要自然融入剧情，不能像填表格一样

## 常见错误

- **信息倾倒**：第一次出场就把人物的年龄、身高、体重、家世、性格、爱好全说了。→ 只说最核心的，其他留到后面
- **脸谱化**：好人就是"英俊潇洒"，坏人就是"贼眉鼠眼"。→ 给人物一些反套路的特征
- **没有记忆点**：人物出场后读者很快就忘了。→ 找一个独特的标志（动作、口头禅、习惯）
- **出场太平**：人物随随便便就出场了，没有任何存在感。→ 给重要人物的出场设计一个"亮相时刻"
- **全靠旁白说**："他是一个很勇敢的人"。→ 用行为和事件来证明，不要直接告诉读者
- **所有人出场方式一样**：每个新人物都是"XX走了进来"。→ 不同性格的人物用不同的出场方式`,source:`built-in`,priority:40,tags:[`人物`,`出场`,`第一印象`]}),i({id:`builtin:worldbuilding-implant`,name:`世界观植入`,description:`用五种植入方式将设定自然融入剧情，避免信息倾倒，让读者在不知不觉中理解世界规则。`,kind:[`knowledge`,`structure`],stages:[`planning`,`drafting`],modes:[`standard`,`strict`],content:`# 世界观植入

## 核心目标

将世界观设定自然地融入故事中，让读者在不知不觉中理解并接受这个世界的规则，同时不影响叙事节奏。好的世界观植入不是"介绍设定"，而是让读者"体验设定"。

## 适用场景

- 世界观设定比较复杂的作品（奇幻、科幻、玄幻等）
- 章节计划阶段，安排设定展示的时机和方式
- 发现有"信息倾倒"问题时
- 读者反馈"看不懂设定"或"设定太复杂"时

## 设定展示的三个原则

### 原则1：服务剧情
设定的展示必须服务于当前的剧情，而不是反过来。
- 正确：剧情需要用到某个设定时，才解释这个设定
- 错误：为了展示设定而专门安排一段剧情
- 检验：如果删掉这段设定介绍，剧情还成立吗？如果成立，就删掉或推后

### 原则2：自然融入
设定要通过角色的行为、对话、环境自然地展现出来，而不是由作者直接讲解。
- 正确：角色遇到一个问题，用世界观的规则去解决
- 错误：作者跳出来说"在这个世界里，规则是这样的……"
- 关键：读者不需要知道全部设定，只需要知道当前剧情需要的部分

### 原则3：按需释放
读者需要知道什么，就释放什么；什么时候需要，什么时候释放。
- 前期：只释放理解当前剧情所必需的设定
- 中期：随着剧情展开，逐步增加设定深度
- 后期：揭示核心设定，改变读者对世界的认知

## 世界观植入的五种方式

### 方式1：对话提及
角色在对话中自然地提到某些设定。
- 示例："你忘了吗？在这里，夜晚是不能出门的。"
- 优势：自然，不像在上课
- 注意：对话要符合人物身份和情境，不能像教科书问答

### 方式2：环境描写
通过描写角色所处的环境，展示世界观的特色。
- 示例：街道两旁悬浮着发光的晶石，行人脚下踩着无声的滑板
- 优势：有画面感，读者可以自己推导
- 注意：不要堆太多陌生名词，一次1-2个新概念即可

### 方式3：角色行为
通过角色的日常行为、习惯、仪式，展现世界观的规则。
- 示例：进门之前要先摸一下门框上的符印 / 吃饭前要默念一段祷词
- 优势：直观，有生活气息
- 注意：行为要有意义，不是为了炫设定而做

### 方式4：冲突触发
因为某个设定的存在，引发了冲突或问题。
- 示例：因为修炼体系的限制，主角无法使用某种力量
- 优势：设定和剧情紧密结合，读者印象深刻
- 注意：冲突要和设定有因果关系，不是硬凑

### 方式5：背景故事
通过角色的回忆、传说、历史事件，展示世界观的深层设定。
- 示例：老一辈人讲起百年前的那场大战
- 优势：有故事性，不枯燥
- 注意：背景故事要和当前剧情有关联，不能凭空插入

## 避免信息倾倒的方法

### 什么是信息倾倒
大段大段地解释世界观设定，让故事停下来，读者像在读百科全书。

### 避免方法
1. **切片法**：把大设定切成小块，分散到不同章节、不同场景中
2. **冲突法**：让设定和冲突绑定，遇到冲突时才解释相关设定
3. **人物法**：让一个不懂设定的角色（如外乡人、穿越者）提问，另一个角色解答
4. **对比法**：通过与读者熟悉的事物对比，快速建立概念
5. **展示法**：不要说"这个世界有魔法"，而是让角色直接使用魔法

## 设定密度控制

### 密度标准
- 开篇前3章：每章最多引入2-3个新设定概念
- 中期：每章最多引入1-2个新设定概念
- 高潮期：尽量不引入新设定，专注于使用已有的设定

### 过载信号
如果出现以下情况，说明设定密度太高了：
- 读者需要频繁翻回去看之前的设定
- 读者记不住各种名词和规则
- 评论区有人问"这是什么意思"
- 你自己都需要记笔记才能理清

## 常见陷阱

- **开篇大设定**：第一章就用好几页讲世界历史、地理、种族分布。→ 开篇只给最必要的设定，其他慢慢加
- **名词轰炸**：一段里出现七八个陌生的专有名词。→ 一次只给1-2个，并且给足上下文让读者能猜意思
- **设定大于故事**：为了展示酷炫的设定而牺牲剧情和人物。→ 设定永远是背景板，故事和人物才是核心
- **前后矛盾**：前面说设定是A，后面又变成了B。→ 建立设定文档，保持一致性
- **解释过度**：读者已经能看懂了，还在反复解释。→ 相信读者的理解能力，点到为止
- **设定无用**：花了很多笔墨介绍的设定，对剧情完全没用。→ 没用的设定就删掉，或留到需要时再介绍`,source:`built-in`,priority:45,tags:[`世界观`,`设定`,`信息`]}),i({id:`builtin:setting-consistency`,name:`设定一致性`,description:`检查大纲、章纲和细纲里的规则、能力边界、信息公开度、代价限制和长期影响是否一致。`,kind:[`knowledge`,`review`],stages:[`planning`,`review`],modes:[`standard`,`strict`],content:`# 设定一致性

## 核心目标

在生成大纲、章纲或细纲时，确保新增内容不破坏已建立的规则、能力体系、金手指边界、社会规则和人物认知。

## 检查维度

1. **规则来源**：本章使用的设定来自哪里？是已有设定、临时新增，还是需要用户确认的新规则。
2. **能力边界**：主角或关键角色能做什么、不能做什么、代价是什么，不能为了解决剧情临时开万能能力。
3. **信息公开度**：哪些设定只有主角知道，哪些角色知道，读者知道多少，避免信息差混乱。
4. **代价与限制**：每次使用能力、资源或制度便利，都要保留对应代价、冷却、风险或反制方式。
5. **长期影响**：新设定是否会影响后续剧情规模、势力格局、人物目标和伏笔回收。

## 输出要求

- 生成章纲时，把设定约束写进"设定限制/规则约束"段落。
- 如果需要新增设定，必须说明它服务哪一个冲突或伏笔。
- 禁止只写"设定合理"这类空判断，必须落到具体规则和具体事件。`,source:`built-in`,priority:35,tags:[`设定`,`规则`,`能力体系`],categoryId:B.setting}),i({id:`builtin:faction-structure`,name:`势力结构`,description:`把组织、门派、家族、公司或官方机构设计成能持续制造资源、压力和剧情选择的结构。`,kind:[`knowledge`,`structure`],stages:[`planning`],modes:[`standard`,`strict`],content:`# 势力结构

## 核心目标

把组织、门派、家族、公司、官方机构或反派阵营设计成能持续制造目标、资源、压力和剧情选择的结构，而不是只作为背景名词。

## 设计清单

1. **势力目标**：这个势力当前最想得到什么？目标要能转化为行动。
2. **资源来源**：它掌握金钱、武力、情报、人脉、地盘、技术或制度中的哪些资源。
3. **内部矛盾**：上层、中层、执行者之间是否存在利益差、理念差或继承权冲突。
4. **外部对手**：它与哪些势力竞争、合作或互相利用。
5. **主角关系**：主角是加入、利用、反抗、被追杀，还是被迫承担该势力的因果。
6. **剧情功能**：它在本卷/本章中负责提供资源、阻力、试炼、反转、伏笔或升级通道中的哪一项。

## 章纲使用方式

- 每次势力登场，都要写清它推动了哪个核心事件。
- 建立势力类事件后，至少保留2章冷却，不要连续用同类事件刷屏。
- 势力不能只有名字，必须有可见代表人物和可感知行动。`,source:`built-in`,priority:35,tags:[`势力`,`组织`,`阵营`],categoryId:B.faction}),i({id:`builtin:map-progression`,name:`地图推进`,description:`设计新地图、换地图和阶段地图，让环境、势力、规则、资源和冲突同步升级。`,kind:[`knowledge`,`structure`],stages:[`planning`],modes:[`standard`,`strict`],content:`# 地图推进

## 核心目标

设计新地图、换地图或阶段地图时，让环境、势力、规则、资源和冲突同步升级，避免地图只是换了地名。

## 地图四势力框架

开局首张地图优先包含四类功能势力，形成资源闭环：

1. **学校/武馆/训练场**：学习技能、提升实力、建立评价体系。
2. **商贩/药行/交易场**：卖出收获、获取资源、制造经济目标。
3. **山贼/敌人/破坏者**：提供实战目标和成果展示对象。
4. **官府/管理机构/上级组织**：提供更高层级的秩序、规则和上升通道。

## 换地图三策略

1. **新旧联动**：新地图最好与旧地图存在上级、仇怨、资源流向或历史因果。
2. **带人走**：至少保留一个旧角色、旧关系或旧伏笔，避免读者情感断层。
3. **提前铺垫**：换地图前先让新地图的传说、人物、规则或奖励露面，让读者期待进入。

## 章纲使用方式

- 新地图 = 新环境 + 新角色 + 新规则 + 新目标 + 新冲突。
- 换地图前，旧地图核心冲突至少阶段性解决。
- 换地图后前5章必须快速建立代入感、资源目标和主要压力源。
- 地位升高时，环境危险度也要同步升高。`,source:`built-in`,priority:35,tags:[`地图`,`换地图`,`势力`],categoryId:B.map}),i({id:`builtin:scene-description`,name:`场景描写`,description:`从功能定位出发，运用五感层次描写法构建有画面感、有氛围、服务剧情的场景。`,kind:[`style`],stages:[`drafting`],modes:[`standard`,`strict`],content:`# 场景描写

## 核心目标

通过文字构建出有画面感、有氛围、有功能的场景，让读者仿佛身临其境，同时服务于剧情推进和人物塑造。好的场景描写不是"写景"，而是用场景来说话。

## 适用场景

- 进入一个新场景时
- 章节中需要转换氛围时
- 感觉场景描写太单薄或太冗余时
- 需要通过环境烘托情绪时

## 场景的功能定位

写场景之前，先想清楚：这个场景存在的意义是什么？至少要满足以下功能中的1-2个。

### 功能1：推进剧情
场景中的某个元素会触发或影响剧情发展。
- 示例：破败的寺庙里藏着线索 / 狭窄的小巷让追逐战更惊险
- 检验：如果换一个场景，这段剧情还成立吗？如果成立，说明场景没起到作用

### 功能2：塑造人物
场景反映了人物的身份、性格、状态。
- 示例：整洁到强迫症的房间 / 乱中有序的工作台 / 墙上贴满照片的调查员房间
- 关键：场景细节要能体现人物特质，不是随便堆东西

### 功能3：营造氛围
场景的色调、光线、声音决定了读者的情绪基调。
- 示例：阴雨天的老宅 = 悬疑恐怖 / 阳光下的草坪 = 轻松愉快
- 注意：氛围要和剧情的情绪走向匹配

### 功能4：传递信息
场景中的细节隐含了世界观、背景故事或伏笔。
- 示例：墙上褪色的老照片暗示过去的辉煌 / 桌上的药瓶暗示人物的健康问题
- 关键：信息要藏在细节里，不是直白地说出来

## 感官层次描写法

不要只写眼睛看到的，调动读者的全部感官。

### 视觉：画面的骨架
- 光线：明亮/昏暗/柔和/刺眼
- 色彩：主色调是什么？有没有突出的颜色？
- 空间：开阔/狭窄/高耸/压抑
- 动态：有没有在动的东西？（风、人影、光影变化）
- 注意：不要面面俱到，只写最有特点的3-5个视觉元素

### 听觉：画面的呼吸
- 环境音：风声、雨声、远处的人声
- 人物的声音：脚步声、呼吸声、衣服摩擦声
- 寂静：有时候"没有声音"比声音更有张力
- 注意：听觉描写要和视觉配合，增强沉浸感

### 嗅觉：画面的温度
- 自然气味：花香、泥土、海水
- 生活气味：饭菜香、烟草味、书的油墨味
- 特殊气味：血腥味、消毒水、腐朽的气息
- 注意：嗅觉最容易触发情绪，但不要用太多，偶尔用效果最好

### 触觉：画面的质感
- 温度：冷、暖、热、凉
- 质感：光滑、粗糙、柔软、坚硬
- 体感：风吹在脸上、脚下的地面触感
- 注意：触觉描写通常和人物动作结合，不要单独写

### 味觉：画面的余韵
- 适用场景：吃饭、喝水、尝到什么东西的时候
- 作用：增强真实感，或通过味道联想其他事物
- 注意：味觉用得最少，只有在需要的时候才用

## 场景描写的节奏控制

### 开篇场景：快切入
场景刚出现时，先用1-2句话抓住最核心的特征，让读者快速建立印象。然后再慢慢补充细节。
- 错误：一上来就写三百字的场景描写，读者还没进入状态
- 正确：先给一个整体印象，再随着剧情推进逐步展示细节

### 剧情中场景：点到为止
剧情发展过程中，场景描写要精简，不要打断叙事节奏。
- 用动作带场景：人物走动时自然看到周围的环境
- 用对话带场景：人物谈论到环境中的某个东西
- 原则：场景描写不能让剧情停下来

### 高潮场景：强化感官
冲突最激烈的时候，可以适当增加场景描写的密度，用环境的变化烘托紧张感。
- 示例：战斗中环境被破坏、天气变化、光线变化
- 作用：让高潮更有画面感和冲击力

## 与人物视角的统一

场景描写必须从当前视角人物的眼睛里看出去，带上他的主观感受。

### 视角影响场景
- 心情好的人：看什么都觉得美好
- 紧张的人：对声音和动静特别敏感
- 熟悉环境的人：注意到细微的变化
- 陌生环境的人：注意到最显眼的东西

### 避免上帝视角
不要写视角人物不可能知道或看到的东西。
- 错误："他不知道，墙后面正有人盯着他"（如果是第三人称有限视角）
- 正确：通过一些迹象让人物（和读者）感觉到不对劲

## 常见陷阱

- **流水账式写景**：从门口写到窗户，从左边写到右边，像在报家具清单。→ 只写最有特点、和剧情/人物相关的细节
- **场景与人物脱节**：场景写得很美，但和人物、剧情完全没关系。→ 场景要服务于人物和剧情
- **形容词堆砌**："美丽的""漂亮的""壮观的""宏伟的"一堆形容词。→ 用具体的细节代替抽象的形容词
- **全知视角混乱**：一会儿写人物看到的，一会儿写读者知道但人物不知道的。→ 保持视角统一
- **描写过长**：一大段全是场景描写，剧情完全停住。→ 把长描写拆成小段，穿插在动作和对话中
- **所有场景一个样**：每个房间都是"一张桌子、几把椅子"。→ 给每个场景一个独特的标志或氛围`,source:`built-in`,priority:45,tags:[`场景`,`描写`,`氛围`]}),i({id:`builtin:dialogue-design`,name:`对话设计`,description:`通过潜台词三层结构和节奏控制技巧，让对话既符合人物又推动剧情还充满张力。`,kind:[`style`,`structure`],stages:[`planning`,`drafting`],modes:[`standard`,`strict`],content:`# 对话设计

## 核心目标

让对话既符合人物身份和性格，又能推动剧情、传递信息、制造张力，同时具有潜台词和节奏感。好的对话不是"说话"，而是人物在语言中博弈。

## 适用场景

- 章节计划阶段，设计重要对话场景时
- 写对话的时候，感觉对话太平淡、太直白时
- 人物对话听起来都像一个人时
- 需要通过对话制造冲突或悬念时

## 对话的四个功能

好的对话应该同时满足以下功能中的至少2个。

### 功能1：推进剧情
对话导致了某些事情的发生或改变。
- 示例：达成一个协议 / 透露一个关键信息 / 做出一个决定
- 检验：如果删掉这段对话，剧情还能继续吗？如果能，说明这段对话没用

### 功能2：展现人物
对话能体现人物的性格、身份、背景和情绪。
- 示例：说话的用词、语气、节奏、习惯用语
- 关键：不同的人要说不同的话，不能所有人都是一个腔调

### 功能3：制造冲突
对话中的分歧、矛盾、交锋产生张力。
- 示例：争论 / 谈判 / 试探 / 隐瞒
- 注意：有冲突的对话才好看，一团和气的对话最无聊

### 功能4：传递信息
通过对话告诉读者一些他们需要知道的事情。
- 示例：背景信息 / 设定解释 / 人物关系
- 注意：信息传递要自然，不能像在念说明书

## 潜台词设计

潜台词是人物没说出来的话，是对话的灵魂。

### 层次1：说出来的
字面上的意思，最表层的信息。
- 示例："这杯茶有点凉了。"
- 作用：建立对话的表面内容

### 层次2：没说的
人物想说但没有直接说出来的话。
- 示例：（我不想再待在这里了 / 你该走了）
- 作用：让读者去猜，增加对话的深度
- 关键：通过语气、停顿、动作、上下文暗示

### 层次3：反着说的
嘴上说的和心里想的完全相反。
- 示例："我没事。"（我现在很不好）
- 作用：增加人物的复杂度和真实感
- 注意：反话要有足够的线索让读者能察觉，不然读者就真信了

### 潜台词的使用技巧
1. **话不说满**：不要让人物把心里想的全说出来
2. **答非所问**：不正面回答问题，转移话题，说明有隐情
3. **重复强调**：反复说某件事，可能是在掩饰相反的事
4. **语气变化**：同样的话，不同的语气有不同的意思
5. **动作配合**：说话时的小动作、表情，补充潜台词

## 对话节奏

对话的节奏由句子长度、停顿、打断等元素控制。

### 快节奏对话
- 句子短，每句只有几个字
- 你一言我一语，交替很快
- 几乎没有动作和神态描写
- 适用场景：争吵、对峙、紧急情况

### 中节奏对话
- 句子长度适中
- 有适当的停顿和反应
- 穿插少量动作和神态描写
- 适用场景：日常交流、讨论问题

### 慢节奏对话
- 句子长，甚至有大段独白
- 有很多停顿、犹豫、思考
- 大量动作、神态、心理描写
- 适用场景：告白、坦白、重要决定

### 节奏控制技巧
- **打断**：一个人没说完另一个人就插嘴，制造紧张感
- **停顿**：沉默、犹豫，增加重量感
- **抢话**：同时说话，表现混乱或激烈
- **沉默**：有时候不说话比说话更有力量
- **语速变化**：越说越快 = 越来越激动；越说越慢 = 越来越沉重

## 信息差与信息释放

对话中的信息不对称是张力的重要来源。

### 信息差的类型
1. **说话人知道，听话人不知道**：一方在试探或隐瞒
2. **听话人知道，说话人不知道**：读者为说话人着急
3. **读者知道，当事人不知道**：戏剧性反讽
4. **双方都不知道**：一起探索，共同发现

### 信息释放节奏
- 不要一次性把所有信息都说完
- 每次对话释放一点信息，留下新的疑问
- 重要信息放在对话的后半段，甚至最后一句
- 关键信息要用特殊的方式强调（停顿、重复、打断）

## 常见陷阱

- **信息倾倒**：对话像在念说明书，大段大段讲设定或背景。→ 把信息拆开，分散到不同对话中，用冲突包裹
- **所有人一个腔调**：不管什么身份、什么性格的人，说话都一样。→ 给每个人物设计独特的说话方式（用词、语气、口头禅）
- **对话太礼貌**：你好我好大家好，没有任何冲突。→ 给对话加入分歧、试探、隐瞒
- **潜台词过度**：每句话都有深层含义，读者看得很累。→ 大部分对话可以直白，关键对话才用潜台词
- **缺少动作**：对话从头到尾都是你说我说，像两个木头人。→ 穿插动作、神态、环境描写
- **废话太多**：打招呼、寒暄、日常客套占了大半篇幅。→ 跳过不重要的寒暄，直接进入正题
- **现代语穿越**：古代背景的人物说"给力""神马"等现代词。→ 保持语言风格和时代背景一致`,source:`built-in`,priority:35,tags:[`对话`,`人物`,`潜台词`]}),i({id:`builtin:scene-transition`,name:`转场过渡`,description:`掌握五种转场类型和自然衔接技巧，让场景切换流畅不生硬，保持阅读节奏。`,kind:[`structure`],stages:[`drafting`],modes:[`standard`],content:`# 转场过渡

## 核心目标

让场景之间的切换自然流畅，既不打断读者的阅读节奏，又能清晰地传达时间、地点、视角的变化。好的转场不是"切换场景"，而是带着读者一起移动。

## 适用场景

- 章节内需要切换场景时
- 时间跳跃或地点变化时
- 视角人物切换时
- 感觉场景切换太生硬、太突兀时

## 转场的五种类型

### 类型1：时间转场
从一个时间点跳到另一个时间点。
- 短跳跃：几小时后、当天晚上、第二天一早
- 长跳跃：一周后、一个月后、几年后
- 技巧：用标志性事件（日出、日落、钟声、季节变化）暗示时间流逝
- 注意：时间跳跃后，要简单交代这段时间发生了什么变化

### 类型2：地点转场
从一个地方换到另一个地方。
- 近距离：从客厅到卧室、从街上到店里
- 远距离：从一个城市到另一个城市、从人间到仙界
- 技巧：用交通工具、行走过程、视线移动来过渡
- 注意：到新场景后，先给一个整体印象，再进入具体情节

### 类型3：视角转场
从一个人物的视角切换到另一个人物的视角。
- 同场景换视角：同一个场景，从A的视角换到B的视角
- 不同场景换视角：A在做X，切到B在做Y
- 技巧：找到两个视角的连接点（同一件事、同一个物品、同一句话）
- 注意：视角切换不能太频繁，一章内尽量不超过2-3次

### 类型4：情绪转场
通过情绪的延续或对比来过渡场景。
- 情绪延续：上一场景的情绪带到下一个场景
- 情绪对比：上一场景很热闹，下一场景很安静，形成反差
- 技巧：用一个有象征意义的画面或动作承接情绪
- 注意：情绪转场要有内在逻辑，不能为了文艺而文艺

### 类型5：蒙太奇转场
快速切换多个场景，展示时间流逝或多条线索并行。
- 适用：展示一段时间内发生的很多事、多条线索同时推进
- 技巧：找到一个共同的线索（声音、动作、主题）把多个场景串起来
- 注意：蒙太奇不能太长，3-5个镜头切换就够了，太多读者会晕

## 自然衔接技巧

### 技巧1：相似物衔接
用两个场景中都有的相似物品或画面来过渡。
- 示例：上一场景最后是桌上的一杯咖啡 → 下一场景开头是另一杯咖啡
- 作用：视觉上的连续感，让切换不生硬

### 技巧2：声音衔接
用声音把两个场景连起来。
- 示例：上一场景最后有人敲门 → 下一场景开头是门开了
- 作用：听觉上的连续感，自然引导读者进入下一个场景

### 技巧3：动作衔接
用一个动作的延续来过渡。
- 示例：上一场景最后人物站起身 → 下一场景开头人物走在路上
- 作用：动作上的连续感，让读者感觉是跟着人物走的

### 技巧4：对话衔接
用一句话从一个场景带到另一个场景。
- 示例：上一场景最后A说"我们去看看吧" → 下一场景开头两人已经到了目的地
- 作用：语言上的连续感，直接进入下一个情节

### 技巧5：主题衔接
用共同的主题或意象来过渡。
- 示例：上一场景在说"背叛" → 下一场景开头就是另一个背叛的场景
- 作用：意义上的连续感，增强作品的整体性

## 转场节奏控制

### 快节奏转场：硬切
直接切换，没有任何过渡。
- 适用：紧张的追逐戏、平行剪辑、快节奏剧情
- 效果：干脆利落，增加紧张感
- 注意：不能硬切太多，否则读者会混乱

### 中节奏转场：轻过渡
用一句话或一个小细节过渡。
- 适用：大多数日常场景切换
- 效果：自然流畅，不突兀
- 注意：过渡要短，不要写太长

### 慢节奏转场：重过渡
用一整个段落甚至更长的篇幅来过渡。
- 适用：大的时间跳跃、重要的场景转换、情绪变化剧烈时
- 效果：有仪式感，给读者心理准备
- 注意：不要每一次转场都重过渡，会显得拖沓

## 硬切与淡入淡出

### 硬切
- 特点：直接切换，没有过渡
- 优点：节奏快，有冲击力
- 缺点：太频繁会让读者混乱
- 适用：动作戏、平行蒙太奇、场景切换频繁时

### 淡入淡出
- 特点：上一个场景慢慢结束，下一个场景慢慢开始
- 优点：优雅、有氛围感
- 缺点：节奏慢，用多了拖沓
- 适用：大的时间跳跃、情绪转换、章节首尾

### 混合使用
- 大多数转场用轻过渡（介于硬切和淡入淡出之间）
- 紧张时刻用硬切
- 重要转折用淡入淡出
- 有变化才有节奏感

## 常见陷阱

- **转场太生硬**：上一段还在A地对话，下一段直接跳到B地战斗，读者反应不过来。→ 加一句过渡，或用衔接技巧
- **过渡太冗长**：切换一个场景写了好几百字的过渡，剧情完全停住。→ 过渡要短，点到为止
- **视角混乱**：频繁切换视角，读者不知道现在在跟谁。→ 一章内视角切换不超过2-3次，每次切换都要明确
- **时间线混乱**：转场后读者搞不清过了多久。→ 明确交代时间，或用环境变化暗示
- **为了转场而转场**：没必要切换的场景也切来切去。→ 能在一个场景里说完的，就不要换场景
- **所有转场一个样**：每次都是"第二天，……"。→ 变化转场方式，增加阅读趣味`,source:`built-in`,priority:55,tags:[`转场`,`节奏`,`衔接`]}),i({id:`builtin:emotion-rendering`,name:`情绪渲染`,description:`用四种情绪外化方式和节奏曲线，调动读者共情，让情绪表达有力量而不泛滥。`,kind:[`style`],stages:[`drafting`,`review`],modes:[`standard`,`strict`],content:`# 情绪渲染

## 核心目标

通过文字调动读者的情绪，让读者与人物产生共情，从而更深地投入到故事中。好的情绪渲染不是"写情绪"，而是让读者自己感受到情绪。

## 适用场景

- 人物经历强烈情绪时（喜悦、悲伤、愤怒、恐惧等）
- 需要营造特定氛围时
- 感觉情绪表达太单薄、太直白时
- 读者反馈"没有代入感""看不懂人物在想什么"时

## 情绪外化的四种方式

不要直接写"他很开心""她很伤心"，而是通过以下方式让情绪自然流露。

### 方式1：动作外化
情绪通过人物的行为、动作、肢体语言表现出来。
- 开心：脚步轻快、不自觉地微笑、做什么都带劲
- 悲伤：动作迟缓、不想动、对什么都没兴趣
- 愤怒：握拳、咬牙、呼吸变粗、想砸东西
- 紧张：坐立不安、手心出汗、不停地做某个小动作
- 关键：动作要符合人物性格，内向的人和外向的人表达方式不同

### 方式2：环境外化
情绪投射到周围的环境上，用环境烘托情绪。
- 开心：阳光明媚、鸟语花香、连风都是温柔的
- 悲伤：阴雨连绵、灰暗的天空、空旷的房间
- 紧张：安静得可怕、时钟滴答声格外清晰、影子拉得很长
- 愤怒：电闪雷鸣、狂风暴雨、东西摔碎的声音
- 注意：环境描写要从人物视角出发，带上主观色彩

### 方式3：对话外化
情绪通过人物的说话方式、语气、内容表现出来。
- 开心：话变多、语速变快、喜欢开玩笑
- 悲伤：话少、声音低沉、答非所问
- 愤怒：声音变大、语速变快、说狠话、打断别人
- 紧张：说话结巴、重复、声音发抖、转移话题
- 关键：潜台词比直白的情绪表达更有力量

### 方式4：内心独白外化
通过人物的内心活动展现情绪，但不是直接说情绪。
- 开心：脑子里在想各种美好的事情、对未来充满期待
- 悲伤：反复回想某件事、自责、觉得一切都没有意义
- 愤怒：在心里骂、脑补各种报复的画面
- 紧张：胡思乱想、往最坏的地方想、担心各种可能出错的事
- 注意：内心独白不能太长，点到为止，否则会拖沓

## 情绪节奏曲线

好的情绪表达不是一条直线，而是有起伏的曲线。

### 情绪的积累
情绪不是突然爆发的，要有一个积累的过程。
- 一点点小事累加
- 压力慢慢增加
- 伏笔一点点埋下
- 最后被一根稻草压垮

### 情绪的爆发
积累到一定程度后，情绪总爆发。
- 爆发点要选在最有冲击力的时刻
- 爆发的方式要符合人物性格
- 爆发要有后果，不能爆发完就没事了

### 情绪的回落
爆发之后，情绪不会立刻消失，而是慢慢回落。
- 余波：爆发后的疲惫、空虚、后悔
- 反思：冷静下来后重新思考
- 变化：经历这次情绪波动后，人物有什么变化

### 节奏建议
- 不要让人物一直处于高强度情绪中，读者会疲劳
- 紧张之后要有放松，悲伤之后要有温暖
- 情绪的起伏要和剧情的起伏配合
- 一章内至少要有一次明显的情绪波动

## 读者共情的触发点

什么情况下读者最容易和人物共情？

### 触发点1：脆弱时刻
人物展现出脆弱的一面时，读者最容易心疼。
- 再坚强的人也有软肋
- 平时不哭的人落泪
- 天不怕地不怕的人有恐惧的东西
- 关键：脆弱不能太多，偶尔一次才珍贵

### 触发点2：努力时刻
人物在为了某个目标努力奋斗时，读者会为他加油。
- 明明很艰难但还是在坚持
- 明明很害怕但还是鼓起勇气
- 明明受了伤但还是站起来
- 关键：努力要有结果，或者虽然失败但有尊严

### 触发点3：失去时刻
人物失去重要的东西时，读者会跟着难过。
- 失去亲人、朋友、爱人
- 失去梦想、信念、希望
- 失去一直以来守护的东西
- 关键：失去的东西必须是读者也觉得珍贵的

### 触发点4：成长时刻
人物克服困难、获得成长时，读者会感到欣慰。
- 从懦弱变勇敢
- 从自私变无私
- 从迷茫变坚定
- 关键：成长要有过程，不能一下子就变了

## 情绪节制与克制

### 为什么要节制
- 情绪太满会溢出来，反而没有力量
- 哭天抢地不如一滴眼泪有冲击力
- 说出来的悲伤不如没说出来的沉重
- 留白比填满更有想象空间

### 节制的技巧
1. **声东击西**：写悲伤不写哭，写手在抖、茶凉了忘了喝
2. **以乐衬悲**：用热闹的场景反衬人物的孤独
3. **欲扬先抑**：情绪到了顶点反而平静下来
4. **留白**：最强烈的情绪不写出来，让读者自己感受
5. **细节代替**：用一个具体的细节代替大段的情绪描写

### 常见的过度表达
- "他感到无比的愤怒，心中燃起了熊熊烈火" → 太直白太夸张
- "她伤心欲绝，哭得死去活来，天昏地暗" → 太用力反而假
- "这是他一生中最幸福的时刻，他觉得全世界都在发光" → 太满了

## 常见陷阱

- **直接说情绪**："他很悲伤""她非常开心"。→ 用动作、环境、对话、细节来展现
- **情绪夸张**：一点小事就"崩溃""绝望""生不如死"。→ 情绪要有分量，不能随便用
- **情绪不变**：人物从头到尾都是一个情绪。→ 情绪要有变化，有起伏
- **情绪不合理**：刚发生了悲伤的事，下一秒就开心起来。→ 情绪要有延续性，不会突然消失
- **情绪泛滥**：每一页都在哭、都在笑、都在生气。→ 物以稀为贵，少而精才有力量
- **只有情绪没有行动**：大段大段写内心感受，人物什么都不做。→ 情绪要通过行动体现，不能光想不做
- **读者共情失败**：作者写得很投入，但读者没感觉。→ 找到共通的情感体验，让读者能代入`,source:`built-in`,priority:40,tags:[`情绪`,`氛围`,`共情`]}),i({id:`builtin:quotable-lines`,name:`金句设计`,description:`四种金句类型和节制原则，创造有记忆点的台词，点题塑人，宁少勿滥。`,kind:[`style`,`output`],stages:[`drafting`,`output`],modes:[`standard`],content:`# 金句设计

## 核心目标

创作出生动、深刻、让人印象深刻的句子，成为作品的记忆点，甚至被读者记住和传播。好的金句不是"为了金句而金句"，而是从故事和人物中自然生长出来的。

## 适用场景

- 章节的开头或结尾
- 人物的重要时刻（告白、决裂、顿悟、牺牲）
- 主题需要被点出来的时候
- 希望给读者留下深刻印象的时候

## 金句的作用

### 作用1：点题
用一句话点出本章或整部作品的主题。
- 示例："有些路，注定要一个人走完。"
- 位置：章节末尾、故事结尾
- 注意：点题要自然，不能像在写读后感

### 作用2：塑造人物
用一句话让人物形象瞬间立起来。
- 示例："我命由我不由天。"
- 位置：人物的关键台词、内心独白
- 注意：这句话必须符合人物性格，不能什么人都说一样的话

### 作用3：制造记忆点
让读者看完之后还能想起这句话。
- 示例："真相只有一个。"
- 位置：关键情节处、反复出现的台词
- 注意：不能太刻意，要和剧情结合

### 作用4：升华主题
把具体的故事提升到更普世的层面。
- 示例："真正的英雄主义，是在认清生活的真相后依然热爱生活。"
- 位置：故事结尾、人物顿悟时刻
- 注意：升华要合理，不能凭空拔高

## 金句的四种类型

### 类型1：哲理型
蕴含某种道理或智慧的句子。
- 特点：有思辨性，让人回味
- 示例："没有绝对的正义，只有不同的立场。"
- 适用：思考、顿悟、讨论的场景
- 注意：不要太说教，要从故事中自然产生

### 类型2：人物型
专属于某个角色的标志性台词。
- 特点：和人物绑定，听到这句话就想到这个人
- 示例："我一定会回来的！"
- 适用：人物的口头禅、关键时刻的宣言
- 注意：要符合人物身份和性格，不能违和

### 类型3：情节型
和某个关键情节绑定的句子。
- 特点：和剧情紧密相关，单独看可能没什么，但在特定情境下很有冲击力
- 示例："我到现在都还记得，那天的雨下得很大。"
- 适用：重要事件的开头或结尾
- 注意：要有上下文的铺垫，不能凭空出现

### 类型4：主题型
直接或间接地表达作品主题的句子。
- 特点：概括性强，能代表整部作品的精神内核
- 示例："希望是个好东西，也许是最好的东西。"
- 适用：故事开头、结尾、关键转折点
- 注意：不要太直白，最好有隐喻或象征

## 出现时机

### 时机1：章节开头
用一句有分量的话开启本章。
- 作用：定调，引发读者好奇
- 注意：不要太长，一句话就够了

### 时机2：情节高潮
在最紧张、最关键的时刻抛出金句。
- 作用：增强冲击力，让读者印象深刻
- 注意：金句要短，要有力，不能太长

### 时机3：人物顿悟
人物想通了某件事、发生了转变的时候。
- 作用：标记人物的成长和变化
- 注意：要符合人物的心路历程，不能太突兀

### 时机4：章节结尾
用一句有韵味的话结束本章。
- 作用：余音绕梁，让读者回味
- 注意：留有余味，不要说太满

### 时机5：故事结尾
用一句话总结整个故事。
- 作用：升华主题，留下长久的印象
- 注意：要能概括整个故事的精神，不能太片面

## 节制原则：宁少勿滥

### 为什么要节制
- 金句太多就等于没有金句
- 每一句都"很有道理"，读者一句都记不住
- 太刻意的金句会让读者觉得尴尬
- 好的金句是锦上添花，不是喧宾夺主

### 节制的标准
- 一章之内，有意识设计的金句不超过2-3句
- 不是每一章都必须有金句
- 金句要配得上它出现的时刻
- 如果删掉这句话，剧情还成立，人物还成立，那这句话可能就是多余的

### 避免的问题
- **为了金句而金句**：硬塞一些"很有道理"的话，和人物剧情没关系。→ 金句要从故事里长出来
- **人人都是哲学家**：不管什么身份的人都能说出很深奥的话。→ 符合人物身份和文化水平
- **金句太长**：一段话全是金句，读者不知道该记哪句。→ 短一点，有力一点
- **重复使用**：同一句金句反复说，读者会烦。→ 关键时候说一次就够了
- **太网络用语**：用太多网络流行语，很快就过时了。→ 追求更持久的表达

## 常见陷阱

- **说教味太重**：像在给读者上课，大道理一堆。→ 把道理藏在故事里，让读者自己体会
- **不符合人物**：一个大字不识的角色说出很有文采的话。→ 什么人说什么话
- **太矫情**：为了"有感觉"故意写得很文艺、很忧伤。→ 真诚比华丽更有力量
- **太鸡汤**：都是"努力就会成功""加油你最棒"这种正确的废话。→ 要有具体的情境和质感
- **太晦涩**：写得很深奥，但读者看不懂想说什么。→ 深刻不等于难懂
- **脱离剧情**：金句和当前的情节、人物没什么关系。→ 金句要为剧情和人物服务
- **强行升华**：故事本身撑不起来，硬要在结尾加一句"升华"的话。→ 先把故事写好，金句自然会来`,source:`built-in`,priority:60,tags:[`金句`,`台词`,`记忆点`]}),...G];function We(){return new Set(q.map(e=>e.id))}var J=`writing-skills.json`;function Ge(e){if(!Array.isArray(e))return[];let t=[];for(let n of e){if(typeof n!=`string`)continue;let e=n.trim();e&&!t.includes(e)&&t.push(e)}return t}function Ke(e){if(!e||typeof e!=`object`)return null;let t=e;return typeof t.id!=`string`||!t.id.trim()||typeof t.name!=`string`||!t.name.trim()?null:{id:t.id.trim(),name:t.name.trim(),createdAt:typeof t.createdAt==`number`?t.createdAt:void 0,updatedAt:typeof t.updatedAt==`number`?t.updatedAt:void 0}}function qe(e){if(!e||typeof e!=`object`)return null;let t=e;return typeof t.name!=`string`||!t.name.trim()||t.source!==`linked`&&(typeof t.content!=`string`||!t.content.trim())?null:i({...t,source:t.source===`built-in`?`built-in`:t.source===`linked`?`linked`:`uploaded`,content:typeof t.content==`string`?t.content:``})}function Je(e){let t=new Map(e.map(e=>[e.id,e])),n=[...e];for(let e of Ie)t.has(e.id)||n.push(e);return n}function Y(e,t){if(e.categoryId&&t.has(e.categoryId))return e;let n=U(e);return n?{...e,categoryId:B[n]}:e}function X(e){let t=e&&typeof e==`object`?e:{},n=Array.isArray(t.skills)?t.skills.map(qe).filter(e=>!!e).filter((e,t,n)=>n.findIndex(t=>t.id===e.id)===t):[],r=Array.isArray(t.categories)?t.categories.map(Ke).filter(e=>!!e).filter((e,t,n)=>n.findIndex(t=>t.id===e.id)===t):[],i=new Set(r.map(e=>e.id)),a=n.map(e=>({...e,categoryId:e.categoryId&&i.has(e.categoryId)?e.categoryId:``})),o=new Set(a.map(e=>e.id));return{version:1,selectedSkillId:typeof t.selectedSkillId==`string`&&o.has(t.selectedSkillId)?t.selectedSkillId:a[0]?.id??null,disabledSkillIds:Ge(t.disabledSkillIds),skills:a,categories:r}}function Ye(e,t=Date.now()){let n=i({id:`skill:${t}`,name:`新建写作 Skill`,description:``,kind:[`structure`,`planning`],stages:[`planning`,`drafting`],modes:[`standard`,`strict`],content:[`# 写作 Skill`,``,`## 使用场景`,``,`说明这个 Skill 适合哪些写作任务。`,``,`## 执行规则`,``,`写下具体规则，例如三次转折、四次信息冲击、章节结尾钩子等。`,``,`## 输出要求`,``,`只让 AI 将本 Skill 用于内部写作决策，不要在最终正文中解释 Skill。`].join(`
`),source:`uploaded`,createdAt:t,updatedAt:t});return X({...e,selectedSkillId:n.id,skills:[n,...e.skills]})}function Xe(e,t,n=Date.now()){let{name:r,content:a,description:o}=t,s=r.trim(),c=a.trim();if(!s||!c)return e;let l=i({id:`skill:${n}`,name:s,description:o?.trim()??``,kind:[`style`,`structure`],stages:[`planning`,`drafting`],modes:[`standard`,`strict`],content:c,source:`uploaded`,createdAt:n,updatedAt:n});return X({...e,selectedSkillId:l.id,skills:[l,...e.skills]})}function Ze(e){let t=e.toLowerCase();return t.endsWith(`.md`)||t.endsWith(`.txt`)||t.endsWith(`.json`)}async function Z(n){if(n.source!==`linked`||!n.linkedPath)return n.content;let i=n.linkedPath,a=Ze(i);try{if(a)return await t(i);let n=await r(i,`SKILL.md`),o=await t(n);try{let n=await r(i,`docs`),a=(await e(n)).filter(e=>e.name.toLowerCase().endsWith(`.md`)&&!e.is_dir);if(a.length>0){let e=[];for(let i of a){let a=await r(n,i.name);try{let n=await t(a);e.push(n)}catch{}}e.length>0&&(o+=`\n---\n# 附加文档\n---\n\n${e.join(`

---

`)}`)}}catch{}return o}catch{return``}}async function Qe(e){let t=e.skills.filter(e=>e.source===`linked`);if(t.length===0)return e;let n=await Promise.all(t.map(e=>Z(e))),r=new Map;t.forEach((e,t)=>{r.set(e.id,n[t])});let i=e.skills.map(e=>{let t=r.get(e.id);return t===void 0?e:{...e,content:t}});return{...e,skills:i}}function Q(e,t,n,r=Date.now()){return X({...e,skills:e.skills.map(e=>e.id===t?i({...e,...n,id:e.id,source:e.source,updatedAt:r}):e)})}function $e(e,t,n){let r=n?e.disabledSkillIds.filter(e=>e!==t):[...new Set([...e.disabledSkillIds,t])];return X({...e,disabledSkillIds:r})}function et(e,t){if(We().has(t))return e;let n=e.skills.filter(e=>e.id!==t);return X({...e,selectedSkillId:e.selectedSkillId===t?n[0]?.id??null:e.selectedSkillId,disabledSkillIds:e.disabledSkillIds.filter(e=>e!==t),skills:n})}function tt(e){let t=new Set(e.disabledSkillIds);return e.skills.filter(e=>!t.has(e.id))}async function nt(e){if(!e)return $(X(null));let n=await r(e,J);try{let e=await t(n);return $(X(JSON.parse(e)))}catch{return $(X(null))}}async function rt(e,t){let i=await r(e,J);await n(i,JSON.stringify(X(t),null,2))}function $(e){let t=Je(e.categories),n=new Set(t.map(e=>e.id)),r=new Set(e.skills.filter(e=>e.source===`built-in`).map(e=>e.id)),i=[...q.filter(e=>!r.has(e.id)).map(e=>Y(e,n)),...e.skills].map(e=>e.source===`built-in`?Y(e,n):e);return X({...e,skills:i,categories:t})}function it(e){let t={"qmai-skill":!0,version:1,name:e.name,description:e.description,kind:e.kind,stages:e.stages,modes:e.modes,content:e.content,priority:e.priority,tags:e.tags};return JSON.stringify(t,null,2)}function at(e){try{let t=JSON.parse(e);if(!t||typeof t!=`object`)return null;let n=t;if(typeof n.name!=`string`||!n.name.trim()||typeof n.content!=`string`||!n.content.trim())return null;let r=Date.now();return i({id:`skill:${r}`,name:n.name,description:typeof n.description==`string`?n.description:``,kind:Array.isArray(n.kind)?n.kind:void 0,stages:Array.isArray(n.stages)?n.stages:void 0,modes:Array.isArray(n.modes)?n.modes:void 0,content:n.content,source:`uploaded`,priority:typeof n.priority==`number`?n.priority:void 0,tags:Array.isArray(n.tags)?n.tags:void 0,createdAt:r,updatedAt:r})}catch{return null}}var ot=[`style`,`structure`,`planning`,`review`,`rewrite`,`output`,`knowledge`],st=[`planning`,`drafting`,`review`,`rewrite`,`output`],ct=[`fast`,`standard`,`strict`];export{Re as _,et as a,Xe as c,nt as d,X as f,Q as g,$e as h,Ye as i,Qe as l,rt as m,ct as n,it as o,tt as p,st as r,at as s,ot as t,Z as u,ze as v,U as y};