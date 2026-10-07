# 界面字号 / 界面字体 失效问题 —— 根因调查报告

日期：2026-10-07
状态：调查完成，根因已确认并实测复现；修复方案待设计评审。

---

## 一、问题陈述（用户报告）

> 我发现一个问题 界面字号 调整根本没有用，放大缩小只有按钮有效果，其他根本没有效果，
> 放大缩小应该放大缩小的是字体。。另外关于界面字体，也没有什么效果，需要调整处理一下，
> 另外就是界面字体再增加一些默认字体。

拆解为三项：
1. **界面字号**调整只在部分位置生效（"只有按钮有效果"）
2. **界面字体**设置完全无效果
3. 需要**增加更多默认字体**

---

## 二、根因 1：字号 —— 单位错配（px 不随根字号缩放）

### 机制

`src/App.tsx:133-139` 通过设置根元素字号实现缩放：

```ts
useEffect(() => {
  document.documentElement.style.fontSize = `${Math.round(uiFontSizeScale * 100)}%`
}, [uiFontSizeScale])
```

根字号只影响 **`rem` / `em`** 单位，**`px` 是绝对单位，不受影响**。

### 代码现状：两条通路并存

| 通路 | 数量 | 单位 | 是否缩放 |
|---|---|---|---|
| Tailwind 原子类（`text-xs` 等） | 1489 处 | `rem`（`--text-xs: .75rem`） | **是** |
| 自定义 CSS 中写死的字号 | **239 处** | `px` | **否** |
| 自定义 CSS 中写死的行高 | **23 处** | `px` | **否** |

这就是"只有部分有效果"的原因：Tailwind 类会变大，自定义 CSS 纹丝不动。
按钮恰好大量使用 Tailwind 类，因此"只有按钮有效果"。

### 实测证据（真实 Chrome + 真实构建产物）

`docs/font-scaling-fix-20261007/prove-rem-scaling.mjs`

```
元素            100%      130%      150%      130%时是否缩放
tw-xs               12     15.6       18      是  (rem)
tw-sm               14     18.2       21      是  (rem)
tw-base             16     20.8       24      是  (rem)
px-12               12       12       12      否  (px)
px-14               14       14       14      否  (px)
px-18               18       18       18      否  (px)

结论：Tailwind rem 类缩放 3/3；自定义 px 缩放 0/3
```

另一次实测（`probe-font-scaling.mjs`）在完整应用界面上采样 12 个可见文本元素，
根字号 100%→130% 后 **12 个全部不变、0 个缩放**。

### 绝对单位字号精确分布（**含一处重要自我修正**）

清点脚本：`docs/font-scaling-fix-20261007/count-absolute-font-units.mjs`
完整清单：`docs/font-scaling-fix-20261007/absolute-font-units.md`

> **修正记录**：早期版本只清点了 7 个 CSS 文件，得出 262 处。这是**严重漏项** ——
> 漏掉了 tsx 中的 Tailwind 任意值 `text-[11px]`（编译为绝对 `font-size:11px`，
> 同样不随根字号缩放）。补全四类来源后的完整规模是 **557 处、67 个文件**。

| 类型 | 数量 | 是否缩放 |
|---|---|---|
| `css font-size: Npx` | 160 | **不缩放 · 需改** |
| `css font: …Npx/…` 简写 | 80 | **不缩放 · 需改** |
| `css line-height: Npx` | 11 | **不缩放 · 需改** |
| `tsx text-[Npx]` 任意值 | **306** | **不缩放 · 需改** |
| **需改合计** | **557** | |
| `css font-size: Nrem/em/%` | 0 | 已缩放 |
| `tsx text-[Nrem]` 任意值 | 1 | 已缩放 |
| `tsx inline fontSize: "Nrem"` | 3 | 已缩放 |
| **无需改合计** | **4** | |

需改文件数：**67**。前 20 名：

