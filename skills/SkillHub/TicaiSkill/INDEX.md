# 题材 Skill 索引

进入任一题材 Skill 前，先读取 `GENRE_ROUTE_STANDARD.md`。AI 大纲固定流程必须按“篇幅类型 + 受众方向 + 题材分类 + 用户灵感 + 目标输出”路由，不提供男女频融合选项。

本目录只负责 AI 大纲体系的题材规则，默认联动 `DagangSkill`、`ZhanggangSkill`、`JueseSkill`、`SheDingSkill`。正文协作区后续可读取已确认章纲，但不在本题材路由中直接生成正文。

程序读取题材路由时优先使用上级目录 `ROUTE_MANIFEST.json`。需要补充新题材时，先查看 `GENRE_COVERAGE_EXPANSION.md`，未创建真实 Skill 前不得加入自动路由。

## 男频

- `male-xuanhuan-xianxia`：玄幻、修仙、仙侠、高武、西幻升级骨架。
- `male-urban-highmartial`：都市、都市异能、都市高武、神明复苏。
- `male-urban-system`：都市脑洞、系统流、金手指核心梗。
- `male-beast-taming`：御兽、宠兽进化、怪物伙伴、学院联赛。
- `male-lord-building`：领主、基建、领地经营、种田争霸。
- `male-simulator-loop`：模拟器、人生模拟、未来预演、读档循环。
- `male-behind-the-scenes`：幕后流、组织马甲、暗中布局、操盘世界。
- `male-longevity-flow`：长生流、时代更替、代际传承。
- `male-mortal-cultivation`：凡人流、低天赋修仙、谨慎生存。
- `male-son-in-law-counterattack`：赘婿、隐藏身份、家族羞辱、社会打脸。
- `male-villain-protagonist`：反派流、逆天改命、夺取气运。
- `rule-mystery-suspense`：规则怪谈、悬疑、悬疑灵异。
- `male-infinite-sci-fi-apocalypse`：无限流、科幻、末世。
- `male-history-alt-history`：历史、历史脑洞、年代、抗战谍战。
- `entertainment-livestream-esports`：文娱娱乐圈、直播文、电竞。
- `farming-business-adventure`：种田、经营、冒险。
- `western-fantasy-cosmic-dark`：西幻、克苏鲁、黑暗题材。

## 女频

- `female-modern-romance`：现言、现言脑洞、职场外壳的情绪线。
- `female-rich-family-ceo`：豪门总裁、先婚后爱、霸总甜宠。
- `female-chasing-wife`：追妻火葬场、狗血言情、虐后翻盘。
- `female-substitute-romance`：替身文、白月光、身份反转。
- `female-house-palace`：古言、宅斗、宫斗。
- `female-xuanhuan-fantasy`：幻想言情、女频玄幻、仙侠情缘。
- `female-workplace-youth-sweet`：职场婚恋、青春甜宠。
- `female-mystery-republic`：女频悬疑、民国言情。
- `female-period-rebirth`：年代、重生改命、换亲、军婚、家庭反击。
- `female-book-transmigration`：穿书、炮灰觉醒、恶毒女配改命、拯救反派。
- `female-rebirth-revenge`：重生复仇、前世惨死、信息差打脸。
- `female-family-pampering-child`：团宠、萌宝、亲情治愈、找回家人。
- `female-farming-business`：种田经商、穿越经营、事业线成长。
- `female-possessive-romance`：强取豪夺、权力差恋爱、虐恋拉扯。
- `female-secret-love-reunion`：暗恋、破镜重圆、久别重逢、遗憾弥补。

## 短篇

- `family-drama-short`：世情、家庭矛盾、弱者反击。
- `zhihu-short`：知乎短篇、强钩子、反转、情绪审判。
- `short-death-regret`：死人文学、死后追悔、不可逆失去。
- `short-marriage-betrayal`：婚恋背叛、出轨、财产转移、离婚反击。
- `short-rebirth-revenge`：短篇重生复仇、反常选择、集中清算。
- `short-public-trial-face-slap`：公开审判式打脸、证据连环揭露。
- `short-soul-perspective`：灵魂视角、死后旁观、无力阻止。

## 同人（跨受众、跨篇幅）

- `fanfic-derivative`：同人、二创、衍生文、原作续写、原作番外、AU、OOC、CP 向、穿书、动漫/影视/小说/游戏同人。

同人与其它题材是**叠加**关系：`同人 + 玄幻` 应同时加载 `fanfic-derivative` 与对应题材 Skill。
同人类型额外要求先有**原作正典**（`.novel/fanfic-canon.md`），并先输出**原作正典卡**再输出题材卡。

## 输出要求

- 先输出题材卡：篇幅类型、受众方向、题材分类、用户灵感、读者承诺、核心卖点、结构策略、联动生成要求、风险与避坑。
- 同人类型在题材卡**之前**先输出**原作正典卡**：世界观硬规则、主要人物的身份/性格/语言习惯/能力边界/已知信息、关键关系、时间线、禁忌、原作未交代的空白。
- 生成总纲时：题材 Skill + `DagangSkill`。
- 生成章纲时：题材 Skill + `ZhanggangSkill` + 对应人物/设定 Skill。
- 生成人物小传时：题材 Skill + `JueseSkill`。
- 生成世界观、势力、地图、伏笔时：题材 Skill + `SheDingSkill`。
- 输出可保存内容时：必须遵循上级目录 `AI_OUTLINE_OUTPUT_PROTOCOL.md` 和 `OUTLINE_FOLDER_STORAGE_STANDARD.md`。
- 需要检查质量时：追加 `QualitySkill/outline-quality-check`。
