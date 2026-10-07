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
| `census-computed-font.mjs` | **主验收工具**：计算样式普查，双判据（100% 等效 + 150% 全缩放） | 三项自检通过（见 `findings.md` §8） |
| `check-root-fontsize-authority.mjs` | 排除"根字号被 React 覆盖"这一会伪造结论的可能 | 已验证：rem 缩放、px 不缩放、根字号稳定 |
| `prove-rem-scaling.mjs` | 证明 rem 会缩放、px 不会 | 3/3 vs 0/3，结论明确 |
| `report-font-resolution.mjs` | **字体解析权威报告**（canvas 像素哈希） | 三项自检通过（通用族 4/5、拉丁 7/7、中文 10/10） |
| `count-absolute-font-units.mjs` | 清点全部绝对单位字号（四类来源，557 处） | 与独立 grep 交叉核对一致 |
| `measure-ui-overflow.mjs` | 界面溢出测量（验收用） | 基线已采集 |
| `probe-font-scaling.mjs` | 完整应用界面上的字号缩放采样 | 12/12 未缩放，复现缺陷 |
| `probe-navigable-pages.mjs` | 探明纯浏览器可覆盖哪些页面 | 结论：仅设置页可达 |

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
| `census-before.json` | 改动前基线：27 个文本元素 × 100%/150% 计算样式 |
| `research-font-install.md` | 阶段 3/4 技术前提（三平台按用户安装字体，含一手实测） |
| `probe-app.png` | 真实应用界面截图（书架空态） |
| `font-page.png` | 可视化字体样张页截图（**注意**：页内"已安装/未安装"徽标基于被推翻的方法，不可采信；字形预览本身可信） |
| `probe-nav.png` | 页面可达性探查时的截图 |

---

## 复现方式

```bash
# 主验收：采集 → 比较
node docs/font-scaling-fix-20261007/census-computed-font.mjs --out after.json
node docs/font-scaling-fix-20261007/census-computed-font.mjs \
     --compare docs/font-scaling-fix-20261007/census-before.json after.json

# 字号缩放方向验证
node docs/font-scaling-fix-20261007/prove-rem-scaling.mjs

# 字体解析权威报告
node docs/font-scaling-fix-20261007/report-font-resolution.mjs

# 绝对单位清点
node docs/font-scaling-fix-20261007/count-absolute-font-units.mjs
```

前置条件：`dist/` 已构建（`npm run build`）；Playwright 全局安装于
`%APPDATA%\npm\node_modules\playwright`。
