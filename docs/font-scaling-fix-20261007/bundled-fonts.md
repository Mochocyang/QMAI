# 随包字体交付说明（阶段 4）

> **结论先行**：随包 **9 款族 / 11 个字重文件**中文字体，合计
> **209,720,176 字节 = 200.00 MiB**。
> 全部经一手许可原文核实为**可捆绑**（8 款族为 OFL-1.1 + 鸿蒙黑体为专有但许可
> 明确允许 `bundle, redistribute`），且全部经 DirectWrite 实测确认
> **能被本应用列出并选中**（见 §5.2）。逐款的来源仓库、固定 tag、下载 URL 与
> SHA-256 见 [`bundled-fonts.json`](./bundled-fonts.json)（机器可读的唯一真相）。
>
> 选择依据：用户在「全部 23 款 / 精简核心 8–10 款 / 只打包点名的几款」中
> 选择了**精简核心 8–10 款**；其后追加了**思源宋体 / 思源黑体的 Bold 字重**，
> 因此文件数由 9 增至 11（族数仍为 9 —— 同一族的不同字重不新增下拉项）。

---

## 1. 清单与体积

| # | 字体 | 文件名 | 字重 | 体积 (MiB) | 许可证 | 固定 tag |
|---|---|---|---|---|---|---|
| 1 | 思源宋体 | `SourceHanSerifSC-Regular.otf` | 400 | 23.41 | OFL-1.1 | `2.003R` |
| 2 | 思源宋体 Bold | `SourceHanSerifSC-Bold.otf` | 700 | 24.34 | OFL-1.1 | `2.003R` |
| 3 | 思源黑体 | `SourceHanSansSC-Regular.otf` | 400 | 15.76 | OFL-1.1 | `2.005R` |
| 4 | 思源黑体 Bold | `SourceHanSansSC-Bold.otf` | 700 | 16.18 | OFL-1.1 | `2.005R` |
| 5 | 霞鹜文楷 | `LXGWWenKai-Regular.ttf` | 400 | 24.39 | OFL-1.1 | `v1.522` |
| 6 | 文津宋体 | `WenJinMincho-Regular.ttf` | 400 | 20.79 | OFL-1.1 | `v2.100` |
| 7 | 寒蝉正楷体 | `ChillKai-Regular.ttf` | 400 | 33.40 | OFL-1.1 | `v2.000` |
| 8 | 鸿蒙黑体 | `HarmonyOSSansSC-Regular.ttf` | 400 | 7.88 | 华为专有（可捆绑） | commit `33ab3b81` |
| 9 | 得意黑 | `SmileySans-Regular.ttf` | 400 | 2.51 | OFL-1.1 | `v2.0.1` |
| 10 | 朱雀仿宋 | `ZhuqueFangsong-Regular.ttf` | 400 | 8.42 | OFL-1.1 | `v0.212` |
| 11 | 更纱黑体 | `SarasaGothicSC-Regular.ttf` | 400 | 22.93 | OFL-1.1 | `v1.0.42` |

体积对安装包的影响：现有便携版 exe 约 203.69 MiB，加上字体
（209,720,176 字节 = 200.00 MiB）后合计约 **404 MiB**。
NSIS 用 LZMA 压缩，但字体本身已是压缩过的二进制，实际增幅接近原始大小。
**含 exe 的总安装包体积超出用户原话里的"100–200MB"**，见 §6.1；
其中字体本身 200.00 MiB 恰好落在该区间上限。

---

## 1.1 同一族的多个字重：注册表值名必须不同

这是加 Bold 时**实测发现的真实缺陷**，值得单独记一笔，因为它的失败方式极具迷惑性。

Windows 的用户级字体注册表是**每项一个值**：

```
HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts
    "Source Han Serif SC (TrueType)"      = <Regular 的绝对路径>
    "Source Han Serif SC Bold (TrueType)" = <Bold 的绝对路径>
```

值名是这一项在系统字体表里的**唯一键**。早期实现只用族名拼值名
（`"<族名> (TrueType)"`），单字重时完全正确；一旦同族加入第二个字重，
两条记录就会拼出**同一个键**，后写的覆盖先写的。

