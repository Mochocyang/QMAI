# 记忆快照「出场物品」分析与优化方案

> 分支 `work/scratch-20261009` ｜ 2026-10-09
>
> **状态：已实施。** §1–§2 记录的是**改造前**的现状与体检结论，
> §3 是方案（§3.4 已按核查结果修正），**§7 是实施记录与实测结果**。
>
> 结论先行：**物品原本是「只写不读」的 —— 提取了、落盘了、但几乎从不进入写作提示词。**
> 所以「优化之后能不能正常读取」这个问题的答案是：**必须先修可达性，否则把分类做得再细也读不到。**

---

## 1. 现状：物品写进了快照，却读不回来

### 1.1 四个环节里，物品只有一个环节是通的

| 环节 | 物品是否参与 | 证据 |
|---|---|---|
| 提取（章节 → 快照） | ✅ 参与 | `chapter-ingest-extract.ts:67` 要求 `"items": []`；`:81` 要求 `itemDetails` |
| 落盘（快照 → 磁盘） | ✅ 参与 | `chapter-ingest.ts` 的 `ChapterSnapshot.items` / `itemDetails` |
| **装配（快照 → 上下文包）** | ❌ **不参与** | 见 §1.2 四条硬证据 |
| 校验（快照 → 事实核查） | ⚠️ 只用到 `holder` 一个字段 | `fact-snapshot.ts:179-188` |

### 1.2 「装配」环节读不到物品 —— 四条硬证据

**证据一：`ContextPack` 根本没有物品字段。**
`context-engine.ts:35-65` 的 `FIELD_PRIORITY` 共 22 个字段，没有任何物品槽位；
`FIELD_CONFIGS`（`:1073-1097`）同样没有。物品不在包里，自然不出现在提示词里。

**证据二：物品不是数据源。**
`context-data-sources.ts:39-63` 的 `DATA_SOURCE_CATEGORY_MAP` 里没有 `items` 键。
物品既不是独立数据源，也没挂到任何既有数据源上。

**证据三：检索 query 里从来没有「物品」语义。**
- 统一检索：`context-engine.ts:864-875`，query = 任务文本 + `第 N 章` + 实体名提示 + `"伏笔 人物 设定 时间线"` —— 四个词里没有「物品/道具」。
- 相关设定：`context-data-sources.ts:324`，query 硬编码为 `"setting 设定 location 地点"`。
  **这里有个很有说服力的错位**：该数据源渲染出来的段标题却是
  `## 相关地点/组织/物品`（`src/i18n/zh.json:1627`）——
  标题承诺了物品，检索式却只找地点。

**证据四：图谱分支只取邻居、且内容被 frontmatter 吃掉。**
`context-engine.ts:984-1005`：对命中的节点取 5 个邻居，把**邻居**的
`content.slice(0, 300)` 塞进候选。两个问题：
1. **命中节点自己从不进结果**（`:988-990` 只把它塞进 `seenIds` 就丢弃了），
   图谱永远只返回「和物品相关的东西」，不返回物品本身；
2. `graph-adapter.ts:401-421` 的 `buildEntityPage` 生成的页面，光 YAML frontmatter
   就有 14 行（`type`/`title`/`created`/`updated`/`tags`/`aliases`/`related`/
   `snapshot_id`/`source_type`/`source_sequence`/`source_revision`/`is_historical`/`sources`），
   300 字符基本被 frontmatter 耗尽，真正的正文
   （`## 当前持有者/能力/限制/来源`）**在切片之外**。

### 1.3 唯一能偶然读到的路径（不可依赖）

物品名**恰好字面出现在任务文本里**时：
任务文本 → 关键词检索命中 `wiki/entities/<物品名>.md`
（该路径被 `search-adapter.ts:55-59` 的 `isAuthoritativeGenerationPath` 放行）
→ LLM 精排进 top10 → 进 `searchResults`。

这条路径要求「用户/细纲里正好写了物品名」，且靠的是**通用关键词检索**，
不是任何「物品记忆」机制。所以现状是：**物品记忆对写作几乎没有贡献。**

---

## 2. 除可达性之外，还有 5 类可优化点

### 2.1 提取提示词对物品零指导（根因之一）

`chapter-ingest-extract.ts:67` 只有一行 `"items": []`，没有任何要求说明。
对比同一份提示词里 `characters` 有 `characterAliases` 的补充规则（`:64`、`:85`），
物品连「什么算物品」「要不要收一次性道具」都没说。
后果：不同章节的提取质量随机，模型可能只收关键道具，也可能把「一杯茶」当物品收进来。

