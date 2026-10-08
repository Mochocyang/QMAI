# 界面字号 / 界面字体 修复 —— 证据与工具索引

本目录记录「界面字号调整无效 + 界面字体设置无效 + 字体选项偏少」这一问题的
完整调查、设计、验收工具与证据。

**先读这两个文件：**

| 文件 | 内容 |
|---|---|
| `design.md` | **设计方案**（阶段 1+2，已获用户认可） |
| `findings.md` | **根因调查报告**（含实测证据、方法迭代与自我纠错记录） |

**阶段 3/4 的技术前提见** `research-font-install.md` —— Windows/macOS/Linux
按用户安装字体的机制、Rust API、NSIS 陷阱与卸载清理。该报告含**在一手实验
（非管理员权限、Windows 11 zh-CN）中实测的结论**，并修正了设计初稿的四处错误假设
（HKCU 值须为绝对路径、只写注册表即立即生效、无需提权、`windows-sys` 非直接依赖）。
报告中标注 `[VERIFIED]` 的是实测，`[UNVERIFIED]` 的是文档依据或未能实测的推断。

---

## ⚠️ 工具状态说明（重要）

本次调查在"如何判断字体是否生效"上**迭代了三次**，其中两个方法后来被证伪。
为记录方法迭代过程，被推翻的脚本**保留在本目录**，但**不得再作为结论依据**。
使用前请先确认下表状态。

### ✅ 权威工具（可用于得出结论）

