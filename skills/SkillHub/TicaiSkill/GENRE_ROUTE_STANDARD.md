# 题材路由标准

本标准用于 AI 大纲固定生成流程。用户完成弹窗选择后，系统按“篇幅类型 + 受众方向 + 题材分类 + 用户灵感 + 目标输出”加载对应题材 Skill，并把题材规则传递给大纲、章纲、人物和设定生成链路。

## 1. 固定输入顺序

1. 创作任务：创建新书、补全已有大纲、生成章纲、完善人物、完善设定。
2. 篇幅类型：长篇小说、短篇小说。
3. 受众方向：男频、女频。
4. 题材分类：从题材路由表中选择，不提供男女频融合选项。
5. 用户灵感：用户自己的故事灵感、想看的桥段、主角设想、世界观想法或一句话梗。
6. 目标输出：题材卡、总纲、卷纲、章纲、人物小传、世界观/势力/伏笔文件。

## 2. 路由原则

- 先锁定篇幅，再锁定男频/女频，再锁定题材；不能只凭“玄幻”“都市”“悬疑”等词直接调用 Skill。
- 男频和女频同名题材必须分开处理。例如男频玄幻走 `male-xuanhuan-xianxia`，女频玄幻走 `female-xuanhuan-fantasy`。
- 短篇优先使用三幕、钩子密度、反转和情绪释放规则；长篇优先使用主线目标、卷级递升、人物弧线和设定承载规则。
- 用户灵感不能被覆盖，只能被题材规则加工、扩展和校准。
- 本题材路由只服务 AI 大纲体系：`DagangSkill`、`ZhanggangSkill`、`JueseSkill`、`SheDingSkill`。正文协作区另行读取已确认章纲，不在本路由中生成正文。

## 3. 标准输出：题材卡

每次进入题材 Skill 后，先产出题材卡，再进入大纲或章纲生成。

```markdown
# 题材卡

## 基本选择
- 篇幅类型：
- 受众方向：
- 题材分类：
- 目标输出：
- 用户灵感：

## 读者承诺
- 目标读者：
- 读者最想获得的核心情绪：
- 本书必须兑现的爽点/情绪：
- 本书不能踩的题材雷点：

## 核心卖点
- 一句话核心梗：
- 题材核心吸引力：
- 主角核心处境：
- 金手指/关键优势：
- 情绪缺口：
- 最终满足：

## 结构策略
- 长篇结构：8 节点、五阶段、分层地图、卷级循环或其他结构。
- 短篇结构：建压、爆点、落定。
- 关键转折：
- 阶段递升方式：

## 联动生成要求
- 大纲生成重点：
- 章纲生成重点：
- 人物生成重点：
- 设定生成重点：
- 伏笔与回收重点：

## 风险与避坑
- 题材偏移风险：
- 读者期待断裂风险：
- 设定崩坏风险：
- 情绪兑现不足风险：
```

## 4. 长篇输出要求

长篇题材卡必须明确：

- 主线目标只能先定一个主轴，后续支线服务主轴。
- 读者承诺要能循环，不是一两个桥段写完就结束。
- 每卷至少有一个阶段目标、一个强冲突、一个情绪兑现、一个下一卷钩子。
- 男频重点检查事业线、升级逻辑、地图递升、金手指边界和爽点阈值。
- 女频重点检查安全感、女主主动性、感情线与成长线咬合、虐点后的反转或补偿。
- 长篇微创新不超过 3 个，优先放在人设、关系、情节，不随意改题材底层期待。

## 5. 短篇输出要求

短篇题材卡必须明确：

- 三幕比例：建压、爆点、落定。
- 开头必须尽快给出冲突、异常、背叛、困境或信息差。
- 每节必须有目标情绪和信息变化。
- 反转必须改变读者认知，不只是换说法。
- 情绪释放要和前期压迫对等；该爽不爽是重大问题。
- 结尾只收最关键情绪，不做长篇解释。

## 6. 题材路由表

