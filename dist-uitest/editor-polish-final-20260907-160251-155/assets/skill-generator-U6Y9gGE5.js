import{_ as e}from"./fs-CHzeAglm.js";import{s as t}from"./path-utils-DetyJ9DL.js";import{a as n}from"./llm-client-DKOM1L0l.js";import{n as r,t as i}from"./six-dimension-prompts-Ce3SjsAb.js";function a(e){return!!e.sixDimensionResearch&&!!e.sixDimensionMeta}function o(e,t){let n=e.sixDimensionResearch,a=e.sixDimensionMeta,o=e.aliasMap?[e.aliasMap.canonical,...e.aliasMap.aliases]:[e.name,...e.aliases],s=Array.from(new Set(o)).filter(Boolean).join(`、`),c=[];c.push(`---`),c.push(`name: ${e.name}`),c.push(`description: ${e.description.substring(0,100)}`),c.push(`sourceBook: ${t.title}`),c.push(`category: character-skill`),c.push(`schema: 6d`),c.push(`analysisDepth: ${a.depth}`),c.push(`webSearchUsed: ${a.webSearchUsed}`),c.push(`sourceNote: ${a.sourceNote}`),c.push(`generatedAt: ${a.generatedAt}`),c.push(`---`),c.push(``),c.push(`# ${e.name}`),c.push(``),c.push(`> 6 维度分析 · 深度：${a.depth} · ${a.sourceNote}`),c.push(``),c.push(`## 角色别名 / 称谓`),c.push(``),c.push(s),c.push(``),c.push(`## 角色总览`),c.push(``),c.push(`- **分类**：${e.category}`),c.push(`- **首次出现**：第 ${e.firstAppearance} 章`),c.push(`- **最后一次出现**：第 ${e.lastAppearance} 章`),c.push(`- **出现次数**：${e.appearanceCount} 次`),c.push(`- **来源作品**：《${t.title}》（作者：${t.author||`未知`}）`),c.push(``);for(let e of i)c.push(`## ${r[e]}`),c.push(``),c.push(n[e]||`（空）`),c.push(``);return c.join(`
`)}async function s(e,t,r,i,s){if(a(e))return o(e,t);if(e.personalityProfile)return l({characterName:e.name,profile:e.personalityProfile,sourceBook:t.title});let c=[{role:`user`,content:[{type:`text`,text:`请为小说角色生成一个完整的 Skill 技能文档。

角色信息：
- 姓名：${e.name}
- 别名：${e.aliases.join(`、`)}
- 分类：${e.category}
- 描述：${e.description}
- 性格：${e.personality}
- 核心动机：${e.motivation||`未提取`}
- 目标：${e.goals?.join(`、`)||`未提取`}
- 恐惧与边界：${e.fears?.join(`、`)||`未提取`}
- 成长弧：${e.growthArc||`未提取`}
- 行为模式：${e.behaviorPatterns||`未提取`}
- 说话方式：${e.speechStyle}
- 关系：${e.relationships.map(e=>`${e.target}（${e.relation}）`).join(`、`)}

来源作品：${t.title}
作者：${t.author||`未知`}

请生成一个 Markdown 格式的 Skill 文档，包含以下部分：

1. Frontmatter（YAML格式）：
   - name: 角色名
   - description: 一句话简介
   - sourceBook: 来源书籍
   - category: 角色分类

2. 角色基本信息
3. 性格特征（详细展开）
4. 说话方式（包含示例）
5. 行为模式
6. 关系网络
7. 使用建议（如何在写作中使用这个角色）
8. 核心动机与目标
9. 恐惧与行为边界
10. 成长弧
11. 语言与行为模式
12. 代表性证据（只用于学习角色塑造，不照搬原作情节）

请直接输出完整的 Markdown 内容，不要额外说明。`,cacheControl:!0}]}],u=``;try{return await n(r,c,{onToken:e=>{u+=e},onDone:()=>{},onError:e=>{console.error(e)},onRequestTrace:s},i),u.startsWith(`---`)||(u=`---
name: ${e.name}
description: ${e.description.substring(0,100)}
sourceBook: ${t.title}
category: character-skill
---

`+u),u}catch(n){return console.error(`Failed to generate skill for ${e.name}:`,n),`---
name: ${e.name}
description: ${e.description}
sourceBook: ${t.title}
category: character-skill
---

# ${e.name}

## 角色基本信息

- **姓名**：${e.name}
- **别名**：${e.aliases.join(`、`)||`无`}
- **分类**：${e.category}
- **首次出现**：第${e.firstAppearance}章

## 角色描述

${e.description}

## 性格特征

${e.personality}

## 说话方式

${e.speechStyle}

## 核心动机与目标

${e.motivation||`未提取`}

${e.goals?.map(e=>`- ${e}`).join(`
`)||`- 未提取`}

## 恐惧与行为边界

${e.fears?.map(e=>`- ${e}`).join(`
`)||`- 未提取`}

## 成长弧

${e.growthArc||`未提取`}

## 语言与行为模式

${e.behaviorPatterns||`未提取`}

## 代表性证据

${e.representativeQuotes?.map(e=>`- [${e.chapterId}] ${e.text}`).join(`
`)||`- 未提取`}

## 关系网络

${e.relationships.map(e=>`- **${e.target}**：${e.relation}${e.description?` - ${e.description}`:``}`).join(`
`)}

## 使用建议

这个角色来自《${t.title}》，可以作为灵魂库中的参考角色使用。在写作中可以借鉴其性格特征和说话方式。
`}}async function c(n,r,i,a,o,c,l){let u=[];for(let d=0;d<n.length;d++){if(c?.aborted)throw Error(`用户取消生成`);let f=n[d];o?.({stage:`generating_skills`,stageLabel:`生成角色Skill`,completed:d,total:n.length,percentage:90+Math.floor(d/n.length*10),currentItem:f.name});let p=await s(f,r,a,c,l),m=`${f.name.replace(/[^一-龥a-zA-Z0-9]/g,`_`)}-skill.md`,h=t(i,`skills`,m);await e(h,p);let g={id:`skill-${f.id}`,characterId:f.id,characterName:f.name,skillContent:p,sourceBook:r.title,chapterRange:[`${f.firstAppearance}`,`${f.lastAppearance}`],createdAt:Date.now(),filePath:h,depth:f.sixDimensionMeta?.depth,sixDimensionMeta:f.sixDimensionMeta};u.push(g)}return o?.({stage:`generating_skills`,stageLabel:`Skill生成完成`,completed:n.length,total:n.length,percentage:100}),u}function l(e){let{characterName:t,profile:n,sourceBook:r}=e;return`# 角色 Skill - ${t}

> 来源：${r??`未知`}
> 提取方式：简单提取（4 字段 + 代表性台词）

## 性格
${n.personality}

## 动机
${n.motivation}

## 说话风格
${n.speechStyle}

## 行为模式
${n.behaviorPatterns}

## 代表性台词
${n.quotes.map(e=>`- 「${e}」`).join(`
`)}

---
*本 Skill 由 QM AI 拆书功能生成*
`}export{c as generateSkillsForCharacters};