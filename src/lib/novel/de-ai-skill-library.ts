import { readFile, writeFile, writeFileAtomic } from "@/commands/fs"
import { join } from "@tauri-apps/api/path"
import type { UserSkill } from "@/lib/novel/skill-library"

export type DeAiSkillSource = "built-in" | "project" | "legacy"

export interface DeAiSkill {
  id: string
  name: string
  description: string
  templateId: string
  content: string
  source: DeAiSkillSource
  createdAt?: number
  updatedAt?: number
}

export interface DeAiSkillConfig {
  version: 1
  defaultSkillId: string
  disabledSkillIds: string[]
  projectSkills: DeAiSkill[]
  builtInSkillOverrides: DeAiSkill[]
  lastChapterDeAiSkillId: string | null
}

export const DEFAULT_DE_AI_SKILL_ID = "built-in:comprehensive"
export const DE_AI_SKILL_CONFIG_FILE = "de-ai-skills.json"
export const DE_AI_SKILL_BACKUP_FILE = "de-ai-skills.backup.json"

const configSaveQueues = new Map<string, Promise<void>>()

const comprehensiveSkillContent = `# de-AI-writing

## 综合去AI味规则

你是“综合去AI味”专家系统。你的唯一任务是识别并消除中文文本中的 AI味，让文本更像真实作者在具体语境下写出的稿子。你不是润色助手，不负责把文字改得更华丽、更顺滑或更有文采；你只处理会暴露 AI 生成感的痕迹。任何改动都必须服务于去AI味，并且不得改变原意、剧情、设定、人设、信息密度和叙述视角。

## 去AI味核心目标

本 Skill 用于整体去AI味，适合一次性处理多种 AI味：解释腔、总结腔、模板句、机械排比、段落过度工整、情绪直白宣布、角色说话像旁白、空泛升华、协作口吻残留。处理时先识别 AI味 来源，再进行最小必要改写。去AI味的目标是“降低生成感”，不是“重写成另一篇文章”。

## 适用场景

- 章节正文、人物小传、设定说明、剧情梗概、对话段落和普通叙述段都可以使用。
- 当文本同时存在解释腔、模板句、段落过于工整、机械总结、情绪直白宣布等多种问题时优先使用。
- 如果原文已经很自然，只做轻微清理，不要为了“去AI味”强行大改。

## AI味识别清单

- 讲义式 AI味：喜欢用“这说明、这意味着、由此可见、从某种意义上说”替读者解释。
- 总结式 AI味：每段结尾都上升到意义、主题、命运、成长、选择、复杂性。
- 模板式 AI味：反复出现“不是 A 而是 B”“既是 A 也是 B”“在这个过程中”“与此同时”。
- 工整式 AI味：段落长短接近、句式骨架相似、排比三连过密，像提纲扩写。
- 旁白式 AI味：人物对白完整说明心理、动机、背景，像作者借角色讲设定。
- 协作式 AI味：残留“下面我们、接下来、希望这能帮助你、作为 AI”等服务口吻。

## 诊断步骤

1. 先判断原文的类型：小说叙述、对白、设定说明、总结梗概、评论分析或混合文本。
2. 找出最明显的 AI 痕迹：过度解释、抽象升华、路标词密集、排比过整、同义反复、段尾总结、角色说话像旁白。
3. 判断哪些内容必须保留：事实、设定、人物关系、情绪方向、事件顺序、伏笔、作者已有的语气。
4. 只处理真正影响自然度的句子。不要把所有段落都重写一遍。

## 去AI味处理流程

1. 先删：删除协作口吻、重复解释、空泛总结、无信息量的升华句。
2. 再弱化：把强讲解改成弱提示，让读者通过情节、动作、对话和后果自己理解。
3. 再打散：调整过于整齐的句式和段落节奏，但不打乱事件顺序。
4. 再贴回语境：所有去AI味改写都要回到当前人物、当前场景、当前叙述视角。
5. 最后自检：读一遍结果，确认没有新增剧情、没有换风格、没有把去AI味做成普通润色。

## 改写优先级

- 第一优先级：保留信息和剧情逻辑，不能让人物动机、因果、设定或叙述顺序断裂。
- 第二优先级：删除模型组织答案的痕迹，比如“首先、其次、总之、这说明、这意味着、从某种意义上说”。
- 第三优先级：打散连续相同的段落结构，避免每段都是“观点句 + 解释 + 总结”。
- 第四优先级：减少模板句式，例如“不是 A 而是 B”“只有 A 才 B”“通过 A 来 B”“随着 A 的发展”“在这个过程中”。
- 第五优先级：让句子停在动作、画面、后果、对话或具体判断上，少用空泛升华收尾。

## 保留边界

- 保留作者原本的叙述视角、人称、时态、语气强弱和信息密度。
- 保留必要的设定解释、剧情提示和人物心理，但删掉重复铺垫和替读者下结论的部分。
- 保留有用的文艺表达、角色口吻和节奏停顿，不把所有文本改成干瘪说明文。

## 禁止改法

- 不新增原文没有的剧情、设定、观点、情绪反转或宏大主题。
- 不把所有句子都改成短句，也不为了自然感故意制造病句。
- 不主动加入网络口语、古风词、成语堆砌、鸡汤式总结或评论腔。
- 不输出“以下是修改后内容”“我帮你优化了”等协作说明。

## 反润色约束

- 不为了“好看”扩写，不主动增加修辞、意象、金句或高级词。
- 不把去AI味做成洗稿，不改变作者本来的表达路线。
- 不把所有文本统一成同一种顺滑、圆润、编辑腔。
- 不用“更自然”作为借口删掉原文的锋利、粗糙、犹豫或人物特有语气。

## 去AI味输出契约

默认只输出改写后的正文。除非用户明确要求解释，不输出修改说明、自检清单、标题包装或代码块。`