| 文件 | 需改处数 |
|---|---|
| `src/components/uitest/ui-test-tools.css` | 64 |
| `src/components/chat/context-trace-panel.tsx` | 59 |
| `src/components/uitest/ui-test.css` | 42 |
| `src/components/novel/book-analysis-workbench.css` | 39 |
| `src/components/uitest/ui-test-shelf.css` | 35 |
| `src/components/uitest/models/model-settings.css` | 28 |
| `src/components/uitest/ui-test-ai.css` | 22 |
| `src/components/uitest/ui-test-editor.css` | 21 |
| `src/components/chat/tool-call-timeline.tsx` | 18 |
| `src/components/settings/sections/foreshadowing-cleanup-tool.tsx` | 16 |
| `src/components/novel/story-simulation/rumor-propagation-panel.tsx` | 12 |
| `src/components/graph/graph-view.tsx` | 11 |
| `src/components/novel/story-simulation/detective-board-panel.tsx` | 11 |
| `src/components/chat/agent-stage-stream.tsx` | 10 |
| `src/components/settings/sections/llm-provider-section.tsx` | 10 |
| `src/components/settings/sections/maintenance-section.tsx` | 10 |
| 其余 51 个文件 | ≤ 8 各 |

px 取值分布与精确 rem 换算（16px 基准）：

| px | rem | 处数 |
|---|---|---|
| 100 | 6.25 | 1 |
| 32 | 2 | 1 |
| 26 | 1.625 | 1 |
| 24 | 1.5 | 1 |
| 22 | 1.375 | 7 |
| 20 | 1.25 | 13 |
| 19 | 1.1875 | 1 |
| 18 | 1.125 | 10 |
| 16 | 1 | 13 |
| 15 | 0.9375 | 9 |
| 14 | 0.875 | 39 |
| 13 | 0.8125 | 78 |
| 12.5 | 0.78125 | 4 |
| 12 | 0.75 | 78 |
| 11 | 0.6875 | **154** |
| 10 | 0.625 | **143** |
| 9 | 0.5625 | 4 |

10/11/12/13px 合计 **453 处**，占 557 处的 81%。

**所有取值都是 0.5 的整数倍** → 除以 16 得到**精确的有限小数**，
因此 100% 根字号下换算后计算值与现状**逐位相同**。
这给出一个强验收判据：**改革前后在 100% 字号下截图应像素级一致**。

---

## 三、根因 2：界面字体 —— 变量被硬编码覆盖

### 机制

用户设置的字体写入 CSS 变量 `--qmai-ui-font-family`：

`src/lib/font-settings.ts`
```ts
export function applyUiFontFamily(value, root = document.documentElement) {
  target.style.setProperty("--qmai-ui-font-family", getUiFontFamilyCss(value))
}
```

`src/index.css`
```css
:root { --qmai-ui-font-family: system-ui, ..., "Microsoft YaHei", ...; }
--font-sans: var(--qmai-ui-font-family);
html { font-family: var(--qmai-ui-font-family); }
```

**但** `src/components/uitest/ui-test.css:5` 把界面字体变量 `--ui` 写死：

```css
--ui: "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
--serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif;
```

而界面绝大部分文字走 `var(--ui)`：

| 文件 | `var(--ui)` 用量 | 其中 `font-family` 用 |
|---|---|---|
| `ui-test-tools.css` | 26 | 1 |
| `model-settings.css` | 13 | 0 |
| `ui-test-editor.css` | 11 | 1 |
| `ui-test-ai.css` | 9 | 0 |
| `ui-test.css` | 8 | 3 |
| `ui-test-shelf.css` | 1 | 0 |

`ui-test.css:46` 一条规则覆盖所有表单控件：

```css
.ui-test-root button, input, textarea, select { font-family: var(--ui); }
```

结论：**用户选择的界面字体被 `--ui` 全面绕过**。全仓 `--ui` 仅此一处定义，
`[data-ui-test-skin]` 皮肤块也不重定义，因此改这一处即可全局生效。

### 根因 3：正文（小说正文）走的是另一条通路

`ui-test-editor.css` 正文使用 `var(--serif)`（思源宋/宋体），与"界面字体"完全独立。
因此用户改"界面字体"时，写作区正文字体不会变化 —— 这是设计使然，不是 bug，
但用户会感知为"没效果"。已在设计中对齐为**独立的正文字体设置**。

---

## 四、字体可用性实测（方法迭代三次，含自我纠错）

### 方法演进（重要，避免重复踩坑）