| 文件 | 用途 | 自检情况 |
|---|---|---|
| `census-computed-font.mjs` | **主验收工具**：计算样式普查，双判据（100% 等效 + 150% 全缩放：`font-size` **与** `line-height`） | 四项自检通过（见 `findings.md` §8 与 `design.md` §6.2）；**11 个设置分区全覆盖**，键 = `分区id::DOM路径`，跨分区遮蔽 = 0；**防虚假通过防线**（见下节）由 `census-guards.spec.mjs` 32 条负向用例钉住。**采集模式另有 6 条防线**（`K/根字号未生效` `L/根字号被覆盖` `M/空采集` `N/元素被遮蔽` `O/分区未到达` `P/起始分区未到达`）：采集是下游一切判定的输入，故它失败必须**退出 1 且不写出产物**，而不是只打 ⚠️ |
| `census-guards.spec.mjs` | **主验收工具的防线测试**（`vitest`，构造 fixtures + 真实调用 CLI + 断言退出码，并**钉死预期守卫代号**） | **35 条全绿**：**32 条负向**（每条对应一个曾经能骗过工具的虚假通过路径，断言必须非 0）\+ **3 条正向对照**（干净 fixtures 必须退出 0；真 SVG 例外在显式配额下仍被允许；其反面保证对照不是假绿）。每条负向用例都显式声明**预期守卫代号** —— 只断言"含 GUARD-FAIL 字样"会让用例被**错误的守卫**满足。另有 **3 条自比较用例**：自比较须退出 0（确定性自检不能被破坏）但**结论行不得宣称"修复已达成"**；路径不同而内容相同的复制件也须被识别；真 before/after 必须**确实**宣告达成（防措辞收窄变成全局行为）。三条都做过变异验证，非恒真 |
| `verify-guard-coverage.mjs` | **守卫覆盖度验证**：把 17 个守卫代号逐条短路，跑上面的用例集，看是否变红 | **17/17 全部有覆盖**。改前只有 8/17 —— `D1 D2 E E2 E3 E4 F G J` 被整条删掉都无人察觉。脚本自身的负对照也验过（把 E3 断言放松回旧写法 → 它报"E3 无覆盖"）。会临时改写工具源码，`finally` 中无条件还原并校验残留为 0。**输出末尾显式声明覆盖范围**：只覆盖 `--compare` 路径上的 17 个代号，采集模式的 6 条防线不在其内（它们靠集成运行验证）—— 避免"全部有覆盖"被误读成"所有守卫都被测到了" |
| `check-root-fontsize-authority.mjs` | 排除"根字号被 React 覆盖"这一会伪造结论的可能 | 已验证：rem 缩放、px 不缩放、根字号稳定 |
| `prove-rem-scaling.mjs` | 证明 rem 会缩放、px 不会 | 3/3 vs 0/3，结论明确 |
| `report-font-resolution.mjs` | **字体解析权威报告**（canvas 像素哈希） | 三项自检通过（通用族 4/5、拉丁 7/7、中文 10/10） |
| `count-absolute-font-units.mjs` | 清点全部绝对单位字号（四类来源，557 处） | 与独立 grep 交叉核对一致。**可见范围已显式声明**（对抗性审查"缺陷 B"）：`isCss = file.endsWith(".css")` 让 `.ts/.tsx` 模板字符串/内联 `style="…"` 里的 CSS 不可见 —— 实测 **16 处**（`story-map-renderer.ts` 15 处 + `profile-document.ts` 1 处，均为独立导出 HTML，按 design §4.4 属例外），已用独立 grep 逐行核对。现在控制台结论行与 `absolute-font-units.md` 都写明"只在哪几类载体上通过"，并新增"可见范围外"一节逐行列出这 16 处，故工具**无法在不说明范围的情况下**宣称"绝对单位 0 处"。检测逻辑抽成纯函数 `findTemplateCssBlindSpots()` 并由 `--selftest` 5 条用例钉住 —— 删掉它会让自检变红（原来内联在主流程里，删改只会打印"另有 0 处"而**不会失败**，变异实测确认过）。自检同时抓到一处**重复计数**：内联 `style="…font-size:11px"` 被两个正则各计一次，删掉冗余模式后总数由虚报的 17 修正为 16。测试文件（`*.spec.ts`）里的 CSS 夹具已排除，不算产品样式债 |
| `measure-ui-overflow.mjs` | 界面溢出测量（验收用）：**13 个界面**（落地页 + 创建项目对话框 + 设置页 11 分区）× 多档 | 80/85/100/150 四档均 0 裁切；阳性对照 4/4 检出、阴性对照 4/4 未误判、静默遮蔽 0。**修过两个盲区**：控件可用高度曾用 `clientHeight`（含内边距，偏大 20px，恰好盖住真实 12px 溢出），且从不打开「新建小说」对话框 —— 两处各自"有理由"，合起来让一个真实缺陷完全隐身 |
| `verify-no-clipping.mjs` | 真实 Chromium 里测「固定 px 盒高 + rem 行高」会不会裁字；三个档位（80/100/150） | 6 个用例 + 已知值核对。**含一条我自己的错误修法**（只换算 height、内边距留 px）作为正式反例：它 150% 档正常、80% 档裁 4px。断言"半修法必须在 80% 档被检出" —— 若不报，说明脚本没覆盖缩小方向，直接判失败 |
| `ui-test-clipping.spec.ts`（在 `src/components/uitest/`） | **仓库级回归守卫**：静态扫描测试版全部 `.css`，在 **0.8 与 1.5 两个档位**分别断言"不存在会裁掉文字的规则" | 4 条全绿。自带可信度自检：必须检出已知缺陷（@150% 溢出 12px）、必须检出**半修法 @80% 溢出 4px**、且不误报只有 `min-height` 的规则（实测 `min-height:40px` 在 150% 长到 51.5px，确实不裁） |
| `census-after.json` | 改动后普查产物（704909 字节，**已入库**） | 与 `census-before.json` 一起使主验收**可复核复算**：`--compare census-before.json census-after.json --allow-new-elements 10` → 正确缩放 1117 / 未解释 0 / 退出 0。此前它不在 git 里（被 `.gitignore:56` 排除），命令行引用的是 `$env:TEMP` 路径 —— 那等于不可复核 |
| `probe-font-scaling.mjs` | 完整应用界面上的字号缩放采样 | 12/12 未缩放，复现缺陷 |
| `probe-navigable-pages.mjs` | 探明纯浏览器可覆盖哪些页面 | 结论：仅设置页可达 |
| `verify-real-exe.mjs` | **真实 exe 验收**：CDP 附加到便携版，读真实 DOM 的 `li::marker` 各档像素值，并做**全界面**字号普查（100% vs 150% 逐元素比对） | 实跑通过；冷启动全流程（章节 → 切「大纲」→ 点开含列表文档）亦通过；**界面字号跟随率 100.0%**（2574/2574 文字元素，0 未变；见 `real-exe-shots/real-exe-ui-scale.json`）。**两处加固**（对抗性审查 P2-③）：①**参与元素下限** `--min-texty`（默认 500，实测 2574）：分母过小则跟随率不构成证据，**直接失败**而非只提示 —— 已实测 `--min-texty 99999` → 退出 1 且不复述跟随率；②**表单控件文字纳入分母**：`<textarea>/<input>/<select>` 的文字在 `.value`/`selectedOptions` 而非文本节点，只看文本节点会让它们**整体隐身**。实测该界面为 0 个（唯一 textarea 为空），另注入文字后确认通路生效（计入分母且 ×1.5） |
| `verify-real-exe-settings-save.mjs` | **真实 exe 端到端**：在设置界面拖滑块/选下拉 → **点保存** → 断言 DOM、localStorage 落盘、以及**真实渲染族**（CDP `CSS.getPlatformFontsForNode`） | 实跑通过；5 个用例 + 恢复初值。覆盖了「直接改 CSS 变量验不到」的保存链路（`setUiFontSizeScale` 排在约 10 个 `await` 之后）。**默认写证据** `real-exe-shots/real-exe-settings-save.json`（`--out` 可改路径）—— 文档里引用的每个数字都必须能在产物里复核 |
| `verify-body-font-single-source.mjs` | 正文字号**静态**单一来源校验（编辑器 DOM 在浏览器里不可达，故必须与真实 exe 双管齐下） | `--selftest` 14/0；正例通过、13 类反例逐一检出 |
| `verify-body-font-scale.mjs` | 注入式验证正文字号/行高（含查找高亮层对齐） | 实跑通过 |
| `verify-ui-font-applies.mjs` | 界面字体 11 项逐个验证（用**真实产品 `cssFamily`**，CDP 判真实渲染族） | `--selftest` 49/0；12 档真换字形、1 档仅度量差、3 档期望相同且成立 |
| `verify-body-font-applies.mjs` | 正文字体是否真的作用于正文渲染 | 实跑通过 |