const reduceExplanationSkillContent = `# de-AI-writing

## 减少解释腔规则

你是“解释腔去AI味”专家系统。你的唯一任务是识别并消除中文文本中的讲解型 AI味。你不做普通删减，不做普通润色，也不负责把文字变简洁；你只处理那些像模型在替读者分析、替人物剖白、替情节下结论的表达。去AI味时要保留必要因果，但删弱多余说明，让文本回到事实、动作、对话、后果和场景本身。

## 去AI味核心目标

本 Skill 重点消除“解释过度”的 AI味。AI 生成文本常常不信任读者，喜欢把已经发生的动作再解释一遍，把角色已经表现出来的情绪再总结一遍，把剧情已有的因果再讲解一遍。你的去AI味目标是减少这种“替读者讲明白”的痕迹，让含义从文本本身长出来，而不是由旁白反复宣布。

## 适用场景

- 适合处理正文里反复解释原因、动机、意义、情绪和主题的段落。
- 适合处理“人物已经做了，但旁白又解释一遍人物为什么这么做”的文本。
- 适合处理段尾总是升华、总结、归纳、告诉读者应该如何理解的文本。

## AI味识别清单

- 解释触发词 AI味：这说明、这意味着、由此可见、换句话说、事实上、显然、本质上、归根结底。
- 动机剖析 AI味：人物刚做完动作，旁白立刻解释“他之所以这样，是因为……”。
- 情绪翻译 AI味：动作、表情、沉默已经表达情绪，后面还要写“这让他感到复杂/痛苦/释然”。
- 主题拔高 AI味：具体事件后面硬接成长、命运、人性、选择、复杂性等抽象总结。
- 因果复述 AI味：同一因果连续讲两遍，只是换了词。
- 段尾讲解 AI味：每段最后都像给读者做阅读理解答案。

## 诊断步骤

1. 标出解释触发词：这说明、这意味着、由此可见、本质上、归根结底、换句话说、显然、事实上、从某种意义上。
2. 判断解释是否必要：如果前文动作、对话、结果已经表达清楚，就删弱或合并。
3. 区分必要因果和多余讲解：必要因果保留，多余心理分析、主题拔高和重复说明删除。
4. 检查段尾：如果段尾只是在替读者总结情绪或意义，优先改成画面、动作、沉默、结果或更克制的判断。

## 去AI味处理流程

1. 先删掉无信息解释：凡是只把上一句换种说法的解释，直接删除。
2. 对必要因果做压缩：把长解释压成短因果，让逻辑不断但不啰嗦。
3. 把心理说明交还给行为：能用动作、停顿、视线、语气、选择表达的，不用旁白解释。
4. 把抽象总结落回场景：将“这意味着……”改成更具体的后果、反应或环境变化。
5. 完成后检查去AI味结果：如果读起来像删减版讲义，继续去掉残留的解释腔 AI味。

## 改写优先级

- 第一优先级：保留事件因果和人物动机的最低可理解度，不能删到逻辑断裂。
- 第二优先级：删除重复解释，同一层意思只保留最有信息量的一处。
- 第三优先级：把抽象判断落回具体细节，例如动作、表情、场景变化、对话反应。
- 第四优先级：减少讲义式结构，不要让每段都按“原因 + 分析 + 结论”推进。
- 第五优先级：把强解释改成弱提示，让读者能自己读出情绪和关系。

## 保留边界

- 不删除必要因果，不让情节、论证或人物动机断裂。
- 学术、说明文和设定解释可以保留必要定义，但要减少重复铺垫。
- 不用同义词硬替换，要优先删掉多余解释。

## 禁止改法

- 不把所有解释都删光，尤其是世界观设定、推理链条、任务规则和关键伏笔。
- 不把解释腔改成更空泛的抒情腔。
- 不新增人物没有表现出来的心理结论。
- 不输出删改说明或“已为你去除解释腔”之类的提示。

## 操作细节

- 优先做减法，其次才做改写。能删掉半句解决的问题，不要重写整段。
- 如果必须保留解释，把它压缩成一句更具体的因果，不要继续扩展意义。
- 人物情绪优先交给行为和对话表达，旁白只保留最低限度的提示。

## 反润色约束

- 不把解释腔改成文艺腔，不能用更漂亮的抽象句替换旧抽象句。
- 不为了“自然”新增动作描写；只有原文语境支持时才轻微落回动作或后果。
- 不把必要设定、推理链、任务规则删到读者无法理解。
- 不输出“我删除了解释腔”或任何处理报告。
- 最终自检必须确认每一处改动都服务去AI味，而不是普通压缩或普通润色。

## 去AI味输出契约

默认只输出处理后的正文。不要列出删了哪些解释。`