| 用户选择 | 主题材 Skill | 默认联动 |
|---|---|---|
| 男频 + 玄幻/修仙/仙侠/高武 | `male-xuanhuan-xianxia` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/power-system`、`SheDingSkill/faction-system`、`SheDingSkill/map-progression` |
| 女频 + 玄幻/幻想言情/仙侠情缘 | `female-xuanhuan-fantasy` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/world-rules`、`SheDingSkill/power-system` |
| 男频 + 都市/都市异能/都市高武 | `male-urban-highmartial` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/power-system`、`SheDingSkill/map-progression`、`JueseSkill/character-design` |
| 男频 + 都市脑洞/系统流 | `male-urban-system` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/idea-market-positioning`、`SheDingSkill/power-system` |
| 男频 + 御兽/宠兽进化 | `male-beast-taming` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/power-system`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 男频 + 领主/基建/领地经营 | `male-lord-building` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/faction-system`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 男频 + 模拟器/未来预演/读档循环 | `male-simulator-loop` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense`、`SheDingSkill/power-system` |
| 男频 + 幕后流/组织马甲 | `male-behind-the-scenes` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/foreshadowing-suspense`、`JueseSkill/supporting-cast`、`SheDingSkill/faction-system` |
| 男频 + 长生流/时代更替 | `male-longevity-flow` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 男频 + 凡人流/谨慎修仙 | `male-mortal-cultivation` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/power-system`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense` |
| 男频 + 赘婿/隐藏身份反击 | `male-son-in-law-counterattack` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/idea-market-positioning`、`JueseSkill/supporting-cast` |
| 男频 + 反派流/逆天改命 | `male-villain-protagonist` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense`、`SheDingSkill/world-rules` |
| 规则怪谈/悬疑/悬疑灵异 | `rule-mystery-suspense` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense` |
| 无限流/科幻/末世 | `male-infinite-sci-fi-apocalypse` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/map-progression`、`SheDingSkill/foreshadowing-suspense` |
| 历史/历史脑洞/抗战谍战/年代 | `male-history-alt-history` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/idea-market-positioning`、`JueseSkill/supporting-cast` |
| 文娱娱乐圈/直播文/电竞 | `entertainment-livestream-esports` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/idea-market-positioning`、`JueseSkill/supporting-cast` |
| 种田/经营/冒险 | `farming-business-adventure` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/faction-system`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 西幻/克苏鲁/黑暗题材 | `western-fantasy-cosmic-dark` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/power-system`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 现言/现言脑洞 | `female-modern-romance` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design` |
| 女频 + 豪门总裁 | `female-rich-family-ceo` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design` |
| 女频 + 追妻火葬场/狗血言情 | `female-chasing-wife` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 替身文 | `female-substitute-romance` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 古言/宅斗/宫斗 | `female-house-palace` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/faction-system`、`JueseSkill/supporting-cast` |
| 女频 + 职场婚恋/青春甜宠 | `female-workplace-youth-sweet` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design` |
| 女频 + 悬疑/民国言情 | `female-mystery-republic` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/foreshadowing-suspense`、`JueseSkill/relationship-emotion` |
| 女频 + 年代/重生改命/换亲 | `female-period-rebirth` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/idea-market-positioning`、`JueseSkill/relationship-emotion`、`JueseSkill/supporting-cast` |
| 女频 + 穿书/炮灰觉醒/拯救反派 | `female-book-transmigration` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense`、`JueseSkill/relationship-emotion` |
| 女频 + 重生复仇/信息差打脸 | `female-rebirth-revenge` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 团宠/萌宝/亲情治愈 | `female-family-pampering-child` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/supporting-cast`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 种田经商/事业成长 | `female-farming-business` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/faction-system`、`SheDingSkill/map-progression`、`JueseSkill/supporting-cast` |
| 女频 + 强取豪夺/权力差恋爱 | `female-possessive-romance` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 女频 + 暗恋/破镜重圆/久别重逢 | `female-secret-love-reunion` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 世情/家庭矛盾/弱者反击 | `family-drama-short` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 知乎/强钩子/反转审判 | `zhihu-short` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 死人文学/死后追悔 | `short-death-regret` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 婚恋背叛/离婚反击 | `short-marriage-betrayal` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 重生复仇 | `short-rebirth-revenge` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 公开审判式打脸 | `short-public-trial-face-slap` | `DagangSkill`、`ZhanggangSkill`、`JueseSkill/supporting-cast`、`SheDingSkill/foreshadowing-suspense` |
| 短篇 + 灵魂视角/死后旁观 | `short-soul-perspective` | `DagangSkill`、`ZhanggangSkill`、`SheDingSkill/world-rules`、`SheDingSkill/foreshadowing-suspense`、`JueseSkill/relationship-emotion` |
| 同人（任意受众/篇幅） | `fanfic-derivative` | 对应题材 Skill、`DagangSkill`、`ZhanggangSkill`、`JueseSkill/character-design`、`JueseSkill/relationship-emotion`、`SheDingSkill/foreshadowing-suspense` |

### 同人的特殊路由

同人不是「再加一个题材」，而是一种**创作类型**。路由时：

1. 先确认**创作类型 = 同人**，并取得同人模式（`canon` / `au` / `ooc` / `cp` / 自定义）与「容许偏离」清单。
2. 再取**原作正典**（`.novel/fanfic-canon.md`）。**没有正典不得进入生成**，只能先追问原作素材。
3. 然后按受众 + 题材取对应题材 Skill，与 `fanfic-derivative` **叠加**加载。
4. 输出顺序：**原作正典卡 → 题材卡 → 总纲/卷纲/章纲/人物/设定**。
5. 正典与题材规则冲突时，以**正典**为准；确需改动原作既成事实时，必须列入「容许偏离」。

## 7. 质量检查

- 是否已同时确认篇幅、男频/女频、题材分类和用户灵感。
- 是否已输出题材卡，而不是直接生成大纲正文。
- 同人类型是否已先输出**原作正典卡**，并核对了出场角色在该时间点的**已知信息**。
- 同人类型是否存在与正典冲突的设定、能力、身份或关系；如有，是否已列入「容许偏离」。
- 同人类型是否在复读原作场景，而不是建立新的戏剧线。
- 是否区分了男频玄幻和女频玄幻、男频复仇和女频复仇。
- 是否把用户灵感改造成核心梗、情绪缺口和读者承诺。
- 是否为大纲、章纲、人物、设定分别给出生成重点。
- 是否没有调用正文生成 Skill 作为 AI 大纲阶段的默认联动。
- 是否给出题材风险与避坑，防止后续章纲偏题。