### ✅ 阶段 3/4（中文字体枚举 + 随包字体）的权威工具

| 文件 | 用途 | 自检情况 |
|---|---|---|
| `bundled-fonts.md` + `bundled-fonts.json` | **随包字体清单**（9 族 / 11 个字重文件，209,720,176 B = 200.00 MiB）与逐款授权依据 | 体积与清单由 `sync-fonts-manifest.mjs --check` 钉住；§1.1 记录同族多字重撞注册表值名的实测缺陷 |
| `docs/font-license-verification/verify-bundle-licenses.mjs` | **授权判据**：逐款比对许可证原文，只认"允许把字体文件打进闭源商业安装包再分发" | 可捆绑 23 款 / 明确不可捆绑 2 款 / 0 款需人工判定。用户点名要的 MiSans 与阿里巴巴普惠体被判**不可捆绑**并给出原文依据 |
| `scripts/sync-fonts-manifest.mjs --check` | 运行期清单与磁盘文件的一致性 + 同族值名查重 | 11 款一致；值名重复会直接退出 1 |
| `verify-nsis-font-cleanup.mjs` | **卸载清理段的验收**：从真实模板抽出那段代码，`makensis` 编译（阶段一），并在**一次性注册表键 + 含中文的临时目录**上**真跑一遍**（阶段二 `--e2e`） | 两阶段通过。⭐ 骨架**必须**是 `Section Uninstall`：同一段代码在普通 `Section` 里编译合法，用错 StrFunc 变体（`${StrTrimNewLines}` vs `${UnStrTrimNewLines}`）会在这里假绿、却让真实安装包**完全打不出来**（实测 2×2 矩阵见 `bundled-fonts.md` §6 第 5 条）。阶段二跑的是**真正的卸载器**（`WriteUninstaller` + `/S`），因为清理段只在卸载器里执行 |
| `verify-real-exe-fonts.mjs` | **真实 exe 验收**：便携版启动后读 HKCU 值、断言 9 个族都能在下拉里选到、canvas 像素哈希证明字形确实变了（含确定性对照） | 实跑通过；11 个文件 / 9 个族；多字重部分按**文件名**匹配，不用值名前缀（否则基线里已有的 `Source Han Serif SC Heavy` 会让 Bold 未装也判过） |
| `scripts/check-bundled-font-licenses.mjs` | **界面许可告知与事实的一致性**：族名集合双向比对随包清单、`licenseFile` 存在性、版权行逐字对照许可原文、OFL 声明与原文自洽 | 9 族全绿。鸿蒙黑体的许可**强制**要求"在软件中显著注明使用了 HarmonyOS Sans"——仅随包放许可证文本**不满足**该条，故告知必须在界面上 |
| `src/lib/bundled-font-licenses.spec.ts` | 同上，但在**测试套件里自动跑**（脚本要人记得跑） | 9 条用例，直接读 `src-tauri/fonts/` 真实文件。9 条变异全部实测变红（删族 / 加族 / 改版权行 / 声明清空 / 不点名 / 谎称非 OFL / UI 不渲染） |

