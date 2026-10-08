//! 阶段 3：枚举本机**中文字体**。
//!
//! ── 要解决的病症 ──
//! 字体下拉里若列出一个本机并不存在的字体，用户选中后浏览器会**静默回退**到
//! 默认字体，界面看起来"选了没反应" —— 这正是本次修复要根除的病症。
//! 真枚举（只列实际存在的中文字体）是从根上消除它的办法。
//!
//! ── 为什么用 DirectWrite 而不是 GDI ──
//! GDI 会**静默替换**所请求的字体：实测请求 `黑体`/`SimHei` 时实际选中的是
//! `宋体`（字形索引与覆盖数完全相同 —— 等于在探测宋体却以为在测黑体）。
//! 要用 GDI 就必须先 `GetTextFaceW` 校验实际族名，不匹配则丢弃。
//! DirectWrite 是 WebView2 实际使用的引擎，`IDWriteFont::HasCharacter` 接受
//! UCS-4 码点，且不存在这个替换陷阱。
//!
//! ── 判据分两层，"中文字体"不是"含汉字" ──
//! 只要求"有汉字字形"会把日文/韩文字体也放进来（它们都有汉字），而日文字体
//! 渲染简体字时部分字形是日式写法（如「直」「骨」）。用户的要求是
//! 「只能选择中文字体库，不能选择英文字体库」，故：
//!   ① 基础层：必须覆盖常用汉字（中日韩字体都有，用来淘汰纯拉丁字体）；
//!   ② 简体层：必须覆盖**简体特有**字形（东/国/龙/论/车/门 —— 日文 JIS 不含），
//!      用来淘汰"只有英文"和"只有日韩汉字"的字体。
//! 两层都过才算中文字体。判据的具体码点见下方常量，并有用例钉住。

use serde::Serialize;

/// 枚举结果里的一款字体。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CjkFont {
    /// CSS 里应使用的族名（优先英文名，因为注册表/Windows 自身用英文名）。
    pub family: String,
    /// 面向用户展示的名字（优先中文名，没有则与 `family` 相同）。
    pub display: String,
}

/// 系统字体表里某个族的一个**字体面**。仅测试与诊断使用。
///
/// 为什么需要它：`available_weights_of_family` 只报字重数字，而一个族里出现的
/// 字重不一定来自我们装的字体 —— 本机基线上就有别人装的
/// `Source Han Serif SC Heavy`，它会让思源宋体这个族在**我们没装 Bold** 时
/// 也报出 700 以上的字重。带上完整名才能判断每一面到底是谁。
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FamilyFace {
    /// DirectWrite 字重值（400 = Regular，700 = Bold）。
    pub weight: i32,
    /// 完整名（`FULL_NAME` 信息串，en-us 优先）；读不到为 `None`。
    pub full_name: Option<String>,
}

/// 一个字体文件自报的完整身份。仅测试与诊断使用（见 `describe_face`）。
///
/// 用 `#[cfg(test)]` 而不是 `#[allow(dead_code)]`：后者会把这套诊断编进发布产物，
/// 而"没被用到的代码"迟早会腐烂成错误的代码。
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontFaceDescription {
    /// `(locale, 族名)`，按 locale 排序。族名 = 同族各字重共用的名字。
    pub family_names: Vec<(String, String)>,
    /// `(locale, face 名)`，按 locale 排序。
    /// face 名是**每个字重各不相同**的那个名字，注册表值名要用它。
    pub face_names: Vec<(String, String)>,
    /// DirectWrite 解析 OS/2 得到的字重（400 = Regular，700 = Bold）。
    /// 保留 `i32` 原样：`DWRITE_FONT_WEIGHT` 就是这个类型，转 `u32` 只是
    /// 为了好看，而"诊断读到的原始值"没有粉饰的理由。
    pub weight: i32,
}

#[cfg(test)]
impl FontFaceDescription {
    /// 取英文 face 名（`en-us` 优先，其次任何一条），用于组成注册表值名。
    pub fn english_face_name(&self) -> Option<&str> {
        let pick = |loc: &str| {
            self.face_names
                .iter()
                .find(|(l, _)| l.eq_ignore_ascii_case(loc))
                .map(|(_, n)| n.as_str())
        };
        pick("en-us")
            .or_else(|| pick("en"))
            .or_else(|| self.face_names.first().map(|(_, n)| n.as_str()))
    }
}

/*
 * ── 判据的探针码点 ──
 *
 * 基础层：任何一款汉字字体（简/繁/日/韩）都必然覆盖这几个。
 * 作用只有一个 —— 淘汰纯拉丁字体。
 */
const PROBE_BASIC: [u32; 7] = [
    0x4E2D, // 中
    0x6587, // 文
    0x4E00, // 一
    0x5341, // 十
    0x5927, // 大
    0x5C0F, // 小
    0x9AD8, // 高
];

/*
 * 简体层：**简体特有**字形 —— 日文 JIS / 韩文 KS 都不含这些简化形式。
 * 这是"中文字体"与"日韩汉字字体"的分界线。
 *
 * 为什么不是"至少要有一个"而是"全部"：只要求一个时，个别日文字体因收录了
 * 少量简化字（或韩文字体因收录大陆用字）会被误判成中文字体；要求全部 6 个
 * 才能可靠地把"能正常排版简体中文"与"只是碰巧有几个汉字"区分开。
 *
 * ⚠️ 代价（如实登记）：**纯繁体**字体（例如只含 Big5 字形的老字体）会被排除。
 * 本机常见的繁体字体（微軟正黑體 `Microsoft JhengHei`、新細明體）都另含简体
 * 字形，实测能通过；真正只含 Big5 的字体在 Windows 上已极少见。
 * 若日后确需列出纯繁体字体，应另加一层繁体探针，而不是放宽这一层。
 */
const PROBE_SIMPLIFIED_ONLY: [u32; 6] = [
    0x4E1C, // 东（簡 東）
    0x56FD, // 国（簡 國）
    0x9F99, // 龙（簡 龍）
    0x8BBA, // 论（簡 論）
    0x8F66, // 车（簡 車）
    0x95E8, // 门（簡 門）
];

/// 判定一款字体是否为"中文字体"：基础层与简体层都必须**全部**覆盖。
///
/// 抽成纯函数（用闭包注入"是否有某码点字形"）是为了能脱离 COM 单元测试，
/// 并用假字体构造**负向对照**（纯拉丁字体必须被排除）。
pub fn qualifies_as_chinese_font(has_char: impl Fn(u32) -> bool) -> bool {
    PROBE_BASIC.iter().all(|&c| has_char(c)) && PROBE_SIMPLIFIED_ONLY.iter().all(|&c| has_char(c))
}