`itemDetails`（`:81`）要求 5 个字段 `holder / previousHolders / abilities / limitations / origin`，
但**下游只消费 `holder`**（`fact-snapshot.ts:183-185`）——
其余 4 个字段每次提取都在花 token，产出后无人读取。

### 2.2 一堆只写不读的死重

| 字段 | 状态 |
|---|---|
| `graphNodes` | 提示词根本没要求输出（`chapter-ingest-extract.ts:58-83` 里没有），`snapshotToGraphNodes` 也不读它 |
| `entityIsNew` | 无任何读取方 |
| `validationWarnings` | 只写进 `.snapshot.md` 供人看 |
| `eventDetails` | 永远不会成为实体页 —— `STABLE_PATCH_ENTRY_TYPES` 只含 character/location/organization/item（`graph-adapter.ts:336-341,355-358`，`graph-adapter.test.ts:253-298` 钉住） |
| `relationshipChanges` | 下游忽略 |
| `.search-index.json` / `.vector-index.json` | 无读取方；向量分块没有物品 kind |
| `itemDetails.{previousHolders,abilities,limitations,origin}` | 见 §2.1 |

### 2.3 快照没有 `schemaVersion`（**改结构时最危险的一点**）

`ChapterSnapshot` 没有版本号。一旦 `items` 从 `string[]` 变成对象数组，
**磁盘上已有的全部快照会被新版代码按新形状解读**，而没有任何迁移或版本判断。
书越老、快照越多，风险越大。

### 2.4 改 `items` 形状会踩的隐性陷阱

这是本次改造**风险最高**的一条：

```
chapter-ingest.ts:138-147  normalizeSnapshotList()
  → value.map((item) => normalizeSnapshotText(item).trim()).filter(Boolean)
```

它把每个元素交给 `normalizeSnapshotText`。若 `items` 变成对象数组：
- 元素被 `String()` 成 `"[object Object]"` 这类垃圾，**或者**
- 被 `filter(Boolean)` 静默丢弃。

两种结果都**不报错**。表现是「物品莫名其妙全没了」，而日志干净。
同一批对象还会污染图谱（`graph-adapter.ts:175-177,248-250,518` 直接用它建节点/边），
生成 `[object Object]` 的节点与文件；快照查看器
（`snapshot-viewer.tsx:11-24,74-86,199,220`）的回写也会把结构拍平。

**因此：不要直接改 `items` 的元素类型。** 见 §3.2 的方案。

### 2.5 分类需要一把「有没有意义」的尺子，而它必须是**相对**的

用户要求把出场物品分成「主角使用 / 配角使用 / 反派使用 / 没有意义的物品」。
前三类是**归属**判断，第四类是**价值**判断，难度完全不同：

- 归属：可从文本（谁用/谁持有）判断；
- **有没有意义：不能孤立判断**。「一把钥匙」在第一次出现时是闲笔，
  在第 30 章揭示它是祖宅钥匙时就有意义。所以「无意义」只能相对
  **已建立的内容**（人物小传、伏笔表、大纲、既往快照）来判，
  这也正是用户自己的表述 ——「要对着前面已写的内容判断」。

---

## 3. 优化方案

### 3.1 先修可达性：给 `buildSectionBriefing` 加「相关道具」小节（**关键一步**）

**为什么选这里**：`sectionBriefing` 的 `FIELD_PRIORITY = 0`
（`context-engine.ts:36`）—— 它是**最后才被裁剪**的字段，几乎是保底通道。
物品数据只要进了这里，就能稳定到达提示词，不必新增数据源。

**为什么不去新增数据源**：新增数据源要同时改
`context-hub/source-paths.ts:3-27`（kinds）与 `:69-99`（依赖前缀），
否则缓存会**永久陈旧**（数据变了但缓存不失效）；
若结果依赖任务文本，还要进 `data-source-cache.ts:77-82` 的 `TASK_SCOPED_SOURCES`。
改动面大、回归风险高，而收益与走 `sectionBriefing` 相同。

**做法**：在 `section-briefing.ts` 里按 `characterNames` 已经算好的出场角色，
从物品快照里筛选「本章相关物品」，输出：

```markdown
### 相关道具
- 玄重尺 — 当前持有：萧炎（主角）；能力：…；限制：…
```

筛选口径建议：物品的 `holder` 在本章出场角色中，**或**物品名出现在本章细纲/任务文本里。