### ❌ 已被推翻的探测脚本（**结论不可采信**，仅保留以记录方法迭代）

| 文件 | 当时结论 | 为何被推翻 |
|---|---|---|
| `verify-fonts-by-pixels.mjs` | 全部字体"不存在"（含 Arial） | 截图哈希法与 canvas 测宽结论矛盾，本环境不可靠 |
| `probe-browser-font-access.mjs` | "四种浏览器都看不到系统字体" | 同上；实际是截图法缺陷，非字体系统问题 |
| `diagnose-font-capability.mjs` | "headless Chromium 解析不到系统字体" | 该诊断用截图哈希作判据，判据本身失效，结论随之作废 |
| `verify-font-detection-cdp.mjs` | CDP `getPlatformFontsForNode` 判字体缺失 | 该接口在本环境连"微软雅黑"都返回空族名，不稳定 |
| `selfcheck-font-page.mjs` | 可视化页面字体探测"自检通过" | "独立复核"用了**同一套 canvas 测宽** —— 两次一致只证明实现一致，发现不了方法本身的盲区 |
| `inventory-px.mjs` | 262 处需改 | 只扫 CSS，**漏掉 tsx 的 `text-[Npx]` 306 处**；已被 `count-absolute-font-units.mjs` 取代 |
| `assess-overflow-risk.mjs` | 各规则的高度/字号 | 手写 CSS 规则分割逻辑有缺陷，同文件所有规则输出相同值；**输出未被采用**，溢出改为浏览器实测 |
| `px-inventory.md` | 262 处清单 | 同上，已被 `absolute-font-units.md` 取代（保留备查） |

> 教训：**当两种方法结论矛盾时，正确处理是找第三种方法交叉印证，
> 而不是接受任一结论。** 本次正是因为坚持交叉印证，才发现了截图法的缺陷，
> 并推翻了自己先前的错误结论。

---

## 权威产物