| 方法 | 结论 | 是否可信 | 原因 |
|---|---|---|---|
| `locator.screenshot` 哈希 | 所有具名字体"不存在" | **否** | 与 canvas 测宽矛盾（判 Arial 也不存在），本环境不可靠 |
| `canvas.measureText` 测宽 | 拉丁可区分 | 仅辅助 | 对中文无效：CJK 全角宽度恒为 1em，黑体/宋体/楷体宽度相同；且需 monospace 兜底 |
| `canvas.getImageData` 像素哈希 | 拉丁 + 中文均可区分 | **是（采用）** | 字体解析走 canvas，判别靠像素缓冲 |

**自查纠错记录**：首版脚本把"对照字体（不存在的字体）必须与基准不同"当作
自检合格条件，导致自检失败。这是**错误的断言** —— 缺失字体会回退到本机默认字体，
Windows 中文默认恰为微软雅黑，故"Microsoft YaHei == 不存在字体"是正确现象。
修正判据为：通用族可区分 + 已知拉丁字体互异 + 已知中文字体互异。

### 权威结论

`docs/font-scaling-fix-20261007/report-font-resolution.mjs`（自检通过）

```
通用族可区分: 4/5     拉丁字体互异: 7/7     中文字体互异: 10/10
自检结论: 通过 —— 该浏览器能解析系统字体（含中文）
```

1. **本机浏览器可解析系统字体（含中文）** → 字体修复可用真实产物验证。
   此前"所有浏览器都看不到系统字体"的结论**已被推翻**。
2. **中文族名可直接用于 CSS `font-family`**，与英文名指向同一字体：

   | 英文名 | 中文名 | 结果 |
   |---|---|---|
   | SimHei | 黑体 | 同一字体 |
   | SimSun | 宋体 | 同一字体 |
   | NSimSun | 新宋体 | 同一字体 |
   | KaiTi | 楷体 | 同一字体 |
   | FangSong | 仿宋 | 同一字体 |
   | DengXian | 等线 | 同一字体 |
   | Microsoft YaHei | 微软雅黑 | 同一字体 |
   | Microsoft JhengHei | 微软正黑体 | **不同**（中文名不识别，回退默认） |

   → 族名支持**不完整**（有反例），不能假设中文名总能用，
   必须以**实际枚举出的族名**为准。
3. **未安装的字体名不报错，只在渲染时静默回退** → 这正是用户"
   选了字体没反应"的底层机制。因此字体下拉必须由真实枚举驱动，
   而不是给一个静态候选列表。
4. 本机默认 CJK 回退 = 微软雅黑。
5. 4 个捆绑候选（霞鹜文楷 / 鸿蒙黑体 / MiSans / 阿里巴巴普惠体）在本机**均未安装**。

### 本机已安装字体（注册表 167 项中筛选）

已确认可用：SimHei 黑体、SimSun/NSimSun 宋体/新宋体、KaiTi 楷体、FangSong 仿宋、
DengXian 等线、Microsoft YaHei/微软雅黑、Microsoft JhengHei 微软正黑体、
Noto Sans SC、Noto Serif SC、Source Han Serif SC、
Arial、Times New Roman、Georgia、Consolas、Segoe UI、Cascadia Mono/Cascadia Code。

**注意**：微软雅黑、宋体、楷体、仿宋、等线、黑体等均为 **Windows 系统专有字体，
不可随包分发**，只能读取本机已有。

---

## 五、Rust 侧可行性（离线可满足）

| 项 | 结论 |
|---|---|
| `windows-sys` | 在 `Cargo.lock` 中（0.61.2 / 0.60.2 / 0.59.0 等），**本地 registry 已缓存 0.61.2**。⚠️ 但**不是 `src-tauri/Cargo.toml` 的直接依赖**（仅传递依赖），必须显式添加并启用 GDI/注册表 feature |
| 所需 API | `EnumFontFamiliesExW`、`GetGlyphIndicesW`、`AddFontResourceExW`、`RemoveFontResourceExW`、`GetFontUnicodeRanges`、`CreateCompatibleDC`、`GetDC` —— **全部已在缓存的 crate 绑定中**（离线可用） |
| crates.io | `index.crates.io` 返回 200，`static.crates.io` 返回 403（根路径不可列，非阻断） |
| 打包目标 | `bundle.targets = ["nsis", "app"]` |
| 用户字体目录 | `%LOCALAPPDATA%\Microsoft\Windows\Fonts` 存在（免管理员权限安装可行） |
| 中文字体覆盖判定 | 首选 DirectWrite `IDWriteFont::HasCharacter`（可用 UCS-4，覆盖 Ext-B）；次选 `GetGlyphIndicesW` + `GGI_MARK_NONEXISTING_GLYPHS`（0xFFFF 表示缺字）。⚠️ GDI 会**静默替换**字体（实测：请求黑体实际选中宋体），用 GDI 必须先用 `GetTextFaceW` 校验实际字体名 |

