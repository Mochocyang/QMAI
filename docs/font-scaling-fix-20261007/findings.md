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

**自检四：采集是否可复现（判据 1/2 的比对结论以此为前提）。**
同一版本的工具**两次独立采集**（各自启动 Playwright、重开浏览器、依次点击 11 个分区），
两份 census 逐条比对：100%/150% 两档的**键数与值差异均为 0**。
采集是确定性的 —— 因此"判据 1 差异 0 / 判据 2 未解释 219"这类结论不是某一次运行的偶然，
基线可以可信地用于跨任务（改动前 vs 改动后）比对。
（复核记录见 `README.md`「基线的覆盖面与键的构成规则」；另一独立复核方也重采过一次，
结论相同。）

### 基线

`docs/font-scaling-fix-20261007/census-before.json`（设置页 **11 个分区**共
**1113 个键**，含 300 条 `::marker` × 100%/150%；早期单视图基线为 27 个文本元素）。

> ⚠️ **验收工具的已知覆盖盲区**（判据全绿 ≠ 全部已验证）：编辑器列表标记
> `src/components/uitest/ui-test-editor.css:239-240`（`li::marker{font-size:12px}`、
> `ol > li::marker{font-size:16px}`）**在本工具的浏览器可达路径下从不挂载**
> （实测 11 个分区里 `.ui-test-editor-body` 命中 0；基线 300 条 marker 全部来自
> changelog 的 li，0 条 12px/16px）。改那两行本工具发现不了，需靠静态 CSS 校验
> 脚本 + 真实 exe 目视确认。详述见 `README.md`「已知覆盖范围与盲区」与
> `design.md` §6.1。

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
5. **自检断言写错**：把"对照字体必须与正文不同"当作合格条件，忽略了
   "缺失字体回退到默认字体"的正常情形，导致假失败。已修正判据为
   "通用族可区分 + 已知拉丁字体互异 + 已知中文字体互异"。

---

## 十、阶段 1+2 实施结果（真实 exe 实测，2026-10-08）

阶段 1（字号随根字号缩放）与阶段 2（界面字体与正文字体可独立设置）已全部实施完成。
下面只记**在真实便携版 exe 里量到的数**，不重复计划与静态校验已覆盖的内容。

### 10.1 用户最初的症状已被反证

用户原话是「放大缩小只有按钮有效果，其他根本没有效果」。用 CDP 驱动真实 exe，
在根字号 100% 与 150% 下**逐一**读每个元素的 computed `font-size`：

| 指标 | 实测 |
| --- | --- |
| 采集元素总数 | 5491 |
| 有自身文字且不在 SVG 内（可比对） | 2574 |
| 恰好 ×1.5（跟着界面字号变） | **2574** |
| 完全没变（×1.0） | **0** |
| 跟随率 | **100.0%** |

2574 个文字元素**没有一个**不跟随。原始证据（脚本每次覆盖写这一个文件）：
`real-exe-shots/real-exe-ui-scale.json` —— `total: 5491` / `texty: 2574` /
`scaled: 2574` / `unscaled: 0` / `followRatePct: 100` / `unscaledTop: []`。

### 10.2 一处必须更正的边界认识：`li::marker` 与小说章节无关

原计划（任务 10 步骤 2b）要求"在正文里造出无序列表与有序列表"来验
`li::marker` 的两条规则。实测发现**这在章节里做不到**，原因不是入口难找，
而是产品结构决定的：

- 章节走 `immersiveWriting`（`preview-panel.tsx`），而 `wiki-editor.tsx` 里
  `effectiveMode = immersiveWriting ? "edit" : mode` 把章节钉死在编辑态，
  正文是 `<textarea>` —— textarea 里不可能有 `ul/ol/li/::marker`；
- `UiTestEditor` 自己的读写切换按钮是**死代码**（`ui-test-editor.tsx:176`
  写成 `{false && …}`），所以"预览正文"那条路也进不去。

**结论：`ui-test-editor.css` 里那两条 `li::marker` 规则唯一可达的消费者是
「非章节文档」**（大纲 / 设定页：`kind="outline"`、`immersiveWriting=false`，
走 Milkdown 的 `.ProseMirror`）。这不是"换个地方验"，而是把这两条规则的
**作用域**从"小说正文"更正为"大纲与设定页"。已写进 `ui-test-editor.css` 注释。