| 文件 | 内容 |
|---|---|
| `absolute-font-units.md` | **557 处**绝对单位字号/行高完整清单（67 个文件） |
| `census-before.json` | 改动前基线：**1113 个键**（设置页 11 个分区，含 **300 条 `::marker`**）× 100%/150% 计算样式（635 KB） |
| `research-font-install.md` | 阶段 3/4 技术前提（三平台按用户安装字体，含一手实测） |
| `probe-app.png` | 真实应用界面截图（书架空态） |
| `font-page.png` | 可视化字体样张页截图（**注意**：页内"已安装/未安装"徽标基于被推翻的方法，不可采信；字形预览本身可信） |
| `probe-nav.png` | 页面可达性探查时的截图 |

---

### 基线的覆盖面与键的构成规则（**后续任务依赖此契约**）

- **覆盖面**：早期基线只采"设置页单一视图"（27 个文本元素）。现基线依次点开设置页
  **全部 11 个分区** —— `model` / `novel` / `network` / `web-search` / `interface` /
  `user-memory` / `maintenance` / `data-management` / `feedback` / `contact-support` /
  `changelog`（用 `data-ui-settings-category-button="<id>"` 定位，与界面语言无关）。
  每个根字号档位 12 次快照共 1140 条记录，去重后 **1113 个键**
  （其中 `::marker` **300 条**）。
- **键 = `<分区id>::<DOM 路径>`**，`::marker` 条目再追加 `::marker`。
  分区 id 是采集该元素时**实际处于激活状态**的分区（`data-ui-settings-category`）。
- 为什么必须带分区前缀：不同分区可能在**同一 DOM 路径**上放**不同元素**。
  早期只以 DOM 路径为键、跨分区 `Object.assign` 合并，后访问的分区会覆盖先访问的
  元素，该元素对两条判据**完全不可见** —— 实测被静默遮蔽 **7 条记录**
  （「重排模型」13px（**本身就是未缩放的 px 元素**）、「其他写作设置」、
  修改反馈窗口、清理伏笔、扫描伏笔追踪器…、检测重复实体 / 概念、
  让大模型扫描…）。其中「其他写作设置」那条，被挤掉的是**同一个导航项的选中态**
  （`.text-sidebar-accent-foreground/70`）与未选中态
  （`.text-sidebar-foreground/55`）—— cls 不同但同一元素，故 7 条记录对应
  **至少 6 个不同元素**。
  **这 7 条怎么测出来的（可复算）**：旧键方案（无分区前缀）的基线是提交
  `8724bef` 的 `census-before.json`（923 键）；把当前基线 1113 个键剥掉
  `分区id::` 前缀得 923 个路径，与旧基线**逐路径比对元素身份**（cls+text+fontSize），
  其中 7 条"新基线存在、旧方案下该路径存活的是另一个身份"，即当时不可见。
  一个看不见部分元素的验收工具会给出**虚假的"全部通过"**，故必须消除。
- **同一元素在多个分区重复出现**（公共外框、侧栏导航等）时按分区各记一份：
  同一元素的计算样式必然一致，只让计数变大，对"未解释必须为 0"无影响。
- 采集日志会打印每次快照的「采集 N / 新增 M」与「同键重写且元素身份不同」计数，
  后者正常必须为 **0**，非 0 即表示仍有元素可能被遮蔽。
- 复核数据（2026-10-07 重采）：判据 1 用两次独立采集互比 → 元素数 1113 = 1113、
  仅改动前有 0、`fontSize`/`lineHeight` 不同 **0**；判据 2 自比 → 894 正确缩放 /
  0 SVG 例外 / **219 未解释**（219 个键对应 **39 个不同 DOM 路径**），
  三组之和 1113 = 键总数（无算丢/算重）。
- **采集可复现**：同一版本两次独立采集互比，两档键数与值差异均为 0 —— 采集是
  确定性的，基线可用于跨任务比对。
- 采集日志的"实际到达分区"按 **11 个分区**计数（起始分区 `model` 另行列示），
  不会出现"分母 11、分子 12"的自相矛盾。

### 已知覆盖范围与盲区（**判据全绿 ≠ 全部已验证**）

