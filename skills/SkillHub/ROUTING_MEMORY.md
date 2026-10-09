# SkillHub 路由记忆

这是 AI 大纲路由使用的记忆清单。用户选择固定生成流程后，系统可按“篇幅类型 + 受众方向 + 题材 + 任务”加载对应 Skill。

AI 大纲阶段只默认联动 `DagangSkill`、`ZhanggangSkill`、`JueseSkill`、`SheDingSkill`。正文协作区可在后续读取已确认章纲，但不在本路由中直接生成正文。

程序读取路由时优先使用 `ROUTE_MANIFEST.json`；AI 文字推理时使用本文件。AI 输出可保存内容时必须遵循 `AI_OUTLINE_OUTPUT_PROTOCOL.md` 和 `OUTLINE_FOLDER_STORAGE_STANDARD.md`。

## 频道与题材路由

| 用户选择 | 主 Skill | 追加 Skill |
|---|---|---|
| 男频 + 玄幻/修仙/仙侠/高武 | `TicaiSkill/male-xuanhuan-xianxia` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/power-system`、`SheDingSkill/faction-system`、`SheDingSkill/map-progression` |
| 女频 + 玄幻/幻想言情/仙侠情缘 | `TicaiSkill/female-xuanhuan-fantasy` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/world-rules`、`SheDingSkill/power-system` |
| 男频 + 都市/都市异能/都市高武 | `TicaiSkill/male-urban-highmartial` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/power-system`、`SheDingSkill/map-progression`、`JueseSkill/character-design` |
| 男频 + 都市脑洞/系统流 | `TicaiSkill/male-urban-system` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/idea-market-positioning`、`SheDingSkill/power-system` |
| 男频 + 御兽/宠兽进化 | `TicaiSkill/male-beast-taming` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/power-system`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 男频 + 领主/基建/领地经营 | `TicaiSkill/male-lord-building` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/faction-system`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 男频 + 模拟器/未来预演/读档循环 | `TicaiSkill/male-simulator-loop` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense`、`SheDingSkill/power-system` |
| 男频 + 幕后流/组织马甲 | `TicaiSkill/male-behind-the-scenes` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/foreshadowing-suspense`、`JueseSkill/supporting-cast`、`SheDingSkill/faction-system` |
| 男频 + 长生流/时代更替 | `TicaiSkill/male-longevity-flow` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 男频 + 凡人流/谨慎修仙 | `TicaiSkill/male-mortal-cultivation` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/power-system`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense` |
| 男频 + 赘婿/隐藏身份反击 | `TicaiSkill/male-son-in-law-counterattack` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/idea-market-positioning`、`JueseSkill/supporting-cast` |
| 男频 + 反派流/逆天改命 | `TicaiSkill/male-villain-protagonist` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense`、`SheDingSkill/world-rules` |
| 规则怪谈/悬疑/悬疑灵异 | `TicaiSkill/rule-mystery-suspense` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense` |
| 无限流/科幻/末世 | `TicaiSkill/male-infinite-sci-fi-apocalypse` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/map-progression`、`SheDingSkill/foreshadowing-suspense` |
| 历史/历史脑洞/抗战谍战/年代 | `TicaiSkill/male-history-alt-history` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/idea-market-positioning`、`JueseSkill/supporting-cast` |
| 文娱娱乐圈/直播文/电竞 | `TicaiSkill/entertainment-livestream-esports` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/idea-market-positioning`、`JueseSkill/supporting-cast` |
| 种田/经营/冒险 | `TicaiSkill/farming-business-adventure` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/faction-system`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 西幻/克苏鲁/黑暗题材 | `TicaiSkill/western-fantasy-cosmic-dark` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/power-system`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 现言/现言脑洞 | `TicaiSkill/female-modern-romance` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design` |
| 女频 + 豪门总裁 | `TicaiSkill/female-rich-family-ceo` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design` |
| 女频 + 追妻火葬场/狗血言情 | `TicaiSkill/female-chasing-wife` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 替身文 | `TicaiSkill/female-substitute-romance` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 古言/宫斗宅斗 | `TicaiSkill/female-house-palace` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/faction-system`、`JueseSkill/supporting-cast` |
| 女频 + 职场婚恋/青春甜宠 | `TicaiSkill/female-workplace-youth-sweet` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design` |
| 女频悬疑/民国言情 | `TicaiSkill/female-mystery-republic` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/foreshadowing-suspense`、`JueseSkill/relationship-emotion` |
| 女频 + 年代/重生改命/换亲 | `TicaiSkill/female-period-rebirth` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/idea-market-positioning`、`JueseSkill/relationship-emotion`、`JueseSkill/supporting-cast` |
| 女频 + 穿书/炮灰觉醒/拯救反派 | `TicaiSkill/female-book-transmigration` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense`、`JueseSkill/relationship-emotion` |
| 女频 + 重生复仇/信息差打脸 | `TicaiSkill/female-rebirth-revenge` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 团宠/萌宝/亲情治愈 | `TicaiSkill/female-family-pampering-child` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/supporting-cast`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 种田经商/事业成长 | `TicaiSkill/female-farming-business` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/faction-system`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 女频 + 强取豪夺/权力差恋爱 | `TicaiSkill/female-possessive-romance` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 暗恋/破镜重圆/久别重逢 | `TicaiSkill/female-secret-love-reunion` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 世情短篇 | `TicaiSkill/family-drama-short` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 知乎短篇 | `TicaiSkill/zhihu-short` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 死人文学/死后追悔 | `TicaiSkill/short-death-regret` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 婚恋背叛/离婚反击 | `TicaiSkill/short-marriage-betrayal` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 重生复仇 | `TicaiSkill/short-rebirth-revenge` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 公开审判式打脸 | `TicaiSkill/short-public-trial-face-slap` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/supporting-cast`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 灵魂视角/死后旁观 | `TicaiSkill/short-soul-perspective` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense`、`JueseSkill/relationship-emotion` |
| 同人（任意受众/篇幅） | `TicaiSkill/fanfic-derivative` | 对应题材 Skill、`DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |

## 同人路由（创作类型，不是题材）

同人是一种**创作类型**：`creation = fanfic`。它与受众/题材**叠加**，不互相替代。

1. 取同人模式：`canon`（正典延续）/ `au`（架空世界）/ `ooc`（性格重塑）/ `cp`（CP 向）/ 用户自定义一句话。
2. 取「容许偏离」清单；**未列入清单的原作既成事实一律不可动**。
3. 取原作正典 `.novel/fanfic-canon.md`。**没有正典不得进入生成**，只能先追问原作素材。
4. 输出顺序：**原作正典卡 → 题材卡 → 总纲/卷纲/章纲/人物/设定**。
5. 正典与题材规则冲突时以**正典**为准。

同人写作硬规则：正典是权威；服从所选模式；写新线不复读原作；靠动机/认知/节奏保留角色声音而非抄句；无证据就留空或发问；压缩资料包是证据不是臆造许可。

## 大纲任务追加规则

- 生成总纲：加载题材 Skill + `DagangSkill` 主控类 Skill。
- 生成章纲：加载题材 Skill + `DagangSkill` 章纲类 Skill + 对应设定/角色 Skill。
- 完善细纲：加载题材 Skill + 伏笔/人物/地图/势力 Skill，避免只扩写情节。
- 保存结果：输出 `outlineSaveRequest` 或 `outlineSaveRequests`，并写明目标文件夹、文件名、写入模式和引用 Skill。
- 质量检查：保存前可加载 `QualitySkill/outline-quality-check`。
- 正文协作：不在 AI 大纲路由中生成正文；后续由正文协作区读取已确认章纲。


