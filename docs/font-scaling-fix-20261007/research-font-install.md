# Installing bundled fonts per-user from a Tauri v2 desktop app

**Scope:** Windows (primary), macOS, Linux. Per-user / no-administrator install + uninstall cleanup.

**How this was researched.** Documentation from Microsoft Learn, Apple Developer, freedesktop/fontconfig and Tauri v2 docs (URLs cited inline), **plus first-hand experiments run on a real Windows 11 (build 26200, zh-CN, WebView2 154.0.4258.62) session at Medium integrity with `IsAdminRole=False`** — i.e. a non-elevated, UAC-filtered token. Everything marked **[VERIFIED]** was measured on that machine, not inferred. Everything marked **[UNVERIFIED]** is a documented claim or a reasonable expectation that I could not test here (no macOS/Linux host, no standard-user account, no reboot).

---

## 0. Answers that contradict the brief's assumptions (read this first)

| # | Assumption in the brief | Finding |
|---|---|---|
| 1 | HKCU value data = font **file name** (relative to the font dir) | **Wrong for the per-user hive. [VERIFIED]** A bare file name in `HKCU\...\Fonts` is *ignored* — the font stayed invisible to a brand-new process. The **same file** became visible instantly once the value data was the **absolute path**. HKLM does use bare names, but only for files that live in `%windir%\Fonts`. |
| 2 | Registry write alone needs a logoff/reboot; you need `AddFontResourceExW` | **Wrong on Windows 11 (and 10 1809+). [VERIFIED]** Copy file into `%LOCALAPPDATA%\Microsoft\Windows\Fonts` + write the HKCU value with the full path ⇒ a **brand-new process saw the font within milliseconds**, with no `AddFontResourceExW`, no `WM_FONTCHANGE`, no logoff, no reboot. |
| 3 | Per-user install needs no elevation | **Confirmed. [VERIFIED]** At Medium IL: file copy into the per-user Fonts dir **succeeded**, HKCU value write **succeeded**, while the same HKCU-context process got `SecurityException: requested registry access is not allowed` writing the HKLM equivalent. |
| 4 | Chinese names are separate registry entries | Correct — they are not. **[VERIFIED]** HKLM has `SimSun & NSimSun (TrueType)` and `SimHei (TrueType)`; the Chinese names 宋体/黑体 are `name`-table localizations (zh-CN) that DirectWrite exposes as *additional names for the same family*. CSS matches **either** name. |
| 5 | `windows-sys` is already a dependency | **Not in `src-tauri/Cargo.toml`.** It is only a transitive dependency (0.52/0.59/0.60/0.61 are all in `Cargo.lock`; there is no direct `windows-sys` and no `windows` entry in the manifest). You must add it explicitly. |
| 6 | — | `windows-sys`'s `FONTENUMPROCW` is declared with `*const LOGFONTW` / `*const TEXTMETRICW`, but Windows actually passes `ENUMLOGFONTEXW` / `NEWTEXTMETRICEXW` (**[VERIFIED]** against the crate source). You must pointer-cast inside the callback. |
| 7 | — | Missing-glyph sentinels differ: **GDI = `0xFFFF`**, **DirectWrite `GetGlyphIndices` = `0`** (`.notdef`). Do not share one check across both APIs. |
| 8 | — | GDI **silently substituted a different physical font** for a requested CJK family in my run (`黑体`/`SimHei` → actually selected `宋体`). Any coverage probe must verify the selected face. |

---

## 1. Windows — per-user font installation

### 1.1 Locations

| | Machine-wide | Per-user |
|---|---|---|
| Directory | `%windir%\Fonts` (`C:\Windows\Fonts`) | `%LOCALAPPDATA%\Microsoft\Windows\Fonts` → `C:\Users\<u>\AppData\Local\Microsoft\Windows\Fonts` |
| Registry | `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts` | `HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts` |
| Value **name** | `"<Family Name> (TrueType)"` e.g. `SimHei (TrueType)` | same convention |
| Value **data** | bare file name, e.g. `simhei.ttf` (**only** because the file is in `%windir%\Fonts`); absolute paths also accepted | **absolute path required**, e.g. `C:\Users\u\AppData\Local\Microsoft\Windows\Fonts\QmaiSans-Regular.ttf` |

Evidence on the live machine (read-only inspection):

```
HKLM: "SimHei (TrueType)"                   ==> simhei.ttf
      "Microsoft YaHei & Microsoft YaHei UI (TrueType)" ==> msyh.ttc
      "DejaVu Math TeX Gyre"                ==> C:\ProgramData\Kingsoft\office6\omath\DejaVuMathTeXGyre.ttf   <- full path, HKLM, outside %windir%\Fonts
HKCU: "Ubuntu Mono (TrueType)"              ==> C:\Users\Administrator\AppData\Local\Microsoft\Windows\Fonts\UbuntuMono[wght].ttf
      "yyb Sans Regular (TrueType)"         ==> C:\Users\Administrator\AppData\Local\Microsoft\Windows\Fonts\yyb.ttf
```

So: the value name is a display/registration label; the **data is what Windows loads**, and for per-user it must be absolute. Suffix convention: on that machine every value ends in `(TrueType)` — including `.otf` files — with a few legacy `(120)` / `(All res)` bitmap strike entries. Use `"<Family> (TrueType)"`.

**[VERIFIED] Controlled experiment** (font copied to the per-user dir, registered under `"Instrument Sans (TrueType)"`):

| value data | fresh process sees the family? |
|---|---|
| `QMAIProbe3-InstrumentSans-Regular.ttf` (bare name) | **No** |
| `C:\Users\...\Local\Microsoft\Windows\Fonts\QMAIProbe3-InstrumentSans-Regular.ttf` | **Yes (4 rows)** |
| (file present, **no** registry value) | **No** |

Consequence: the file alone is not enough (same as the documented "if you only copy the font into `%windir%\fonts`, it will be available only after the system is rebooted"), and the registry is what makes it live.

### 1.2 Registry writing in Rust

Recommended: `winreg` (ergonomic) or `windows-sys` raw. With `windows-sys` 0.61 (exact signature from the crate source):

```rust
// windows-sys 0.61.2: System/Registry
windows_link::link!("advapi32.dll" "system" fn RegSetValueExW(
    hkey: HKEY, lpvaluename: PCWSTR, reserved: u32,
    dwtype: REG_VALUE_TYPE, lpdata: *const u8, cbdata: u32) -> WIN32_ERROR);
pub const HKEY_CURRENT_USER: HKEY;  pub const REG_SZ: REG_VALUE_TYPE = 1;  pub const KEY_SET_VALUE = 2;
```