| 范围 | 状态 |
|---|---|
| 设置页 11 个分区（含 `changelog` 的长列表） | ✅ 已覆盖，1113 键 × 100%/150% |
| `::marker` 伪元素 | ⚠️ **仅** changelog 的 `li`（14px，rem，本来就会缩放），共 300 条 |
| SVG 内联 `font-size` 图元 | ⚠️ 本机可达页面实测 **0 个**（`provider-brand-icon` 因无提供方未渲染、`context-usage-ring` 在聊天页不可达）——"SVG 例外 = 0"属正常 |
| **编辑器列表标记**（`src/components/uitest/ui-test-editor.css` 的 `li::marker` / `ol > li::marker`） | ⚠️ 本工具（浏览器）**发现不了** —— 实测 11 个分区里 `.ui-test-editor-body` 命中 **0**，点遍所有可达按钮后仍为 **0**；基线 300 条 marker 中 **0 条** 是这两条规则的。**但真实 exe 已闭环**：`verify-real-exe.mjs` 读真实 DOM 的 `li::marker`，默认档 12/16px → 150% 时 18/24px 逐位相符（见 `findings.md` §10.3） |
| 编辑器以外的非设置页界面 | ⚠️ 浏览器里**只有设置页可达**；**真实 exe 已覆盖**：`verify-real-exe.mjs` 的全界面普查覆盖 **2574** 个文字元素（2026-10-07 实测，含表单控件文字；该数随应用所处页面/内容漂移，同一版本两次实测见过 2574 与 2585，**以产物 `real-exe-ui-scale.json` 为准**） |

> **因此：任务 7 改那两行 `::marker`，本工具的判据 2 不会变色。**
> 判据 2 全绿 **不能**理解为"编辑器列表标记也已验证"。
> 替代验证（已完成）：(a) **静态 CSS 校验脚本** `verify-body-font-single-source.mjs`
> —— 检查那几处引用同一字号变量、无残留 px 硬编码（`--selftest` 14/0）；
> (b) **真实 exe 实测** `verify-real-exe.mjs`（读 `li::marker` 计算值）
> 与 `verify-real-exe-settings-save.mjs`（走设置界面保存后量像素）。
>
> ⚠️ **一条必须知道的边界更正（任务 10 实测）**：那两条 `li::marker` 规则
> **对小说章节永远不生效** —— 章节走 `immersiveWriting`，正文是 `<textarea>`，
> 不可能产生 `li`。唯一可达的消费者是**非章节文档**（大纲/设定页）的
> Milkdown `.ProseMirror`。详见 `findings.md` §10.2。

---

## 复现方式