### 3.2 分类用「旁挂」而不是改 `items`（避开 §2.4 陷阱）

**不改** `ChapterSnapshot.items: string[]`。新增一个平级字段：

```ts
itemCategories?: Record<string, "protagonist" | "supporting" | "antagonist" | "trivial">
```

理由：
- `items` 的形状不变 → `normalizeSnapshotList` 不会静默吞数据，
  图谱、快照查看器、既有磁盘快照全部继续工作；
- 新字段缺失时优雅降级（等同「未分类」），天然向后兼容，**因此不必先补 `schemaVersion`**；
- 名称 → 类别的映射与 `items` 一一对应，读取时 `itemCategories[name] ?? "unknown"`。

同时按 §2.3 补 `schemaVersion`，为**将来**的形状变更留出判断依据（本次不做迁移）。

### 3.3 分类怎么判：先规则、后模型，且「无意义」要对着已有内容

1. **归属（主角/配角/反派）**：复用既有角色词汇表
   `男主|女主|男配|女配|反派|导师|盟友|配角|主角`（`character-multi-agent.ts:3-5`）
   与角色页命名约定 `wiki/characters/角色-<role>-<名>.md`（`character-save-extractor.ts:48-52`）。
   已知角色 → 查其 role；未知 → 交给模型。
2. **有无意义**：把「该物品名 + 出现章节」与**已建立内容**一起交给模型判断：
   人物小传、伏笔表（`foreshadowing-tracker.ts` 的 `importance` 是现成的分级先例）、
   大纲 §14「新增道具」（`chapter-outline-template.ts:574-582`）、既往快照摘要。
   提示词里必须写明：**判断依据是「是否与已建立的人物目标、伏笔、冲突相关」，
   而不是「是否贵重/稀有」。**
3. **落点**：分类结果随快照落盘，并在 §3.1 的「相关道具」小节里体现 ——
   `trivial` 的道具不进提示词（省 token），其余按持有者归组。

### 3.4 死重清理：**核查后推翻了自己的初判**（→ 后续已按核查结论单独清理，见 §8）

原计划「顺手清掉 `graphNodes`、`entityIsNew`、`relationshipChanges`」。
逐项核查读者后发现**初判有错**——其中三项其实都有下游读取方：

| 字段 | 初判 | 核查结果 |
|---|---|---|
| `graphNodes` | 死重 | ❌ **有读者**：`chapter-ingest-output.ts:240`、`graph-adapter.ts:122`（规范化）、`snapshot-viewer.tsx:209,230`（展示与编辑回写） |
| `relationshipChanges` | 死重 | ❌ **有读者**：`chapter-ingest-output.ts:164,181`、`fact-snapshot.ts:343-344`（真在比对关系变化） |
| `validationWarnings` | 死重 | ❌ **有读者**：`chapter-ingest.ts:708-712` 渲染 `.snapshot.md` 的「校验警告」段，是给人看的真输出 |
| `entityIsNew` | 死重 | ✅ 确认只写不读（仅 `chapter-ingest.ts:1275-1291` 写、无任何读者）→ §8 已删 |
| `.search-index.json` / `.vector-index.json` | 死重 | ✅ 确认只写不读（仅 `:1255-1256` 写；TS 与 Rust 两侧都搜过，零读者）→ §8 已删 |

**本轮一律不删。** 理由：初判在 5 项里错了 3 项，说明这类「看起来没人用」的结论
必须逐项验证，而不是靠阅读印象；而基于错误分析的删除比不删危险得多
（`graphNodes` 若按初判删掉，会直接砍掉快照查看器的编辑能力与图谱规范化）。
确认只写不读的两项已按核查结论**单独**清理，见 §8。

---

## 4. 回答「优化之后能不能正常读取」

分两种情况，答案不同：

| 做法 | 能否读到 | 说明 |
|---|---|---|
| **只做分类**（§3.2-3.3），不修可达性 | ❌ **仍读不到** | 物品照样进不了 `ContextPack`；分类只是让磁盘上的数据更整齐 |
| **先修可达性**（§3.1）再做分类 | ✅ **能读到** | 走 `sectionBriefing`（priority 0，几乎不被裁），物品随「本节速记」进入提示词 |

**所以顺序不能反：§3.1 是前置条件。**
只做分类会出现「分类做得很漂亮，写作时依然读不到」的结果 —— 这正是当前
`相关地点/组织/物品` 那个标题的翻版（承诺了物品，检索式里却没有物品）。