### 10.3 列表标记实测（真实 exe，样本 `wiki/outlines/开篇方向.md`）

该文档实测含 `ul > li` 27 个、`ol > li` 5 个、`##` 标题 6 个。

| 档位 | 正文 p | 无序 li | 无序 ::marker | 有序 li | 有序 ::marker | 标题 h2 |
| --- | --- | --- | --- | --- | --- | --- |
| 默认 | 18 | 16 | **12** | 16 | **16** | 18 |
| 正文 150% | 27 | 24 | 18 | 24 | 24 | 27 |
| 界面 150% | 27 | 24 | 18 | 24 | 24 | 27 |
| 双 150% | 40.5 | 36 | 27 | 36 | 36 | 40.5 |
| 正文 85% | 15.3 | 13.6 | 10.2 | 13.6 | 13.6 | 15.3 |
| 双 85% | 13.005 | 11.56 | 8.67 | 11.56 | 11.56 | 13.005 |

单位 px。每格都是**恰好**基准 × 期望倍率（27/18 = 40.5/27 = 1.5；
13.005/18 = 0.7225）。**比例守恒**：无序标记 < 无序列表项（12<16、18<24、
27<36、10.2<13.6、8.67<11.56），有序标记 = 有序列表项；没有一档颠倒。

顺带验证了设计边界 (j)：**标题 h2 的字号与正文完全相同，而字体首项始终是
`PingFang SC`（即 `--ui` 栈首项），不是 `--serif` 的 `Noto Serif SC`。**

### 10.4 设置界面 → 保存 的端到端

| 操作 | 结果 |
| --- | --- |
| 界面字号拖到 150% → 保存 | `documentElement.style.fontSize = 150%`，落盘 `qmai-ui-font-size-scale = 1.5`；正文字号未被带动 |
| 正文字号拖到 125% → 保存 | `--qmai-body-font-scale = 1.25`；真实文档 p 22.5 / 无序 li 20 / 无序 ::marker 15 / 有序 li 20 / 有序 ::marker 20（逐个恰好 ×1.25） |
| 界面字体选「黑体」→ 保存 | CDP **真实渲染族** `Microsoft YaHei UI` → `SimHei` |
| 正文字体选「楷体」→ 保存 | 正文真实渲染族 `KaiTi`（44 字形）；界面控件 `.ui-test-nav-item` 仍 `SimHei`（独立）；正文衬线层 `.ui-test-brand-name` 变 `KaiTi`（**设计如此**，`ui-test.css:118`） |

字体判定一律用 CDP 的 `CSS.getPlatformFontsForNode`，**不看**
`getComputedStyle().fontFamily` —— 后者只回显你写的栈，栈首字体本机不存在时
它照样回显那个名字，证明不了任何"生效"。

原始证据：`real-exe-shots/real-exe-settings-save.json`（脚本每次运行覆盖写入，
**不是可选的** —— 靠 stdout 的数字无法复核，本节最初就因此撤掉过一处引用）。
里面逐条记着滑块写入值与**回读值**、`localStorage` 落盘值、CDP 报告的真实渲染族
（含 `before`/`after` 两个方向）、以及恢复前后的期望/实际对照。

### 10.5 本次踩到并已修的测量陷阱（会让结论变成假的）

1. **往 CSS 变量里写进字符串 `"undefined"`**：组合对象用 `body/root`，
   设值函数读 `bodyScale/rootPct`，于是把 `--qmai-body-font-scale` 设成了
   字面量 `"undefined"`。后果是 `calc(1.125rem * var(--scale))` 在**计算值阶段
   整条失效**，字号静默退回继承值 14px —— 表现为**五个档位读数完全一样**。
   这种"完全一致"最像"功能坏了"，差点据此去改产品代码。已加回读正对照。
2. **`connectOverCDP` 的 `browser.close()` 会永久挂住**（它试图关掉真实浏览器
   进程）：结论已全部打印完毕、进程却不退出，实测挂过 10 分钟以上。
   已改为限时 4s + 显式 `process.exit`。
3. **`page.evaluate` 的函数体取不到脚本外层变量**（报 `UI_KEY is not defined`），
   键名必须写字面量。
