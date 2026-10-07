# QMAI 4.1.1 更新内容清单（草案原文）

> 以下即为将写入 `src/lib/changelog.ts` 的 `highlights` 原文。
> 分节标题（`### 一、…`）不在仓库中，是发版后用于 GitHub Release 正文的人工编排。
> 状态：**待确认**。

---

## 建议的 GitHub Release 分节

### 一、拆书库工作台

1. 【结果面板精简】移除结果版本下拉、搜索框、仅待确认、汇总状态行、整版「确认并加入」与导出结果六项，生成结果直接展示
2. 【结果自动入库】打开结果即自动发布尚未入库的新版本，不再需要逐版手动确认；旧版（legacy）条目仍保持手动导入，避免与新版产生重复角色
3. 【成果对象可删除】每个对象新增删除按钮（二次确认），删除会真正移除灵魂库中的对应条目；并记录删除状态，避免重新入库时「删了又回来」
4. 【版本合并为一份列表】各版本对象卡合并为一份连续列表（旧版本在前），修订与删除按钮紧挨；版本级内容（导图、证据索引、与上一版的变化、补充修订）保留并移至列表之后
5. 【证据索引下沉】证据索引移入每张卡片，只列出该成果自己引用的原文，与同一行的「N条依据」共用同一个证据集合
6. 【清理冗余标记】移除「已入库/待确认」状态徽标与旧版来源标签，整版统计一并移除
7. 【角色绑定对话框】新增搜索框、改为每行 5 个、支持忽略与恢复；加宽至 760px 并修正纵向裁切，常见角色名不再显示不全
8. 【旧版角色整合】旧版角色迁移为新版条目并并入对应页签，旧版结果改为常显；故事页签的旧版区标注为「历史导图」与新版当前导图区分
9. 【支持删除作品】作品下拉每一项与顶部当前作品均可删除（保留二次确认）
10. 【识别失败可重试】角色识别失败后「开始分析」不再被锁死

### 二、角色灵魂库

11. 【打开不再等 3 分钟】修复进入灵魂库后长时间只显示空状态：人物名单拆成「本地秒回」+「后台精修」两段，灵魂列表不再被人名扫描阻塞
12. 【人物名单缓存】按文件指纹持久化缓存人物名单，不再每次打开都重扫大纲并串行等待模型超时，过滤「编号派通用手段」「冲突点」「当前状态」等非人名条目
13. 【修复精修结果被抹掉】缓存写回改为读-改-写，避免覆盖已落盘的精修结果
14. 【修复「已精修」误标】LLM 精修按真实失败形态判定成功，失败不再被永久标记为已完成（此前会导致只能由模型发现的人物永不出现，且无报错）
15. 【修复人名永久消失】实体页读取失败时不再留下残缺缓存

### 三、记忆中心

16. 【单页重构】拆掉嵌套的两层双栏，改为整窗单页：分类变为顶部标签条，内容独占全宽，快照详情在同页内返回并保留滚动位置
17. 【大纲快照可查看】此前大纲快照只用于计数、从不渲染，实际无法打开；现按标题排序正常展示
18. 【修复快照数量错误】修复大纲快照被截断导致的计数不符（显示 9 而实际 10）

### 四、章节目录

19. 【记忆状态绿点】已提取记忆的章节显示绿点，提取中显示灰点脉冲；按路径而非标题判定，「提取中」不会因标题重名同时点亮两行

### 五、大纲与文档

20. 【修复「HTML 形式」永久置灰】任何大纲类型都会生成 HTML；此前「像章纲但缺结构化数据」（例如从大纲继续生成章纲）必然产出无 HTML 的请求
21. 【需求分析浮层】需求分析改为面板内锚定浮层并给出具体选项，选项不再空白（四层兜底），也不再被拖动窗口等操作误关
22. 【档案文档配色体系】八类档案模板补齐卡片、字段、表格、斑马纹、侧栏与投影令牌，加入分区强调色轮转
23. 【修复分区导航跳空白页】档案文档内的锚点导航不再清空整个文档
24. 【修复深色皮肤对比度】修复星夜皮肤下档案文档正文对比度过低的问题，三套皮肤均达 WCAG AA

### 六、界面与输入

25. 【回复时间带日期】AI 回复的结束时间当天仍只显示时刻，更早的记录补月日，跨年补完整年月日
26. 【等待文案整段显示】生成中的等待文案不再忽隐忽现，正文出现后仍保留俏皮文案
27. 【记忆提示不被遮挡】草稿「提取记忆」提示不再被正文盖住
28. 【模型限额选择器】自定义模型的上下文窗口与输出上限改用统一预设选择器，输出上限与所选上下文联动

---

## 英文条目（`highlights.en`）

