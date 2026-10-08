# 随包字体交付说明（阶段 4）

> **结论先行**：随包 **10 款**中文字体，合计 **176,682,440 字节 = 168.50 MiB**。
> 全部经一手许可原文核实为**可捆绑**（9 款 OFL-1.1 + 鸿蒙黑体为专有但许可
> 明确允许 `bundle, redistribute`）。逐款的来源仓库、固定 tag、下载 URL 与
> SHA-256 见 [`bundled-fonts.json`](./bundled-fonts.json)（机器可读的唯一真相）。
>
> 选择依据：用户在「全部 23 款 / 精简核心 8–10 款 / 只打包点名的几款」中
> 选择了**精简核心 8–10 款**。

---

## 1. 清单与体积

| # | 字体 | 文件名 | 体积 (MiB) | 许可证 | 固定 tag |
|---|---|---|---|---|---|
| 1 | 思源宋体 | `SourceHanSerifSC-Regular.otf` | 23.41 | OFL-1.1 | `2.003R` |
| 2 | 思源黑体 | `SourceHanSansSC-Regular.otf` | 15.76 | OFL-1.1 | `2.005R` |
| 3 | 霞鹜文楷 | `LXGWWenKai-Regular.ttf` | 24.39 | OFL-1.1 | `v1.522` |
| 4 | 文津宋体 | `WenJinMincho-Regular.ttf` | 20.79 | OFL-1.1 | `v2.100` |
| 5 | 寒蝉正楷体 | `ChillKai-Regular.ttf` | 33.40 | OFL-1.1 | `v2.000` |
| 6 | 鸿蒙黑体 | `HarmonyOSSansSC-Regular.ttf` | 7.88 | 华为专有（可捆绑） | commit `33ab3b81` |
| 7 | 得意黑 | `SmileySans-Regular.ttf` | 2.51 | OFL-1.1 | `v2.0.1` |
| 8 | 朱雀仿宋 | `ZhuqueFangsong-Regular.ttf` | 8.42 | OFL-1.1 | `v0.212` |
| 9 | 更纱黑体 | `SarasaGothicSC-Regular.ttf` | 22.93 | OFL-1.1 | `v1.0.42` |
| 10 | 芫荽 | `Iansui-Regular.ttf` | 9.01 | OFL-1.1 | `v1.020` |

体积对安装包的影响：现有便携版 exe 为 213,574,144 字节（203.69 MiB），
加上字体（176,682,440 字节 = 168.50 MiB）后合计 **390,256,584 字节 = 372.18 MiB**。
NSIS 用 LZMA 压缩，但字体本身已是压缩过的二进制，实际增幅接近原始大小。
用户已确认可以接受（原话是"体积可增至 100–200MB"，
本次比该上限略高，见 §6 说明）。

---

## 2. 落盘位置与打包路径

```
src-tauri/fonts/
├── fonts-manifest.json          ← 运行期清单（由脚本生成，勿手工编辑）
├── licenses/                    ← 10 份许可证全文
│   ├── source-han-serif-OFL.txt
│   ├── ...
│   └── harmonyos-sans-LICENSE.txt
└── <10 个字体文件>
```