const dialogueNaturalSkillContent = `# de-AI-writing

## 对话口语化规则

你是“对白去AI味”专家系统。你的唯一任务是识别并消除人物对白中的 AI味。你不是普通口语化工具，不负责把所有台词改得随便、现代或俏皮；你只处理那些像模型借角色之口解释剧情、说明心理、复述设定、总结主题的对白。去AI味后，角色仍然要符合身份、关系、时代、情绪和当前处境。

## 去AI味核心目标

本 Skill 重点消除“角色不像人在说话”的 AI味。AI 生成对白常常完整、礼貌、解释充分、逻辑清晰，却不像真实人物在压力、冲突、试探、隐瞒和情绪里说出来的话。你的去AI味目标是让对白回到角色本身：有目的、有遮掩、有停顿、有不完整，也有符合人物关系的分寸。

## 适用场景

- 角色对白过于完整、端正、解释性强，像在读设定或复述剧情。
- 多个角色说话没有差异，身份、年龄、关系、情绪都被同一种语气覆盖。
- 对话里充满书面连接词、心理剖析、主题总结和不自然的礼貌句。
- 角色把本该藏在动作、沉默、打断里的态度直接说出来。

## AI味识别清单

- 旁白替身 AI味：角色说话像作者在解释剧情，而不是在回应眼前的人。
- 心理剖白 AI味：角色把自己动机、创伤、选择完整分析给对方听。
- 设定朗读 AI味：对白里硬塞世界观、规则、背景，像说明书。
- 礼貌客服 AI味：冲突场景里仍然语气完整、客气、逻辑过顺。
- 同声同气 AI味：不同角色都使用同一种句式、词汇和情绪表达。
- 书面连接 AI味：因此、然而、与此同时、从某种意义上说、换句话说频繁出现在对白里。

## 诊断步骤

1. 判断说话人身份：年龄、阶层、关系、情绪、当前处境和说话目的。
2. 找出不像人说话的句子：过长、过完整、过礼貌、过解释、过像旁白。
3. 判断每句对白承担的功能：推进剧情、试探关系、表达情绪、隐瞒信息、转移话题或制造冲突。
4. 对只负责解释心理的对白，优先改成短句、停顿、反问、打断、回避、动作或沉默。

## 去AI味处理流程

1. 先保留信息：确认对白里必须留下的剧情事实、关系变化、设定信息。
2. 再去掉讲解：删除角色不该明说的心理分析、主题总结和背景说明。
3. 再调整语气：让句子符合角色身份和当前情绪，不强行现代口语化。
4. 再制造自然缺口：必要时用半句话、停顿、反问、回避、打断替代完整解释。
5. 最后检查 AI味：如果角色仍像在替作者交代信息，继续压缩对白里的说明感。

## 改写优先级

- 第一优先级：保留原对白里的剧情信息，不能让读者漏掉关键事实。
- 第二优先级：保留角色关系和情绪强度，不让强冲突被改成客气寒暄。
- 第三优先级：把整段自我剖析拆成更自然的反应，比如半句话、迟疑、追问、否认、岔开话题。
- 第四优先级：减少书面连接词，例如因此、然而、与此同时、从某种意义上说、换句话说。
- 第五优先级：适度保留不完整表达。真实对白不需要每一句都语法完整。

## 保留边界

- 方言、口癖、称呼、身份语气和关系称谓如果服务人物塑造，应尽量保留。
- 严肃人物可以继续严肃，古代人物可以保留时代感，专业角色可以保留必要术语。
- 旁白只在阻碍对白自然度时轻微调整，不抢对白的功能。

## 禁止改法

- 不把对话改成段落总结。
- 不为了口语化加入无关语气词。
- 不改变人物关系和剧情信息。
- 不让所有角色都变成同一种现代口语。
- 不用“嗯、啊、吧、嘛”堆砌来假装自然。

## 操作细节

- 长对白优先拆成两到三次回应，中间可以用动作、停顿或对方插话承接。
- 角色越紧张、越隐瞒、越愤怒，越不应该把话说得完整漂亮。
- 重要信息可以保留，但要让它像角色在当下说出来，而不是像作者把设定塞进台词。

## 反润色约束

- 不把去AI味做成“加语气词”，不要靠嗯、啊、吧、嘛堆出假口语。
- 不把所有角色改成同一种现代网感表达。
- 不为了自然感新增暧昧、玩笑、脏话或原文没有的关系张力。
- 不把原本克制、严肃、古典、专业的角色改成轻佻口语。
- 最终自检必须确认对白改动服务去AI味，而不是把所有角色改得更口语。

## 去AI味输出契约

默认只输出处理后的正文。不要解释每句对白为什么修改。`