→ **无需联网、无需新增未缓存依赖即可实现本机字体枚举。**

---

## 六、用户已确认的四项设计决策

| 议题 | 决定 |
|---|---|
| 捆绑字体如何生效 | **装进系统 · 按用户安装**（`%LOCALAPPDATA%`，免管理员/UAC） |
| 捆绑字体范围 | **还要更多**（不止 6 款；需逐个核对许可证，且系统专有字体不可分发） |
| 正文写作区字体 | **正文单独一个设置**（界面字体与正文字体互不干扰） |
| 字号滑块范围 | **放宽到 80%–150%** |

---

## 七、待调研确认（进行中）

1. 可合法再分发的中文写作字体清单与许可证（含"免费使用但不可再分发"的陷阱）。
2. 三平台按用户安装字体的机制细节（Windows 注册表/API、macOS ~/Library/Fonts、
   Linux ~/.local/share/fonts）、卸载清理、NSIS 安装时机的权限影响。

### 已确认的许可证结论（来自一手来源）

**MiSans 不可捆绑 —— 必须移出捆绑名单。**
小米官方许可协议 PDF（`hyperos.mi.com/font/download` 链接的
`MiSans字体知识产权许可协议.pdf`）明文：

> 「3）您不得单独将 MiSans 字体或其组件对外租赁、再许可、给予、出借或进一步分发
> 字体软件或其任何副本以及重新分发或售卖。此限制不适用于您使用 MiSans 字体创作的
> 任何其他作品。」

即：许可豁口只覆盖**用该字体创作的作品**（文档/logo/应用输出），
**不包括把字体文件本身随安装包分发**。且该许可为"不可转让的、可撤销的"。

→ MiSans 属"可免费使用但**不可再分发**"，与微软雅黑同类处理：只能读本机、
不能打包。这也印证了"免费 ≠ 可打包"是本需求最大的法律风险点。

**仍需华为官方许可原文确认**：GitHub 上 `huawei-fonts/HarmonyOS-Sans` 只是转打包镜像
（README 仅链接华为设计指南），其 LICENSE 为 GPL-3.0，**不是**权威许可来源。

**IPA Font License 1.0 的额外义务**：霞鹜新晰黑 / 霞鹜新致宋并非 OFL，
而是源自 IPAex 的 **IPA Font License 1.0**。该许可 s.3.1(2) 与 IPA FAQ 3.3.2
要求再分发衍生字体时**必须提供让用户换回原始 IPA 字体的途径**，
否则禁止再分发。作者自己的说明也建议：若不愿承担该合规成本，改用 OFL 字体。

**已确认可安全捆绑的 OFL 核心**：霞鹜文楷 LXGW WenKai、Adobe 思源黑体/思源宋体
（Source Han Sans/Serif）、Sarasa Gothic、得意黑 Smiley Sans、朱雀仿宋、
Maple Mono、寒蝉圆体 Chill Round、Chiron Hei/Sung HK、未来荧黑 Glow Sans。

---

## 八、验收方法（已建立并自我验证）

### 方法：计算样式普查 + 双判据

脚本：`docs/font-scaling-fix-20261007/census-computed-font.mjs`

用"计算样式"而非截图比对，因为计算样式是确定性的（截图受抗锯齿/栅格化/动态内容干扰），
且能直接断言缩放倍数。元素标识用 DOM 路径（改动只涉及 CSS 值、不改结构，路径稳定）。