```rust
fn to_wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

/// Register an already-copied font file for the CURRENT USER (no elevation).
unsafe fn register_user_font(family: &str, abs_path: &std::path::Path) -> std::io::Result<()> {
    use windows_sys::Win32::System::Registry::*;
    let subkey = to_wide(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts");
    let mut hkey: HKEY = std::ptr::null_mut();
    let rc = RegCreateKeyExW(
        HKEY_CURRENT_USER, subkey.as_ptr(), 0, std::ptr::null(),
        REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, std::ptr::null(), &mut hkey, std::ptr::null_mut());
    if rc != 0 { return Err(std::io::Error::from_raw_os_error(rc as i32)); }

    let value_name = to_wide(&format!("{family} (TrueType)"));
    // REG_SZ data MUST be NUL-terminated UTF-16; cbdata includes the terminator.
    let data: Vec<u16> = abs_path.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = std::slice::from_raw_parts(data.as_ptr() as *const u8, data.len() * 2);
    let rc = RegSetValueExW(hkey, value_name.as_ptr(), 0, REG_SZ, bytes.as_ptr(), bytes.len() as u32);
    RegCloseKey(hkey);
    if rc != 0 { return Err(std::io::Error::from_raw_os_error(rc as i32)); }
    Ok(())
}
```

`winreg` equivalent:

```rust
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;
let key = RegKey::predef(HKEY_CURRENT_USER)
    .create_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")?.0;
key.set_value(&format!("{family} (TrueType)"), &abs_path.to_string_lossy().to_string())?;
```

Getting `%LOCALAPPDATA%` in Tauri v2: `app.path().local_data_dir()?` (Windows → `%LOCALAPPDATA%`; note it is `~/Library/Application Support` on macOS, so gate it with `#[cfg(windows)]`), or `dirs::data_local_dir()`. Then `.join("Microsoft").join("Windows").join("Fonts")`.

**You must supply the family name.** Windows does not derive it from your value name usefully; and the practical order is: read the family name *from the file* before/after copying. Two good ways: DirectWrite `IDWriteFactory::CreateFontFileReference` → `CreateFontFace` → `GetFamilyNames()`, or the `ttf-parser` crate (parse the `name` table, nameID 1/16 + 4/2). Persist a manifest of `{file → family name → registry value name}` in your app data dir so uninstall is exact and you never delete a font the user installed themselves.

### 1.3 Installation algorithm (recommended, in-app Rust)

1. `fs::create_dir_all(%LOCALAPPDATA%\Microsoft\Windows\Fonts)` (create it if missing — it exists on this machine, but do not assume).
2. Copy each bundled font to a **unique, ASCII** file name there (e.g. `QmaiSans-Regular.ttf`). Skip the copy if the destination already exists with identical hash/length (idempotent → safe on every update).
3. Write the HKCU value `"<Family> (TrueType)" = <absolute path>`.
4. Optional but belt-and-braces for *already running* consumers: `AddFontResourceExW(path, 0, NULL)` (session-wide, not `FR_PRIVATE`) and broadcast `WM_FONTCHANGE`.
5. Record what you installed (value name + path + version) in your app data dir.
6. Best effort: if you want to know whether CSS will resolve the family, re-enumerate (or have the WebView report `document.fonts.check()`).

Do this **from the app, on first run / after update**, rather than from the installer — see §6 and §10 for why.

---

## 2. Windows — process-local vs session-local vs permanently installed

Three distinct lifetimes. **[VERIFIED]** for GDI on Windows 11 build 26200:

| Mechanism | Scope | Lifetime | Verified |
|---|---|---|---|
| `AddFontResourceExW(path, FR_PRIVATE, NULL)` (`FR_PRIVATE = 0x10`) | **only the calling process** | removed automatically when the process exits, or on `RemoveFontResourceExW` | **[VERIFIED]** `add -> 1`; in the *same* process the family appeared (`in-process rows=1152 contains 'JetBrains Mono'? True`); after that process exited a **fresh process did not see it** |
| `AddFontResourceExW(path, 0, NULL)` | **whole session** (all processes) | until `RemoveFontResourceExW`, or the session ends; *not* persistent across reboot | **[VERIFIED]** `add -> 1` and visible session-wide |
| Copy file into a Fonts dir **+ registry value** | **all processes, and all future sessions** | until you delete the value and file | **[VERIFIED]** fresh process saw it with **no** `AddFontResourceExW` at all |
| `FR_NOT_ENUM = 0x20` | as above but not enumerable | — | not tested (documented) |

Microsoft's own statement, [`AddFontResourceExW`](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexw):

> "This function installs the font only for the current session. When the system restarts, the font will not be present. To have the font installed even after restarting the system, the font must be listed in the registry."
> `FR_PRIVATE`: "Specifies that only the process that called the AddFontResourceEx function can use this font… When the process terminates, the system will remove all fonts installed by the process with the AddFontResourceEx function."