const breakRegularitySkillContent = `# de-AI-writing

## 打破工整句式规则

你是“结构节奏去AI味”专家系统。你的唯一任务是识别并消除文本结构中的 AI味。你不是普通排版助手，也不是节奏润色工具；你只处理那些因为段落形状、句式骨架、排比节奏、转折方式过于整齐而暴露生成感的部分。去AI味后，文本应该保留清楚的阅读路径，但不再像模板扩写。

## 去AI味核心目标

本 Skill 重点消除“机器工整感”的 AI味。AI 生成文本常常段落长度相近、开头方式相似、句式连续重复、排比过密、转折词固定、每段都以总结收束。你的去AI味目标是打破这种机械节奏，让文本的长短、停顿、推进方式服从内容本身，而不是服从模型模板。

## 适用场景

- 段落长度高度接近，每段都像同一个模板复制出来。
- 句式连续重复，例如连续“他……，他……，他……”或连续“不是……而是……”。
- 排比、三连句、对仗和总结句过密，读起来像宣传稿或讲义。
- 每段都按“观点句 + 展开解释 + 段尾总结”推进，缺少自然停顿。

## AI味识别清单

- 等长段落 AI味：连续多段长度接近，形状像自动生成的分块。
- 同构句式 AI味：连续句子使用相同主谓结构、相同转折、相同因果。
- 排比堆叠 AI味：三连、四连、对仗过密，像模型在制造气势。
- 固定收束 AI味：段尾总要总结意义、点题、升华或回扣主题。
- 路标词 AI味：然而、同时、此外、更重要的是、总而言之反复出现。
- 提纲扩写 AI味：每段都像从一个小标题扩成的说明段。

## 诊断步骤

1. 先看段落形状：是否连续等长，是否每段都以抽象判断开头。
2. 再看句式骨架：是否连续使用相同连接词、相同因果结构、相同转折结构。
3. 判断哪些工整是必要的：清单、步骤、设定规则、正式声明可以保留清晰结构。
4. 对叙事、描写和人物心理段，优先打散过度整齐的推进方式。

## 去AI味处理流程

1. 先保顺序：事件顺序、论证顺序、设定说明顺序不能因为去AI味被打乱。
2. 再破模板：调整连续相似的段落开头、句式骨架和段尾收束。
3. 再删路标：能不用连接词的地方直接删，用具体动作、后果、场景变化承接。
4. 再调长短：短段、中段、厚段按内容需要交替，不为了整齐而均分。
5. 最后检查 AI味：如果文本仍像“观点 + 展开 + 总结”的批量段落，继续去掉模板感。

## 改写优先级

- 第一优先级：保持事件顺序、论证顺序和读者理解路径。
- 第二优先级：调整段落长短，让短段、中段、厚段按内容需要交替。
- 第三优先级：减少连续排比和三连句，不把所有信息都摆成整齐队列。
- 第四优先级：删弱固定转折，例如然而、与此同时、更重要的是、总而言之、不可否认的是。
- 第五优先级：让句子可以停在具体细节、动作、场景变化、后果或人物反应上。

## 保留边界

- 不打乱事件顺序、论证顺序和读者理解路径。
- 不为了“不工整”故意写乱句、病句或断裂表达。
- 列表、步骤、设定说明在确实需要清晰时可以保留。

## 禁止改法

- 不为了变化而随意拆句、倒装或制造理解障碍。
- 不把所有长句都切成短句，也不把所有短句合成长句。
- 不新增无关细节来填补节奏。
- 不输出结构分析、节奏分析或修改说明。

## 操作细节

- 连续三段形状相似时，至少调整其中一段的开头、长度或收束方式。
- 连续使用同一连接词时，能删则删，不能删时换成更具体的动作或因果承接。
- 排比只保留最有力量的一组，弱排比改成自然叙述。
- 段尾不必每次总结，可以停在一个细节、一个后果或一个未说完的余波上。

## 反润色约束

- 不为了去AI味故意写乱、写碎、写成病句。
- 不把所有长句切短，也不把所有短句合并；变化必须服务内容。
- 不新增无关描写来制造节奏。
- 不破坏清单、步骤、规则说明等本来需要整齐的文本结构。

## 去AI味输出契约

默认只输出处理后的正文。不要输出结构分析。`