**为什么放在 `src-tauri/fonts/` 而不是仓库根**：`bundle.resources` 里位于
`src-tauri/` **之外**的源会被放到 `$INSTDIR\_up_\`（`skills` 就是如此，
见已生成的 `installer.nsi`）。放在 `src-tauri/` 内才能干净地落到
`$INSTDIR\fonts\`，与 Rust 侧按 `resource_dir()/fonts` 解析的路径一致。

**两份清单的分工**（不要合并）

| 文件 | 读者 | 内容 | 是否进安装包 |
|---|---|---|---|
| `docs/.../bundled-fonts.json` | 人 + 发布门禁 | 含 `sourceRepo`/`sourceTag`/`sourceUrl`/`licenseName`，回答"字节从哪来、许可为何" | 否 |
| `src-tauri/fonts/fonts-manifest.json` | 运行期 | 只含 `id`/`file`/`sizeBytes`/`sha256`/`family`/`licenseFile` | 是 |

运行期那份**由** `node scripts/sync-fonts-manifest.mjs` **生成**（手工维护两份
必然漂移）。生成时会**重算每个文件的 SHA-256 与大小**并与来源清单核对 ——
若不一致直接失败，因为那意味着字体文件被替换过，**必须重新核对许可证**。
脚本还拒绝两种状态：`fonts/` 里有清单未列出的字体文件（会被打进包却不会被
安装、许可证也无人核对），以及清单列出但磁盘上没有的文件。

---

## 3. 许可证义务（发布前必须逐条满足）

### 3.1 九款 OFL-1.1 字体

- **必须随包分发 OFL-1.1 全文与各自的版权行** —— 已放在 `fonts/licenses/`。
- **若修改了字体（子集化 / 格式转换 / 改名），必须去掉保留字体名（RFN）。**
  本项目**不做任何修改**：每个文件都是上游 release 的原始字节
  （因此也不需要改名）。这一条由 SHA-256 门禁守住。
- 已声明的保留字体名（仅作登记，本次不触发）：
  `霞鹜 | 霞鶩 | 落霞孤鹜 | 落霞孤鶩 | LXGW`（霞鹜文楷系列）、
  `WenJin Mincho | 文津宋体 | 文津宋體 | 文津明朝 | 문진(文津) 명조 | Source`、
  `ChillRoundF | ChillRoundM`、`Smiley | 得意黑`、`Source`（思源系列、更纱黑体）。

### 3.2 鸿蒙黑体（唯一非 OFL，**风险最高**）

华为许可允许 `use, copy, merge, embed, bundle, redistribute and/or sell
unmodified copies`，但有以下必须遵守的限制：

1. **绝对不能修改** —— 不许子集化、不许格式转换、不许改名。
   许可原文把 "fonts software" 排除在可修改范围之外。
   （`bundled-fonts.json` 里记录的是原始字节，未做任何处理。）
2. **必须保留版权声明与许可协议** —— 已在 `licenses/harmonyos-sans-LICENSE.txt`。
3. **必须显著注明使用了 HarmonyOS Sans** —— 见 §4 的界面与文档义务。
4. **不得单独再分发** —— 只能随本软件一起分发。
5. **许可证不可转让，且可被撤销（revocable）** —— 这是持续风险：
   一旦华为撤销授权，后续版本必须立刻移除该字体。**建议法务登记此风险**。

> 仓库根目录的 `LICENSE` 是 **GPL-3.0**，那是 npm 包装脚本的许可，
> **不是**字体许可 —— 这是本项目最容易踩的陷阱。真实许可是官方 ZIP 内的
> 协议全文，已按此处理。

### 3.3 界面与文档义务（待实施，非本阶段代码）

- [ ] 在「设置 → 关于」或同类位置**显著注明**本软件包含 HarmonyOS Sans 字体，
      并附华为版权声明。
- [ ] 分发 `licenses/` 目录（已随包，是否需要额外在关于页给出入口待定）。
- [ ] 每次发版跑一次 `node docs/font-license-verification/verify-bundle-licenses.mjs`；
      **任一字体 SHA-256 变化即必须重新人工核对许可证**。

---

## 4. 被排除的字体（以及为什么）

### 用户点名但**不能**打包的两款

| 字体 | 结论 | 依据（原文） | 替代 |
|---|---|---|---|
| **小米 MiSans** | 灰区，不捆绑 | 授权动词只有"安装、使用"；条件 3) 禁止"不得**单独**…进一步分发"，但条件 1) 又要求"您应在**软件中**特别注明使用了 MiSans 字体"——**自相矛盾**，未取得小米书面确认前不打包 | 鸿蒙黑体、思源黑体 |
| **阿里巴巴普惠体 3.0** | **明确不可捆绑** | 仅 `download, install and use`；第 4 条兜底禁止 `take any other action not permitted by Alibaba`。**完全没有**再分发/嵌入授权 | 思源黑体、更纱黑体 |

**唯一合规的打包路径是取得书面授权。**

### 按类别排除

- **方正、汉仪**：嵌入授权单独计价。
- **文泉驿正黑**：GPL-2 的嵌入例外只覆盖"文档产物"，不覆盖软件分发。
- **霞鹜新晰黑 / 新致宋 / 晰黑 / 致宋 / 尚智黑 / 铭心宋**：
  IPA Font License 1.0（非 OFL），再分发需提供"换回原始 IPA 字体"的途径。
- **昭源黑体 Chiron Hei HK**：OFL-1.1 可捆绑，但**无 release 资产**、
  只能从源码构建，因此无法按固定哈希确定性地取得 —— 本次不纳入
  （不是许可问题，是可复现性问题）。

### 未纳入本次清单但许可允许的字体

核实为可捆绑的共 23 款；本次按"精简核心"只取了 10 款。其余可随时增补：
霞鹜文楷 GB / 屏幕阅读版 / TC、SuperHan、寒蝉全圆体、悠哉字体、
未来荧黑、Noto Sans/Serif CJK、Noto Sans SC、Maple Mono、抖音美好体。

---

## 5. 已解决的取证难题（供复核）

| 问题 | 处理 |
|---|---|
| 鸿蒙黑体仓库**没有 tag/release**（只有 commit） | 固定到 HEAD commit `33ab3b81b92c01f5e340c89960872bee174d8704`；`sourceTag` 记该 SHA |
| 鸿蒙黑体是 **Git LFS** blob（raw URL 只返回 133 字节指针） | 用 LFS oid/size（`52136595`）逐字节校验本地文件；`sourceUrl` 记可用的 LFS 二进制地址 |
| 文津宋体、更纱黑体**只有 `.7z`**，系统无 7z | 用系统自带 bsdtar（libarchive）解压；文津取 **P0（平面 0/BMP，常用汉字全集）**，更纱只取 **SC 单语言包** |
| 得意黑**没有真正的 Regular**（只有 Oblique，`macStyle=2`） | 文件名为 `SmileySans-Regular.ttf` 但内部族名为 `Smiley Sans`，已在清单 `familyNote` 注明 |
| 芫荽上游 `OFL.txt` **自带 UTF-8 BOM** | 去除 BOM（4387→4384 字节，正文逐字符一致） |
| GitHub API 限流，无法用 API digest 交叉核对 | **所有哈希都是从真正落盘的文件算出来的**，不依赖任何上游声明值 |

### 族名与字体 `name` 表不一致（本轮抓到的真实缺陷）

清单里的 `family` 同时用作 CSS 的 `font-family` 名字与注册表值名，
必须与字体文件 `name` 表一致 —— 否则"装得上、匹配不上"，
用户看到的就是**「选了这个字体但界面没变」**，正是本次修复要根除的病症。

`src-tauri/src/fonts.rs` 的测试
`随包字体的清单族名必须与字体文件自报的族名一致` 直接用 DirectWrite 问每个
文件（与 WebView2 做字体匹配时读的是同一张 `name` 表），**抓到 2 处错误**：

| 字体 | 初稿声明（错） | DirectWrite 实报（已修正） |
|---|---|---|
| 文津宋体 | `WenJin Mincho` | `WenJin Mincho Plane 0` |
| 朱雀仿宋 | `Zhuque Fangsong` | `Zhuque Fangsong (technical preview)` |

同时**排除**一处疑似问题：得意黑的 `nameID1` 是 `Smiley Sans Oblique`，
但 DirectWrite 用的是**排印族名（nameID16）**`Smiley Sans`，故清单里的
`Smiley Sans` 是正确的。这个结论只能由实测得到 —— 人肉读 name 表会读错，
因为"该看哪条记录"本身就取决于引擎。

该测试的**跳过条件**刻意划得很窄：`fonts/` 里有字体文件却没有清单时
**必须失败**（那些文件会被打进安装包却不会被安装），只有 `fonts/` 完全为空
才是"本检出不带随包字体"。否则删掉清单就能让测试假绿。

---

## 6. 与用户约定的两处偏差（需知悉）

1. **体积比约定上限略高**：用户原话是"体积可增至 100–200MB"，
   本次字体为 **168.50 MiB（176,682,440 字节）**，加上现有 exe（203.69 MiB）
   后合计 **372.18 MiB**。
   偏差原因是 10 款里含思源宋体（23.41）、霞鹜文楷（24.39）、
   寒蝉正楷体（33.40）三款大字体。
   **若需把字体压回 200 MiB 以内**，最省事的三项删减建议（按"性价比"排序）：
   去掉寒蝉正楷体（−33.40）、思源宋体（−23.41）、更纱黑体（−22.93），
   合计可回到约 88.76 MiB。请确认取舍。
2. **思源系列未含 Bold**：两款思源的 SC 包内确有 Bold
   （+42,485,160 字节 ≈ +40.52 MiB）。本次刻意只取 Regular 以保证
   清单与 10 个 id 严格 1:1。需要粗体另说。

---

## 7. 复跑方式

```powershell
# 1) 生成/校验运行期清单（会重算 SHA-256 并核对来源清单）
node scripts/sync-fonts-manifest.mjs
node scripts/sync-fonts-manifest.mjs --check

# 2) 核实许可证结论（需联网取许可原文）
node docs/font-license-verification/verify-bundle-licenses.mjs

# 3) 族名是否与字体文件一致（需 Windows + DirectWrite）
cd src-tauri; cargo test --offline --lib 随包字体的清单族名 -- --nocapture

# 4) 安装/卸载记录与幂等性
cd src-tauri; cargo test --offline --lib font_install

# 5) 卸载清理段的 NSIS 语法（用真正的 makensis 编译模板原文片段）
node docs/font-scaling-fix-20261007/verify-nsis-font-cleanup.mjs
```