---

## 5. 验证计划（改动必须带测试）

1. **可达性**（核心断言）：构造一份含物品快照的工程 → 调 `buildContextPack()` →
   断言 `sectionBriefing` 含「相关道具」且含物品名 → 断言
   `contextPackToPrompt()` 的输出里出现该物品。
   *没有这条测试，本次优化等于没做。*
2. **不吞数据**：给 `items` 传对象数组，断言**不产生** `[object Object]` 节点/文件；
   断言 `normalizeSnapshotList` 的行为被明确钉住（当前是静默丢，需先决定新行为）。
3. **向后兼容**：旧快照（无 `itemCategories`）读取不报错，未分类物品按 `unknown` 处理。
4. **分类正确性**：`trivial` 物品不进提示词；主角/配角/反派按持有者正确归组。
5. **提示词长度**：`chapter-ingest-extract.spec.ts:18,33` 断言提取提示词长度
   `< 2400 + 2` —— 增加分类 schema 文字**会顶到这条**，需同步评估。

---

## 6. 一句话总结

物品现在的病根**不是分类不够细，而是根本没接进写作提示词**。
先按 §3.1 把它接进 `sectionBriefing`（priority 0 的保底通道），
再用 §3.2 的旁挂字段做四分类（避开 `normalizeSnapshotList` 的静默吞数据陷阱），
最后按 §5 用「打字到提示词」的端到端断言把通路钉死。

> **以上方案已实施完毕，实施记录与实测结果见 §7。**

---

## 7. 实施记录（已完成）

### 7.1 落地了什么

| 环节 | 文件 | 说明 |
|---|---|---|
| 收集/分类/筛选/排版 | `src/lib/novel/item-category.ts`（新） | 纯函数，便于单测；`items` 形状**未改** |
| 快照字段 | `src/lib/novel/chapter-ingest.ts` | 新增 `itemCategories?`；用**闭集**归一化器（认不出的分类丢掉，不落垃圾键）；`.snapshot.md` 的「出场物品」带上分类标签 |
| 提取提示词 | `src/lib/novel/chapter-ingest-extract.ts` | 增加 `itemCategories` schema + 归类口径（「有没有故事作用」而非「贵不贵重」）；支持注入已建立设定 |
| 已建立设定 | `src/lib/novel/extract-established-context.ts`（新） | 角色定位名册（**只列目录、不读正文**）+ 未回收伏笔；上限 1500 字 |
| **可达性** | `src/lib/novel/section-briefing.ts` | 新增「### 相关道具」小节，只读**本章之前**的 30 份章节快照 |
| 缓存失效 | `src/lib/context-hub/data-source-cache.ts` | `sectionBriefing: 2 → 3` |
| 角色词汇表 | `src/lib/novel/character-multi-agent.ts` | 导出 `CHARACTER_ROLE_TYPES`（避免第三份枚举副本） |

### 7.2 两个动手后才发现的关键事实

1. **`sectionBriefing` 的缓存接线早就是对的**，不必像初判那样担心：
   `source-paths.ts:98` 的依赖前缀**本来就含 `.novel/snapshots/`**，
   且它已在 `TASK_SCOPED_SOURCES`（`data-source-cache.ts:81`）里。
   所以「新读快照」不需要动任何缓存依赖声明——但**必须 bump 版本号**，
   否则旧缓存（用不含物品的代码算出来的）会因为依赖戳没变而一直命中，
   表现为「改了代码，提示词里始终没有道具」。
2. **§3.4 的死重初判错了 3/5**。详见 §3.4 的核查表。

### 7.3 实测结果

- 新增 3 个 spec 文件、+43 个用例：
  - `item-category.spec.ts` —— 归一化、跨快照合并、筛选、排版（含畸形数据防御）
  - `item-briefing-integration.spec.ts` —— **端到端**：磁盘快照 → `buildContextPack` → `contextPackToPrompt`
  - `extract-established-context.spec.ts` —— 角色名册解析与已建立设定构建
- **反向验证（防假绿）**：把「相关道具」小节临时关掉（`MAX_BRIEFING_ITEMS = 0`）后，
  端到端用例 7 条里**失败 6 条**，恢复后全绿 —— 证明这些断言真的在盯这条通路，
  而不是恰好通过。
- 全量：`npm run test:mocks` **714 文件 / 6874 通过**（基线 711 / 6831）；
  `typecheck` 与 `typecheck:tests` 均 exit 0。