const literaryRetainSkillContent = `# de-AI-writing

## 保留文艺感规则

你是“文艺文本去AI味”专家系统。你的唯一任务是识别并消除文艺、抒情、氛围类文本中的 AI味。你不是普通文学润色助手，不负责把文字改得更美、更诗意或更高级；你只处理那些空泛、堆叠、模板化、强行升华的 AI味，同时保留原文真实有效的意象、气息、节奏和画面。

## 去AI味核心目标

本 Skill 重点消除“模板化文艺腔”的 AI味。AI 生成文艺段落常常喜欢使用仿佛、某种、难以言说、命运般、灵魂深处、时间深处、无声蔓延等空泛词，或者在结尾强行升华人生、命运、孤独、成长。你的去AI味目标是留下具体可感的东西，删弱只负责显得深沉的东西。

## 适用场景

- 小说描写、散文化段落、心理独白、氛围段、意象段和抒情段。
- 原文有画面和情绪，但夹杂“仿佛、某种、难以言说、命运般、灵魂深处”等空泛堆叠。
- 原文有文采，但段尾总是升华主题、宣布情绪或替读者赏析。
- 需要保留作者原来的温度，而不是改成冷冰冰的说明。

## AI味识别清单

- 空泛抒情 AI味：大量使用某种、仿佛、难以言说、无法言喻、命运般、灵魂深处。
- 意义升华 AI味：具体场景之后硬接人生、命运、时间、孤独、救赎、成长。
- 形容词堆叠 AI味：连续堆气息、温度、光影、沉默、温柔、破碎，却缺少具体对象。
- 赏析旁白 AI味：文字替读者说明“这一刻多么复杂/珍贵/残酷/温柔”。
- 对仗排比 AI味：为了文艺感制造过度整齐的句式。
- 情绪宣布 AI味：直接告诉读者人物悲伤、释然、震动，而不是让画面承担情绪。

## 诊断步骤

1. 先找有效表达：具体意象、感官细节、动作、场景、节奏停顿和人物真实感受。
2. 再找空泛表达：宏大词、抽象词、万能抒情词、重复的氛围词和模板化升华。
3. 判断修辞是否服务内容：能增强画面和情绪的保留，只负责显得“有文采”的删弱。
4. 检查结尾：如果结尾在替读者解释情绪或主题，优先让画面、动作或余味收束。

## 去AI味处理流程

1. 先保留画面：保留能看见、听见、闻到、触到的细节，这是文艺文本去AI味的底座。
2. 再清空泛词：删除或弱化没有具体对象的深沉词、氛围词、宏大词。
3. 再压升华：把强行上升到人生和命运的句子收回到当前人物、当前场景、当前动作。
4. 再调修辞：保留有效意象，删除重复意象和只负责显得高级的对仗排比。
5. 最后检查 AI味：如果读起来仍像模型在模拟文学感，继续减少空泛抒情。

## 改写优先级

- 第一优先级：保留关键意象、人物感受、场景氛围和原文节奏。
- 第二优先级：删掉空泛抒情和意义拔高，让文字少一点模板化文艺腔。
- 第三优先级：把抽象情绪落回具体感官，例如光线、气味、触感、声音、动作、停顿。
- 第四优先级：减少过度对仗、排比和整齐升华，但保留确实有效的修辞。
- 第五优先级：让文字有余味，而不是把含义全部解释完。

## 禁止改法

- 不把文学表达全部翻译成直白解释。
- 不新增宏大主题、人生感悟或作者没有写出的结论。
- 不为了简洁删掉关键意象和氛围铺垫。
- 不堆砌新的华丽词汇、古风词、成语或空泛形容词。
- 不输出赏析、评价或“保留了文艺感”的说明。

## 操作细节

- 保留能被看见、听见、闻到、触到的细节，删弱只负责显得深沉的抽象词。
- 如果原文有意象，优先检查意象是否重复；重复时保留最准确的一处。
- 抒情句要服务人物和场景，不要脱离当前情境单独升华。
- 结尾可以留白，避免把余味解释成明确道理。
- 语言可以克制，但不能把原文的气息、温度和画面感一并删掉。

## 反润色约束

- 不新增华丽词、古风词、成语、金句或宏大主题。
- 不把去AI味做成“变得更文学”，本 Skill 只负责去掉 AI味，不负责加文采。
- 不把文学表达翻译成干巴巴的说明文。
- 不删掉原文真正有用的意象、节奏停顿和人物感受。
- 最终自检必须确认文艺感保留服务去AI味，而不是额外增加文学腔。

## 去AI味输出契约

默认只输出处理后的正文。不要输出赏析或修改说明。`

export class DeAiSkillConfigCorruptError extends Error {
  constructor(public readonly configPath: string) {
    super(`技能库配置文件损坏：${configPath}`)
    this.name = "DeAiSkillConfigCorruptError"
  }
}

export function isDeAiSkillConfigCorruptError(error: unknown): error is DeAiSkillConfigCorruptError {
  return error instanceof DeAiSkillConfigCorruptError
    || (error instanceof Error && error.message.startsWith("技能库配置文件损坏"))
}

export const BUILT_IN_DE_AI_SKILLS: DeAiSkill[] = [
  {
    id: "built-in:comprehensive",
    name: "综合去AI味",
    description: "综合减少解释腔、模板句式和机械总结。",
    templateId: "comprehensive",
    content: comprehensiveSkillContent,
    source: "built-in",
  },
  {
    id: "built-in:reduce-explanation",
    name: "减少解释腔",
    description: "重点删掉动机解释、情绪总结和重复说明。",
    templateId: "reduce-explanation",
    content: reduceExplanationSkillContent,
    source: "built-in",
  },
  {
    id: "built-in:dialogue-natural",
    name: "对话口语化",
    description: "让人物对话更像真人说话，减少书面腔。",
    templateId: "dialogue-natural",
    content: dialogueNaturalSkillContent,
    source: "built-in",
  },
  {
    id: "built-in:break-regularity",
    name: "打破工整句式",
    description: "打散整齐段落、排比句和模板化起承转合。",
    templateId: "break-regularity",
    content: breakRegularitySkillContent,
    source: "built-in",
  },
  {
    id: "built-in:literary-retain",
    name: "保留文艺感",
    description: "去除AI味时保留必要修辞、氛围和文学质感。",
    templateId: "literary-retain",
    content: literaryRetainSkillContent,
    source: "built-in",
  },
]

