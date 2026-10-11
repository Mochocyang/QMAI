# QMAI 现状与「无法生成同人」根因

> 任务 2 的第二半：在**我们自己的软件**里核实现状，定位为什么同人类型生成不出来。
>
> 结论先说：**QMAI 的标签体系里其实已经有「同人衍生」，但它只是一个孤立的中文标签**——
> 顶部创作入口没有它、向导下拉选不到它、题材路由清单没有它、题材 Skill 没有它、
> 更要命的是**全软件没有「原作正典」这个概念**。所以用户即使硬选「自定义题材 = 同人」，
> 模型也只能把它当原创写，凭空编造角色与设定。
>
> 用一句话概括根因：**同人不是缺一个题材选项，是缺一整条「原作 → 正典 → 约束」的链路。**

---

## 1. 已核实的事实（逐条给证据）

### 1.1 标签表知道同人，仅此而已

`src/lib/novel/outline-genres.ts`（男频 18 类 / 女频 18 类 / 共 630 标签）里**确实存在**同人：

- 女频主分类：`{key:"tongren", label:"同人衍生"}`，14 个子题材
  `tongren_dongman 动漫同人 / tongren_yingshi 影视同人 / tongren_xiaoshuo 小说同人 / tongren_mingxing 明星同人 /
   tongren_hp 哈利波特 / tongren_huyan 复联漫威 / tongren_sanzhiquan 权游冰与火 / tongren_daomu 盗墓笔记 /
   tongren_douluo 斗罗大陆 / tongren_doupo 斗破苍穹 / tongren_quanzhi 全职高手 / tongren_mingzhen 名侦探柯南 /
   tongren_shenwei 神威万花筒 / tongren_yueying 火影忍者`
- 男频：`{key:"erciyuan",label:"二次元"}` 下有子题材 `erciyuan_tongren 同人衍生`
- 女频：`{key:"erciyuan_nv",label:"二次元"}` 下有子题材 `ecy_tongren 同人衍生`

但这个文件的**全部导出只有一个** `getMainGenreLabel()`（`outline-genres.ts:37`）——
也就是说它只提供「key → 中文名」的显示映射，**不参与任何路由、任何提示词、任何文件生成**。

### 1.2 大纲向导：频道只有男频/女频，题材列表里没有同人

`src/lib/novel/outline-wizard.ts`：

- `OutlineWizardChannel = "male" | "female" | "auto"`（`:12`），
  `OUTLINE_WIZARD_CHANNEL_OPTIONS`（`:64-69`）只有「男频 / 女频 / 暂不确定」。
- `MALE_GENRES`（`:182-210`，26 项）、`FEMALE_GENRES`（`:212-229`，15 项）里**没有 `tongren`，也没有 `erciyuan_tongren`**。
- `GENRE_SKILL_NAMES`（`:116-158`，共 43 条映射）里**没有任何同人条目**。
- `SUPPORT_SKILLS_BY_TOPIC`（`:160-180`）同理。
- `getOutlineWizardSkillNames()`（`:278-301`）：命中 `GENRE_SKILL_NAMES` 时加载题材 Skill + 联动技能；
  **未命中时退化**为 `idea-market-positioning` + `character-design`——这正是同人会拿到的待遇：
  一套「从零开始设计卖点和人物」的原创技能，而不是「贴着原作正典写新线」的技能。

`src/components/sources/outline-wizard-dialog.tsx:85-88` 的题材下拉直接来自
`getOutlineWizardGenres(request.channel)`，所以**UI 上根本点不到同人**。
唯一能碰到同人的路径是 `genre === "custom"` 手填中文（`:147`），
但手填的自由文本不进 `GENRE_SKILL_NAMES` 查表（`outline-wizard.ts:280` 用的是 `request.genre`，即值 `"custom"`），
**题材 Skill 依然加载不到**。

### 1.3 题材路由清单里没有同人

`skills/SkillHub/ROUTE_MANIFEST.json`（版本 1，`scope: "ai-outline"`）共 **34 条 route**，
覆盖男频 17 / 女频 15 / 短篇 7，**没有一条同人 route**；
`plannedCoverage`（`:383-387`）三个数组**全为空**——说明项目自己认为「已无待补题材」，
而同人确实不在任何计划里。