4. **点目录行要点行内的 `button`**：处理器挂在 button 上，点外层
   `div[data-page-path]` 只向上冒泡、不下传，表现为"点了没反应"。
5. **把正确行为误报成缺陷**：最初拿 `.ui-test-brand-name` 当"界面文字"判
   正文字体的独立性，它跟着正文字体变，被判为缺陷。查 `ui-test.css:118` 才
   发现它**按设计**就用 `var(--serif)`。改用 `.ui-test-nav-item` 后才正确。
   **探针选错比不做验证更危险** —— 它会让你去"修"一个本来正确的设计。

### 10.6 真实 exe 里仍未量到的部分（诚实缺口）

- `[data-find-highlights]` 高亮层的字号/行高对齐：它只在章节里、且需要查找
  进行中。由 `verify-body-font-scale.mjs` 注入验证覆盖（18px → 行高 35.1px）。
- `.ui-test-editor-details` / `-auxiliary` / `-path`：需额外展开才挂载，未量像素；
  三者只跟界面字号，引用关系已由静态校验覆盖。
- 界面字体 11 项里真实 exe 只实测了 `simhei` 与 `kaiti`；其余 9 项由
  `verify-ui-font-applies.mjs` 用真实产品 `cssFamily` 在浏览器里逐个验。
- `opt:microsoft-yahei` 只换度量不换字形（已登记，本次刻意未改字体栈）。

---

## 十一、阶段 1+2 收尾：一处真实回归，两个方向的盲区

本节记录的是**"已经宣布通过之后"**才被发现的问题。它的价值不在修复本身，
而在于暴露了验收工具的三层盲区 —— 每一层都让上一层的"0"变得不可信。

### 11.1 缺陷：`.ui-test-create-name` 在 150% 档裁掉文字 12px

`.ui-test-create-name`（「新建小说」对话框里的名称输入框）在阶段 1
被换算成 `font-size: 1rem; line-height: 1.5rem`，但 `height` 仍是 `44px`。
阶段 1 有意只换算字号、不换算布局高度（design §4.4），单看没问题；
问题出在**这两个值配在一起**：

| 档位 | 可用高度（44px − 上下内边距 20px） | 行盒（1.5rem × 倍率） | 结果 |
| --- | --- | --- | --- |
| 100% | 24px | 24px | 恰好 |
| 150% | 24px（不缩放） | 36px | **溢出 12px，文字被 input 裁掉** |

这是 `ad94b79` 已经手工修过的**同一类缺陷**，那次的提交信息写得很清楚：
「高度必须与 line-height 同为 rem，否则界面字号放大时行盒变大而容器不动，
文字被 input 裁掉」。它修了 `model-settings.css` 的 4 处，漏了这一处。

**它是回归**，不是既有问题：换算前是 `font-size: 16px; line-height: 24px`，
两个都是绝对单位，任何档位都不裁（`git show 83ba882^:…` 可复核）。

### 11.2 修复：不变量"可用高度 = 行盒 × 倍率"

第一次的修法（与 `ad94b79` 惯例一致：只把 `height` 换成 `2.75rem`）
**是不完整的**。设倍率 s：

```
可用高度 = 44s − 20     （内边距 10px 不缩放）
行盒     = 24s
溢出     = 24s − (44s − 20) = 20(1 − s)
```

`s = 1` 时为 0 —— 所以 100% 档永远看不出问题；但 **s < 1 时同样为正**：
80% 档可用 35.2 − 20 = 15.2px，而行盒 19.2px，**裁掉 4px**。
界面字号滑块的最小值正是 80%（真实 exe 实测 `min=80`）。

正确修法是让内边距一起换算，使不变量 `可用高度 = 24s = 行盒` 在**所有**档位成立：

```css
height: 2.75rem;              /* 44px */
padding: 0.625rem 0.875rem;   /* 10px 14px —— 必须也是 rem */
line-height: 1.5rem;          /* 24px */
```

100% 档逐位等于原值（零视觉回归），150% 与 80% 均无溢出。
由 `verify-no-clipping.mjs` 在真实 Chromium 中三档实测确认（见 11.4 表）。

### 11.3 三层盲区（为什么"全部通过"没有意义）