/// 诊断用码点：两层探针，外加用来区分简繁/日韩的额外样本。
///
/// 布局（共 25 项，顺序即含义）：`[0..7)` 基础层、`[7..13)` 简体层、
/// `[13..19)` 繁体特有字形、`[19..22)` 假名/谚文、`[22..25)` 常用汉字样本。
///
/// 直接写字面量而不是用 const fn 拼：拼装版本写过一次，偏移量算错了一格
/// （`12` 应为 `13`）导致"繁体层"盖住了"简体层"的最后一格、数组还少一格，
/// 于是诊断结果整体错位、看起来像真有缺陷。诊断工具本身出错会把人引向
/// 错误的结论，比没有诊断更糟。
#[cfg(all(test, windows))]
const DIAG_CODEPOINTS: [u32; 25] = [
    // [0..7) 基础层：任何汉字字体都有
    0x4E2D, 0x6587, 0x4E00, 0x5341, 0x5927, 0x5C0F, 0x9AD8, // 中文一十大 小高
    // [7..13) 简体层：简体特有，日韩 JIS/KS 不含
    0x4E1C, 0x56FD, 0x9F99, 0x8BBA, 0x8F66, 0x95E8, // 东国龙论车门
    // [13..19) 繁体层：繁体特有（簡→繁 的对应形式）
    0x6771, 0x570B, 0x9F8D, 0x8AD6, 0x8ECA, 0x9580, // 東國龍論車門
    // [19..22) 假名与谚文：繁体中文正体不应包含
    0x3042, 0x30A2, 0xAC00, // あ ア 가
    // [22..25) 常用汉字样本：确认确有汉字排版能力
    0x4F60, 0x597D, 0x7684, // 你 好 的
];

#[cfg(windows)]
mod win {
    use super::{qualifies_as_chinese_font, CjkFont};
    // `HSTRING` 生产路径也要用（读本地化族名、写注册表）。
    use windows::core::HSTRING;
    use windows::Win32::Graphics::DirectWrite::{
        DWriteCreateFactory, IDWriteFactory, IDWriteFontCollection, DWRITE_FACTORY_TYPE_SHARED,
        DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_NORMAL,
    };
    // 诊断路径专用。单独 cfg(test) 引，避免非测试构建出现 unused import 警告。
    #[cfg(test)]
    use super::{FontFaceDescription, FamilyFace};
    #[cfg(test)]
    use windows::Win32::Graphics::DirectWrite::DWRITE_INFORMATIONAL_STRING_FULL_NAME;
    #[cfg(test)]
    use windows::Win32::Graphics::DirectWrite::{IDWriteFont, IDWriteFontFace3, IDWriteLocalizedStrings};
    #[cfg(test)]
    use windows::core::Interface;

    /// 读一个 `IDWriteLocalizedStrings` 的指定 locale 名字。
    ///
    /// `locale` 用 `HSTRING`（DirectWrite 内部比较用的是宽字符 locale 名）。
    /// 找不到该 locale 时返回 `None`，由调用方决定回退策略。
    unsafe fn localized_name(

        strings: &windows::Win32::Graphics::DirectWrite::IDWriteLocalizedStrings,
        locale: &str,
    ) -> Option<String> {
        let locale_h = HSTRING::from(locale);
        let mut index: u32 = 0;
        let mut exists = windows::core::BOOL(0);
        // 找不到该 locale 不算错误，`exists` 为 0 即可
        strings.FindLocaleName(&locale_h, &mut index, &mut exists).ok()?;
        if !exists.as_bool() {
            return None;
        }
        let len = strings.GetStringLength(index).ok()?;
        // GetStringLength 不含结尾 NUL；多给一个槽位并按 0 截断，避免依赖其实现细节
        let mut buf = vec![0u16; (len as usize) + 1];
        strings.GetString(index, &mut buf).ok()?;
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16(&buf[..end]).ok()
    }

    /// 列出某个族在当前系统字体表里**实际可用**的全部字重（升序、去重）。
    ///
    /// 供诊断使用：判断"同族多字重是否真的都注册上了"。
    /// 族不存在时返回 `Ok(vec![])` 而不是错误 —— "这个族没有"本身是有效结论。
    ///
    /// ── 这个数字**不足以**单独下结论，必须配合完整名 ──
    /// 实测（本机）：`ChillKai`（只有一个 Regular 文件）也报告 `[400, 700]`，
    /// 因为 DirectWrite 会为缺少粗体的族**合成**一个 700 面，而它的完整名与
    /// 400 面**完全相同**（都是「寒蝉正楷体」）。所以：
    ///   · 看到 700 不等于"真装了 Bold"；
    ///   · 判断真伪要看完整名是否不同（真实的 Bold 会叫
    ///     `Source Han Serif SC Bold`，合成面只会沿用 `Source Han Serif SC`）。
    /// 另：本机 DirectWrite 把每个面都枚举**两次**（SimSun 等系统字体也一样），
    /// 故元素个数没有意义，只有去重后的字重集合与完整名有意义。
    #[cfg(test)]
    pub fn available_weights_of_family(family: &str) -> Result<Vec<i32>, String> {
        let mut weights: Vec<i32> = faces_of_family(family)?
            .into_iter()
            .map(|f| f.weight)
            .collect();
        weights.sort_unstable();
        weights.dedup();
        Ok(weights)
    }