| 判据 | 内容 | 依据 |
|---|---|---|
| **1. 等效性** | 根字号 100% 时，改动前后每个文本元素的 `fontSize` / `lineHeight` 必须相同 | 557 处 px 值均为 0.5 整数倍，÷16 得精确有限小数，故 100% 下计算值应逐位相同 |
| **2. 生效性** | 根字号 150% 时，**所有**文本元素字号必须 = 100% 时的 1.5 倍 | 若有元素未变，即该处仍有绝对单位漏网 |

### 方法自检（关键，避免用坏工具得出结论）

**自检一：工具能否区分等效与不等效？**
用基线数据自己比自己 → 判据 1 报告"0 处不同" → 等效性检查按预期工作。

**自检二：工具能否抓到真实缺陷？**
同一次自比对中，判据 2 报告 **27/27 全部未缩放** —— 在**设置页**独立复现了缺陷，
且这个页面是浏览器中可到达的页面里 px 密度最高的之一（`ui-test-tools.css` 64 处）。
（2026-10-07 工具扩到 **11 个设置分区**、并消除跨分区元素遮蔽后重采基线，
同一自比对的数字变为 **1113 个键中 894 正确缩放 / 0 SVG 例外 / 219 未解释**；
详见 `README.md`「基线的覆盖面与键的构成规则」与 `design.md` §6.2。）

**自检三：排除"根字号被 React 覆盖"这一会伪造结论的可能。**
`App.tsx` 的 `useEffect` 会按 `uiFontSizeScale` 重写根字号；若它在我脚本设置 150% 后
又渲染一次，根字号会被改回 100%，那么"未缩放"就不是单位问题而是根字号没生效 ——
结论会被误读、后续验收会假失败。

脚本 `check-root-fontsize-authority.mjs` 持续观察 3 秒：

```
documentElement.style.fontSize = 150%   计算根字号 = 24px
rem 探针 = 18px   px 探针 = 12px   .ui-test-brand-name = 18px
（+0/+300/+800/+1500/+3000ms 均保持不变）

根字号保持 150%: true
rem 探针缩放 1.5 倍: true（12px → 18px）
px 探针保持不变: true（12px → 12px）
→ 情形 A：根字号稳定，rem 缩放、px 不缩放。验收方法有效。
```

三种探针对照明确了机制：**rem 缩放、px 不缩放、根字号稳定**
（`.ui-test-brand-name` 18px 为 px 硬编码，故不缩放）。

### 基线

`docs/font-scaling-fix-20261007/census-before.json`（设置页 **11 个分区**共
**1113 个键**，含 300 条 `::marker` × 100%/150%；早期单视图基线为 27 个文本元素）。

---

## 九、本次调查的自我纠错记录

1. **险些采信错误的字体探测结论**：可视化页面用 canvas 测宽判断字体是否安装，
   对中文无效（全角宽度相同），且我的"独立复核"用了同一套方法 —— 两次一致
   只能证明实现一致，无法发现方法本身的盲区。已改用 canvas 像素哈希。
2. **误判"浏览器看不到系统字体"**：截图哈希法与 canvas 测宽结论矛盾时，
   正确处理是继续找第三种方法交叉印证，而不是接受任一结论。最终定位为截图法缺陷。
3. **静态 CSS 分析脚本不可靠**：手写的规则分割逻辑产生了明显错误的输出
   （同文件所有规则显示相同高度/字号）。该输出**未被采用**，溢出风险改为
   在实际浏览器中实测（改动后按 scale 逐档比较 scrollHeight/clientHeight）。
4. **严重漏项：只清点了 CSS，漏掉 tsx 中的 Tailwind 任意值。**
   早期清点只扫 7 个 CSS 文件得 262 处，实际还有 `text-[11px]` 这类任意值 306 处，
   完整规模 557 处 / 67 文件。若按早期结论施工，界面里大批小字（10px/11px 徽标、
   时间戳等，共 297 处）仍不会缩放，问题只解决一半。已用统一清点脚本覆盖四类来源。
5. **自检断言写错**：把"对照字体必须与基准不同"当作合格条件，忽略了
   "缺失字体回退到默认字体"的正常情形，导致假失败。已修正判据为
   "通用族可区分 + 已知拉丁字体互异 + 已知中文字体互异"。