| # | 盲区 | 后果 | 已修 |
| --- | --- | --- | --- |
| 1 | `measure-ui-overflow.mjs` **从不打开「新建小说」对话框**。它只走落地页 + 设置页 11 分区，而这个输入框既不在落地页、也不在设置页 | 整轮报"0 裁切"，守卫项全绿。讽刺的是同文件守卫 E 的原文就写着"这类控件正是静态预判发现风险的地方" | 已补该界面，并新增守卫 F **强制要求到达** |
| 2 | 同一文件检测控件时用 `clientHeight` 当可用高度，而 **`clientHeight` 包含内边距** | 44px 的框被当成"可用 44px ≥ 行盒 36px"，12px 的溢出被吃掉。与盲区 1 叠加才造成完全不可见 | 已改为 `clientHeight − 上下内边距` |
| 3 | 明细只打印**最高档**（`byScale[hi]`） | 缩小方向的裁切会被计入总数、却永远看不到明细 —— 有 finding 查不到是什么 | 已改为**逐档打印** |
| 4 | 守卫①"倍率生效"用绝对容差，且只跟"另一个档位"比 | `--scales 100`、`--scales 100,104`、乃至把倍率改成空操作后的 `--scales 150`，都**退出 0 并报"✓ 通过"** | 已要求 ≥2 档且跨度 ≥1.25，容差改相对值，并直接断言最高档根字号 |

盲区 1 与 2 是**乘积关系**：只有 `<input>` 的第二类检测能看到这个元素，
而它的尺子偏大 20px，刚好盖住 12px 的溢出。两个各自都"有理由"的近似，
合起来让一个真实可见的缺陷完全隐身。

### 11.4 修复后的实测（真实产物 dist/，13/13 界面）

| 档位 | 80 | 85 | 100 | 150 |
| --- | --- | --- | --- | --- |
| 裁切数 | 0 | 0 | 0 | 0 |

`overflow-80-85-100-150.json`：`measuredCount` 每档 829，
`medianRatio 1.875`（=150/80，尺子倍率正确），阳性对照 4/4 已检出、
阴性对照 4/4 未误判、`guardFails: []`、`verdict.pass: true`。

真实浏览器（`verify-no-clipping.mjs`，加粗为关键行）：

| 写法 | 80% | 100% | 150% |
| --- | --- | --- | --- |
| 原始（`height: 44px`） | 不裁 | 不裁 | **裁 12px** |
| 半修（`height: 2.75rem`，内边距留 px） | **裁 4px** | 不裁 | 不裁 |
| 完整修法（内边距也 rem） | 不裁 | 不裁 | 不裁 |

这张表是"只看放大方向会漏掉一半"的直接证据：三种写法在 100% 档
**完全一样**，差别只在两端。

### 11.5 新增的守卫

- `src/components/uitest/ui-test-clipping.spec.ts`（4 条用例）：静态扫描
  测试版全部 `.css`，在 **0.8 与 1.5 两个档位**分别断言"不存在会裁掉文字的规则"。
  它自带可信度自检：必须能检出已知缺陷（原始写法 @150% → 溢出 12px）、
  必须能检出**半修法 @80% → 溢出 4px**、且必须不误报已知安全写法
  （只有 `min-height` 的规则 —— 下限会随内容长高，实测 `min-height:40px`
  在 150% 档长到 51.5px，确实不裁）。
- `measure-ui-overflow.mjs` 新增守卫 F（对话框必须到达），
  并把档位跨度校验、相对容差、根字号断言补进守卫①。
- `verify-no-clipping.mjs` 增到三档，并把"半修法"作为**正式反例**写进用例：
  若它不报裁切，说明脚本没覆盖缩小方向，直接判失败。

### 11.6 仍然存在的诚实缺口

- 静态扫描判不了"这个 class 选择器背后是 `<input>` 还是会裁的容器"，
  所以它只能给**候选**；最终裁决靠真实浏览器/真实 exe 的
  `scrollHeight > clientHeight` 与行盒对比。本节的缺陷正是"静态扫描报出候选、
  但动态工具因为盲区 1+2 没能裁决"。
- `measure-ui-overflow.mjs` 仍只覆盖 13 个界面。模态对话框只补了
  「新建小说」这一个；其余对话框（如模型编辑、灵魂编辑）未逐一走查。
- 检测器已修得更灵敏，但**未回头重跑历史档位**（100/115/130/150）
  之外的组合，只跑了 80/85/100/150。