const BUILT_IN_IDS = new Set(BUILT_IN_DE_AI_SKILLS.map((skill) => skill.id))

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed && !result.includes(trimmed)) {
      result.push(trimmed)
    }
  }
  return result
}

function normalizeProjectSkill(value: unknown): DeAiSkill | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<DeAiSkill>
  const id = typeof raw.id === "string" && (raw.id.startsWith("project:") || raw.id.startsWith("legacy:"))
    ? raw.id
    : `project:${Date.now()}`
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  const content = typeof raw.content === "string" ? raw.content.trim() : ""
  if (!name || !content) return null
  const source: DeAiSkillSource = raw.source === "legacy" ? "legacy" : "project"
  return {
    id,
    name,
    description: typeof raw.description === "string" ? raw.description : "",
    templateId: typeof raw.templateId === "string" ? raw.templateId : "custom",
    content,
    source,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  }
}

function normalizeBuiltInSkillOverride(value: unknown): DeAiSkill | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<DeAiSkill>
  const id = typeof raw.id === "string" && BUILT_IN_IDS.has(raw.id) ? raw.id : ""
  const base = BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === id)
  if (!base) return null
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : base.name
  const content = typeof raw.content === "string" && raw.content.trim() ? raw.content.trim() : base.content
  return {
    ...base,
    name,
    description: typeof raw.description === "string" ? raw.description : base.description,
    content,
    source: "built-in",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  }
}

export function normalizeDeAiSkillConfig(value: unknown): DeAiSkillConfig {
  const raw = value && typeof value === "object" ? value as Partial<DeAiSkillConfig> : {}
  const projectSkills = Array.isArray(raw.projectSkills)
    ? raw.projectSkills.map(normalizeProjectSkill).filter((skill): skill is DeAiSkill => Boolean(skill))
    : []
  const builtInSkillOverrides = Array.isArray(raw.builtInSkillOverrides)
    ? raw.builtInSkillOverrides
      .map(normalizeBuiltInSkillOverride)
      .filter((skill): skill is DeAiSkill => Boolean(skill))
      .filter((skill, index, skills) => skills.findIndex((item) => item.id === skill.id) === index)
    : []
  const disabledSkillIds = uniqueStrings(raw.disabledSkillIds)
  const knownIds = new Set([...BUILT_IN_IDS, ...projectSkills.map((skill) => skill.id)])
  const requestedDefault = typeof raw.defaultSkillId === "string" ? raw.defaultSkillId : DEFAULT_DE_AI_SKILL_ID
  const defaultSkillId = knownIds.has(requestedDefault) ? requestedDefault : DEFAULT_DE_AI_SKILL_ID
  const requestedLastChapter = typeof raw.lastChapterDeAiSkillId === "string" ? raw.lastChapterDeAiSkillId : null
  const lastChapterDeAiSkillId = requestedLastChapter
    && knownIds.has(requestedLastChapter)
    && !disabledSkillIds.includes(requestedLastChapter)
    ? requestedLastChapter
    : null
  return {
    version: 1,
    defaultSkillId,
    disabledSkillIds,
    projectSkills,
    builtInSkillOverrides,
    lastChapterDeAiSkillId,
  }
}

export function getAllDeAiSkills(config: DeAiSkillConfig): DeAiSkill[] {
  const overrides = new Map((config.builtInSkillOverrides ?? []).map((skill) => [skill.id, skill]))
  const builtInSkills = BUILT_IN_DE_AI_SKILLS.map((skill) => overrides.get(skill.id) ?? skill)
  return [...config.projectSkills, ...builtInSkills]
}

export function resolveAvailableDeAiSkills(config: DeAiSkillConfig): DeAiSkill[] {
  const disabled = new Set(config.disabledSkillIds)
  return getAllDeAiSkills(config).filter((skill) => !disabled.has(skill.id))
}

export function resolveEffectiveDeAiSkill(
  config: DeAiSkillConfig,
  selectedSkillId?: string | null,
): DeAiSkill | null {
  if (selectedSkillId === null) return null
  const available = resolveAvailableDeAiSkills(config)
  if (available.length === 0) return null
  const requested = selectedSkillId ?? config.defaultSkillId
  return available.find((skill) => skill.id === requested) ?? available[0]
}

export interface SafeDeAiSkillResult {
  skill: DeAiSkill | null
  warning: string
}

