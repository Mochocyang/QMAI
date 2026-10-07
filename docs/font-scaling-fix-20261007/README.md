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
| `census-computed-font.mjs` | **主验收工具**：计算样式普查，双判据（100% 等效 + 150% 全缩放：`font-size` **与** `line-height`） | 四项自检通过（见 `findings.md` §8 与 `design.md` §6.2）；**11 个设置分区全覆盖**，键 = `分区id::DOM路径`，跨分区遮蔽 = 0；**防虚假通过防线**（见下节）由 `census-guards.spec.mjs` 19 条用例钉住 |
| `census-guards.spec.mjs` | **主验收工具的防线测试**（`vitest`，构造 fixtures + 真实调用 CLI + 断言退出码） | **23 条全绿**：**21 条负向**（每条对应一个曾经能骗过工具的虚假通过路径，断言必须非 0）\+ **2 条正向对照**（干净 fixtures 必须退出 0；真 SVG 例外在显式配额下仍被允许），另有其反面用例保证对照不是假绿 |
| `check-root-fontsize-authority.mjs` | 排除"根字号被 React 覆盖"这一会伪造结论的可能 | 已验证：rem 缩放、px 不缩放、根字号稳定 |
| `prove-rem-scaling.mjs` | 证明 rem 会缩放、px 不会 | 3/3 vs 0/3，结论明确 |
| `report-font-resolution.mjs` | **字体解析权威报告**（canvas 像素哈希） | 三项自检通过（通用族 4/5、拉丁 7/7、中文 10/10） |
| `count-absolute-font-units.mjs` | 清点全部绝对单位字号（四类来源，557 处） | 与独立 grep 交叉核对一致 |
| `measure-ui-overflow.mjs` | 界面溢出测量（验收用） | 基线已采集 |
| `probe-font-scaling.mjs` | 完整应用界面上的字号缩放采样 | 12/12 未缩放，复现缺陷 |
| `probe-navigable-pages.mjs` | 探明纯浏览器可覆盖哪些页面 | 结论：仅设置页可达 |
| `verify-real-exe.mjs` | **真实 exe 验收**：CDP 附加到便携版，读真实 DOM 的 `li::marker` 各档像素值，并做**全界面**字号普查（100% vs 150% 逐元素比对） | 实跑通过；冷启动全流程（章节 → 切「大纲」→ 点开含列表文档）亦通过；**界面字号跟随率 100.0%**（2574/2574 文字元素，0 未变） |
| `verify-real-exe-settings-save.mjs` | **真实 exe 端到端**：在设置界面拖滑块/选下拉 → **点保存** → 断言 DOM、localStorage 落盘、以及**真实渲染族**（CDP `CSS.getPlatformFontsForNode`） | 实跑通过；5 个用例 + 恢复初值。覆盖了「直接改 CSS 变量验不到」的保存链路（`setUiFontSizeScale` 排在约 10 个 `await` 之后）。**默认写证据** `real-exe-shots/real-exe-settings-save.json`（`--out` 可改路径）—— 文档里引用的每个数字都必须能在产物里复核 |
| `verify-body-font-single-source.mjs` | 正文字号**静态**单一来源校验（编辑器 DOM 在浏览器里不可达，故必须与真实 exe 双管齐下） | `--selftest` 14/0；正例通过、13 类反例逐一检出 |
| `verify-body-font-scale.mjs` | 注入式验证正文字号/行高（含查找高亮层对齐） | 实跑通过 |
| `verify-ui-font-applies.mjs` | 界面字体 11 项逐个验证（用**真实产品 `cssFamily`**，CDP 判真实渲染族） | `--selftest` 49/0；12 档真换字形、1 档仅度量差、3 档期望相同且成立 |
| `verify-body-font-applies.mjs` | 正文字体是否真的作用于正文渲染 | 实跑通过 |

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
| 编辑器以外的非设置页界面 | ⚠️ 浏览器里**只有设置页可达**；**真实 exe 已覆盖**：`verify-real-exe.mjs` 的全界面普查覆盖 2574 个文字元素 |

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
# 主验收：采集 → 比较
node docs/font-scaling-fix-20261007/census-computed-font.mjs --out after.json
node docs/font-scaling-fix-20261007/census-computed-font.mjs \
     --compare docs/font-scaling-fix-20261007/census-before.json after.json

# 验收工具自身的防线测试（每条虚假通过路径一个用例，须全绿）
npx vitest run docs/font-scaling-fix-20261007/census-guards.spec.mjs

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
