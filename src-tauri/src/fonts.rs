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

    /// 枚举本机全部字体族，过滤出中文字体。
    pub fn list_cjk_fonts() -> Result<Vec<CjkFont>, String> {
        unsafe {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .map_err(|e| format!("DWriteCreateFactory 失败: {e}"))?;
            let mut collection: Option<IDWriteFontCollection> = None;
            factory
                .GetSystemFontCollection(&mut collection, false)
                .map_err(|e| format!("GetSystemFontCollection 失败: {e}"))?;
            let collection = collection.ok_or_else(|| "GetSystemFontCollection 返回了空集合".to_string())?;

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
        use windows::Win32::Graphics::DirectWrite::{
            DWRITE_FONT_FACE_TYPE_TRUETYPE, DWRITE_FONT_SIMULATIONS_NONE, IDWriteFontFace3,
        };
        // `Interface` 必须 in scope 才能用 `.cast()`（IDWriteFontFace → IDWriteFontFace3）。
        // 少了它只会得到 "no method named cast"，报错信息不提示真正原因。
        // 放在函数内是因为这个 trait 只有这条测试路径需要，放到模块顶部会在
        // 非测试构建里变成 unused import 警告。
        use windows::core::Interface;
        if !path.is_file() {
            return Err(format!("字体文件不存在：{}", path.display()));
        }
        unsafe {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .map_err(|e| format!("DWriteCreateFactory 失败: {e}"))?;
            let wide = windows::core::HSTRING::from(path.to_string_lossy().as_ref());
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
            // GetFamilyNames 在 FontFace3 上；从 FontFace 查询接口
            let face3: IDWriteFontFace3 = face
                .cast()
                .map_err(|e| format!("IDWriteFontFace → IDWriteFontFace3 失败：{e}"))?;
            let names = face3
                .GetFamilyNames()
                .map_err(|e| format!("GetFamilyNames 失败：{e}"))?;

            let count = names.GetCount();
            let mut out: Vec<(String, String)> = Vec::new();
            /*
             * 逐条列出全部 locale 的名字，并**带上它自己的 locale**。
             * locale 很关键：同一个族名在不同 locale 下可能不同
             * （如 `WenJin Mincho Plane 0` 只在 en-us 下），
             * 而注册表值名要用英文名、展示要用中文名，两者都要能看到。
             */
            for i in 0..count {
                let len = names.GetStringLength(i).unwrap_or(0);
                let mut buf = vec![0u16; (len as usize) + 1];
                if names.GetString(i, &mut buf).is_err() {
                    continue;
                }
                let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                let name = String::from_utf16_lossy(&buf[..end]);
                if name.trim().is_empty() {
                    continue;
                }
                // locale 读不到就用序号占位（不至于因此丢掉一个真实族名）
                let locale = (|| -> Option<String> {
                    let llen = names.GetLocaleNameLength(i).ok()?;
                    let mut lbuf = vec![0u16; (llen as usize) + 1];
                    names.GetLocaleName(i, &mut lbuf).ok()?;
                    let lend = lbuf.iter().position(|&c| c == 0).unwrap_or(lbuf.len());
                    let loc = String::from_utf16_lossy(&lbuf[..lend]);
                    if loc.trim().is_empty() { None } else { Some(loc) }
                })()
                .unwrap_or_else(|| format!("index{i}"));
                out.push((locale, name));
            }
            out.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
            Ok(out)
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

    /// 诊断用：把某个字体文件对每层探针的覆盖情况打出来。
    ///
    /// 只在需要排查"某款随包字体为什么不出现在下拉里"时手动跑：
    /// `cargo test --lib 诊断_随包字体对探针的覆盖 -- --nocapture --ignored`
    #[cfg(windows)]
    #[test]
    #[ignore = "诊断工具，非断言测试"]
    fn 诊断_随包字体对探针的覆盖() {
        let fonts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        for name in [
            "Iansui-Regular.ttf",
            "LXGWWenKai-Regular.ttf",
            "WenJinMincho-Regular.ttf",
            "ZhuqueFangsong-Regular.ttf",
            "ChillKai-Regular.ttf",
            "SmileySans-Regular.ttf",
            "SarasaGothicSC-Regular.ttf",
            "SourceHanSansSC-Regular.otf",
            "SourceHanSerifSC-Regular.otf",
            "HarmonyOSSansSC-Regular.ttf",
        ] {
            let path = fonts_dir.join(name);
            if !path.is_file() {
                println!("  {name}：文件不存在");
                continue;
            }
            match win::has_chars_of_file(&path, &DIAG_CODEPOINTS) {
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
}