实测证据（`fonts::tests::诊断_列出某族实际可用的字重`，
两个 `.otf` 文件都留在用户字体目录、只改注册表值名）：

| 注册表状态 | 该族实测可用字重 | 该族字体面的完整名 |
|---|---|---|
| 只写一个值名（指向 Bold 文件） | `[700]` | `Source Han Serif SC Bold` |
| 写两个不同值名 | `[400, 700]` | `Source Han Serif SC` / `Source Han Serif SC Bold` |
| **删掉 Bold 的值名**（文件仍在磁盘上） | `[400, 900]` | `Source Han Serif SC` / `Source Han Serif SC Heavy` |

最后一行是关键对照：**文件还在磁盘上，但 700 那一档彻底消失**，
只剩 `Source Han Serif SC`（我们装的 Regular）与
`Source Han Serif SC Heavy`（本机基线里本来就有的另一款字体）。
也就是说：加一个字重而值名不变，**等于白装一个 25 MB 的文件**，
而用户只会看到"加粗没变化"——几乎不可能被归因到注册表键上。

> **不要用字重数字单独下结论。** 实测发现 DirectWrite 会为缺少粗体的族
> **合成**一个 700 面，其完整名与 400 面**完全相同**：`ChillKai` 只有一个
> Regular 文件，却也报告 `[400, 700]`；`SimSun`、`KaiTi` 同理。
> 所以"看到 700"不等于"真装了 Bold"，必须看**完整名是否不同**
> （真 Bold 叫 `Source Han Serif SC Bold`，合成面只沿用族名）。
> 另：本机 DirectWrite 把每个面都枚举**两次**（系统字体也一样），
> 故"面的个数"没有意义。上面的结论依据的是完整名，不是计数。

**修复**：`registry_value_name(family, weight)`，字重进值名。
命名对齐 Windows 自身习惯（Regular 不带后缀、其余带：
`Noto Sans SC (TrueType)` / `Noto Sans SC Bold (TrueType)` /
`Source Han Serif SC Heavy (TrueType)`）—— Regular 不带后缀还有个好处：
已有单字重字体的值名**保持不变**，升级时不会留下一批指向旧名字的孤儿键。

**防回归**（三层，缺一不可）：

1. `scripts/sync-fonts-manifest.mjs` 生成清单时检查**任意两条的值名不得重复**；
2. `fonts::tests::清单里任意两条的注册表值名都不得相同`（纯数据，无需 Windows）；
3. `fonts::tests::随包字体声明的字重必须与字体文件自报的一致`
   —— 用 DirectWrite 读文件 `OS/2` 得到的真实字重比对清单声明，
   **不靠文件名里的 `-Bold` 猜**。

配套地，卸载记录的第 1 行也从"族名"改为**完整值名**，NSIS 侧不再自行拼
`" (TrueType)"`：`DeleteRegValue` 对**不存在**的值是静默成功的，
两处各拼一次必然有一天对不上，卸载后就会留下指向已删文件的悬空注册表值。
`verify-nsis-font-cleanup.mjs` 现在反过来断言模板里**不得**出现拼接写法。

---

## 2. 落盘位置与打包路径

```
src-tauri/fonts/
├── fonts-manifest.json          ← 运行期清单（由脚本生成，勿手工编辑）
├── licenses/                    ← 9 份许可证全文
│   ├── source-han-serif-OFL.txt
│   ├── ...
│   └── harmonyos-sans-LICENSE.txt
└── <11 个字体文件>
```