    /// 一个族里每个**字体面**的身份：字重 + 完整名（`FULL_NAME`）。
    ///
    /// 完整名很重要：只报字重时，一个来自**另一款同族字体**的面
    /// （本机基线上就有 `Source Han Serif SC Heavy`）会被误读成
    /// "我们装的 Bold 生效了"。完整名能直接看出到底是哪一款。
    #[cfg(test)]
    pub fn faces_of_family(family: &str) -> Result<Vec<FamilyFace>, String> {
        unsafe {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .map_err(|e| format!("DWriteCreateFactory 失败: {e}"))?;
            let mut collection: Option<IDWriteFontCollection> = None;
            factory
                .GetSystemFontCollection(&mut collection, false)
                .map_err(|e| format!("GetSystemFontCollection 失败: {e}"))?;
            let collection =
                collection.ok_or_else(|| "GetSystemFontCollection 返回了空集合".to_string())?;
            let name_h = HSTRING::from(family);
            let mut index: u32 = 0;
            let mut exists = windows::core::BOOL(0);
            collection
                .FindFamilyName(&name_h, &mut index, &mut exists)
                .map_err(|e| format!("FindFamilyName 失败：{e}"))?;
            if !exists.as_bool() {
                return Ok(Vec::new());
            }
            let fam = collection
                .GetFontFamily(index)
                .map_err(|e| format!("GetFontFamily 失败：{e}"))?;
            let count = fam.GetFontCount();
            let mut out = Vec::new();
            for i in 0..count {
                let f = match fam.GetFont(i) {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                let weight: i32 = f.GetWeight().0;
                // 完整名要经由 FontFace3 的 informational string 取；
                // GetFaceNames 只给 style 名（实测为 "Bold"/"Regular"），
                // 用它当身份会把同族各面混在一起。
                let full_name = read_full_name_of_font(&f);
                out.push(FamilyFace { weight, full_name });
            }
            Ok(out)
        }
    }

    /// 取一个 `IDWriteFont` 的完整名（en-us 优先）。取不到返回 `None`，
    /// 不返回 `Some("")` —— 空串会被当成"有名字"从而掩盖读取失败。
    #[cfg(test)]
    fn read_full_name_of_font(f: &IDWriteFont) -> Option<String> {
        unsafe {
            let face = f.CreateFontFace().ok()?;
            let face3: IDWriteFontFace3 = face.cast().ok()?;
            let mut strings: Option<IDWriteLocalizedStrings> = None;
            let mut exists = windows::core::BOOL(0);
            face3
                .GetInformationalStrings(
                    DWRITE_INFORMATIONAL_STRING_FULL_NAME,
                    &mut strings,
                    &mut exists,
                )
                .ok()?;
            if !exists.as_bool() {
                return None;
            }
            let strings = strings?;
            let n = strings.GetCount();
            if n == 0 {
                return None;
            }
            // 优先 en-us，其次第一个（与 describe_face 的策略一致）
            let mut pick = 0u32;
            for i in 0..n {
                let len = strings.GetLocaleNameLength(i).ok()?;
                let mut buf = vec![0u16; len as usize + 1];
                if strings.GetLocaleName(i, &mut buf).is_err() {
                    continue;
                }
                let loc = String::from_utf16_lossy(&buf[..len as usize]);
                if loc.eq_ignore_ascii_case("en-us") {
                    pick = i;
                    break;
                }
            }
            let len = strings.GetStringLength(pick).ok()?;
            let mut buf = vec![0u16; len as usize + 1];
            strings.GetString(pick, &mut buf).ok()?;
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// 枚举本机全部字体族，过滤出中文字体。
    pub fn list_cjk_fonts() -> Result<Vec<CjkFont>, String> {
        unsafe {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .map_err(|e| format!("DWriteCreateFactory 失败: {e}"))?;
            // IDWriteFactory（v1）用输出参数返回集合，不是直接返回；
            // 直接返回集合的是 IDWriteFactory3 的同名方法。
            let mut collection: Option<IDWriteFontCollection> = None;
            factory
                .GetSystemFontCollection(&mut collection, false)
                .map_err(|e| format!("GetSystemFontCollection 失败: {e}"))?;
            let collection =
                collection.ok_or_else(|| "GetSystemFontCollection 返回了空集合".to_string())?;

            let count = collection.GetFontFamilyCount();
            let mut out: Vec<CjkFont> = Vec::new();

            for i in 0..count {
                let family = match collection.GetFontFamily(i) {
                    Ok(f) => f,
                    // 单个族读失败不该让整次枚举失败（字体库可能有坏条目）
                    Err(_) => continue,
                };
                // 用常规字重/字宽/字形去问这个族"有没有这个字"。
                // HasCharacter 是 IDWriteFont 上的方法，故先取一个代表成员。
                let font = match family.GetFirstMatchingFont(
                    DWRITE_FONT_WEIGHT_NORMAL,
                    DWRITE_FONT_STRETCH_NORMAL,
                    DWRITE_FONT_STYLE_NORMAL,
                ) {
                    Ok(f) => f,
                    Err(_) => continue,
                };

                let has = |c: u32| -> bool {
                    // 出错时保守地当作"没有"，宁可不列也不列一个用不了的
                    font.HasCharacter(c).map(|b| b.as_bool()).unwrap_or(false)
                };
                if !qualifies_as_chinese_font(has) {
                    continue;
                }

                let names = match family.GetFamilyNames() {
                    Ok(n) => n,
                    Err(_) => continue,
                };
                let en = localized_name(&names, "en-us");
                let zh = localized_name(&names, "zh-cn");
                // 族名一个都没读到就跳过：没有名字的字体无法写进 CSS
                let family_name = match (&en, &zh) {
                    (Some(e), _) => e.clone(),
                    (None, Some(z)) => z.clone(),
                    (None, None) => continue,
                };
                // display 先算好再 move family_name，否则是"移动后再借用"
                let display = zh.clone().unwrap_or_else(|| family_name.clone());
                out.push(CjkFont {
                    family: family_name,
                    display,
                });
            }

            // DirectWrite 的顺序由系统字体集合决定，不稳定；排序后结果可复现
            // （可复现是"这个列表能被测试断言"的前提）
            out.sort_by(|a, b| a.family.cmp(&b.family));
            out.dedup_by(|a, b| a.family == b.family);
            Ok(out)
        }
    }

    /// 从**字体文件**判断它是否含有给定码点的字形（不依赖是否已安装）。仅测试使用。
    ///
    /// 用 `GetGlyphIndices`：字形索引 0 恒为 `.notdef`（缺失字形），
    /// 因此"索引 != 0"就是"有字形"。这条路径不经过系统字体集合，
    /// 也就不受"字体是否已注册/是否被枚举到"的影响。
    #[cfg(test)]
    pub fn has_chars_of_file(path: &std::path::Path, codepoints: &[u32]) -> Result<Vec<bool>, String> {
        use windows::Win32::Graphics::DirectWrite::{
            DWRITE_FONT_FACE_TYPE_TRUETYPE, DWRITE_FONT_SIMULATIONS_NONE,
        };
        if !path.is_file() {
            return Err(format!("字体文件不存在：{}", path.display()));
        }
        unsafe {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .map_err(|e| format!("DWriteCreateFactory 失败: {e}"))?;
            let wide = HSTRING::from(path.to_string_lossy().as_ref());
            let file = factory
                .CreateFontFileReference(&wide, None)
                .map_err(|e| format!("CreateFontFileReference 失败：{e}"))?;
            let face = factory
                .CreateFontFace(
                    DWRITE_FONT_FACE_TYPE_TRUETYPE,
                    &[Some(file)],
                    0,
                    DWRITE_FONT_SIMULATIONS_NONE,
                )
                .map_err(|e| format!("CreateFontFace 失败：{e}"))?;
            // 逐码点单独查：一次性传整批时，任何失败都会丢掉全部结果；
            // 逐点查能把"某码点查不了"与"确实没有该字形"分开
            let mut out = Vec::with_capacity(codepoints.len());
            for &cp in codepoints {
                let mut glyph: u16 = 0;
                match face.GetGlyphIndices(&cp, 1, &mut glyph) {
                    Ok(()) => out.push(glyph != 0),
                    Err(_) => out.push(false),
                }
            }
            Ok(out)
        }
    }

    /// 读一个字体**文件**的族名（不安装也能读）。仅测试使用，理由见外层包装。
    ///
    /// 用 `CreateFontFileReference` + `CreateFontFace` 直接从文件建 face，
    /// 再查 `IDWriteFontFace3::GetFamilyNames`。这条路径与 WebView2
    /// 实际做字体匹配时读的是同一张 `name` 表。
    #[cfg(test)]
    pub fn describe_font_file(path: &std::path::Path) -> Result<Vec<(String, String)>, String> {
        Ok(describe_face(path)?.family_names)
    }

    /// 读一个字体**文件**自报的完整身份：族名、face 名、字重。
    ///
    /// ── 为什么需要 face 名 ──
    /// 注册表值名的约定是 `<face 名> (TrueType)`，而 **face 名不等于族名**：
    /// 同一族的不同字重，族名相同、face 名不同
    /// （如族名都是 `Source Han Serif SC`，face 名分别是
    /// `Source Han Serif SC` 与 `Source Han Serif SC Bold`）。
    /// 只用族名做值名，Regular 与 Bold 会撞在同一个键上、互相覆盖，
    /// 结果总有一个字重的文件被写在磁盘上却从未注册 —— 即"装了但用不到"。
    ///
    /// 机器上 Windows 自己装出来的值名可佐证这个约定：
    /// `Noto Sans SC (TrueType)` / `Noto Sans SC Bold (TrueType)` /
    /// `Noto Sans SC Medium (TrueType)`、`Source Han Serif SC Heavy (TrueType)`。
    ///
    /// 同时返回 `weight`（DirectWrite 解析 OS/2 得到的数值），
    /// 让"这就是 Regular"成为可断言的数值而不是靠名字猜。
    #[cfg(test)]
    pub fn describe_face(path: &std::path::Path) -> Result<FontFaceDescription, String> {
        use windows::Win32::Graphics::DirectWrite::{
            DWRITE_FONT_FACE_TYPE_TRUETYPE, DWRITE_FONT_SIMULATIONS_NONE, IDWriteFontFace3,
        };
        // `Interface` 必须 in scope 才能 `.cast()`，否则只报 "no method named cast"
        use windows::core::Interface;
        if !path.is_file() {
            return Err(format!("字体文件不存在：{}", path.display()));
        }
        unsafe {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .map_err(|e| format!("DWriteCreateFactory 失败: {e}"))?;
            let wide = HSTRING::from(path.to_string_lossy().as_ref());
            let file = factory
                .CreateFontFileReference(&wide, None)
                .map_err(|e| format!("CreateFontFileReference 失败 {}: {e}", path.display()))?;
            let face = factory
                .CreateFontFace(
                    DWRITE_FONT_FACE_TYPE_TRUETYPE,
                    &[Some(file)],
                    0,
                    DWRITE_FONT_SIMULATIONS_NONE,
                )
                .map_err(|e| format!("CreateFontFace 失败 {}: {e}", path.display()))?;
            let face3: IDWriteFontFace3 = face
                .cast()
                .map_err(|e| format!("IDWriteFontFace → IDWriteFontFace3 失败：{e}"))?;

            let read_all = |strings: &IDWriteLocalizedStrings| -> Vec<(String, String)> {
                let count = strings.GetCount();
                let mut out: Vec<(String, String)> = Vec::new();
                for i in 0..count {
                    let len = strings.GetStringLength(i).unwrap_or(0);
                    let mut buf = vec![0u16; (len as usize) + 1];
                    if strings.GetString(i, &mut buf).is_err() {
                        continue;
                    }
                    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                    let name = String::from_utf16_lossy(&buf[..end]);
                    if name.trim().is_empty() {
                        continue;
                    }
                    let locale = (|| -> Option<String> {
                        let llen = strings.GetLocaleNameLength(i).ok()?;
                        let mut lbuf = vec![0u16; (llen as usize) + 1];
                        strings.GetLocaleName(i, &mut lbuf).ok()?;
                        let lend = lbuf.iter().position(|&c| c == 0).unwrap_or(lbuf.len());
                        let loc = String::from_utf16_lossy(&lbuf[..lend]);
                        if loc.trim().is_empty() { None } else { Some(loc) }
                    })()
                    .unwrap_or_else(|| format!("index{i}"));
                    out.push((locale, name));
                }
                out.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
                out
            };

            Ok(FontFaceDescription {
                family_names: read_all(
                    &face3
                        .GetFamilyNames()
                        .map_err(|e| format!("GetFamilyNames 失败：{e}"))?,
                ),
                face_names: read_all(
                    &face3
                        .GetFaceNames()
                        .map_err(|e| format!("GetFaceNames 失败：{e}"))?,
                ),
                weight: face3.GetWeight().0,
            })
        }
    }
}

#[cfg(windows)]
pub use win::list_cjk_fonts;

/// 读一个**字体文件**自报的族名（不依赖它是否已安装）。
///
/// ── 为什么需要这个 ──
/// 清单里的 `family` 会同时被用作：① CSS 里 `font-family` 的名字；
/// ② 注册表值名。两者都必须与字体文件 `name` 表里的族名一致，否则
/// "字体装上了但选了没反应"——正是本次修复要根除的病症。
///
/// 这个函数让"清单声明的族名是否真的存在于此文件"变成**可测的断言**，
/// 而不是靠人肉读文档。它已经抓到过一次真实问题：
/// 文津宋体的实际族名是 `WenJin Mincho Plane 0`（仓库把字体按 Unicode 平面
/// 拆成 P0/P2/P3，英文名带平面后缀），朱雀仿宋是
/// `Zhuque Fangsong (technical preview)` —— 都不是清单里写的那个名字。
///
/// 返回该 face 的全部 `(locale, 名字)`，按 locale 排序。
///
/// 目前**只有测试**用它（生产路径不需要读文件族名：装好之后由系统解析）。
/// 因此用 `#[cfg(test)]` 而不是 `#[allow(dead_code)]` —— 后者会把这套诊断
/// 悄悄编进发布产物，而"没被用到的代码"迟早会腐烂成错误的代码。
#[cfg(all(test, windows))]
pub fn describe_font_file(path: &std::path::Path) -> Result<Vec<(String, String)>, String> {
    win::describe_font_file(path)
}

/// 该文件自报的族名集合（去重后按小写排序）。同样只服务测试，见上。
#[cfg(all(test, windows))]
pub fn family_names_of_file(path: &std::path::Path) -> Result<Vec<String>, String> {
    let all = describe_font_file(path)?;
    let mut names: Vec<String> = all.into_iter().map(|(_, name)| name).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    Ok(names)
}

/// 读一个字体**文件**自报的完整身份（族名 / face 名 / 字重）。
///
/// 为什么要读 face 名：注册表值名必须**逐字重各不相同**，否则同族的
/// Regular 与 Bold 会撞在同一个键上互相覆盖。规则见 `describe_face` 的注释。
#[cfg(all(test, windows))]
pub fn describe_face_of_file(path: &std::path::Path) -> Result<FontFaceDescription, String> {
    win::describe_face(path)
}

/// 非 Windows 平台：本阶段的枚举只实现 Windows（WebView2）。
/// 明确返回错误而不是返回空列表 —— 空列表会被前端当成"本机没有中文字体"，
/// 那是个会被用户信以为真的假结论。
#[cfg(not(windows))]
pub fn list_cjk_fonts() -> Result<Vec<CjkFont>, String> {
    Err("中文字体枚举目前仅实现 Windows（DirectWrite）".to_string())
}

/// 判定某个**字体文件**是否通过中文字体判据（不依赖它是否已安装）。
#[cfg(all(test, windows))]
fn file_passes_chinese_probe(path: &std::path::Path) -> Result<bool, String> {
    let mut probe: Vec<u32> = Vec::new();
    probe.extend_from_slice(&PROBE_BASIC);
    probe.extend_from_slice(&PROBE_SIMPLIFIED_ONLY);
    let hits = win::has_chars_of_file(path, &probe)?;
    // 复用生产判据本身，而不是在测试里重写一遍规则 ——
    // 重写的那一份迟早会与生产逻辑分叉
    Ok(qualifies_as_chinese_font(|c| {
        probe
            .iter()
            .position(|&p| p == c)
            .map(|i| hits[i])
            .unwrap_or(false)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一个"只有给定码点才有字形"的假字体，用来做正/负向对照。
    fn font_with(chars: &[u32]) -> impl Fn(u32) -> bool + '_ {
        move |c| chars.contains(&c)
    }

    fn all_probes() -> Vec<u32> {
        PROBE_BASIC
            .iter()
            .chain(PROBE_SIMPLIFIED_ONLY.iter())
            .copied()
            .collect()
    }

    #[test]
    fn 覆盖全部探针的字体被判定为中文字体() {
        assert!(qualifies_as_chinese_font(font_with(&all_probes())));
    }

    #[test]
    fn 纯拉丁字体必须被排除_负向对照() {
        // 一个汉字字形都没有
        let latin = |_c: u32| false;
        assert!(
            !qualifies_as_chinese_font(latin),
            "纯拉丁字体（无汉字）绝不能被当作中文字体 —— 否则用户选中后会静默回退"
        );
    }

    #[test]
    fn 只有基础汉字但缺简体特有字形的字体必须被排除_负向对照() {
        // 这就是"日文/韩文汉字字体"的形状：常用汉字都有，简体特有字形没有
        assert!(
            !qualifies_as_chinese_font(font_with(&PROBE_BASIC)),
            "只覆盖基础汉字（日韩字体即如此）不能被当作中文字体"
        );
    }

    #[test]
    fn 简体层缺任意一个都必须被排除() {
        // 逐个抽掉简体探针中的一个，都必须判为不合格 ——
        // 若某条探针其实不参与判定，这里会暴露
        for &missing in PROBE_SIMPLIFIED_ONLY.iter() {
            let chars: Vec<u32> = all_probes().into_iter().filter(|&c| c != missing).collect();
            assert!(
                !qualifies_as_chinese_font(font_with(&chars)),
                "抽掉简体探针 U+{missing:04X} 后仍被判为中文字体 —— 该探针未参与判定"
            );
        }
    }

    #[test]
    fn 基础层缺任意一个都必须被排除() {
        for &missing in PROBE_BASIC.iter() {
            let chars: Vec<u32> = all_probes().into_iter().filter(|&c| c != missing).collect();
            assert!(
                !qualifies_as_chinese_font(font_with(&chars)),
                "抽掉基础探针 U+{missing:04X} 后仍被判为中文字体 —— 该探针未参与判定"
            );
        }
    }

    #[test]
    fn 探针本身不得重复() {
        // 重复的探针会让"抽掉一个"的用例失效（另一个副本仍然满足）
        let mut all = all_probes();
        let before = all.len();
        all.sort_unstable();
        all.dedup();
        assert_eq!(before, all.len(), "探针码点里有重复项");
    }

    /*
     * ── 真实枚举（需要 Windows + DirectWrite）──
     *
     * 前 6 条用假字体测"判据逻辑对不对"；这一条测"真的接上系统后拿到什么"。
     * 两者缺一不可：逻辑对但 COM 调用写错时，前者全绿而功能完全不可用。
     */

    #[cfg(windows)]
    #[test]
    fn 真实枚举本机中文字体() {
        let list = list_cjk_fonts().expect("枚举不应失败");
        // 打印全部结果：`cargo test -- --nocapture` 可人工复核
        println!("── 本机中文字体 {} 款 ──", list.len());
        for f in &list {
            println!("  {:<40} display={}", f.family, f.display);
        }

        assert!(!list.is_empty(), "本机一款中文字体都没枚举到，枚举逻辑很可能没接上");

        // 排序且去重（可复现是能被断言的前提）
        let mut families: Vec<&str> = list.iter().map(|f| f.family.as_str()).collect();
        let sorted = {
            let mut s = families.clone();
            s.sort_unstable();
            s
        };
        assert_eq!(families, sorted, "结果必须按 family 排序");
        families.dedup();
        assert_eq!(families.len(), list.len(), "family 不得重复");

        // 族名不得为空（写进 CSS 会得到 `""` 这种无效栈）
        for f in &list {
            assert!(!f.family.trim().is_empty(), "族名不得为空: {f:?}");
        }

        /*
         * 负向对照：纯拉丁字体绝不能被列进来。
         * 这是用户那条要求（「只能选择中文字体库，不能选择英文字体库」）的直接断言，
         * 也是"选了没反应"病症的根因之一。
         */
        for banned in ["Arial", "Segoe UI", "Times New Roman", "Calibri", "Consolas", "Verdana"] {
            assert!(
                !list.iter().any(|f| f.family.eq_ignore_ascii_case(banned)),
                "纯拉丁字体 {banned} 不应出现在中文字体列表里"
            );
        }

        /*
         * 正向对照：本机确定存在的中文字体必须被枚举到。
         * 没有这一条时，一个"永远返回空列表"的实现也能让上面的负向对照全绿。
         * 微软雅黑随所有 Windows 发行版提供（本机已实测存在），故用它做锚点。
         */
        let anchors = ["Microsoft YaHei", "SimSun", "Microsoft JhengHei", "SimHei"];
        let hit: Vec<&str> = anchors
            .iter()
            .copied()
            .filter(|a| list.iter().any(|f| f.family.eq_ignore_ascii_case(a)))
            .collect();
        assert!(
            !hit.is_empty(),
            "一个已知的中文字体锚点都没命中（试过 {anchors:?}）—— 枚举可能只返回了空/错误结果"
        );
        println!("  命中锚点: {hit:?}");
    }

    /*
     * ── 随包字体的族名必须与清单声明一致 ──
     *
     * 这是本轮真正抓到过的缺陷类别：清单里写的族名如果与字体文件
     * `name` 表里的族名不一致，字体**装得上、CSS 匹配不上**，
     * 用户看到的就是"选了这个字体但界面没变"——正是本次要根除的病症。
     *
     * 光看文档看不出来（文津宋体写成 `WenJin Mincho` 很合理，
     * 实际却是 `WenJin Mincho Plane 0`），必须问 DirectWrite。
     */
    #[cfg(windows)]
    #[test]
    fn 随包字体的清单族名必须与字体文件自报的族名一致() {
        let fonts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let manifest_path = fonts_dir.join("fonts-manifest.json");
        /*
         * 跳过条件的边界要划准，否则这条测试能被"删掉清单"绕过：
         *   · fonts/ 里**有**字体文件却没有清单 → 一定是缺陷（文件会被打进安装包、
         *     却不会被安装，也不会有人核对它们的许可证）→ 必须失败；
         *   · fonts/ 里既没清单也没字体文件 → 只是这个检出不带随包字体
         *     （例如只跑 `npm run dev` 的开发环境）→ 跳过并**打印**出来，
         *     因为"测试通过"与"根本没测"看起来必须不一样。
         */
        let has_font_files = std::fs::read_dir(&fonts_dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok()).any(|e| {
                    let n = e.file_name().to_string_lossy().to_lowercase();
                    n.ends_with(".ttf") || n.ends_with(".otf") || n.ends_with(".ttc")
                })
            })
            .unwrap_or(false);
        if !manifest_path.is_file() {
            assert!(
                !has_font_files,
                "{} 里有字体文件但没有 fonts-manifest.json —— 这些文件会被打进安装包，\
                 却不会被安装、许可证也不会被核对。请运行 node scripts/sync-fonts-manifest.mjs",
                fonts_dir.display()
            );
            println!("ⓘ 跳过：本检出不含随包字体（{} 为空）", fonts_dir.display());
            return;
        }
        let manifest = crate::font_install::read_manifest(&fonts_dir)
            .expect("清单应可读")
            .expect("清单应存在");

        let mut mismatched = Vec::new();
        for entry in &manifest.fonts {
            let path = fonts_dir.join(&entry.file);
            let names = family_names_of_file(&path)
                .unwrap_or_else(|e| panic!("读取 {} 的族名失败：{e}", entry.file));
            // 声明名必须在**该文件自报的**族名集合里（大小写不敏感）
            let matched = names.iter().any(|n| n.eq_ignore_ascii_case(&entry.family));
            println!(
                "  {:<34} 声明={:<26} 实报={:?}",
                entry.file, entry.family, names
            );
            if !matched {
                mismatched.push(format!(
                    "{}（id={}）：清单声明 {:?}，但文件自报的族名是 {:?}",
                    entry.file, entry.id, entry.family, names
                ));
            }
        }
        assert!(
            mismatched.is_empty(),
            "以下随包字体的清单族名与字体文件不符 —— CSS 会匹配不上，\
             表现为「选了没反应」：\n  {}",
            mismatched.join("\n  ")
        );
    }

    #[cfg(windows)]
    #[test]
    fn 读取不存在字体的族名会返回错误而不是空列表() {
        // 空列表会与"这个字体没有任何族名"混淆；调用方据此应区分处理
        let missing = std::path::Path::new("C:/definitely/not/here/nope.ttf");
        assert!(describe_font_file(missing).is_err());
        assert!(family_names_of_file(missing).is_err());
    }

    /// 清单里声明的 `weight` 必须与字体文件自报的字重一致。
    ///
    /// ── 为什么这条不能省 ──
    /// `weight` 参与拼注册表值名：写错（例如把 Bold 写成 400）会让同一族的
    /// 两个字重拼出**同一个值名**，后注册的覆盖先注册的 —— 磁盘上多一个文件、
    /// 系统里少一档字重，而用户只看到"加粗没变化"。
    ///
    /// 这里不重复实现拼名逻辑，只核对"声明 = 文件自报"这个事实，
    /// 由 DirectWrite 解析 `OS/2` 得到，不靠文件名里的 `-Bold` 猜。
    #[cfg(windows)]
    #[test]
    fn 随包字体声明的字重必须与字体文件自报的一致() {
        let fonts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        if !fonts_dir.join("fonts-manifest.json").is_file() {
            println!("ⓘ 跳过：本检出不含随包字体清单");
            return;
        }
        let manifest = crate::font_install::read_manifest(&fonts_dir)
            .expect("清单应可读")
            .expect("清单应存在");

        let mut mismatched = Vec::new();
        for entry in &manifest.fonts {
            let path = fonts_dir.join(&entry.file);
            let d = describe_face_of_file(&path)
                .unwrap_or_else(|e| panic!("读取 {} 的字重失败：{e}", entry.file));
            println!(
                "  {:<34} 声明字重={:<4} 自报字重={}",
                entry.file, entry.weight, d.weight
            );
            if d.weight as u32 != entry.weight {
                mismatched.push(format!(
                    "{}（id={}）：清单声明 {}，文件自报 {}",
                    entry.file, entry.id, entry.weight, d.weight
                ));
            }
        }
        assert!(
            mismatched.is_empty(),
            "以下随包字体声明的字重与文件不符 —— 会拼出错误/重复的注册表值名，\
             导致同族字重互相覆盖：\n  {}",
            mismatched.join("\n  ")
        );
    }

    /// 清单里任意两条的注册表值名都不得相同。
    ///
    /// 这是纯数据断言（不需要读文件），因此即使在没有 DirectWrite 的机器上
    /// 也能挡住"加字重时忘了改 weight"这个错误。拼名规则与
    /// `src-tauri/src/font_install.rs` 的 `registry_value_name` 保持一致。
    #[test]
    fn 清单里任意两条的注册表值名都不得相同() {
        let fonts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        if !fonts_dir.join("fonts-manifest.json").is_file() {
            println!("ⓘ 跳过：本检出不含随包字体清单");
            return;
        }
        let manifest = crate::font_install::read_manifest(&fonts_dir)
            .expect("清单应可读")
            .expect("清单应存在");

        let mut seen: Vec<(String, String)> = Vec::new();
        let mut dupes = Vec::new();
        for entry in &manifest.fonts {
            // 借用生产实现，避免这里再抄一份字重映射（抄一份就一定会漂移）
            let name = crate::font_install::registry_value_name_for_test(&entry.family, entry.weight);
            if let Some((prev_id, _)) = seen.iter().find(|(_, n)| n == &name) {
                dupes.push(format!(
                    "{} 与 {} 都会写成「{name}」",
                    prev_id, entry.id
                ));
            }
            seen.push((entry.id.clone(), name));
        }
        assert!(
            dupes.is_empty(),
            "注册表值名重复 —— 后者会覆盖前者，其中一档字重在系统里不存在：\n  {}",
            dupes.join("\n  ")
        );
    }

    /*
     * ── 随包字体必须真的能被列出来 ──
     *
     * 这条不变式来自一个真实缺陷：曾经随包了 **芫荽 Iansui**，它是纯繁体字体，
     * 不含 东/国/龙/论/车/门 里的 东/龙/论/车。结果是它在用户机器上被安装、
     * 被写进注册表（9 MB 实实在在占了空间），却因为过不了中文判据而
     * **永远不会出现在任何字体下拉里** —— 用户看不到、也选不到。
     *
     * 而且就算硬把它列出来也是错的：它缺的这几个是极常用字，
     * 简体正文里出现 东/车 时只能回退到别的字体，同一段文字出现两种字形。
     *
     * 所以规则是：**随包字体集必须是"可被选中字体集"的子集。**
     * 要么它过判据（能被列出、能正常渲染简体），要么就不该随包。
     */
    #[cfg(windows)]
    #[test]
    fn 随包的每一款字体都必须能通过中文字体判据() {
        let fonts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let manifest_path = fonts_dir.join("fonts-manifest.json");
        if !manifest_path.is_file() {
            // 与族名一致性测试同样的边界：有字体文件却没清单 = 缺陷
            let has_files = std::fs::read_dir(&fonts_dir)
                .map(|rd| {
                    rd.filter_map(|e| e.ok()).any(|e| {
                        let n = e.file_name().to_string_lossy().to_lowercase();
                        n.ends_with(".ttf") || n.ends_with(".otf") || n.ends_with(".ttc")
                    })
                })
                .unwrap_or(false);
            assert!(!has_files, "有字体文件却没有清单，无法核对可选中性");
            println!("ⓘ 跳过：本检出不含随包字体");
            return;
        }
        let manifest = crate::font_install::read_manifest(&fonts_dir)
            .expect("清单应可读")
            .expect("清单应存在");

        let mut unusable = Vec::new();
        for entry in &manifest.fonts {
            let path = fonts_dir.join(&entry.file);
            match file_passes_chinese_probe(&path) {
                Ok(true) => {}
                Ok(false) => unusable.push(format!(
                    "{}（{} / {}）：过不了中文字体判据 —— 它会被安装到用户机器上，\
                     却永远不会出现在字体下拉里（不可选中的随包字体 = 白占体积）",
                    entry.display, entry.id, entry.file
                )),
                Err(e) => unusable.push(format!("{}（{}）：读取失败 {e}", entry.display, entry.id)),
            }
        }
        assert!(
            unusable.is_empty(),
            "以下随包字体无法被用户选中：\n  {}",
            unusable.join("\n  ")
        );
    }

    /// 负向对照：这条测试必须能真的失败，否则上面那条只是装饰。
    ///
    /// 用一个**已知通不过**判据的字体验证机制本身有效 ——
    /// 如果判据被误改成"永远返回 true"，这里会立刻报错。
    #[cfg(windows)]
    #[test]
    fn 负向对照_纯拉丁字体文件必须被判据拒绝() {
        // Arial 一定不含汉字；找不到就跳过（不同系统字体位置可能不同），
        // 但**必须打印**，避免"跳过"被当成"通过"
        let candidates = [
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
        ];
        let Some(path) = candidates
            .iter()
            .map(std::path::Path::new)
            .find(|p| p.is_file())
        else {
            println!("ⓘ 跳过负向对照：找不到任何已知纯拉丁字体");
            return;
        };
        let passed = file_passes_chinese_probe(path).expect("应能读取拉丁字体");
        assert!(
            !passed,
            "纯拉丁字体 {} 竟通过了中文字体判据 —— 判据已失效",
            path.display()
        );
    }

    /// 诊断用：把某个目录里每个字体文件对每层探针的覆盖情况打出来。
    ///
    /// 只在需要排查"某款随包字体为什么不出现在下拉里"时手动跑：
    /// `cargo test --lib 诊断_随包字体对探针的覆盖 -- --nocapture --ignored`
    ///
    /// 目录从 `QMAI_FONT_DIAG_DIR` 读，默认 `src-tauri/fonts`。
    /// **扫描目录而不是写死文件名清单**：写死的清单会随着字体增减过期，
    /// 而过期的诊断工具比没有更糟 —— 它会安静地漏掉新加的文件
    /// （本函数早先就写死了已删除的 `Iansui-Regular.ttf`）。
    #[cfg(windows)]
    #[test]
    #[ignore = "诊断工具，非断言测试"]
    fn 诊断_随包字体对探针的覆盖() {
        let fonts_dir = std::env::var_os("QMAI_FONT_DIAG_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts"));
        let mut files: Vec<std::path::PathBuf> = Vec::new();
        for entry in std::fs::read_dir(&fonts_dir)
            .unwrap_or_else(|e| panic!("读不到 {}：{e}", fonts_dir.display()))
            .flatten()
        {
            let p = entry.path();
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if p.is_file() && matches!(ext.as_str(), "ttf" | "otf" | "ttc") {
                files.push(p);
            }
        }
        files.sort();
        if files.is_empty() {
            println!("ⓘ {} 里没有字体文件", fonts_dir.display());
            return;
        }
        for path in &files {
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            match win::has_chars_of_file(path, &DIAG_CODEPOINTS) {
                Ok(hits) => {
                    let basic_missing: Vec<String> = PROBE_BASIC
                        .iter()
                        .zip(hits.iter())
                        .filter(|(_, &has)| !has)
                        .map(|(&c, _)| format!("U+{c:04X}"))
                        .collect();
                    let simp_missing: Vec<String> = PROBE_SIMPLIFIED_ONLY
                        .iter()
                        .zip(hits.iter().skip(7))
                        .filter(|(_, &has)| !has)
                        .map(|(&c, _)| format!("U+{c:04X} {}", char::from_u32(c).unwrap_or('?')))
                        .collect();
                    let trad_have: Vec<String> = DIAG_CODEPOINTS[13..19]
                        .iter()
                        .zip(hits.iter().skip(13))
                        .filter(|(_, &has)| has)
                        .map(|(&c, _)| char::from_u32(c).unwrap_or('?').to_string())
                        .collect();
                    // 假名/谚文：有任何一个都说明它更像日韩字体而非中文正体
                    let kana_hangul: Vec<String> = DIAG_CODEPOINTS[19..22]
                        .iter()
                        .zip(hits.iter().skip(19))
                        .filter(|(_, &has)| has)
                        .map(|(&c, _)| char::from_u32(c).unwrap_or('?').to_string())
                        .collect();
                    println!(
                        "  {name:<34} 基础缺={basic_missing:?} 简体缺={simp_missing:?} \
                         繁体有={trad_have:?} 假名谚文={kana_hangul:?}"
                    );
                }
                Err(e) => println!("  {name}：读取失败 {e}"),
            }
        }
    }

    /// 诊断用：打印每个字体文件自报的族名、face 名与字重。
    ///
    /// 注册表值名的规范是 `<face 名> (TrueType)`，而同族各字重的**族名相同、
    /// face 名不同**。加字重之前必须先用这个工具读出真实的 face 名，
    /// 而不是照着文件名的 `-Bold` 猜 —— 值名写错会造成同族字重互相覆盖。
    ///
    /// `cargo test --lib 诊断_字体文件自报的族名与字重 -- --nocapture --ignored`
    /// 目录同 `诊断_随包字体对探针的覆盖`（`QMAI_FONT_DIAG_DIR` 可覆盖）。
    #[cfg(windows)]
    #[test]
    #[ignore = "诊断工具，非断言测试"]
    fn 诊断_字体文件自报的族名与字重() {
        let fonts_dir = std::env::var_os("QMAI_FONT_DIAG_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts"));
        let mut files: Vec<std::path::PathBuf> = Vec::new();
        for entry in std::fs::read_dir(&fonts_dir)
            .unwrap_or_else(|e| panic!("读不到 {}：{e}", fonts_dir.display()))
            .flatten()
        {
            let p = entry.path();
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if p.is_file() && matches!(ext.as_str(), "ttf" | "otf" | "ttc") {
                files.push(p);
            }
        }
        files.sort();
        if files.is_empty() {
            println!("ⓘ {} 里没有字体文件", fonts_dir.display());
            return;
        }
        for path in &files {
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            match describe_face_of_file(path) {
                Ok(d) => {
                    let fam = d
                        .family_names
                        .iter()
                        .find(|(l, _)| l.eq_ignore_ascii_case("en-us"))
                        .map(|(_, n)| n.as_str())
                        .unwrap_or("(无 en-us)");
                    let face = d.english_face_name().unwrap_or("(无)");
                    println!("  {name}");
                    println!("     族名 = {fam}");
                    println!("     face = {face}");
                    println!("     字重 = {}", d.weight);
                    println!("     注册表值名应为 = \"{face} (TrueType)\"");
                }
                Err(e) => println!("  {name}：读取失败 {e}"),
            }
        }
    }

    /// 诊断用：列出某个**族**在当前系统字体表里**实际可用**的全部字重。
    ///
    /// 这是判断"同一族的多个字重是否真的都注册上了"的唯一可靠办法。
    /// `GetFirstMatchingFont` 不够用：它只返回一个**最接近**的字重，
    /// 而"最接近"可能意味着"其实只有 Regular，其余都是拿别的字重凑的"。
    /// 逐个列出族内字体才能看出到底有几个真实字重。
    ///
    /// 族名从 `QMAI_FONT_DIAG_FAMILY` 读（逗号分隔可查多个）。
    ///
    /// `cargo test --lib 诊断_列出某族实际可用的字重 -- --nocapture --ignored`
    #[cfg(windows)]
    #[test]
    #[ignore = "诊断工具，非断言测试"]
    fn 诊断_列出某族实际可用的字重() {
        let raw = std::env::var("QMAI_FONT_DIAG_FAMILY")
            .unwrap_or_else(|_| "Source Han Serif SC,Source Han Sans SC".to_string());
        for family in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            match win::available_weights_of_family(family) {
                Ok(weights) => {
                    println!("  {family}：可用字重 {weights:?}（共 {} 个）", weights.len());
                    /*
                     * 逐面打印身份。只报字重数字会在两种情况下误导人：
                     *   · 以为"有 700 就说明 Bold 装好了"，其实那一面可能是
                     *     系统里另一款同族字体贡献的；
                     *   · 反过来，看到意外的字重却无法判断它从哪来。
                     * 打印完整名（FULL_NAME）能直接看出是哪个文件/哪一款。
                     */
                    match win::faces_of_family(family) {
                        Ok(faces) => {
                            for (i, f) in faces.iter().enumerate() {
                                println!(
                                    "      [{i}] 字重={} 全名={:?}",
                                    f.weight, f.full_name
                                );
                            }
                        }
                        Err(e) => println!("      （逐面枚举失败：{e}）"),
                    }
                }
                Err(e) => println!("  {family}：{e}"),
            }
        }
    }
}