`skills/SkillHub/TicaiSkill/` 下 **40 个题材 Skill 目录**，**没有同人**。

### 1.4 项目自己的文档已经承认这个缺口

- `skills/SkillHub/TicaiSkill/GENRE_COVERAGE_EXPANSION.md:58-59`：下一批建议补齐表当前是「暂无 / 暂无 / 暂无」。
- `skills/SkillHub/EXTRACTION_REPORT.md:50`：
  > **男频：长生流、同人流、黑暗流细分、国潮非遗、军史、科举。**

即：**「同人流」在项目自述里被明确列为暂未细分项**，且此后再未被补齐。

- `skills/SkillHub/TicaiSkill/GENRE_ROUTE_STANDARD.md:10` 把路由输入定死为
  「篇幅类型 + 受众方向 + 题材分类 + 用户灵感 + 目标输出」，
  **不提供「原作 / 素材来源」这一维**——同人恰恰需要这一维。

### 1.5 全软件没有「原作正典」概念（最关键）

在 `src/` 全量检索 `同人 / fanfic / canon / 原作 / 二创`，命中的只有：

| 命中 | 位置 | 说明 |
|---|---|---|
| `canonRules` 字段 | `context-engine.ts:99`（`ContextPack`）、`FIELD_PRIORITY.canonRules = 17`（`:55`） | 上下文包里的「正史规则」槽位 |
| `canonRules` 数据源 | `context-data-sources.ts:335-348` | **模糊检索**：`searchWiki(projectPath, "canon 正史 rule 规则")` → 取**第 1 条** → **截断 2000 字** |
| `mustAvoid` | `context-engine.ts:423-425` | 把 `canonRules` 文本拼成「禁止违背」条目 |
| `中文「同人」` | 只在 `skills/` 与 `docs/` 的说明文档里（`EXTRACTION_REPORT.md:50`） | 代码侧零命中 |

也就是说：

1. **没有一个「用户导入的原作素材」入口**。`writing-entity-web-search.ts`、`dismantling.ts`（拆书）
   都是为了分析**自己的作品**或检索实体，不是为了承载外部原作。
2. **`canonRules` 不是正典**：它是「在 wiki 里模糊搜到的一篇文档的前 2000 字」，
   既不确定、也不可迭代、更无法区分「哪些是原作硬事实、哪些是本作新设定」。
3. **没有 `fanficMode`**：无法声明本作与原作的关系（延续 / 架空 / 重塑 / CP）。
4. **没有 `allowedDeviations`**：没有「允许偏离哪些原作事实」的白名单，
   因而审核阶段也无法判断「这里到底是崩设还是有意改动」。
5. **正典没有受保护优先级**：`FIELD_PRIORITY`（`context-engine.ts:35-59`）里
   最贴近的 `canonRules` 排在 17，往后的 `writingStyle(19) / searchResults(20) / graphSearchResults(21)`
   都比它更晚被裁，但**优先级 17 意味着它在 token 不足时会先于 `outline(6)` 等被裁掉**——
   而 `AGENTS.md` 里写明的上下文包优先级是
   「用户指定 > 章节细纲 > 上一章结尾 > **Canon 正史** > 人物状态 > 伏笔 > …」，
   即正典本应排在 `characterStates(9)` **之前**，现状与设计意图不符。

### 1.6 全书创建/生成链路都假设「原创」

- `outline-wizard.ts:356` 的充分性闸门要求的必要信息是
  「篇幅、频道、题材、故事灵感、核心卖点、作品规模、**主要人物方向**、**世界观/背景方向**、预期章节结构」——
  **全部是「要用户从零想」的项目**，没有任何一项是「原作是哪部 / 原作的既成事实是什么」。