**为什么放在 `src-tauri/fonts/` 而不是仓库根**：`bundle.resources` 里位于
`src-tauri/` **之外**的源会被放到 `$INSTDIR\_up_\`（`skills` 就是如此，
见已生成的 `installer.nsi`）。放在 `src-tauri/` 内才能干净地落到
`$INSTDIR\fonts\`，与 Rust 侧按 `resource_dir()/fonts` 解析的路径一致。

**两份清单的分工**（不要合并）

| 文件 | 读者 | 内容 | 是否进安装包 |
|---|---|---|---|
| `docs/.../bundled-fonts.json` | 人 + 发布门禁 | 含 `sourceRepo`/`sourceTag`/`sourceUrl`/`licenseName`，回答"字节从哪来、许可为何" | 否 |
| `src-tauri/fonts/fonts-manifest.json` | 运行期 | 只含 `id`/`file`/`weight`/`sizeBytes`/`sha256`/`family`/`licenseFile` | 是 |

运行期那份**由** `node scripts/sync-fonts-manifest.mjs` **生成**（手工维护两份
必然漂移）。生成时会**重算每个文件的 SHA-256 与大小**并与来源清单核对 ——
若不一致直接失败，因为那意味着字体文件被替换过，**必须重新核对许可证**。
脚本还拒绝三种状态：`fonts/` 里有清单未列出的字体文件（会被打进包却不会被
安装、许可证也无人核对）、清单列出但磁盘上没有的文件、
以及**任意两条的注册表值名重复**（见 §1.1）。

---

## 3. 许可证义务（发布前必须逐条满足）

### 3.1 八款 OFL-1.1 字体族（共 10 个文件）

- **必须随包分发 OFL-1.1 全文与各自的版权行** —— 已放在 `fonts/licenses/`。
  同一族的不同字重**共用同一份 OFL**（许可证随族不随字重），
  因此思源宋体 / 思源黑体的 Bold 不需要额外的许可证文件。
- **若修改了字体（子集化 / 格式转换 / 改名），必须去掉保留字体名（RFN）。**
  本项目**不做任何修改**：每个文件都是上游 release 的原始字节
  （因此也不需要改名）。这一条由 SHA-256 门禁守住。
  两个 Bold 文件与它们同族的 Regular 来自**同一个 release ZIP** ——
  这一点是核对过的：下载回来的 Regular 与已随包的字节 **SHA-256 完全一致**，
  所以 Bold 与 Regular 的许可证状态相同，不存在"Bold 是从别处拿的"这种风险。
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

### 许可没问题、但**实测后**移出的一款

| 字体 | 结论 | 原因 |
|---|---|---|
| **芫荽 Iansui** | 许可 **OFL-1.1、完全可捆绑**，但**不随包** | 实为**纯繁体**字体：DirectWrite 实测缺简体特有的 东/龙/论/车。随包的后果是"装了却永远不会出现在字体下拉里"（9.01 MiB 白占），且即便硬列出来，简体正文里的常用字也只会回退到别的字体、同一段文字两种字形。详见 §5.2 |

留痕在 `bundled-fonts.json` 的 `excludedAfterProbe`（含来源、tag、SHA-256 与理由）。
**若日后要支持繁体写作**，正确做法是**另加一层繁体判据 + 单独的字体分组**，
而不是把它塞回现有清单 —— 那样会让简体用户选到一款渲染不全的字体。

### 未纳入本次清单但许可允许的字体

核实为可捆绑的共 23 款；本次按"精简核心"只取了 **9 款**。其余可随时增补：
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
| 芫荽上游 `OFL.txt` **自带 UTF-8 BOM** | 去除 BOM（4387→4384 字节，正文逐字符一致）。⚠️ 该字体后来因**过不了简体判据**被移出随包清单，见 §5.2；此行保留是为了记下当时处理过的取证细节 |
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

### 5.2 随包字体必须真的能被选中（本轮抓到的真实缺陷之二）

**芫荽 Iansui 曾被随包，但真实安装后它从未出现在字体下拉里。**
它被完整安装到用户机器、写进注册表（9.01 MiB 白占），却因为过不了
中文字体判据（实为纯繁体字体，DirectWrite 实测缺简体特有的
东/龙/论/车 四个字形）而**永远不会被列出**。

更关键的是：**就算硬把它列出来也是错的。** 它缺的 东/车/龙/论 都是极常用字，
简体正文里出现这些字时只能回退到别的字体，同一段文字会呈现两种字形 ——
正是要根除的「选了没反应」类病症。

因此新增不变式测试 `随包的每一款字体都必须能通过中文字体判据`：

> **随包字体集必须是"可被选中字体集"的子集。**

配套一条**负向对照** `负向对照_纯拉丁字体文件必须被判据拒绝`，
防止判据被误改成"永远返回 true"而让上面那条变成装饰。

排查用的是 `#[ignore]` 诊断测试
`诊断_随包字体对探针的覆盖`：