```bash
# 主验收：直接用入库的产物复算（不依赖本机环境，任何人都能复核）
node docs/font-scaling-fix-20261007/census-computed-font.mjs \
     --compare docs/font-scaling-fix-20261007/census-before.json \
               docs/font-scaling-fix-20261007/census-after.json \
     --allow-new-elements 10
# 期望：正确缩放 1117 / SVG 例外 0 / 未解释 0 / 退出 0

# 若要重新采集（需先 npm run build）：
node docs/font-scaling-fix-20261007/census-computed-font.mjs --out after.json

# 验收工具自身的防线测试（每条虚假通过路径一个用例，须全绿）
npx vitest run docs/font-scaling-fix-20261007/census-guards.spec.mjs

# 守卫覆盖度：逐条短路 17 个代号，证明每个都有用例钉住（禁用后套件必须变红）
node docs/font-scaling-fix-20261007/verify-guard-coverage.mjs

# 界面裁切测量（13 个界面；阳性/阴性对照与静默遮蔽自检）
node docs/font-scaling-fix-20261007/measure-ui-overflow.mjs \
     --scales 80,85,100,150 --out docs/font-scaling-fix-20261007/overflow-80-85-100-150.json

# 字号缩放方向的定点回归守卫（0.8 与 1.5 两档都要过）
npx vitest run src/components/uitest/ui-test-clipping.spec.ts

# 真实 Chromium 里测「固定 px 盒高 + rem 行高」会不会裁字（含"半修法"反例）
node docs/font-scaling-fix-20261007/verify-no-clipping.mjs

# 字号缩放方向验证
node docs/font-scaling-fix-20261007/prove-rem-scaling.mjs

# 字体解析权威报告
node docs/font-scaling-fix-20261007/report-font-resolution.mjs

# 绝对单位清点
node docs/font-scaling-fix-20261007/count-absolute-font-units.mjs

# 静态单一来源校验（正文字号四处 + 从属尺寸）
node docs/font-scaling-fix-20261007/verify-body-font-single-source.mjs
node docs/font-scaling-fix-20261007/verify-body-font-single-source.mjs --selftest

# 真实 exe 验收（需 WebView2 开 CDP，见下）
node docs/font-scaling-fix-20261007/verify-real-exe.mjs --port 9333            # 自己启动 exe
node docs/font-scaling-fix-20261007/verify-real-exe.mjs --attach --port 9333   # 附加到已在运行的实例
node docs/font-scaling-fix-20261007/verify-real-exe-settings-save.mjs --port 9333

# ── 阶段 4（随包字体）──────────────────────────────────────────────
# 卸载清理段：先编译，再在一次性注册表键 + 含中文的临时目录上真跑一遍
# （--e2e 需要先构建过 Rust；不带 --e2e 只做编译与契约检查）
node docs/font-scaling-fix-20261007/verify-nsis-font-cleanup.mjs
node docs/font-scaling-fix-20261007/verify-nsis-font-cleanup.mjs --e2e

# 运行期清单与磁盘一致性 + 同族注册表值名查重
node scripts/sync-fonts-manifest.mjs --check

# 授权判据（只认"允许打进闭源商业安装包再分发"）
node docs/font-license-verification/verify-bundle-licenses.mjs

# 界面许可告知与事实一致（鸿蒙黑体的许可强制要求"在软件中显著注明"）
node scripts/check-bundled-font-licenses.mjs
npx vitest run src/lib/bundled-font-licenses.spec.ts src/components/settings/sections/interface-section.spec.tsx

# Rust 侧字体安装/清理的单元测试（含"路径含中文时记录仍必须是纯 ASCII"）
cd src-tauri && cargo test --offline --lib font_install -- --test-threads=1

# 真实 exe：随包字体是否真的装上了、能否在下拉里选到、字形是否真变了
# （前置：便携版已构建，且 WebView2 带 CDP 参数启动，同上）
node docs/font-scaling-fix-20261007/verify-real-exe-fonts.mjs

# ⚠️ 唯一能发现 NSIS 上下文相关错误的检查：真正把安装包打出来
#    `npm run build:portable` 走 tauri build --no-bundle，**不跑 NSIS**，
#    所以它不能替代这一步（安装包曾因此长期完全打不出来而无人察觉）
npx tauri build --bundles nsis
```

前置条件：`dist/` 已构建（`npm run build`）；Playwright 全局安装于
`%APPDATA%\npm\node_modules\playwright`。

**真实 exe 验收的前置**：先构建便携版（`node scripts/build-portable.mjs`），
再带 CDP 参数启动 —— WebView2 只认环境变量，命令行参数无效：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
Start-Process release-portable\QMaiWrite.exe -WorkingDirectory release-portable
# 等 http://127.0.0.1:9333/json/version 可访问后再跑上面的脚本
```

⚠️ 应用启用了 `tauri_plugin_single_instance`：**若已有实例在运行，新进程会把参数
转交给旧实例并立即退出**，CDP 端口不会打开，表现为"脚本说连不上"。此时要么先关掉
旧实例，要么用 `--attach` 附加到那个已经在跑、且**当初就带着 CDP 参数启动**的实例。
进程名是 `QMaiWrite`（不是 `qmai`）。