- 提取提示词长度实测 **1379 字符**（预算 2402），新增分类说明后仍有充足余量。

### 7.4 已知边界

- **只读章节快照**，不读大纲快照（负数）。大纲快照里的 `items` 是**规划**，
  其 `holder` 是模型对未来剧情的推测，当「当前持有者」会误导正文。
- 往前看 30 章：再早的道具若本章未点名就找不回来。这是**有意的取舍**——
  无上限读取会让长篇（上千章）的上下文装配成本随书长线性上涨。
- 提取阶段的分类质量取决于模型；规则侧只保证**闭集收敛与不确定性不误判**
  （认不出的分类宁可丢掉，也不会当成主角道具注入）。

---

## 8. 后续清理：按 §3.4 的核查结论删掉两项确认无读者的产物

§3.4 核查后确认「只写不读」的是 `entityIsNew` 与两个索引文件，它们已单独清理。
**§3.4 里判定「有读者」的三项一个都没动。**

### 8.1 删了什么

| 产物 | 删除内容 |
|---|---|
| `entityIsNew` | `ChapterSnapshot` 字段、`normalizeEntityFlags()` 归一化器、三处写入点（章节提取路径 / 大纲路径 / 校验失败兜底）、`validateEntityReferences()` 里的逐实体标志位写入 |
| `.search-index.json` / `.vector-index.json` | 两行落盘、`SearchIndexText`/`VectorIndexText`/`SearchIndexSection`/`VectorIndexChunk` 四个类型、`buildSearchIndexText()`/`buildVectorIndexText()` 两个构建器及其私有 `section()`/`chunk()` 辅助函数，以及 `ChapterIngestOutput` 上的两个字段 |

**保留**：`validateEntityReferences()` 仍然照常产出 `type: "entity_new"` 的
`validationWarnings` —— 那条会渲染进 `.snapshot.md` 的「校验警告」段给人看，
是真输出。删掉的只是**顺带**维护的那份没人读的标志位映射。

### 8.2 删除前又核查了一遍（这次没有翻车）

- `.output.json` 的唯一读取方 `story-extractor.ts:300-302` **只取
  `data.wikiUpdatePatch.entries`**，不碰索引字段 → 从 `.output.json` 里去掉这两个字段是安全的；
- `SearchIndexText`/`VectorIndexText` 全仓库**没有任何外部导入方**（只在自己文件内用）；
- `.output.json` / `.wiki-patch.json` 确实有读者（story-simulation、graph-adapter），**保留**；
- `scripts/rebuild-novel-memory.mjs` 的清理正则 `/^(\d+)\./i` 匹配所有带章节号前缀的文件，
  删掉这两种文件不影响它；
- Rust 侧确认零引用。

### 8.3 防回归

- **行为断言**：`chapter-ingest-output.test.ts` 用 `Object.keys(output).sort()`
  钉死返回值**恰好**是 `graphDerivation` / `snapshotWikiFields` / `wikiUpdatePatch` 三项
  —— 少一项或多一项都会红，防止索引字段被无意加回来。
- **源码断言**：`chapter-ingest.spec.ts` 新增一组守卫，断言
  `chapter-ingest.ts` 里不再出现 `.search-index.json`、`.vector-index.json`、
  `entityIsNew`、`normalizeEntityFlags`，同时**仍含** `.output.json`、`.wiki-patch.json`
  与 `type: "entity_new"` —— 既有反向也有正向，避免「删过头」。

### 8.4 遗留：磁盘上的历史孤儿文件

老版本已经写下的 `NNN.search-index.json` / `NNN.vector-index.json` **仍在磁盘上**，
新代码既不读也不写、也不会再生成。**本次没有加清理逻辑**，原因：

- 清理是一件事务性迁移，不是删代码；`saveChapterIngestOutput()` 在摄取关键路径上，
  为「删两个没人读的文件」往里加 I/O 不划算；
- 不删的代价只是每章几 KB 的静默占用，没有任何功能影响。

> 顺带发现（**既有问题，非本次引入，未改**）：TS 侧没有任何代码删除
> `.novel/chapter-ingest-output/` 下的文件。所以删掉某章记忆后，
> 该章的 `NNN.output.json` 会留下，而 `story-extractor` 会继续从它重建角色
> —— 存在「已删章节的角色在推演里复活」的可能。只有
> `scripts/rebuild-novel-memory.mjs` 会清这个目录。这值得单独修。
