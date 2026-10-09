# QMAI 4.2.0 更新内容清单

> **对比基线**：v4.1.2（2026-10-07）→ v4.2.0（2026-10-09）
> **本文件用途**：可对外发布的更新日志。下面「建议的 GitHub Release 分节」可直接作为 Release 正文；
> `src/lib/changelog.ts` 的 `highlights` 是它的精简条目（应用内「更新日志」与自动生成的 Release 正文由它产出）。
> **状态**：已发布 —— 发布提交 `a0cefd6`，标签 `v4.2.0`。
> 文中每条都回到源码核对过；括号内的数值取自 `src/lib/font-settings.ts` 的边界常量与
> `src/stores/wiki-store.body-typography.spec.ts` 的迁移用例，不照抄提交信息。

---

## 更新概览

这一版的主题是**「把字交给你自己管」**：

- **字体**：随包 9 款中文字体（11 个字重文件），装完即有，不需管理员权限；
- **排版**：正文与界面彻底分家，正文字号改绝对像素并与界面字号解耦，可调参数从 1 项扩到 6 项；
- **写作现场**：新增「字体设置」浮层与底部写作字数状态栏；
- **新题材**：同人创作，配「原作正典」按固定路径注入；
- **修复**：卷纲内容被静默丢弃、正文滚不动、安装包打不出来、中文用户名下卸载清理失效、设置不落盘等。

---

## 建议的 GitHub Release 分节

### 一、字体：随包 9 款中文字体

1. 【随包中文字体】此前字体列表只能用系统里已装的字体，列表里还混着 Arial 等西文，换一台机器就可能选不出可用字体。现随软件附带 **9 款已核实可商用的中文字体**（共 11 个字重文件）：思源宋体、思源黑体（各含 Bold）、霞鹜文楷、文津宋体、寒蝉正楷体、鸿蒙黑体、得意黑、朱雀仿宋、更纱黑体
2. 【装到当前用户即可】随包字体安装到**当前用户**，不需要管理员权限；「装完从未启动过」这个空档也补上了
3. 【界面字体只在中文范围内列选】Arial 等西文字体已从**界面字体**选项移除
4. 【鸿蒙黑体许可告知】按该字体许可证的强制要求在软件中显著注明

### 二、正文与界面彻底分家

5. 【修复「改正文把整个界面一起改掉」】此前在章节里改正文字体，整个界面（导航、按钮、品牌名）会跟着一起变；现在两者完全独立——**改正文不影响界面，改界面不影响正文**
6. 【正文字号改绝对像素并与界面字号解耦】正文字号可调 **12–32px**（预设：小 15 / 默认 18 / 大 21 / 特大 24），不再乘界面字号——把界面调大方便点按钮，正文不会跟着一起变大
7. 【旧设置自动迁移】旧的倍数字号会按当时的界面字号自动换算为像素值（例：旧倍数 1.25 且界面 100% → 23px；旧倍数 1 且界面 150% → 27px），不需要你重设

### 三、排版参数从 1 项扩到 6 项

8. 【6 项排版参数】正文字体、正文字号（预设 + 滑块）、行间距（1.2–2.6）、字间距（−1–6）、左右边距（0–160）、底部安全距离（0–240）
9. 【修复「最后一行贴着窗口底边」】新增「底部安全距离」，长章节滚到底不再顶住窗口下沿
10. 【拖动只写一次】滑块连续拖动只在停下后落盘一次，拖得久也不会卡

### 四、写作现场的「字体设置」浮层

11. 【章节与大纲都能开】两个工具栏都新增「字体设置」浮层，图标是 Type（`T`），与「一键排版」的魔法棒**刻意区分开**
12. 【6 项参数从设置页移入浮层】在写作现场就能调排版，不必来回跳设置页
13. 【默认设置】浮层内一键还原默认
14. 【浮层版式】数值放在滑块**左侧**且不压住滑块；「底部安全距离」单行显示并排在**最后**；「默认设置」紧挨关闭按钮；浮层不溢出视口

### 五、底部写作字数状态栏

15. 【新增常驻状态栏】把**手写**与 **AI 生成**分开计数
16. 【删除会扣减】删除已生成的内容会同步扣减，数字不再虚高
17. 【版式】灰环、百分比贴最右、字号更小

### 六、同人创作（新题材）

18. 【新增同人衍生题材】作为独立创作类型接入
19. 【原作正典按固定路径注入】正典存放在项目内的**固定路径**，按该路径**整篇注入**上下文，**不走模糊检索**——检索可能漏掉，固定路径不会
20. 【四种模式 + 自定义】支持 `canon` / `au` / `ooc` / `cp`，也可以用一句话自定义
21. 【归入设定分类门闩】正典归入设定分类，不会串到别处

### 七、记忆与章节

22. 【出场物品四分类】此前物品在提示词里只有一行空数组、零指导，于是提取质量随机（可能把「一杯茶」当物品收进来）；现要求为每件物品给出四分类，并写明「有无意义」的判定口径
23. 【分类真正接进提示词】分类结果会进入写作提示词，不只是提取出来存着
24. 【章节记忆绿点恢复】已提取的章节显示绿点、提取中显示灰点脉冲；按路径而非标题判定，「提取中」不会因标题重名同时点亮两行