1. [Streamlined Result Panel] Removed six items from the result panel — version dropdown, search box, pending-only filter, summary status row, whole-version "Confirm & Add" and export — so generated results are shown directly.
2. [Automatic Ingestion] Opening results now auto-publishes versions that are not yet in the library, with no manual per-version confirmation; legacy entries still require manual import so they cannot duplicate new-style characters.
3. [Deletable Result Objects] Every object gains a delete button (with confirmation) that truly removes the matching soul-library entry, and the deletion is recorded so it cannot come back on the next ingestion.
4. [Versions Merged Into One List] Object cards from all versions are merged into one continuous list (oldest first) with the revision and delete buttons adjacent; version-level content (story map, evidence index, changes since the previous version, supplementary revisions) is kept and moved after the list.
5. [Evidence Index Moved Into Cards] The evidence index now sits inside each card and lists only the source text that this result itself cites, sharing one evidence set with the "N items of evidence" on the same row.
6. [Redundant Markers Removed] Removed the "in library / pending" status badge, the legacy origin tag and the whole-version statistics block.
7. [Character Binding Dialog] Added a search box, five items per row, and ignore/restore; widened to 760px and fixed vertical clipping so common character names are no longer cut off.
8. [Legacy Characters Integrated] Legacy characters migrate into new-style entries and are merged into the matching tab, legacy results are always shown, and the legacy area of the story tab is labelled "Historical Map" to distinguish it from the current map.
9. [Delete Works] Any entry in the works dropdown and the current work at the top can be deleted, both with confirmation.
10. [Retry After Recognition Failure] A failed character recognition no longer locks the "Start Analysis" button.
11. [No More 3-Minute Wait] Fixed the soul library showing an empty state for a long time: the character list is split into an instant local pass and a background LLM refinement, so the soul list is no longer blocked by name scanning.
12. [Character List Cache] Character names are cached by file fingerprint instead of rescanning outlines and waiting on model timeouts on every open, filtering out non-name entries.
13. [Refinement Results Preserved] Cache write-back is now read-modify-write, so refined names already on disk are not overwritten.
14. [Fixed "Refined" Mislabeling] LLM refinement is judged by its real failure shapes; a failure is no longer permanently marked as done (which previously hid model-only characters with no error at all).
15. [Fixed Names Disappearing] A failed entity-page read no longer leaves a partial cache behind.
16. [Single-Page Rebuild] The two nested two-column layouts are gone: categories become a top tab strip, content takes the full width, and snapshot details open in the same page with scroll position preserved.
17. [Outline Snapshots Viewable] Outline snapshots were previously only counted and never rendered, so they could not be opened at all; they are now listed and sorted by title.
18. [Fixed Snapshot Count] Fixed the mismatch caused by truncating outline snapshots (showing 9 while there were 10).
19. [Memory Green Dot] Chapters with extracted memory show a green dot and chapters being extracted show a pulsing gray dot, keyed by path rather than title so duplicate titles cannot light up two rows at once.
20. [Fixed Permanently Disabled "HTML"] Every outline type now produces HTML; previously the common "looks like a chapter outline but lacks structured data" case (for example continuing from an outline) always produced a request with no HTML.
21. [Requirement Analysis Overlay] Requirement analysis is now an overlay anchored inside the panel with concrete options that are never empty, and it is no longer dismissed by dragging the window.
22. [Profile Document Color System] All eight profile templates gained tokens for cards, fields, tables, zebra striping, sidebars and shadows, plus rotating section accent colors.
23. [Fixed Blank Page on Section Navigation] Anchor navigation inside profile documents no longer clears the whole document.
24. [Dark Skin Contrast] Fixed the very low body-text contrast of profile documents under the starry-night skin; all three skins now meet WCAG AA.
25. [Reply Time With Date] AI reply end times still show only the time today, add month and day for older records, and a full date across years.
26. [Waiting Text Shown In Full] The generating wait text no longer flickers; the playful line stays after the body text appears.
27. [Memory Hint No Longer Covered] The draft "extract memory" hint is no longer covered by the body text.
28. [Model Limit Selectors] Custom models now use the shared preset selectors for context window and max output, with the output limit tied to the selected context size.

---

## 不计入用户说明的区间内容

这些是过程性提交，不面向用户：

- 设计/实施文档 29 个（拆书库、灵魂库、记忆中心）
- 测试与验证工具 16 个（便携版 exe 校验、真实浏览器几何检查、变异验证）
- 变更记录补全、推送前敏感信息审计脚本
- 3 个 merge 提交

## 风险与行为变更提示

发版时值得在 Release 正文里点明三点：

1. **结果自动入库**：以前需要手动点「确认并加入」，现在打开结果即自动发布未入库版本。这是有意变更。
2. **删除是真实删除**：删除成果对象会真正移除灵魂库条目，不可撤销（有二次确认）。
3. **移除了 6 项 UI**：若有依赖「导出结果」等功能的用法，本次之后不复存在。
