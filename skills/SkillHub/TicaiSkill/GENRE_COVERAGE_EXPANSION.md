# 题材覆盖扩展矩阵

本文件用于记录后续需要补齐的题材 Skill。当前不把未完成题材伪装成已完成 Skill；只有创建了对应 `SKILL.md` 并进入 `ROUTE_MANIFEST.json` 的题材，才允许程序自动路由。

## 1. 已覆盖题材

### 男频

- 玄幻、修仙、仙侠、高武、西幻升级：`male-xuanhuan-xianxia`
- 都市、都市异能、都市高武、神明复苏：`male-urban-highmartial`
- 都市脑洞、系统流、金手指核心梗：`male-urban-system`
- 御兽、宠兽进化、怪物伙伴、学院联赛：`male-beast-taming`
- 领主、基建、领地经营、种田争霸：`male-lord-building`
- 模拟器、人生模拟、未来预演、读档循环：`male-simulator-loop`
- 幕后流、组织马甲、暗中布局、操盘世界：`male-behind-the-scenes`
- 长生流、时代更替、代际传承：`male-longevity-flow`
- 凡人流、低天赋修仙、谨慎生存：`male-mortal-cultivation`
- 赘婿、隐藏身份、家族羞辱、社会打脸：`male-son-in-law-counterattack`
- 反派流、逆天改命、夺取气运：`male-villain-protagonist`
- 规则怪谈、悬疑、悬疑灵异：`rule-mystery-suspense`
- 无限流、科幻、末世：`male-infinite-sci-fi-apocalypse`
- 历史、历史脑洞、年代、抗战谍战：`male-history-alt-history`
- 文娱娱乐圈、直播文、电竞：`entertainment-livestream-esports`
- 种田、经营、冒险：`farming-business-adventure`
- 西幻、克苏鲁、黑暗题材：`western-fantasy-cosmic-dark`

### 女频

- 现言、现言脑洞、职场外壳情绪线：`female-modern-romance`
- 豪门总裁、先婚后爱、霸总甜宠：`female-rich-family-ceo`
- 追妻火葬场、狗血言情、虐后翻盘：`female-chasing-wife`
- 替身文、白月光、身份反转：`female-substitute-romance`
- 古言、宅斗、宫斗：`female-house-palace`
- 幻想言情、女频玄幻、仙侠情缘：`female-xuanhuan-fantasy`
- 职场婚恋、青春甜宠：`female-workplace-youth-sweet`
- 女频悬疑、民国言情：`female-mystery-republic`
- 年代、重生改命、换亲、军婚、家庭反击：`female-period-rebirth`
- 穿书、炮灰觉醒、恶毒女配改命、拯救反派：`female-book-transmigration`
- 重生复仇、前世惨死、信息差打脸：`female-rebirth-revenge`
- 团宠、萌宝、亲情治愈、找回家人：`female-family-pampering-child`
- 种田经商、穿越经营、事业线成长：`female-farming-business`
- 强取豪夺、权力差恋爱、虐恋拉扯：`female-possessive-romance`
- 暗恋、破镜重圆、久别重逢、遗憾弥补：`female-secret-love-reunion`

### 短篇

- 世情、家庭矛盾、弱者反击：`family-drama-short`
- 知乎短篇、强钩子、反转、情绪审判：`zhihu-short`
- 死人文学、死后追悔、不可逆失去：`short-death-regret`
- 婚恋背叛、出轨、财产转移、离婚反击：`short-marriage-betrayal`
- 短篇重生复仇、反常选择、集中清算：`short-rebirth-revenge`
- 公开审判式打脸、证据连环揭露：`short-public-trial-face-slap`
- 灵魂视角、死后旁观、无力阻止：`short-soul-perspective`

### 同人（跨受众、跨篇幅）

- 同人、二创、衍生文、原作续写、原作番外、AU、OOC、CP 向、穿书：`fanfic-derivative`

同人与其它题材是**叠加**关系，不是替代关系：`同人 + 玄幻` 需要同时加载 `fanfic-derivative`
与对应题材 Skill。同人还额外依赖一份**原作正典**（`.novel/fanfic-canon.md`），
没有正典就不允许进入生成。

## 2. 下一批建议补齐

| 方向 | 题材 | 建议 Skill 名称 | 优先级 | 需要联动 |
|---|---|---|---|---|
| 同人 | 单个原作的专属写法（如长篇同人的多原作融合） | 待定 | 低 | 需先积累 `fanfic-derivative` 的实际产出 |

## 3. 新增题材 Skill 标准

新增题材 Skill 时必须包含：

- `适用范围`
- `AI 大纲路由约束`
- `核心读者期待`
- `大纲生成规则`
- `章纲生成重点`
- `AI 大纲联动`
- `test-prompts.json`

并同步更新：

- `TicaiSkill/INDEX.md`
- `ROUTE_MANIFEST.json`
- `ROUTING_MEMORY.md`
- `GENRE_ROUTE_STANDARD.md` 的题材路由表

## 4. 禁止事项

- 未创建真实 Skill 前，不得把题材加入自动路由。
- 不得用男频 Skill 覆盖女频同名题材。
- 不得用长篇 Skill 覆盖短篇强反转题材。
- 不得把正文 Skill 作为 AI 大纲题材路由默认联动。