### 八、档案文档

25. 【删掉左侧「分区导航」】人物小传、组织势力、力量体系、金手指、背景、地理、伏笔、地点共 **8 类**档案文档移除左侧导航栏，版面改回**单栏**，长文本获得更宽的阅读区
26. 【已生成的文件也一并清理】此前生成的 **7 个**档案 `.html` 也清理了——否则预览面板会继续读磁盘上那份老文件，你仍会看到那一栏。**正文一字未改**（分区卡片数与锚点列表逐项一致，原件已备份）

### 九、写作现场

27. 【自动保存改为每 3 分钟】
28. 【会话标题按标点派生】此前直接把首条消息截前 50 字当标题，标题栏里挂着两行没头没尾的正文；现优先在句末/分句/顿开处断开，上限 **12 字**，实在没有标点才硬截（不调模型——标题要即时可见）
29. 【大纲输入区精简】
30. 【修复正文滚不动】正文容器冒用了编辑器内部类名
31. 【大纲与章节排列逐项对齐】去掉大纲行的前导图标
32. 【停止后可重新开始】补上停止生成后的重启入口
33. 【桌面文件拖入导入】支持把桌面上的文件直接拖进列表导入

### 十、共创大纲

34. 【卷纲内容不再被静默丢弃】此前校验不通过时**整段内容会消失且没有任何提示**；现改为把校验问题显示在**生成结果下方**，你能看到到底哪一条不合格
35. 【讨论轮不再夹带生成契约】缺协议时自动补协议

### 十一、导入与编辑

36. 【导入的设定集不再丢失正文】编辑态补回表格 / 引用 / 代码块骨架
37. 【分隔线不再吞掉整节内容】正文里的分隔线不再被当成 frontmatter，连整节内容一起吞掉

### 十二、安装、卸载与设置持久化

38. 【安装包长期完全打不出来】修复 NSIS 卸载区用错函数变体的问题——这一条一度让整个安装包无法产出
39. 【中文用户名下卸载清理静默失效】改为记录纯文件名，不再静默失败
40. 【随包字体两处未生效】修复不可选中的随包字体等问题
41. 【设置不再丢失】修复「调完设置立刻关窗口」时改动没有落盘

---

## 英文条目（`highlights.en`）

1. [Nine Chinese Writing Fonts Bundled] The font list previously offered only what was already installed on the system, mixed with Western faces such as Arial, so a different machine might offer no usable option. Nine commercially verified Chinese writing fonts now ship with the app (11 weight files in total): Source Han Serif and Source Han Sans (each including Bold), LXGW WenKai, WenJin Mincho, ChillKai, HarmonyOS Sans SC, Smiley Sans, Zhuque Fangsong and Sarasa Gothic SC.
2. [Installed For The Current User] Bundled fonts install for the current user with no administrator rights needed, and the "installed but never launched" gap is covered too.
3. [Chinese Faces Only In The Interface List] Western faces such as Arial have been removed from the interface font options.
4. [HarmonyOS Sans License Notice] Prominently credited in the app as that font's license requires.

5. [Fixed "Changing Body Font Restyled The Whole Interface"] Changing the body font inside a chapter used to restyle the entire interface (navigation, buttons, brand name). The two are now fully independent — adjusting one never affects the other.
6. [Body Size In Absolute Pixels, Decoupled From Interface Scale] Body text size is adjustable from 12px to 32px (presets: Small 15 / Default 18 / Large 21 / Extra large 24) and is no longer multiplied by the interface scale, so enlarging the interface for easier clicking no longer enlarges the body text.
7. [Old Settings Migrated Automatically] Legacy multiplier sizes are converted to pixel values using the interface scale in effect (for example, multiplier 1.25 at 100% → 23px; multiplier 1 at 150% → 27px), so nothing needs to be set again.

8. [Six Typography Parameters] Body font, body size (presets plus slider), line height (1.2–2.6), letter spacing (−1 to 6), side margins (0–160) and bottom safe distance (0–240).
9. [Fixed "Last Line Against The Window Edge"] The new bottom safe distance keeps a long chapter from pressing against the bottom of the window when scrolled to the end.
10. [Dragging Writes Once] Continuously dragging a slider writes to disk once, after you stop, so long drags no longer stutter.

11. [Openable From Chapter And Outline] Both toolbars gain a font-settings popover with a Type (`T`) icon, deliberately distinct from the wand used by one-click formatting.
12. [Six Parameters Moved From Settings] Typography can now be adjusted in the writing view without jumping back and forth to the settings page.
13. [Default Button] One click inside the popover restores the defaults.
14. [Popover Layout] Values sit to the left of their slider without covering it, bottom safe distance stays on a single line at the very bottom, the Default button sits next to Close, and the popover never overflows the viewport.

15. [New Permanent Status Bar] Hand-written and AI-generated text are counted separately.
16. [Deleting Deducts] Deleting generated content deducts it too, so the number no longer overstates the work.
17. [Layout] A grey ring, the percentage pinned to the far right, and a smaller type size.