- `outline-wizard.ts:270` 的校验只要求「灵感非空」，同人特有的「原作素材 + 模式」不参与校验。
- `src/lib/novel/project-meta.ts` 的 `NovelProjectMeta` 只有
  `id / title / genre / targetWords / novelMode / createdAt / updatedAt / currentChapter / totalChapters /
  totalWords / volumes / description`——**没有承载同人模式或正典指针的字段**。

---

## 2. 根因链（为什么「生成不出来」）

```
用户想写同人
  └─ 向导下拉只有 男频/女频/auto × 26+15 个原创题材   → 选不到「同人衍生」        [1.2]
      └─ 只能「自定义题材」手填中文                    → 自由文本不参与技能查表     [1.2]
          └─ 题材 Skill 加载不到同人 Skill             → 退化到 idea-market-positioning
                                                          + character-design（原创技能）[1.2]
              └─ ROUTE_MANIFEST / TicaiSkill 里没有同人  → 无从路由、无题材卡标准      [1.3]
                  └─ 提示词里没有「原作正典」这一维     → 模型把同人当原创，凭空编写   [1.4][1.6]
                      └─ 上下文里没有受保护的正典段     → 既成事实丢失、设定崩坏        [1.5]
                          └─ 没有 fanficMode / allowedDeviations
                             → 审核无法区分「有意改」与「写崩了」                    [1.5]
```

**可复现的判定标准**：即使在当前版本里手填「同人」并生成大纲，
产出的大纲也必然是「一本原创小说」——因为**没有任何机制把原作事实喂给模型**。
这正是用户观察到的「无法生成同人类型的小说」。

---

## 3. 缺口清单（按修复优先级）

| # | 缺口 | 影响 | 依据 |
|---|---|---|---|
| G1 | 大纲向导无「同人」入口（频道/题材/技能三重缺失） | 用户**选不到**，流程第一步就断 | §1.2 |
| G2 | 无同人题材 Skill 与路由条目 | 题材卡标准、大纲/章纲生成重点全缺 | §1.3 |
| G3 | 无「原作素材导入 → 正典文档」链路 | 模型无据可依，必然编造原作事实 | §1.5 |
| G4 | 无 `fanficMode` 元数据与 `allowedDeviations` 白名单 | 无法声明创作边界，审核无标准 | §1.5 |
| G5 | 正典未进受保护高优先级上下文段 | 长文里正典被裁，后段崩设 | §1.5 |
| G6 | 项目元数据无同人字段 | 正典指针/模式无处持久化，重开即丢 | §1.6 |
| G7 | 大纲向导充分性闸门不要求「原作 + 模式」 | 信息不足也照生成，产出废稿 | §1.6 |

---

## 4. 与 InkOS 的差距对照

| 能力 | InkOS | QMAI 现状 |
|---|---|---|
| 同人是否为独立创作入口 | 是（`fanfic_init` 意图 + 独立工具 + 独立确认卡） | 否（只是标签表里一个孤立中文名） |
| 同人模式 | `fanficMode` 自由文本，内置 canon/au/ooc/cp | **无** |
| 容许偏离清单 | `allowedDeviations: string[]` | **无** |
| 原作素材导入 | `fanfic init --from <文件或目录>`，目录合并 | **无** |
| 正典编译 | 专用 importer + 分片 + 结构化工具输出 | **无** |
| 正典落盘 | `story/fanfic_canon.md` | **无** |
| 正典进大纲 | system prompt 的 `## 同人模式` + `## 原作正典` | **无** |
| 正典进正文 | `protected` 上下文源 → 「正典约束证据」块 | **无**（仅模糊 `canonRules`，截断 2000 字） |
| 正典参与断点恢复 | 是 | 否 |
| 同人 Skill 强制激活 | 是，缺失即报错 | 否（无同人 Skill） |
| 同人审核维度 | 按 `fanficMode` + `allowedDeviations` 判 | 无 |
| 同人题材标签 | —（InkOS 不靠标签，靠 creation kind） | 有标签但**完全没接线** |

**结论**：QMAI 需要的不是「多加一个下拉项」，而是把 §3 的 G1–G7 按
**「入口 → 题材 Skill → 正典链路 → 元数据 → 上下文 → 审核」** 的顺序补齐。