```powershell
cd src-tauri
cargo test --offline --lib 诊断_随包字体对探针的覆盖 -- --ignored --nocapture
```

它把每款随包字体对每层探针的覆盖情况打出来。**该诊断工具本身写错过一次**
（const fn 拼数组时偏移量算错一格，导致"繁体层"盖住"简体层"的最后一格、
数组还少一格），把结果整体弄错位、看起来像同时有多个缺陷。
所以它现在直接写字面量，并在注释里记下这次错误：
**诊断工具出错会把人引向错误结论，比没有诊断更糟。**

**关于"用假名/谚文区分日韩字体"这个想法**：实测**不可行**——
`Source Han Sans SC` / `Sarasa Gothic SC` / `霞鹜文楷` 等**中文**字体
都含 あ/ア（部分还含 가），这是 CJK 字体的常规兼容收录。
真正能区分的是"是否含简体特有字形"，故判据维持原样。

**芫荽的处置**：从随包清单移出，但**留痕**在
`bundled-fonts.json` 的 `excludedAfterProbe` 里（含来源、tag、SHA-256 与
排除理由），这样日后有人问"芫荽为什么没随包"能直接查到答案。
`sync-fonts-manifest.mjs` 会检查这些被排除的文件**确实不在**
`src-tauri/fonts/` 里 —— 资源目录是整目录打包的，留着它会让安装包白白多出
9.01 MiB。若日后要支持繁体写作，应**另加一层繁体判据与单独的字体分组**，
而不是把它塞回现有清单。

---

## 6. 与用户约定的两处偏差（需知悉）

1. **安装包总体积超出约定上限**：用户原话是"体积可增至 100–200MB"。
   本次**字体**为 **200.00 MiB（209,720,176 字节 = 9 款族 / 11 个文件）**，
   恰好落在该区间上限；但加上现有 exe（约 203.69 MiB）后，
   **安装包总体积约 404 MiB**，超出该上限。
   偏差原因是清单里含寒蝉正楷体（33.40）、霞鹜文楷（24.39）、
   思源宋体 Regular + Bold（23.41 + 24.34）几款大字体。
   **若需把字体压回 100 MiB 以内**，最省事的三项删减建议（按"性价比"排序）：
   去掉寒蝉正楷体（−33.40）、思源宋体 Regular + Bold（−47.75）、
   更纱黑体（−22.93），合计可回到约 95.92 MiB。请确认取舍。
2. ~~**思源系列未含 Bold**~~ **已按用户决定补上**：思源宋体 + 思源黑体的 Bold
   合计 +42,485,160 字节 ≈ +40.52 MiB，现为 9 款族 / 11 个文件。
   加 Bold 的过程暴露了一个真实缺陷（同族字重撞注册表值名），
   详见 §1.1 —— 那不是"顺手加两个文件"，而是必须同时改注册与卸载两条路径。
3. **升级时的旧字体不会自动删除**：若某个随包字体在后续版本被移出清单
   （如本次的芫荽），它**不会被启动流程自动删除**，而是保留在安装记录里、
   等卸载时清理，同时在启动日志里如实报告一行。这是刻意的保守选择 ——
   不让"启动应用"这条路径根据一个可被外部改写的记录文件去删文件。
   真实用户从 4.1.2（不带任何随包字体）升级不受影响。
4. **加字重时的注册表迁移**：值名规则对 Regular **不带**后缀，
   因此本次新增两个 Bold 不影响既有 9 个文件的值名，
   升级时不会留下指向旧名字的孤儿键。这是选择"Regular 不带后缀"
   这条命名规则（而非"一律带后缀"）的一个实际收益。

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

# 6) 真实 exe 端到端：字体落盘/注册表 + 下拉可选中 + 选中后真换字形
#    （需要先 node scripts/build-portable.mjs；脚本自己会还原它改动的用户设置）
node docs/font-scaling-fix-20261007/verify-real-exe-fonts.mjs

# 7) 真实机器上的清理（会真的删掉本机已安装的随包字体，仅手动执行）
cd src-tauri; cargo test --offline --lib 手动_在真实机器上清理随包字体 -- --ignored --nocapture
```