18. [New Fan-Fiction Genre] Added as its own creation type.
19. [Source Canon Injected By Fixed Path] The canon is stored at a fixed path inside the project and injected whole by that path rather than through fuzzy search — search can miss it, a fixed path cannot.
20. [Four Modes Plus Custom] `canon`, `au`, `ooc` and `cp`, plus a free-form one-line description.
21. [Filed Under Settings] The canon is filed into the settings category and cannot leak elsewhere.

22. [Four-Way Item Classification] Items previously appeared in the prompt as a single empty array with no guidance, so extraction quality was random (a cup of tea might be collected as an item). Every item must now be classified into one of four kinds, with a stated rule for what counts as meaningful.
23. [Classification Actually Reaches The Prompt] The classification is fed into the writing prompt, not merely stored.
24. [Chapter Memory Dots Restored] Chapters whose memory has been extracted show a green dot and chapters being extracted show a pulsing grey dot, keyed by path rather than title so duplicate titles cannot light up two rows at once.

25. [Section Navigation Rail Removed] The left navigation rail is gone from all eight profile document types — character briefs, factions, power system, golden finger, background, geography, foreshadowing and locations — and the layout returns to a single column, giving long text a wider reading area.
26. [Previously Generated Files Cleaned Too] The seven profile `.html` files generated earlier were cleaned as well; otherwise the preview panel would keep reading the old file on disk and you would still see the rail. Not one character of body text changed — section card counts and the anchor list match item by item, and the originals are backed up.

27. [Autosave Every Three Minutes]
28. [Session Titles Derived At Punctuation] Titles used to be the first 50 characters of the first message, leaving two lines of truncated prose in the title bar. Titles are now cut at sentence, clause or list boundaries, capped at 12 characters, with a hard cut only when there is no punctuation at all (no model call — a title must appear instantly).
29. [Slimmer Outline Input Area]
30. [Fixed Un-scrollable Body Text] The body container had borrowed a class name used inside the editor.
31. [Outline And Chapter Rows Aligned] The leading icon on outline rows was removed.
32. [Restart After Stopping] A restart entry was added after generation is stopped.
33. [Drag Files In To Import] Files from the desktop can be dragged straight into the list to import.

34. [Volume Outline Content No Longer Silently Discarded] A failed validation used to make the whole section vanish with no message at all. Problems are now shown beneath the generated result, so you can see exactly which item failed.
35. [Discussion Round No Longer Carries The Contract] The generation contract is attached automatically when it is missing.

36. [Imported Setting Collections Keep Their Body Text] Table, quote and code-block skeletons are restored in the editing state.
37. [Dividers No Longer Swallow A Section] A divider inside body text is no longer mistaken for frontmatter and swallowed together with the whole section.

38. [Installer Could Not Be Built At All] Fixed a wrong function variant in the NSIS uninstall section — this single defect had been blocking the entire installer.
39. [Uninstall Cleanup Under Chinese User Names] Cleanup now records plain file names instead of failing silently.
40. [Two Bundled-Font Paths Fixed] Including bundled fonts that could not be selected.
41. [Settings No Longer Lost] Fixed changes not being written to disk when the settings were closed immediately after adjusting.

---

## 风险与行为变更提示

发版时值得在 Release 正文里点明五点：

1. **界面字体选项移除了 Arial 等西文字体**。如果你原来固定使用 Arial，需要重新选一个中文字体（随包字体装完即可用）。
2. **正文字号与界面字号解耦**。如果你原来依赖「界面调大 → 正文跟着变大」，现在需要在章节/大纲工具栏的「字体设置」里单独调正文字号。旧倍数会按当时的界面字号自动迁移，不必重设。
3. **6 项排版参数从设置页移到了「字体设置」浮层**。设置页里不再有这些控件（「界面字号」仍在设置页）。
4. **档案文档左侧的「分区导航」已移除**，版面为单栏。这是一次真实的元素删除，不是把元素藏起来。
5. **v4.0.0 ~ v4.1.1 的自动更新是失效的**（v4.1.2 已修复）。若你还在这些版本上，请先手动更新一次，此后自动更新即恢复正常。

## 不计入用户说明的区间内容

自 v4.1.2 起共 168 个提交，其中用户可见的功能与修复 62 个（即上文条目）。其余为过程性提交，不面向用户：

- **设计与实施文档 63 个**（字体与排版的分层设计、实施计划、核对报告、故障复盘等）
- **测试与验收工具 21 个**「test」提交 + 2 个「verify」提交（真实 exe 验收脚本、跟随率分类器、变异验证、许可告知可见性检查等）
- **2 个 revert**：一对「共创气泡在显示层剥离结构化 JSON」的修改与其回退 —— 该做法被否决，**未进入本版**
- **1 个 refactor**（记忆快照两处确认无读者的产物）、**2 个 chore**（发版核验脚本、分支约定）
- **1 个 merge**：并入 `origin/main` 的「Delete docs directory」，按用户选择**保留 docs/**（理由：两个已提交的测试会真实读取 `docs/` 内的文件，删掉必红）
