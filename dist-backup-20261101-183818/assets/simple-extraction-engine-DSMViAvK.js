function e(e){let{characterNames:t,chapterSamples:n}=e,r=t.map(e=>`- ${e}`).join(`
`);return{stablePrefix:`你是一个小说角色分析助手。请根据下列章节内容，分析以下角色的人物特征。

# 分析要求
对每个角色输出 4 个字段 + 3-5 句代表性台词：
- personality（性格）：核心性格特征 + 优缺点（50-100 字）
- motivation（动机）：核心目标、欲望、恐惧（30-80 字）
- speechStyle（说话风格）：语言习惯、用词偏好、语气（30-80 字）
- behaviorPatterns（行为模式）：决策倾向、面对冲突的方式、社交风格（30-80 字）
- quotes（代表性台词）：3-5 句最能体现该角色性格的原文台词

# 输出格式（JSON 数组）
[
  {
    "name": "角色名",
    "personality": "...",
    "motivation": "...",
    "speechStyle": "...",
    "behaviorPatterns": "...",
    "quotes": ["台词1", "台词2", "台词3", "台词4", "台词5"]
  }
]

只返回 JSON，不要其他文字。

# 章节内容
${n}`,dynamicSuffix:`

# 角色列表
${r}`}}async function t(t){let{character:i,chapterSamples:a,signal:o,_llmCall:s}=t;try{let{stablePrefix:t,dynamicSuffix:c}=e({characterNames:[i.name],chapterSamples:a}),l=await(s??r)(t+c,t);if(o?.aborted)throw Error(`aborted`);let u=l.replace(/^[\s\S]*?```(?:json)?\s*\n?/i,``).replace(/\n?```\s*[\s\S]*$/,``).trim(),d;try{if(d=JSON.parse(u),!Array.isArray(d))throw Error(`LLM 返回的不是数组`)}catch{return{name:i.name,profile:{personality:u.slice(0,200).trim(),motivation:``,speechStyle:``,behaviorPatterns:``,quotes:[]},error:`LLM 返回格式不正确，已提取部分内容`,errorKind:`parse`}}let f=d.find(e=>e.name===i.name);return f?{name:i.name,profile:{personality:f.personality||``,motivation:f.motivation||``,speechStyle:f.speechStyle||``,behaviorPatterns:f.behaviorPatterns||``,quotes:(f.quotes??[]).slice(0,5)}}:{name:i.name,profile:n(),error:`LLM 返回中未找到角色「${i.name}」的信息`,errorKind:`missing`}}catch(e){let t=e instanceof Error?e.message:`unknown error`,r=t.toLowerCase().includes(`network`)||t.toLowerCase().includes(`fetch`)||t.toLowerCase().includes(`timeout`)||t===`aborted`;return{name:i.name,profile:n(),error:t,errorKind:r?`network`:`unknown`}}}function n(){return{personality:``,motivation:``,speechStyle:``,behaviorPatterns:``,quotes:[]}}async function r(e){throw Error(`defaultLlmCall not implemented in this context`)}export{t as extractSingleProfile};