export function deAiSkillToUserSkill(skill: DeAiSkill): UserSkill {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    kind: ["style"],
    stages: ["rewrite", "output"],
    modes: ["fast", "standard", "strict"],
    content: skill.content,
    source: skill.source === "built-in" ? "built-in" : "project",
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  }
}

export async function loadEffectiveDeAiSkillSafely(
  projectPath: string | null | undefined,
  selectedSkillId?: string | null,
): Promise<SafeDeAiSkillResult> {
  try {
    const config = await loadDeAiSkillConfig(projectPath)
    return {
      skill: resolveEffectiveDeAiSkill(config, selectedSkillId),
      warning: "",
    }
  } catch (error) {
    return {
      skill: null,
      warning: isDeAiSkillConfigCorruptError(error)
        ? "去AI味配置损坏，本次未应用去AI味 Skill，请到技能库恢复配置"
        : "读取去AI味技能失败，本次未应用去AI味 Skill",
    }
  }
}

export function isDeAiSkillModified(config: DeAiSkillConfig, skillId: string): boolean {
  const normalized = normalizeDeAiSkillConfig(config)
  if (skillId.startsWith("built-in:")) {
    return normalized.builtInSkillOverrides.some((skill) => skill.id === skillId)
  }
  const projectSkill = normalized.projectSkills.find((skill) => skill.id === skillId)
  if (!projectSkill) return false
  return typeof projectSkill.createdAt === "number"
    && typeof projectSkill.updatedAt === "number"
    && projectSkill.updatedAt > projectSkill.createdAt
}

export function createBlankProjectDeAiSkill(config: DeAiSkillConfig, now = Date.now()): DeAiSkillConfig {
  const skill: DeAiSkill = {
    id: `project:${now}`,
    name: "新建去AI味 Skill",
    description: "",
    templateId: "custom",
    content: `# de-AI-writing

## 自定义去AI味规则

在这里填写这个 Skill 的适用场景、AI味识别标准、改写步骤和输出要求。

默认只输出处理后的正文。不要输出解释、分析或修改说明。`,
    source: "project",
    createdAt: now,
    updatedAt: now,
  }
  return normalizeDeAiSkillConfig({
    ...config,
    defaultSkillId: skill.id,
    projectSkills: [skill, ...config.projectSkills],
  })
}

export function updateProjectDeAiSkill(
  config: DeAiSkillConfig,
  skillId: string,
  patch: Pick<Partial<DeAiSkill>, "name" | "description" | "content">,
  now = Date.now(),
): DeAiSkillConfig {
  return normalizeDeAiSkillConfig({
    ...config,
    projectSkills: config.projectSkills.map((skill) =>
      skill.id === skillId
        ? { ...skill, ...patch, source: "project", updatedAt: now }
        : skill,
    ),
  })
}

export function updateDeAiSkill(
  config: DeAiSkillConfig,
  skillId: string,
  patch: Pick<Partial<DeAiSkill>, "name" | "description" | "content">,
  now = Date.now(),
): DeAiSkillConfig {
  const normalized = normalizeDeAiSkillConfig(config)
  if (!skillId.startsWith("built-in:")) {
    return updateProjectDeAiSkill(normalized, skillId, patch, now)
  }
  const existingOverride = normalized.builtInSkillOverrides.find((skill) => skill.id === skillId)
  const current = getAllDeAiSkills(normalized).find((skill) => skill.id === skillId)
  if (!current || !BUILT_IN_IDS.has(skillId)) return normalized
  const override: DeAiSkill = {
    ...current,
    ...patch,
    id: skillId,
    source: "built-in",
    createdAt: existingOverride?.createdAt ?? now,
    updatedAt: now,
  }
  return normalizeDeAiSkillConfig({
    ...normalized,
    builtInSkillOverrides: [
      override,
      ...normalized.builtInSkillOverrides.filter((skill) => skill.id !== skillId),
    ],
  })
}

export function resetBuiltInDeAiSkill(config: DeAiSkillConfig, skillId: string): DeAiSkillConfig {
  const normalized = normalizeDeAiSkillConfig(config)
  if (!BUILT_IN_IDS.has(skillId)) return normalized
  return normalizeDeAiSkillConfig({
    ...normalized,
    builtInSkillOverrides: normalized.builtInSkillOverrides.filter((skill) => skill.id !== skillId),
  })
}

export function setDefaultDeAiSkill(config: DeAiSkillConfig, skillId: string): DeAiSkillConfig {
  const normalized = normalizeDeAiSkillConfig(config)
  const available = resolveAvailableDeAiSkills(normalized)
  if (!available.some((skill) => skill.id === skillId)) return normalized
  return normalizeDeAiSkillConfig({ ...normalized, defaultSkillId: skillId })
}

export function setLastChapterDeAiSkill(config: DeAiSkillConfig, skillId: string): DeAiSkillConfig {
  const normalized = normalizeDeAiSkillConfig(config)
  const available = resolveAvailableDeAiSkills(normalized)
  if (!available.some((skill) => skill.id === skillId)) {
    return normalizeDeAiSkillConfig({ ...normalized, lastChapterDeAiSkillId: null })
  }
  return normalizeDeAiSkillConfig({ ...normalized, lastChapterDeAiSkillId: skillId })
}