And [`Font Installation and Deletion`](https://learn.microsoft.com/en-us/windows/win32/gdi/font-installation-and-deletion):

> "Whenever an application calls the functions that add and delete font resources, it should also call the SendMessage function and send a `WM_FONTCHANGE` message to all top-level windows in the system."

**Practical reading of my results:** on Windows 10 1809+/11 the font *provider* picks up a new `HKCU\…\Fonts` value dynamically, so "registry only, usable after logoff" is obsolete — new processes get it immediately. `AddFontResourceExW` is still the right tool when you want (a) app-only fonts with no registry footprint (`FR_PRIVATE`), or (b) to force availability for *already-running* processes in the session without a registry write.

**Flagged [UNVERIFIED]:** whether an already-running WebView2/Chromium host refreshes its internal font list when the font appears (Chromium caches DirectWrite font collections in the browser process). Test in your app: install, then check `document.fonts.check('16px "Your Font"')` and, if needed, recreate the window or reload. Broadcasting `WM_FONTCHANGE` is the standard nudge but I could not verify Chromium honours it here.

Rust call site:

```rust
use windows_sys::Win32::Graphics::Gdi::{AddFontResourceExW, RemoveFontResourceExW, FR_PRIVATE};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, HWND_BROADCAST, WM_FONTCHANGE, SMTO_ABORTIFHUNG };

fn to_wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

unsafe fn add_session_font(path: &std::path::Path) -> i32 {
    // fl = 0 -> session-wide;  FR_PRIVATE -> this process only;  FR_NOT_ENUM -> not enumerable
    AddFontResourceExW(to_wide(&path.to_string_lossy()).as_ptr(), 0, std::ptr::null())
}

unsafe fn remove_session_font(path: &std::path::Path, flags: u32) {
    RemoveFontResourceExW(to_wide(&path.to_string_lossy()).as_ptr(), flags, std::ptr::null());
    broadcast_font_change();
}

unsafe fn broadcast_font_change() {
    let mut result: usize = 0;
    SendMessageTimeoutW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0, SMTO_ABORTIFHUNG, 1000, &mut result);
}
```

---

## 3. Windows 10 / 11 — elevation

**Per-user installation does not require elevation. [VERIFIED]**
The test session was `Mandatory Label\Medium Mandatory Level`, `IsAdminRole=False`. From that token:

* copy into `%LOCALAPPDATA%\Microsoft\Windows\Fonts` → **OK**
* write `HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts` → **OK**
* write the `HKLM` twin → **denied** (`SecurityException`)

ACL of the per-user dir on that machine grants `FullControl` to the user account and `BUILTIN\Administrators`, and it sits inside the user's own profile — which is exactly why no elevation is needed. This is also why Windows Settings → Personalization → Fonts can offer "install for current user only".

**Flagged [UNVERIFIED]:** I could not create/impersonate a true non-admin standard-user account here (`runas /trustlevel:0x20000` produced no usable token in this harness), so the standard-user case is supported by the ACL/profile argument above plus the documented per-user font feature, not by a direct measurement. Nothing about the mechanism suggests it differs.

---

## 4. Windows — enumerating fonts and testing glyph coverage from Rust

### 4.1 Exact `windows-sys` signatures (read from windows-sys 0.61.2 source)

```rust
// windows-sys = { version = "0.61", features = [
//   "Win32_Foundation", "Win32_Graphics_Gdi", "Win32_System_Registry",
//   "Win32_UI_WindowsAndMessaging" ] }

// Graphics/Gdi
fn AddFontResourceExW(name: PCWSTR, fl: FONT_RESOURCE_CHARACTERISTICS, res: *const c_void) -> i32;
fn RemoveFontResourceExW(name: PCWSTR, fl: u32, pdv: *const c_void) -> BOOL;
fn EnumFontFamiliesExW(hdc: HDC, lplogfont: *const LOGFONTW, lpproc: FONTENUMPROCW,
                       lparam: LPARAM, dwflags: u32) -> i32;
fn GetGlyphIndicesW(hdc: HDC, lpstr: PCWSTR, c: i32, pgi: *mut u16, fl: u32) -> u32;
fn GetFontUnicodeRanges(hdc: HDC, lpgs: *mut GLYPHSET) -> u32;
fn GetTextFaceW(hdc: HDC, c: i32, lpname: PWSTR) -> i32;
fn CreateCompatibleDC(hdc: HDC) -> HDC;
fn CreateFontIndirectW(lplf: *const LOGFONTW) -> HFONT;
fn SelectObject(hdc: HDC, h: HGDIOBJ) -> HGDIOBJ;
fn DeleteObject(ho: HGDIOBJ) -> BOOL;
fn DeleteDC(hdc: HDC) -> BOOL;

pub type HDC = *mut c_void;   pub type HFONT = *mut c_void;
pub const DEFAULT_CHARSET: FONT_CHARSET = 1u8;   // GB2312_CHARSET = 134
pub const FR_PRIVATE: FONT_RESOURCE_CHARACTERISTICS = 16u32;
pub const FR_NOT_ENUM: FONT_RESOURCE_CHARACTERISTICS = 32u32;
pub const GGI_MARK_NONEXISTING_GLYPHS: u32 = 1u32;

// NOTE (verified against the crate): the callback is declared with LOGFONTW/TEXTMETRICW,
// but Windows really passes ENUMLOGFONTEXW/NEWTEXTMETRICEXW (prefix-compatible).
pub type FONTENUMPROCW = Option<unsafe extern "system" fn(
    param0: *const LOGFONTW, param1: *const TEXTMETRICW, param2: u32, param3: LPARAM) -> i32>;

pub struct LOGFONTW { /* ... */ pub lfFaceName: [u16; 32] }      // LF_FACESIZE = 32
pub struct ENUMLOGFONTEXW { pub elfLogFont: LOGFONTW,
    pub elfFullName: [u16; 64], pub elfStyle: [u16; 32], pub elfScript: [u16; 32] }  // LF_FULLFACESIZE = 64
pub struct GLYPHSET { pub cbThis: u32, pub flAccel: u32, pub cGlyphsSupported: u32,
                      pub cRanges: u32, pub ranges: [WCRANGE; 1] }
pub struct WCRANGE { pub wcLow: u16, pub cGlyphs: u16 }

// UI/WindowsAndMessaging
fn SendMessageTimeoutW(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM,
                       fuflags: SEND_MESSAGE_TIMEOUT_FLAGS, utimeout: u32,
                       lpdwresult: *mut usize) -> LRESULT;
pub const HWND_BROADCAST: HWND;  pub const WM_FONTCHANGE: u32 = 29;  pub const SMTO_ABORTIFHUNG = 2;
```

### 4.2 Enumeration: the correct call and the duplicate problem

`EnumFontFamiliesExW` with `lfCharSet = DEFAULT_CHARSET` and `lfFaceName = ""` enumerates *all uniquely-named fonts*, **but you must filter**. Measured on this machine: **1149 callback rows for 219 distinct face names.**

Reasons, and what to do:

* **One row per character set (script), not per family.** `Noto Sans SC` produced separate rows for 西方/日语/中欧/西里尔语/越南文/CHINESE_GB2312. Microsoft: *"based on the values of lfCharSet and lfFaceName, EnumFontFamiliesEx will enumerate the same font as many times as there are distinct character sets in the font… an application should filter the list of fonts."* → dedupe on `lfFaceName` (keep one row per family; use `elfStyle`/`lfWeight` only if you actually need styles).
* **`elfScript` is LOCALIZED. [VERIFIED]** On this zh-CN machine it returned `西方`, `日语`, `中欧`, `西里尔语`, `越南文`, `符号`, `希伯来语` — never `WESTERN`/`CHINESE_GB2312`. **Do not use `elfScript` as a key.** Use the numeric `lfCharSet` (0 = ANSI/Western, 134 = GB2312, 128 = ShiftJIS, …) if you need to group.
* **Vertical-writing variants.** 50 of the 219 face names are prefixed with `@` (`@Noto Sans SC`, `@宋体`). Filter `name.starts_with('@')` unless you want vertical layout.
* **Localized vs English names.** See §5 — the *same* physical family can be reported under a Chinese name here and an English name in the registry.

```rust
use std::collections::BTreeSet;
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::Foundation::LPARAM;

unsafe extern "system" fn enum_cb(
    lplf: *const LOGFONTW, _ntme: *const TEXTMETRICW, _font_type: u32, lparam: LPARAM) -> i32 {
    // Windows passes ENUMLOGFONTEXW even though windows-sys types it as LOGFONTW.
    let e = &*(lplf as *const ENUMLOGFONTEXW);
    let set = &mut *(lparam as *mut BTreeSet<String>);
    let name = String::from_utf16_lossy(
        &e.elfLogFont.lfFaceName.iter().copied().take_while(|c| *c != 0).collect::<Vec<u16>>());
    if !name.is_empty() && !name.starts_with('@') { set.insert(name); }
    1 // non-zero: keep enumerating
}

pub fn list_font_families() -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    unsafe {
        let hdc = CreateCompatibleDC(std::ptr::null_mut());
        let mut lf: LOGFONTW = std::mem::zeroed();
        lf.lfCharSet = DEFAULT_CHARSET;      // enumerate all charsets; dedupe by family
        lf.lfFaceName = [0u16; 32];          // empty => every distinct typeface name
        EnumFontFamiliesExW(hdc, &lf, Some(enum_cb),
                            &mut out as *mut _ as LPARAM, 0);
        DeleteDC(hdc);
    }
    out
}
```

### 4.3 Does the font actually cover Chinese characters?

**Recommendation, in order:**

**A. Best: DirectWrite `IDWriteFont::HasCharacter`** — the API the WebView actually uses.
[`IDWriteFont::HasCharacter(UINT32 unicodeValue, BOOL *exists)`](https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nf-dwrite-idwritefont-hascharacter) — "Determines whether the font supports a specified character." It takes a **UCS-4** code point, so it also works for CJK Extension B+ (U+20000+) where GDI's UTF-16 API cannot. Pair it with `IDWriteFactory::CreateFontFileReference` + `CreateFontFace` to probe a font **file before installing it** — this lets you validate a bundled font at build time or first run without touching the registry. Batching alternative: [`IDWriteFont1::GetUnicodeRanges`](https://learn.microsoft.com/en-us/windows/win32/api/dwrite_1/nf-dwrite_1-idwritefont1-getunicoderanges).

**B. Good for GDI-based probing: `GetGlyphIndicesW` on a DC with the font selected.**
[`GetGlyphIndicesW`](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getglyphindicesw): *"The function can be used to determine whether a glyph exists in a font"*; with `GGI_MARK_NONEXISTING_GLYPHS` it *"Marks unsupported glyphs with the hexadecimal value 0xffff."* **[VERIFIED]** on this machine, test string `中文测试字体龘`:

| requested family | actually selected | glyph indices (`0xFFFF` = missing) | `GetFontUnicodeRanges` | verdict |
|---|---|---|---|---|
| 宋体 / SimSun | 宋体 | `045D 1BB7 237B 4205 1187 0583 55C8` | cGlyphs=28849, cRanges=163 | covers all 7 |
| 新宋体 / NSimSun | 新宋体 | same as SimSun | 28849 / 163 | covers all 7 |
| 微软雅黑 / Microsoft YaHei | 微软雅黑 | `0418 0786 0879 0AA1 0601 047D 6F53` | 29709 / 162 | covers all 7 |
| 等线 | 等线 | `1D2C 3486 3C4A 5AD4 2A56 1E52 6E97` | 29264 / 211 | covers all 7 |
| Noto Sans SC | Noto Sans SC | `2265 399E 415C 5FC7 2F79 238B 737B` | 30445 / 469 | covers all 7 |
| **Arial** (control, Latin-only) | Arial | `FFFF FFFF FFFF FFFF FFFF FFFF FFFF` | 3412 / 163, no test char in ranges | covers 0/7 |
| **Marlett** (symbol) | Marlett | all `FFFF` | 480 / 23 | covers 0/7 |

```rust
pub fn font_has_all(hdc: HDC, s: &str) -> bool {
    let wide: Vec<u16> = s.encode_utf16().chain(std::iter::once(0)).collect();
    let mut gi = vec![0u16; s.encode_utf16().count()];
    let n = unsafe { GetGlyphIndicesW(hdc, wide.as_ptr(), gi.len() as i32, gi.as_mut_ptr(),
                                      GGI_MARK_NONEXISTING_GLYPHS) };
    if n == u32::MAX { return false; }                    // GDI_ERROR
    gi.iter().all(|g| *g != 0xFFFF && *g != 0)            // 0xFFFF = missing, 0 = .notdef
}

pub fn font_covers_all(hdc: HDC, s: &str) -> bool {
    // whole-repertoire check, 2-pass sizing: pass NULL to learn the byte size
    unsafe {
        let need = GetFontUnicodeRanges(hdc, std::ptr::null_mut());
        if need == 0 { return false; }
        let mut buf = vec![0u8; need as usize];
        let gs = buf.as_mut_ptr() as *mut GLYPHSET;
        GetFontUnicodeRanges(hdc, gs);
        let c_ranges = (*gs).cRanges as usize;
        let ranges = std::slice::from_raw_parts((*gs).ranges.as_ptr(), c_ranges);
        s.chars().all(|ch| {
            let c = ch as u32;
            if c > 0xFFFF { return false; }               // GDI ranges are UCS-2 only
            ranges.iter().any(|r| c >= r.wcLow as u32 && c < r.wcLow as u32 + r.cGlyphs as u32)
        })
    }
}
```

**Pitfalls, with evidence:**

1. **GDI may not select the font you asked for. [VERIFIED — important]** In my run, requesting `黑体` and requesting `SimHei` both produced `GetTextFaceW → 宋体`, with identical glyph indices *and* identical `cGlyphsSupported` — i.e. I was probing SimSun while believing I was probing SimHei. (In a separate process, the same names resolved correctly to 黑体, so this is state/order-dependent substitution, not a fixed mapping.) **Always verify the selection**:
   ```rust
   fn selected_face(hdc: HDC) -> String {
       let mut buf = [0u16; 64];
       let n = unsafe { GetTextFaceW(hdc, 64, buf.as_mut_ptr()) };
       if n <= 1 { return String::new(); }
       String::from_utf16_lossy(&buf[..(n as usize - 1)])
   }
   // if selected_face(hdc) != the face name you enumerated, discard the result
   ```
   Even better, take the face name straight from the callback and match case-insensitively, and set `lfCharSet` to the specific charset (134 = GB2312) rather than `DEFAULT_CHARSET`.
2. **Sentinel mismatch.** GDI `GGI_MARK_NONEXISTING_GLYPHS` ⇒ `0xFFFF`. [`IDWriteFontFace::GetGlyphIndices`](https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nf-dwrite-idwritefontface-getglyphindices) ⇒ *"When characters are not present in the font this method returns the index 0, which is the undefined glyph or '.notdef' glyph."* Check both `0xFFFF` and `0` when using GDI (a font may map an unmapped code point to `.notdef` = 0 instead of reporting missing).
3. **Coverage ≠ visible glyph.** A font can carry a real glyph for U+4E2D that is blank or a drawn tofu box: `GetGlyphIndicesW` then returns a valid index and your test passes while the user sees boxes. `GetFontUnicodeRanges` only reflects the `cmap` (Microsoft: the DWrite variant's *"ranges are from the cmap, not the OS/2::ulCodePageRange1"*), so it cannot detect this either. If you need certainty, measure the rendered glyph: `GetGlyphOutlineW(..., GGO_BITMAP, ...)` and check for empty/zero-area output, or render and hash. **[UNVERIFIED]** — I had no such font available to demonstrate.
4. **`GetFontUnicodeRanges` is UCS-2.** It cannot answer for CJK Ext-B+ (U+20000+). Use DirectWrite for those. Also note it returns the repertoire of the **selected face**: for `.ttc` collections (msyh.ttc, simsun.ttc) you must select the right sub-face first.
5. **The ranges are the union across scripts/styles of the selected face**; "font covers Chinese" should be answered by probing the actual characters you will render (or the block ranges you care about), not by a single boolean.
6. **Name localization** (see §5) means the family name you get back may be Chinese while the registry uses English — don't compare them as strings across the two sources.

---

## 5. Windows — English vs Chinese family names, and what CSS should use

**How Chinese names are exposed. [VERIFIED]** They are **not** registry entries and **not** separate families. They are localized records in the OpenType `name` table that DirectWrite exposes as *additional family names for the same family*. Probing `IDWriteFontCollection::FindFamilyName` on this machine:

```
FindFamilyName([Microsoft YaHei]) -> exists=True index=30 | names(2): [en-us=Microsoft YaHei] [zh-cn=微软雅黑]
FindFamilyName([微软雅黑])        -> exists=True index=30 | (same family)
FindFamilyName([SimSun])          -> exists=True index=58 | names(3): [en-us=SimSun] [zh-cn=宋体] [zh-sg=宋体]
FindFamilyName([宋体])            -> exists=True index=58 | (same family)
FindFamilyName([SimHei]) / [黑体]  -> exists=True index=80 | [en-us=SimHei] [zh-cn=黑体]
FindFamilyName([NSimSun]) / [新宋体]-> exists=True index=59 | [en-us=NSimSun] [zh-cn=新宋体] [zh-sg=新宋体]
FindFamilyName([KaiTi]) / [楷体]    -> exists=True index=79 | [en-us=KaiTi] [zh-cn=楷体]
FindFamilyName([DengXian]) / [等线] -> exists=True index=77 | [en-us=DengXian] [zh-cn=等线]
FindFamilyName([Noto Sans SC])     -> exists=True index=81 | names(1): [en-us=Noto Sans SC]   (no zh name)
```

So both names resolve to the **same family index** → **CSS matches either one.** WebView2 renders through Chromium/DirectWrite, so `font-family: "Microsoft YaHei"` and `font-family: 微软雅黑` are equivalent on Windows.

**Which to use:** English first, then the localized name, then a bundled/fallback stack. English is stable across system locales (DirectWrite always exposes the `en-us` record; the `zh-cn` record only exists for fonts that carry one), and quoting Chinese names in CSS/handlebars/JSON is one more encoding hazard in your toolchain.

```css
font-family: "Microsoft YaHei", "微软雅黑", "PingFang SC", "Noto Sans SC",
             "Source Han Sans SC", "Hiragino Sans GB", sans-serif;
```

**How GDI differs (important if you build a font picker or write registry value names). [VERIFIED]** `EnumFontFamiliesExW` on this zh-CN machine returned the **localized** family names — 宋体, 新宋体, 黑体, 微软雅黑, 楷体, 仿宋, 等线 (the English `SimSun`/`SimHei`/`Microsoft YaHei` did **not** appear as such; only `Microsoft YaHei UI` did, because that sub-family carries no distinct zh name). Microsoft documents the old rule as *"EnumFonts, EnumFontFamilies, and EnumFontFamiliesEx return the English typeface name if the system locale does not match the language of the font"* — empirically the reverse also happens: matching locale ⇒ localized name. Therefore:

* **Do not feed GDI-enumerated names into CSS as the only name** — a picker that shows 宋体 and a stylesheet that says `SimSun` will both work in a browser, but on a non-Chinese Windows the GDI name is `SimSun`; keep both in the stack.
* **For your own registry value names**, use the English family name from the `name` table (`"<EnglishFamily> (TrueType)"`), matching the convention Windows itself uses (`SimSun & NSimSun (TrueType)`, `SimHei (TrueType)`).
* Reading localized names in Rust: DirectWrite `GetFamilyNames()` → `IDWriteLocalizedStrings` (iterate `GetLocaleName(i)` / `GetString(i)`, `FindLocaleName("zh-cn")`), or `ttf-parser`, or the `font-kit`/`fontdb` crates.

**Reading the name table for CSS you generate:** if you bundle a font, take the English family name as canonical and, if you must match a Chinese name the user may type, also accept the localized record.

---

## 6. Windows — NSIS (Tauri v2) and elevation

### 6.1 Supported mechanism (documented + confirmed against this project's generated script)

Tauri v2 config ([`TauriConfig.bundle.windows.nsis`](https://v2.tauri.app/reference/config/), [Windows Installer guide](https://v2.tauri.app/distribute/windows-installer/)):

```json
{ "bundle": { "windows": { "nsis": { "installerHooks": "./windows/hooks.nsh" } } } }
```

Hooks: `NSIS_HOOK_PREINSTALL` (before copying files / registry / shortcuts), `NSIS_HOOK_POSTINSTALL` (after), `NSIS_HOOK_PREUNINSTALL` (before removal), `NSIS_HOOK_POSTUNINSTALL` (after removal). A full custom template is also supported via `nsis.template`.

This project already has `src-tauri/windows/` (with `installer-header.bmp`, `installer-sidebar.bmp`) and a generated script at `src-tauri/target/release/nsis/x64/installer.nsi`. Verified in that file:

* line 40 `!define INSTALLMODE "currentUser"` (matches `tauri.conf.json`, which has no `nsis` override),
* line 105–106 `!if "${INSTALLMODE}" == "currentUser"` → **`RequestExecutionLevel user`**; `perMachine` → `RequestExecutionLevel admin`; `both` → MultiUser plugin,
* `NSIS_HOOK_PREINSTALL` inserted at the **top of `Section Install`** (line 664) — i.e. *before* files are copied,
* `NSIS_HOOK_POSTINSTALL` at the **end of `Section Install`** (line 1521), **unconditionally** (runs in silent/passive updates too),
* `NSIS_HOOK_PREUNINSTALL` (1566) and `NSIS_HOOK_POSTUNINSTALL` (2484) — the latter is also **unconditional**,
* `$UpdateMode` is parsed from `/UPDATE` on the command line (lines 490, 1558) and the installer appends `/UPDATE` when it launches the **previous** uninstaller (line 353).

### 6.2 Does the hook run elevated?

It runs with whatever token the installer has:

* **`installMode: "currentUser"` (Tauri's default) ⇒ non-elevated ⇒ per-user font install into `%LOCALAPPDATA%`/`HKCU` is correct and works.**
* **`perMachine` / `both` ⇒ the installer is elevated (`RequestExecutionLevel admin`).** Your hook then runs as the *elevated installing user*: an `HKCU` write still lands in that user's hive — so a "per-user" font would be installed only for the user who ran the installer, and with `both` + a standard user typing admin credentials it lands in the **admin's** profile, not the app user's. If you need per-user fonts, keep `currentUser`, or install fonts from the app instead of the installer.

### 6.3 Example hook (per-user, non-elevated)

```nsis
; src-tauri/windows/hooks.nsh   — must sit at TOP LEVEL (macros expand elsewhere)
!define HOOKDIR "${__FILEDIR__}"          ; capture before entering a macro body
!define FONTREG "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"

!macro NSIS_HOOK_POSTINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    CreateDirectory "$LOCALAPPDATA\Microsoft\Windows\Fonts"
    SetOutPath "$LOCALAPPDATA\Microsoft\Windows\Fonts"
    File "${HOOKDIR}\fonts\QmaiSans-Regular.ttf"
    WriteRegStr HKCU "${FONTREG}" "Qmai Sans (TrueType)" \
                "$LOCALAPPDATA\Microsoft\Windows\Fonts\QmaiSans-Regular.ttf"
    SetOutPath "$INSTDIR"                ; ALWAYS restore: SetOutPath affects later File commands
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1                 ; without this, fonts are deleted during updates
    DeleteRegValue HKCU "${FONTREG}" "Qmai Sans (TrueType)"
    Delete /REBOOTOK "$LOCALAPPDATA\Microsoft\Windows\Fonts\QmaiSans-Regular.ttf"
  ${EndIf}
!macroend
```

Tauri's docs on `File` inside a hook: `${__FILEDIR__}` at the top level of the hook file is the hook file's directory, but *inside a macro body* it refers to the generated script's directory — hence the top-level `!define`.

```json
{ "bundle": { "windows": { "nsis": {
    "installerHooks": "./windows/hooks.nsh",
    "installMode": "currentUser" } } } }
```

**Caveat:** NSIS cannot read a font's `name` table, so the family name has to be hardcoded (or the `.nsh` generated at build time from the same manifest your Rust code uses). That is one more reason to prefer installing fonts from Rust.

---

## 7. Windows — uninstall cleanup

**Sufficient sequence (and what I verified):**

1. Remove any session registration the app made: `RemoveFontResourceExW(path, 0, NULL)` (and `flags = FR_PRIVATE` if you used it) — from a process that added it, or before deleting the file.
2. `RegDeleteValueW(HKEY_CURRENT_USER, "SOFTWARE\...\Fonts", "<Family> (TrueType)")`.
3. `SendMessageTimeoutW(HWND_BROADCAST, WM_FONTCHANGE, ...)`.
4. Delete the file.

**[VERIFIED]** In a non-elevated session, for a font installed into `%LOCALAPPDATA%\Microsoft\Windows\Fonts`: after `RemoveFontResourceExW` returned `TRUE` and the registry value was deleted, **the file deleted successfully — no reboot, no "file in use", no lock**. Same result for a test font registered from a temp directory immediately after deregistration.

**But the Microsoft docs warn about a lock in the general case**, [`AddFontResourceExW`](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexw):

> "A font listed in the registry and installed to a location other than the `%windir%\fonts\` folder cannot be modified, deleted, or replaced as long as it is loaded in any session. In order to change one of these fonts, it must first be removed by calling `RemoveFontResource`, removed from the font registry … and the system restarted."

I could not reproduce that lock (my test font never became part of a session's initial font load — that only happens for fonts present at logon). **Design consequence: always copy bundled fonts into the per-user Fonts directory; never register the font file in place inside your app's install directory.** Consequences of registering in place: (a) after the next logon the file may be locked until reboot, so uninstall/repair may fail; (b) **the Tauri updater replacing your app directory can fail** because the font file is loaded; (c) the auto-generated uninstaller's "delete app data" option only removes `$APPDATA\<bundle-id>` and `$LOCALAPPDATA\<bundle-id>` (verified in `installer.nsi` ~line 2462–2480) — it will **not** clean `%LOCALAPPDATA%\Microsoft\Windows\Fonts`, so explicit cleanup is mandatory.

Practical hardening:

* Record exactly what you installed (value name + path) in your app data dir; on uninstall delete only those, never "all fonts that look like ours".
* If the file cannot be deleted, fall back to `MoveFileExW(..., MOVEFILE_DELAY_UNTIL_REBOOT)` (NSIS equivalent: `Delete /REBOOTOK`, shown above) or delete only the registry value and let the file go at next logon. A registry-only removal is enough to make the font unusable/disappear after logoff.
* If the app itself is running while fonts are removed, the app's own session references may block deletion — remove fonts from the app on uninstall/quit, or accept `/REBOOTOK`.
* Uninstall of the **last** version is the only case where you should delete; during reinstall/update the old uninstaller runs with `/UPDATE` — guard the hook (`$UpdateMode <> 1`).

---

## 8. macOS

* **Per-user directory: `~/Library/Fonts`.** User-installed fonts go here; `/Library/Fonts` is machine-wide (needs admin) and `/System/Library/Fonts` is Apple's (never touch). A plain copy of a `.ttf`/`.otf`/`.ttc` into `~/Library/Fonts` is the install; there is no registry and no elevation prompt. **[UNVERIFIED — could not fetch an Apple page stating the directory]**: Apple's support/guide pages are JS-rendered and returned no usable text in this session, and the archived File System Programming Guide did not yield the text either. The directory is universally documented and consistent with the CoreText scope model below, but treat the *exact* statement as unconfirmed by an Apple primary source here.
* **Programmatic, authoritative:** [`CTFontManagerRegisterFontsForURL(url, scope, &error)`](https://developer.apple.com/documentation/coretext/ctfontmanagerregisterfontsforurl(_:_:_:)) — "Registers fonts from the specified font URL with the Font Manager. Registered fonts are discoverable through font descriptor matching." Scopes ([`CTFontManagerScope`](https://developer.apple.com/documentation/coretext/ctfontmanagerscope)):
  * `kCTFontManagerScopeProcess` — "available to the current process for the duration of the process unless directly unregistered" (**the macOS analogue of `FR_PRIVATE`**),
  * `kCTFontManagerScopeSession` — "available to the current user session but won't be available in subsequent sessions",
  * `kCTFontManagerScopeUser` — "available to all processes for the current user session and will be available in subsequent sessions unless unregistered" (**the macOS analogue of the HKCU per-user install**),
  * `kCTFontManagerScopePersistent` — system-wide/all users (requires privileges).
  Use `CTFontManagerRegisterFontsForURLs` for a batch and `CTFontManagerUnregisterFontsForURL`/`...ForURLs` to remove. For Rust: `core-text` / `objc2-core-text` (this project already depends on `objc2` for macOS).
* **Does a copy need a registration call or restart?** No call is needed for the copy path — CoreText discovers fonts in the standard font directories. Newly launched apps see it; already-running apps generally pick it up through CoreText's font-change notification, but a **WKWebView may need the page reloaded or the view recreated** to rebuild its font cache. **[UNVERIFIED]** (no macOS host here).
* **Sandbox:** a Mac App Store (sandboxed) build cannot write to `~/Library/Fonts` — it is confined to its container; use `ATSApplicationFontsPath` in `Info.plist` (below) or `kCTFontManagerScopeProcess` instead. **[UNVERIFIED]** as a general statement, standard sandbox behaviour.
* **Alternative that avoids installation entirely:** the `Info.plist` key `ATSApplicationFontsPath` points at a directory of fonts inside the app bundle and makes them available **to your app** via CoreText, with no copy and no system state. This is the macOS analogue of `@font-face`. **[UNVERIFIED in this session]** — verify on a real build before relying on it.
* **Code signing / notarization:** bundled `.ttf`/`.otf` files in `Contents/Resources` are ordinary sealed resources: they are covered by the app's own code signature (`CodeResources`) and by notarization of the whole bundle; fonts are **not** separately signed or notarized, and no entitlement is required for the copy-out-to-`~/Library/Fonts` approach in a non-sandboxed app. Never write into your own bundle (that breaks the seal) — copy out instead. **[UNVERIFIED by an actual notarization run here]** (derived from Apple's code-signing/sealed-resources rules).
* **Licensing (do not skip):** shipping Microsoft's CJK fonts (Microsoft YaHei, SimSun, SimHei…) is a licence violation. Use an OFL font (Noto Sans SC / Source Han Sans) and ship its licence file. Technical, not legal, advice — but it decides which family names your app can hardcode.
* **Uninstall:** delete the files you copied from `~/Library/Fonts`, and if you registered programmatically call `CTFontManagerUnregisterFontsForURL` first. No reboot.

---

## 9. Linux

* **Per-user directory: `$XDG_DATA_HOME/fonts`, defaulting to `~/.local/share/fonts`.** The [XDG Base Directory spec](https://specifications.freedesktop.org/basedir-spec/latest/): *"$XDG_DATA_HOME defines the base directory relative to which user-specific data files should be stored. If $XDG_DATA_HOME is either not set or empty, a default equal to $HOME/.local/share should be used."* fontconfig's own per-user config uses exactly that (`fonts.conf(5)`: `<dir prefix="xdg">fonts</dir>` — `prefix="xdg"` means *"the value in the XDG_DATA_HOME environment variable will be added as the path prefix"*). The older `~/.fonts` is still scanned by most distros but is **deprecated** (man page: *"~/.fonts.conf is deprecated now. it will not be read by default in the future version"*; same intent for `~/.fonts`). Read `XDG_DATA_HOME` rather than hardcoding `~/.local/share`.
* **`fc-cache -f` is sufficient** (or `fc-cache -f ~/.local/share/fonts`). ArchWiki: *"For a single user, install fonts to `~/.local/share/fonts/`. In many cases this suffices… Finally, update the Fontconfig cache (usually unnecessary as software using the Fontconfig library does this): `$ fc-cache`."* So: files may need `chmod 644`/dirs `755` to be readable; `fc-cache -f` makes them visible to fontconfig immediately; already-running apps may still need a restart because toolkits cache font lists.
* **Distro differences:** none material for the per-user path — it is fontconfig-driven everywhere. System-wide manual installs go to `/usr/local/share/fonts` (do not put things in `/usr/share/fonts`, that is the package manager's). Verify with `fc-match "Your Font"`. **[UNVERIFIED]** — no Linux host in this session; based on the fontconfig man page + ArchWiki + XDG spec.
* **AppImage vs .deb/.rpm:**
  * **`.deb` / `.rpm`:** use Tauri's `bundle.linux.deb.files` / `bundle.linux.rpm.files` (both exist and are documented in the [config reference](https://v2.tauri.app/reference/config/)) to drop fonts into `/usr/share/fonts/truetype/<pkg>/`, and run `fc-cache -f` from `postInstallScript` (`deb`/`rpm` both expose `postInstallScript`/`postRemoveScript`/`preInstallScript`/`preRemoveScript`). The package manager then removes the files on uninstall — clean, no per-user state, no runtime code. This is system-wide (all users) and needs root *at package-install time*, which is expected on Linux. Alternatively still do the per-user copy from the app.
  * **AppImage:** the payload lives in a read-only squashfs mounted transiently (usually under `/tmp/.mount_*`), so the AppImage cannot "install" anything — the app must copy fonts to `~/.local/share/fonts` at first run and run `fc-cache -f`. **There is no uninstaller**: deleting the AppImage leaves the fonts behind, so provide an explicit "remove installed fonts" action and/or record what you installed (same manifest idea as Windows). If you run `fc-cache` as a child process, ship the dependency assumption (`fontconfig` is present on essentially every desktop distro) and tolerate its absence.
  * **Flatpak/Snap:** confinement typically prevents writing to the host's `~/.local/share/fonts`; the sandbox usually maps it but the host must see the change to use the font outside the app. Because the app is the only consumer, `@font-face` is usually the better answer there. **[UNVERIFIED]**

---

## 10. Tauri-specific pitfalls: bundling, path resolution, updater

* **Yes, `bundle.resources` can carry font files** ([Embedding Additional Files](https://v2.tauri.app/develop/resources/)): `"resources": ["fonts/**/*"]` (array form preserves structure into `$RESOURCE/fonts/...`) or the map form `{ "assets/fonts/": "fonts/" }` for exact placement. Resolve at runtime with `app.path().resolve("fonts/QmaiSans-Regular.ttf", BaseDirectory::Resource)?` (Rust) or `resolveResource()` (JS). `$RESOURCE` on Windows/NSIS is `$INSTDIR`; on macOS it is `Contents/Resources`.
* **Watch the `_up_` mapping.** In this project's generated `installer.nsi`, `resources: { "../skills/**/*": "skills/" }` produced `CreateDirectory "$INSTDIR\_up_\skills\..."` — resources referenced from *outside* `src-tauri` land under `$INSTDIR\_up_\...`. **Keep font files inside `src-tauri/` (e.g. `src-tauri/fonts/`) so they land at `$INSTDIR\fonts\...`**, matching the path your Rust resolution code and your NSIS hook use.
* **A resource path is not a system font.** Copying from `$RESOURCE` to the per-user font dir is a required step; the resource copy in the install dir is just the source (and must never be registered in place — see §7).
* **Do not register fonts that live in the app install directory.** Besides the "cannot be deleted while loaded" doc warning, the **updater replaces app files**; a font loaded from `$INSTDIR` can make that replacement fail. Always copy into `%LOCALAPPDATA%\Microsoft\Windows\Fonts` and register the copy.
* **Updater behaviour:**
  * **Windows (NSIS):** `POSTINSTALL` runs **unconditionally** at the end of `Section Install` (verified in `installer.nsi` line 1521), so installer-based font installation re-runs on every update. But the previous version's uninstaller is invoked with `/UPDATE` (line 353), and `PREUNINSTALL`/`POSTUNINSTALL` also run unconditionally — a naive "delete fonts on uninstall" would delete them mid-update, then reinstall them. **Always guard with `${If} $UpdateMode <> 1`.** Whether the Tauri updater plugin itself passes `/UPDATE` to the new setup is **[UNVERIFIED]**; an installer-hook design must be idempotent regardless.
  * **Simplest robust pattern:** install fonts **from the app** on startup with an idempotent "ensure" step (verify file + registry value; copy/register only if missing or changed). Then updates, repairs, manual reinstalls and portable copies all self-heal, and uninstall is just the uninstaller hook deleting the values/files that the app recorded. It also keeps you compatible with `.msi` and with the `app`/portable targets this project builds (`targets: ["nsis", "app"]`).
  * **macOS:** the updater replaces the `.app` bundle; fonts installed in `~/Library/Fonts` are untouched and remain valid; just re-run the ensure step. **[UNVERIFIED]**
  * **Linux:** AppImage updates replace the mounted image (your `~/.local/share/fonts` copies persist — good); `.deb`/`.rpm` upgrades re-run the package scripts.
* **This project currently bundles no fonts**: `bundle.resources` is only `{ "../skills/**/*": "skills/" }`, and there is no `AddFontResource`/`EnumFontFamilies`/registry-font code anywhere in `src-tauri/src`. So this is greenfield; the `src-tauri/windows/` folder already exists for a `hooks.nsh`.

---

## 11. `@font-face` vs system installation — and what a CSS `@font-face` name exposes

* **`@font-face` exposes the family name only inside the document/CSS font set of that WebView.** It does **not** register anything with the OS: no file is copied, no registry/fontconfig/CoreText entry is created, other applications and other documents cannot resolve `font-family: "Your Font"`. Your stated answer is correct. Corollary: an exported HTML file or a PDF that references the family by name will only render correctly for users who have it *system-installed*, and `document.fonts.check('16px "Your Font"')` tells you whether the WebView resolved it (from `@font-face` *or* from the system).
* **They should coexist, with distinct names for your own font.** Recommended layering:
  1. `@font-face` from app resources ─ the guaranteed, licence-safe, version-pinned baseline inside the app (no install, no permissions, works in portable/AppImage/Store builds);
  2. system installation ─ needed for everything *outside* the WebView: the user's other apps, exported documents, the WebView's own default UI stack, and any component that renders via the OS rather than your stylesheet.
* **Naming caution:** if your `@font-face` declares the *same* family name as the system-installed font, the in-app document silently prefers the `@font-face` copy, so a failed system install becomes invisible — you can no longer tell whether the OS install worked. Either keep the `@font-face` name distinct (e.g. `"Qmai Sans App"` vs system `"Qmai Sans"`) or verify the system install out-of-band (re-enumerate: the family appears via `EnumFontFamiliesExW`/DirectWrite only when installed). For a *system* font you want to match (e.g. 宋体/SimSun), listing both names in the stack is the right move (§5).
* **Licence/size note:** `@font-face` does not make redistribution lawful — bundling a font still requires a licence that permits embedding and redistribution (OFL for Noto/Source Han is fine).

---

## 12. Verification status summary

| Claim | Status |
|---|---|
| HKCU per-user value data must be an **absolute** path; bare file name is ignored | **[VERIFIED]** (A/B experiment) |
| File alone without registry value ⇒ not enumerated | **[VERIFIED]** |
| File + HKCU value ⇒ visible to a **new** process immediately, no reboot/logoff/`AddFontResourceEx` | **[VERIFIED]** (Win 11 26200) |
| `FR_PRIVATE` ⇒ process-local only; other processes do not see it after the adder exits | **[VERIFIED]** |
| `fl = 0` ⇒ session-wide | **[VERIFIED]** |
| Per-user install needs no elevation (Medium IL: file + HKCU OK, HKLM denied) | **[VERIFIED]** |
| A true **non-admin standard user** can do the same | **[UNVERIFIED]** (ACL/profile + docs only) |
| Enumeration duplicates: 1149 rows / 219 families; `@`-prefixed vertical variants; `elfScript` localized | **[VERIFIED]** |
| `GetGlyphIndicesW` + `GGI_MARK_NONEXISTING_GLYPHS` correctly separates CJK-capable from Latin-only fonts | **[VERIFIED]** (Arial/Marlett = all `0xFFFF`) |
| GDI can silently substitute a different physical font for the requested face | **[VERIFIED]** (黑体/SimHei → 宋体) |
| DWrite resolves `Microsoft YaHei` ≡ `微软雅黑`, `SimSun` ≡ `宋体`, `SimHei` ≡ `黑体`, `NSimSun` ≡ `新宋体`, `KaiTi` ≡ `楷体`, `DengXian` ≡ `等线` | **[VERIFIED]** (same family index) |
| Fonts in the per-user dir delete cleanly after deregistration (no reboot) | **[VERIFIED]** (in this session) |
| A font registered **outside** a Fonts dir stays locked until all sessions unload + reboot | **[UNVERIFIED]** (MS docs warning; I could not force the post-logon lock) |
| Tauri NSIS `installerHooks` + hook names + `installMode` default `currentUser` + `RequestExecutionLevel user` | **[VERIFIED]** (docs + this project's generated `installer.nsi`) |
| `POSTINSTALL`/`POSTUNINSTALL` run unconditionally; `/UPDATE` guard needed | **[VERIFIED]** (generated `installer.nsi`) |
| Whether the Tauri **updater** passes `/UPDATE` to the new setup | **[UNVERIFIED]** |
| Already-running WebView2/Chromium picks up a newly installed font without a window reload | **[UNVERIFIED]** — test in-app |
| `~/Library/Fonts` is the per-user font dir; a copy suffices | **[UNVERIFIED]** against an Apple primary source (CoreText scope semantics verified) |
| macOS: bundled fonts need no separate signing/notarization | **[UNVERIFIED by an actual notarization run]** |
| Fonts covering a character but rendering blank/box glyphs defeat coverage checks | **[UNVERIFIED]** (reasoned from API semantics; no such font available) |
| Linux: `~/.local/share/fonts` + `fc-cache -f` | **[UNVERIFIED on a Linux host]** (fontconfig `fonts.conf(5)`, XDG spec, ArchWiki) |

### Sources
Microsoft Learn: [AddFontResourceExW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-addfontresourceexw), [Font Installation and Deletion](https://learn.microsoft.com/en-us/windows/win32/gdi/font-installation-and-deletion), [EnumFontFamiliesExW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-enumfontfamiliesexw), [ENUMLOGFONTEXW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-enumlogfontexw), [GetGlyphIndicesW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getglyphindicesw), [IDWriteFont::HasCharacter](https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nf-dwrite-idwritefont-hascharacter), [IDWriteFontFace::GetGlyphIndices](https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nf-dwrite-idwritefontface-getglyphindices), [IDWriteFont1::GetUnicodeRanges](https://learn.microsoft.com/en-us/windows/win32/api/dwrite_1/nf-dwrite_1-idwritefont1-getunicoderanges).
Apple: [CTFontManagerRegisterFontsForURL](https://developer.apple.com/documentation/coretext/ctfontmanagerregisterfontsforurl(_:_:_:)), [CTFontManagerScope](https://developer.apple.com/documentation/coretext/ctfontmanagerscope).
freedesktop: [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/), [fonts.conf(5)](https://manpages.ubuntu.com/manpages/noble/man5/fonts-conf.5.html), [ArchWiki: Fonts](https://wiki.archlinux.org/title/Fonts).
Tauri v2: [Windows Installer](https://v2.tauri.app/distribute/windows-installer/), [Embedding Additional Files](https://v2.tauri.app/develop/resources/), [Configuration reference](https://v2.tauri.app/reference/config/), [Updater](https://v2.tauri.app/plugin/updater/).
NSIS: [SetShellVarContext](https://nsis.sourceforge.io/Reference/SetShellVarContext), [WriteRegStr](https://nsis.sourceforge.io/Reference/WriteRegStr).