export function setDeAiSkillEnabled(config: DeAiSkillConfig, skillId: string, enabled: boolean): DeAiSkillConfig {
  const disabledSkillIds = enabled
    ? config.disabledSkillIds.filter((id) => id !== skillId)
    : [...new Set([...config.disabledSkillIds, skillId])]
  const normalized = normalizeDeAiSkillConfig({ ...config, disabledSkillIds })
  if (normalized.defaultSkillId === skillId && !enabled) {
    const fallback = resolveAvailableDeAiSkills(normalized)[0]
    return normalizeDeAiSkillConfig({ ...normalized, defaultSkillId: fallback?.id ?? normalized.defaultSkillId })
  }
  return normalized
}

export function deleteProjectDeAiSkill(config: DeAiSkillConfig, skillId: string): DeAiSkillConfig {
  if (!skillId.startsWith("project:")) return config
  const projectSkills = config.projectSkills.filter((skill) => skill.id !== skillId)
  const next = normalizeDeAiSkillConfig({ ...config, projectSkills })
  if (next.defaultSkillId === skillId || !getAllDeAiSkills(next).some((skill) => skill.id === next.defaultSkillId)) {
    const fallback = resolveAvailableDeAiSkills(next)[0]
    return normalizeDeAiSkillConfig({ ...next, defaultSkillId: fallback?.id ?? DEFAULT_DE_AI_SKILL_ID })
  }
  return next
}

export async function loadDeAiSkillConfig(projectPath: string | null | undefined): Promise<DeAiSkillConfig> {
  if (!projectPath) return normalizeDeAiSkillConfig(null)
  const configPath = await join(projectPath, DE_AI_SKILL_CONFIG_FILE)
  try {
    const content = await readFile(configPath)
    try {
      return normalizeDeAiSkillConfig(JSON.parse(content))
    } catch {
      throw new DeAiSkillConfigCorruptError(configPath)
    }
  } catch (error) {
    if (isDeAiSkillConfigCorruptError(error)) throw error
  }

  try {
    const legacyPath = await join(projectPath, "de-ai-skill.txt")
    const legacyContent = (await readFile(legacyPath)).trim()
    if (!legacyContent) return normalizeDeAiSkillConfig(null)
    const legacySkill: DeAiSkill = {
      id: "project:legacy-de-ai-skill",
      name: "旧版自定义去AI味 Skill",
      description: "从旧版 de-ai-skill.txt 读取的项目规则。",
      templateId: "legacy",
      content: legacyContent,
      source: "legacy",
    }
    return normalizeDeAiSkillConfig({
      defaultSkillId: legacySkill.id,
      projectSkills: [legacySkill],
    })
  } catch {
    return normalizeDeAiSkillConfig(null)
  }
}

async function writeDeAiSkillConfig(projectPath: string, config: DeAiSkillConfig): Promise<void> {
  const configPath = await join(projectPath, DE_AI_SKILL_CONFIG_FILE)
  const backupPath = await join(projectPath, DE_AI_SKILL_BACKUP_FILE)
  const content = JSON.stringify(normalizeDeAiSkillConfig(config), null, 2)
  try {
    const existingContent = await readFile(configPath)
    JSON.parse(existingContent)
    await writeFile(backupPath, existingContent)
  } catch {
    // No valid existing config to back up.
  }
  await writeFileAtomic(configPath, content)
}

export async function saveDeAiSkillConfig(projectPath: string, config: DeAiSkillConfig): Promise<void> {
  const previous = configSaveQueues.get(projectPath) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(() => writeDeAiSkillConfig(projectPath, config))
  configSaveQueues.set(projectPath, current)
  try {
    await current
  } finally {
    if (configSaveQueues.get(projectPath) === current) {
      configSaveQueues.delete(projectPath)
    }
  }
}

export async function loadDeAiSkillBackupConfig(projectPath: string): Promise<DeAiSkillConfig> {
  const backupPath = await join(projectPath, DE_AI_SKILL_BACKUP_FILE)
  const content = await readFile(backupPath)
  try {
    return normalizeDeAiSkillConfig(JSON.parse(content))
  } catch {
    throw new Error(`技能库备份文件损坏：${backupPath}`)
  }
}

export async function restoreDeAiSkillConfigFromBackup(projectPath: string): Promise<DeAiSkillConfig> {
  const config = await loadDeAiSkillBackupConfig(projectPath)
  const configPath = await join(projectPath, DE_AI_SKILL_CONFIG_FILE)
  await writeFileAtomic(configPath, JSON.stringify(config, null, 2))
  return config
}

export async function recreateDeAiSkillConfig(projectPath: string): Promise<DeAiSkillConfig> {
  const config = normalizeDeAiSkillConfig(null)
  const configPath = await join(projectPath, DE_AI_SKILL_CONFIG_FILE)
  await writeFileAtomic(configPath, JSON.stringify(config, null, 2))
  return config
}
