Unicode true
ManifestDPIAware true
; Add in `dpiAwareness` `PerMonitorV2` to manifest for Windows 10 1607+ (note this should not affect lower versions since they should be able to ignore this and pick up `dpiAware` `true` set by `ManifestDPIAware true`)
; Currently undocumented on NSIS's website but is in the Docs folder of source tree, see
; https://github.com/kichik/nsis/blob/5fc0b87b819a9eec006df4967d08e522ddd651c9/Docs/src/attributes.but#L286-L300
; https://github.com/tauri-apps/tauri/pull/10106
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  ; Set the compression algorithm. We default to LZMA.
  SetCompressor /SOLID "{{compression}}"
!endif

; Keep above !include to stay ahead of any plugin command
; see https://github.com/tauri-apps/tauri/pull/15422#discussion_r3289239624
{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WinVer.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}
; 卸载时清理随包字体要用到（读记录文件后剥掉行尾 CRLF）。
;
; ── 必须用 `Un` 前缀的那个变体 ──
; StrFunc 每个函数都生成两份，调用方式不同：
;   ${StrTrimNewLines}   → Function StrTrimNewLines   + `Call StrTrimNewLines`
;   ${UnStrTrimNewLines} → Function un.StrTrimNewLines + `Call un.StrTrimNewLines`
; 而 NSIS **禁止**在 `Section Uninstall` 里 `Call` 不以 `un.` 开头的函数：
;   `Call must be used with function names starting with "un." in the
;    uninstall section.`
; 清理段完全位于卸载区，所以必须用 `Un` 变体。
;
; 这个缺陷曾经真实存在：模板用了非 `Un` 变体，`makensis` 直接编译失败，
; 于是**整个安装包都打不出来**。一直没被发现是因为：
;   ① `npm run build:portable` 走 `tauri build --no-bundle`，根本不跑 NSIS；
;   ② 原先的验收脚本把这段代码抽出来放进一个**普通 `Section`** 编译 ——
;      同一片段在普通 Section 里完全合法，"编译通过"于是成了假绿。
; 现在验收脚本的骨架改用 `Section Uninstall`（见 verify-nsis-font-cleanup.mjs），
; 与生产上下文一致，这类错误不会再被隐藏。
; 另注意与 TextFunc 的 `TrimNewlines` 无关 —— 那是文件级的，且 TextFunc.nsh 没被 include。
${UnStrTrimNewLines}

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define UNINSTALLERHEADERIMAGE "{{uninstaller_header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
; 随包字体写进/清理的 HKCU 键。
;
; ── 为什么抽成 !define ──
; 卸载清理段必须能被执行一遍才算验证过。只"编译通过"证明不了
; FileRead / StrTrimNewLines / DeleteRegValue 在运行时的实际行为 ——
; 而这段代码用户装完就再也不会跑到，出错也只会表现为"卸载后字体库里多出十几个
; 字体"。抽成 define 后，验收脚本可以把整段代码放进一个**一次性键**里真跑一遍
; （见 docs/font-scaling-fix-20261007/verify-nsis-font-cleanup.mjs 的端到端部分），
; 而不必污染用户真实的字体注册表。
; 验收脚本会断言这里的值等于生产路径，防止有人把它改错。
!define QMAIFONTKEY "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"

; 随包字体的安装目录（每用户，无需提权）。与 Rust 侧
; `font_install::user_font_dir()` 的 `%LOCALAPPDATA%\Microsoft\Windows\Fonts`
; 必须一致 —— 验收脚本会断言这一点。
;
; ── 为什么清理段要**自己拼**这个目录，而不是从记录里读绝对路径 ──
; NSIS 的 `FileRead` 按系统 ANSI 代码页解码、且不认 BOM，而记录文件是 Rust 用
; UTF-8 写的。内容全是 ASCII 时两者字节相同所以"碰巧"能跑；一旦路径里出现非
; ASCII（中文 Windows 用户名 → `C:\Users\张三\AppData\Local`）就会读成乱码，
; 而 `Delete` 对不存在的路径**静默成功**，字体永久残留且没有任何报错。
; 所以记录里只存纯 ASCII 的文件名，目录在这里拼 —— `$LOCALAPPDATA` 是原生
; Unicode，中文用户名不受影响。
!define QMAIFONTDIR "$LOCALAPPDATA\Microsoft\Windows\Fonts"

; 卸载记录文件所在目录。生产路径即 `$APPDATA\<bundle id>`，与 Rust 侧
; `font_install::remove_installed_fonts` 读的那个目录必须一致。
;
; 抽成 !define 的理由同 `QMAIFONTKEY`：端到端验收脚本可以把它指向临时目录，
; 于是整段清理代码能被真跑一遍，而不必往用户真实的 %APPDATA% 里写东西。
; 验收脚本会断言这里的默认值与 Rust 侧常量一致。
!define QMAIFONTRECORDDIR "$APPDATA\${BUNDLEID}"

; ═══════════════════════════════════════════════════════════════════════════
; 随包字体表（阶段 4）：安装时按用户安装，卸载时兜底清理
; ═══════════════════════════════════════════════════════════════════════════
;
; ── 为什么安装器也要装字体（Rust 侧启动时明明已经会装）──
; Rust 的 `ensure_fonts_installed` 在每次启动时幂等"确保"安装，覆盖便携版与更新
; 自愈。但它有个天生的空档：**装上之后一次都没启动过**。那时字体不在机器上，
; 而用户的原话是"在安装软件时…自动安装到电脑中"。安装器本来就把这 11 个文件
; 拷进了 `$INSTDIR\fonts\`，再拷一份到用户字体目录只是同一次安装里多搬一遍，
; 却让"装完即用"（含其它软件与导出的 HTML/PDF 按名引用）成立。
; 两条路径写的是**同一组**目标（同一目录、同一值名规则），互相幂等，不是两套逻辑。
;
; ── 权限 ──
; 目标是 `%LOCALAPPDATA%\Microsoft\Windows\Fonts` 与 `HKCU`，都属当前用户，
; 因此**不触发 UAC**（安装器本身是 `RequestExecutionLevel user`）。
;
; ── 为什么这份表写死在 NSIS 里，而不是运行时读清单 ──
; NSIS 没有 JSON 解析能力，而它在编译期就知道要装哪些文件。代价是这张表与
; `src-tauri/fonts/fonts-manifest.json` 存在重复，所以有三道守卫钉住一致性：
;   ① Rust 测试 `NSIS_模板里的字体表必须与随包清单逐字一致`（自动，进 cargo test）；
;   ② 验收脚本 verify-nsis-font-cleanup.mjs 的阶段三：真跑一遍"安装 → 卸载"往返；
;   ③ scripts/check-nsis-font-table.mjs（手动，独立于 Rust 的复核）。
; 任一守卫变红都意味着"安装器装的字体与随包清单脱节" —— 那会让用户看到
; 字体装了却选不到（或反过来），且**不会有任何报错**。
;
; ── 值名规则 ──
; 值名 = `<族名>[ <字重后缀>] (TrueType)`，与 Rust 侧 `registry_value_name`
; 唯一对应。同族的 Regular 与 Bold 必须是**不同**的值名，否则后写的覆盖先写的，
; 表现为"磁盘上多一个文件、系统里少一档字重"。守卫 ① 会逐条比对。
;
; ── 关于 `.otf` 也写 `(TrueType)` ──
; 这不是笔误：Windows 自身对本机思源黑体/宋体（.otf）就是用 `(TrueType)`，
; 见本机基线 `Noto Sans SC (TrueType)`。照抄系统惯例，不"纠正"。

; 单条字体：按 `mode` 展开为安装或卸载动作。
; mode = `install`（装 + 记进卸载记录）/ `install-norecord`（只装）/ `uninstall`。
; `install-norecord` 用于记录文件打不开时的降级：**字体可用性优先于可卸载性**，
; 而且 Rust 启动时会重写记录，所以那一次降级是暂时的。
; $R5 只在安装段用（打开的记录文件句柄），$R0–$R3 只在卸载段用，互不干扰。
!macro QMAI_FONT_ENTRY mode file valueName
  !if "${mode}" == "uninstall"
    Delete /REBOOTOK "${QMAIFONTDIR}\${file}"
    DeleteRegValue HKCU "${QMAIFONTKEY}" "${valueName}"
  !else
    ; 已存在就跳过拷贝：Rust 启动时会按文件大小自愈（见 install_into），
    ; 所以不必为了修一个坏文件而每次安装/更新都重拷 200MB。
    ${IfNot} ${FileExists} "${QMAIFONTDIR}\${file}"
      CopyFiles /SILENT "$INSTDIR\fonts\${file}" "${QMAIFONTDIR}\"
    ${EndIf}
    ; 注册表值每次都写：值可能被注册表清理工具单独清掉，写一次是廉价的，
    ; 漏写则表现为"字体文件在、但任何字体列表里都没有它"。
    WriteRegStr HKCU "${QMAIFONTKEY}" "${valueName}" "${QMAIFONTDIR}\${file}"
    ; 记进卸载记录：第 1 行完整值名、第 2 行纯文件名，两者都必须是纯 ASCII。
    ; 格式由 Rust 侧 write_uninstall_record 定义，且由 Rust 测试钉住。
    !if "${mode}" == "install"
      FileWrite $R5 "${valueName}$\r$\n"
      FileWrite $R5 "${file}$\r$\n"
    !endif
  !endif
!macroend

; 整张表。**顺序不重要**，但必须与 fonts-manifest.json 的集合逐字一致。
!macro QMAI_FONT_TABLE mode
  !insertmacro QMAI_FONT_ENTRY "${mode}" "SourceHanSerifSC-Regular.otf" "Source Han Serif SC (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "SourceHanSerifSC-Bold.otf" "Source Han Serif SC Bold (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "SourceHanSansSC-Regular.otf" "Source Han Sans SC (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "SourceHanSansSC-Bold.otf" "Source Han Sans SC Bold (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "LXGWWenKai-Regular.ttf" "LXGW WenKai (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "WenJinMincho-Regular.ttf" "WenJin Mincho Plane 0 (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "ChillKai-Regular.ttf" "ChillKai (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "HarmonyOSSansSC-Regular.ttf" "HarmonyOS Sans SC (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "SmileySans-Regular.ttf" "Smiley Sans (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "ZhuqueFangsong-Regular.ttf" "Zhuque Fangsong (technical preview) (TrueType)"
  !insertmacro QMAI_FONT_ENTRY "${mode}" "SarasaGothicSC-Regular.ttf" "Sarasa Gothic SC (TrueType)"
!macroend

!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"
!define INSTALLDIRNAME "QMaiWrite"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

; We don't actually use this value as default install path,
; it's just for nsis to append the product name folder in the directory selector
; https://nsis.sourceforge.io/Reference/InstallDir
!define PLACEHOLDER_INSTALL_DIR "placeholder\${INSTALLDIRNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

# additional plugins
!addplugindir "${ADDITIONALPLUGINSPATH}"

; Uninstaller signing command
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; Handle install mode, `perUser`, `perMachine` or `both`
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${INSTALLDIRNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

; Installer icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

; Installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Enable header images for installer and uninstaller pages when either image is configured.
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!else if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!endif

; Installer header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"
!endif

; Uninstaller header image
!if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_UNBITMAP "${UNINSTALLERHEADERIMAGE}"
!endif

; Uninstaller icon
!if "${UNINSTALLERICON}" != ""
  !define MUI_UNICON "${UNINSTALLERICON}"
!endif

; Define registry key to store installer language
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; Installer pages, must be ordered as they appear
; 1. Welcome Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_WELCOME

; 2. License Page (if defined)
!if "${LICENSE}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif

; 3. Install mode (if it is set to `both`)
!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif

; 4. Custom page to ask user if he wants to reinstall/uninstall
;    only if a previous installation was detected
Var ReinstallPageCheck
Page custom PageReinstall PageLeaveReinstall
Function PageReinstall
  ; Uninstall previous WiX installation if exists.
  ;
  ; A WiX installer stores the installation info in registry
  ; using a UUID and so we have to loop through all keys under
  ; `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
  ; and check if `DisplayName` and `Publisher` keys match ${PRODUCTNAME} and ${MANUFACTURER}
  ;
  ; This has a potential issue that there maybe another installation that matches
  ; our ${PRODUCTNAME} and ${MANUFACTURER} but wasn't installed by our WiX installer,
  ; however, this should be fine since the user will have to confirm the uninstallation
  ; and they can chose to abort it if doesn't make sense.
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_loop_done ; Exit loop if there is no more keys to loop on
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $R0 "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 0 wix_loop_done
    StrCpy $WixMode 1
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
    Goto compare_version
  wix_loop_done:

  ; Check if there is an existing installation, if not, abort the reinstall page
  ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${IfThen} "$R0$R1" == "" ${|} Abort ${|}

  ; Compare this installar version with the existing installation
  ; and modify the messages presented to the user accordingly
  compare_version:
  StrCpy $R4 "$(older)"
  ${If} $WixMode = 1
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0
  ; Reinstalling the same version
  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  ; Upgrading
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ; Downgrading
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ${Else}
    Abort
  ${EndIf}

  ; Skip showing the page if passive
  ;
  ; Note that we don't call this earlier at the begining
  ; of this function because we need to populate some variables
  ; related to current installed version if detected and whether
  ; we are downgrading or not.
  ${If} $PassiveMode = 1
    Call PageLeaveReinstall
  ${Else}
    nsDialogs::Create 1018
    Pop $R4
    ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

    ${NSD_CreateLabel} 0 0 100% 24u $R1
    Pop $R1

    ${NSD_CreateRadioButton} 30u 50u -30u 8u $R2
    Pop $R2
    ${NSD_OnClick} $R2 PageReinstallUpdateSelection

    ${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
    Pop $R3
    ; Disable this radio button if downgrading and downgrades are disabled
    !if "${ALLOWDOWNGRADES}" == "false"
      ${IfThen} $R0 = -1 ${|} EnableWindow $R3 0 ${|}
    !endif
    ${NSD_OnClick} $R3 PageReinstallUpdateSelection

    ; Check the first radio button if this the first time
    ; we enter this page or if the second button wasn't
    ; selected the last time we were on this page
    ${If} $ReinstallPageCheck <> 2
      SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${Else}
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}

    ${NSD_SetFocus} $R2
    nsDialogs::Show
  ${EndIf}
FunctionEnd
Function PageReinstallUpdateSelection
  ${NSD_GetState} $R2 $R1
  ${If} $R1 == ${BST_CHECKED}
    StrCpy $ReinstallPageCheck 1
  ${Else}
    StrCpy $ReinstallPageCheck 2
  ${EndIf}
FunctionEnd
Function PageLeaveReinstall
  ${NSD_GetState} $R2 $R1

  ; If migrating from Wix, always uninstall
  ${If} $WixMode = 1
    Goto reinst_uninstall
  ${EndIf}

  ; In update mode, always proceeds without uninstalling
  ${If} $UpdateMode = 1
    Goto reinst_done
  ${EndIf}

  ; $R0 holds whether same(0)/upgrading(1)/downgrading(-1) version
  ; $R1 holds the radio buttons state:
  ;   1 => first choice was selected
  ;   0 => second choice was selected
  ${If} $R0 = 0 ; Same version, proceed
    ${If} $R1 = 1              ; User chose to add/reinstall
      Goto reinst_done
    ${Else}                    ; User chose to uninstall
      Goto reinst_uninstall
    ${EndIf}
  ${ElseIf} $R0 = 1 ; Upgrading
    ${If} $R1 = 1              ; User chose to uninstall
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; User chose NOT to uninstall
    ${EndIf}
  ${ElseIf} $R0 = -1 ; Downgrading
    ${If} $R1 = 1              ; User chose to uninstall
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; User chose NOT to uninstall
    ${EndIf}
  ${EndIf}

  reinst_uninstall:
    HideWindow
    ClearErrors

    ${If} $WixMode = 1
      ReadRegStr $R1 HKLM "$R6" "UninstallString"
      ExecWait '$R1' $0
    ${Else}
      ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
      ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
      ${IfThen} $UpdateMode = 1 ${|} StrCpy $R1 "$R1 /UPDATE" ${|} ; append /UPDATE
      ${IfThen} $PassiveMode = 1 ${|} StrCpy $R1 "$R1 /P" ${|} ; append /P
      StrCpy $R1 "$R1 _?=$4" ; append uninstall directory
      ExecWait '$R1' $0
    ${EndIf}

    BringToFront

    ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|} ; ExecWait failed, set fake exit code

    ${If} $0 <> 0
    ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      ; User cancelled wix uninstaller? return to select un/reinstall page
      ${If} $WixMode = 1
      ${AndIf} $0 = 1602
        Abort
      ${EndIf}

      ; User cancelled NSIS uninstaller? return to select un/reinstall page
      ${If} $0 = 1
        Abort
      ${EndIf}

      ; Other erros? show generic error message and return to select un/reinstall page
      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort
    ${EndIf}
  reinst_done:
FunctionEnd

; 5. Choose install directory page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_DIRECTORY

; 6. Start menu shortcut page
Var AppStartMenuFolder
!if "${STARTMENUFOLDER}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"
!else
  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip
!endif
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

; 7. Installation page
!insertmacro MUI_PAGE_INSTFILES

; 8. Finish page
;
; Don't auto jump to finish page after installation page,
; because the installation page has useful info that can be used debug any issues with the installer.
!define MUI_FINISHPAGE_NOAUTOCLOSE
; Use show readme button in the finish page as a button create a desktop shortcut
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(createDesktop)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut
; Show run app after installation.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH

Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

; Uninstaller Pages
; 1. Confirm uninstall page
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
!define /ifndef WS_EX_LAYOUTRTL         0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow
Function un.ConfirmShow ; Add add a `Delete app data` check box
  ; $1 inner dialog HWND
  ; $2 window DPI
  ; $3 style
  ; $4 x
  ; $5 y
  ; $6 width
  ; $7 height
  FindWindow $1 "#32770" "" $HWNDPARENT ; Find inner dialog
  System::Call "user32::GetDpiForWindow(p r1) i .r2"
  ${If} $(^RTL) = 1
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE} | ${WS_EX_LAYOUTRTL}"
    IntOp $4 50 * $2
  ${Else}
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE}"
    IntOp $4 0 * $2
  ${EndIf}
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i r3, w "${__NSD_CheckBox_CLASS}", w "$(deleteAppData)", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $DeleteAppDataCheckbox
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
Function un.ConfirmLeave
  SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive
!insertmacro MUI_UNPAGE_CONFIRM

; 2. Uninstalling Page
!insertmacro MUI_UNPAGE_INSTFILES

;Languages
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "青幕AI写作仅支持 64 位 Windows，不支持 32 位系统。"
    Abort
  ${EndIf}

  ${IfNot} ${AtLeastBuild} 19041
    MessageBox MB_OK|MB_ICONSTOP "青幕AI写作需要 Windows 10 2004 (20H1) 或更高版本。"
    Abort
  ${EndIf}

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro SetContext

  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    ; Prefer D drive as default install location when available.
    ${If} ${FileExists} "D:\*.*"
      StrCpy $INSTDIR "D:\${INSTALLDIRNAME}"
    ${Else}
      ; Fall back to install mode defaults.
      !if "${INSTALLMODE}" == "perMachine"
        ${If} ${RunningX64}
          !if "${ARCH}" == "x64"
            StrCpy $INSTDIR "$PROGRAMFILES64\${INSTALLDIRNAME}"
          !else if "${ARCH}" == "arm64"
            StrCpy $INSTDIR "$PROGRAMFILES64\${INSTALLDIRNAME}"
          !else
            StrCpy $INSTDIR "$PROGRAMFILES\${INSTALLDIRNAME}"
          !endif
        ${Else}
          StrCpy $INSTDIR "$PROGRAMFILES\${INSTALLDIRNAME}"
        ${EndIf}
      !else if "${INSTALLMODE}" == "currentUser"
        StrCpy $INSTDIR "$LOCALAPPDATA\${INSTALLDIRNAME}"
      !endif
    ${EndIf}

    Call RestorePreviousInstallLocation
  ${EndIf}


  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif
FunctionEnd


Section EarlyChecks
  ; Abort silent installer if downgrades is disabled
  !if "${ALLOWDOWNGRADES}" == "false"
  ${If} ${Silent}
    ; If downgrading
    ${If} $R0 = -1
      System::Call 'kernel32::AttachConsole(i -1)i.r0'
      ${If} $0 <> 0
        System::Call 'kernel32::GetStdHandle(i -11)i.r0'
        System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; set red color
        FileWrite $0 "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !endif

SectionEnd

Section WebView2
  ; Check if Webview2 is already installed and skip this section
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ; Webview2 installation
    ;
    ; Skip if updating
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ; $6 holds the path to the webview2 installer
        ExecWait "$6 ${WEBVIEW2INSTALLERARGS} /install" $1
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ; Chromium updater docs: https://source.chromium.org/chromium/chromium/src/+/main:docs/updater/user_manual.md
            ; Modified from "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView\ModifyPath"
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Function WaitForMainBinaryRelease
  StrCpy $0 0

  wait_main_binary_release:
    Delete "$INSTDIR\${MAINBINARYNAME}.exe"
    IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 wait_main_binary_released
    IntOp $0 $0 + 1
    ${If} $0 >= 30
      Abort "当前程序文件仍被占用，请完全退出 QMaiWrite 后重试。"
    ${EndIf}
    Sleep 500
    Goto wait_main_binary_release

  wait_main_binary_released:
FunctionEnd

Section Install
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  Call WaitForMainBinaryRelease

  ; Copy main executable
  File "${MAINBINARYSRCPATH}"

  ; Copy resources
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  ; Copy external binaries
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  ; Create file associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$INSTDIR\${MAINBINARYNAME}.exe,0" "Open with ${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\""
    {{/each}}
  {{/each}}

  ; Register deep links
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    ; Save install mode to be selected by default for the next installation such as updating
    ; or when uninstalling
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; Remove old main binary if it doesn't match new main binary name
  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  ; Save current MAINBINARYNAME for future updates
  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  ; Registry information for add/remove programs
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; Create start menu shortcut
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateOrUpdateStartMenuShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Create desktop shortcut for silent and passive installers
  ; because finish page will be skipped
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  ; ── 随包字体：按用户安装（阶段 4）──
  ;
  ; 与 Rust 侧 `ensure_fonts_installed` 指向**同一组**目标（同一目录、同一值名
  ; 规则），两者互相幂等，是刻意的冗余：
  ;   装好了 → Rust 启动时按大小跳过拷贝、再幂等注册一次（无副作用）；
  ;   没装上（安装器被杀、拷贝失败）→ Rust 启动时补上。
  ; 任何一边单独存在都不会让字体缺失。
  ;
  ; 更新（$UpdateMode = 1）时**跳过**，两个理由：
  ;   ① 字体早已在机器上，重拷 200MB 没有意义；
  ;   ② 记录文件此刻由 Rust 维护，里面可能含"本次清单已移除、但仍留在机器上"的
  ;      旧字体条目（见 font_install.rs 里"本次构建不再随包的字体"那段）。
  ;      用安装器的表重写记录会把那些条目抹掉，于是它们**永远不会被清理**。
  ${If} $UpdateMode <> 1
    ; ── 必须显式切到 current 上下文（实测过，不是想当然）──
    ; 随包字体**永远是按用户装的**（HKCU + 用户自己的 %LOCALAPPDATA%），与 Rust 侧
    ; `user_font_dir()` / `app_data_dir()` 指向同一处。而 NSIS 的 `$LOCALAPPDATA`
    ; 会随 `SetShellVarContext` 变 —— 本机实测：
    ;     current → C:\Users\<用户>\AppData\Local
    ;     all     → C:\ProgramData        ← 与 HKCU 指的不是同一个用户
    ; `.onInit` 里的 `SetContext` 按 INSTALLMODE 设（perMachine ⇒ all）。今天
    ; INSTALLMODE 是 currentUser，所以不加也能跑；但只要有人把它改成 perMachine
    ; 或 both，字体就会被拷进 C:\ProgramData\... 而 HKCU 值指向那里，表现是
    ; "装完了却一个字体都用不了"，且不会有任何报错。这里显式钉死。
    ; HKCU 本身不受 SetShellVarContext 影响，所以 forcing current 才是正确配对。
    SetShellVarContext current
    ; 目标目录可能还不存在：Windows 只在第一次有每用户字体时才创建它
    CreateDirectory "${QMAIFONTDIR}"
    CreateDirectory "${QMAIFONTRECORDDIR}"
    ; 记录文件以 "w" 清空重建：此刻机器上的随包字体就等于这张表。
    ; 旧版本遗留的条目不会因此丢失 —— Rust 启动时会读旧记录并把它并回新记录。
    ClearErrors
    FileOpen $R5 "${QMAIFONTRECORDDIR}\installed-fonts.txt" w
    ${If} ${Errors}
      ; 记录打不开也要把字体装上：可用性优先于可卸载性，
      ; 且 Rust 启动时每次都会重写这两份记录，这次降级是暂时的。
      DetailPrint "无法写入字体卸载记录，字体仍会安装（应用启动时会补写）"
      !insertmacro QMAI_FONT_TABLE "install-norecord"
    ${Else}
      !insertmacro QMAI_FONT_TABLE "install"
      FileClose $R5
    ${EndIf}
  ${EndIf}
  ; 结束标签：验收脚本靠它把这一整段**原样**切出来、放进 Section 里真跑一遍
  ; （见 verify-nsis-font-cleanup.mjs 的阶段三）。切不出来时脚本会失败而不是
  ; 跳过 —— 否则"没测到"会伪装成"通过"。
  qmai_fonts_install_done:

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  ; Auto close this page for passive mode
  ${If} $PassiveMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function .onInstSuccess
  ; Check for `/R` flag only in silent and passive installers because
  ; GUI installer has a toggle for the user to (re)start the app
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $R0
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$R0"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Section Uninstall

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Delete the app directory and its content from disk
  ; Copy main executable
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete resources
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  ; Delete external binaries
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; Delete app associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  ; Delete deep links
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}


  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ; Remove shortcuts if not updating
  ${If} $UpdateMode <> 1

  ; ── 清理随包字体（阶段 4）──
  ;
  ; 随包字体被安装到**本用户**的字体目录，并写进了 HKCU：
  ;   %LOCALAPPDATA%\Microsoft\Windows\Fonts\<file>
  ;   HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts : "<值名>" = <绝对路径>
  ; 其中**值名已含 `(TrueType)` 后缀与字重**（如 `Source Han Serif SC Bold (TrueType)`），
  ; 由 src-tauri/src/font_install.rs 的 registry_value_name 唯一决定。
  ; 这两处**都不在 $INSTDIR 里**，所以下面那些 Delete/RMDir 一个都碰不到它们，
  ; 连"删除应用数据"选项也只清 $APPDATA/$LOCALAPPDATA 下的应用目录。
  ; 不显式清理的后果：用户卸载后字体库里永久多出十几个字体，而且没有任何提示。
  ;
  ; 必须在**另一个** $UpdateMode <> 1 里做：更新时旧卸载器会带 /UPDATE 运行，
  ; 不保护就会在更新过程中把字体删掉（更新完应用还得重装一遍，且用户会看到
  ; 字体短暂消失）。
  ;
  ; 记录文件是**交替两行**的纯文本（完整值名一行、**纯文件名**一行），
  ; 没有注释行 —— 一行注释就会让后面全部错位、删错文件。
  ; 第 2 行是文件名而不是绝对路径：见上面 `QMAIFONTDIR` 处的说明
  ; （NSIS 按 ANSI 解码 UTF-8 记录，非 ASCII 路径会读成乱码）。
  ; 格式由 src-tauri/src/font_install.rs 的 write_uninstall_record 定义，
  ; 并由 Rust 侧同名测试 parse_uninstall_record 钉住。
  ;
  ; 注意：这一段必须排在下面"删除应用数据"里 RmDir /r "$APPDATA\${BUNDLEID}"
  ; **之前** —— 否则记录文件先被删掉，字体就再也清不掉了。
  ;
  ; 上下文必须与安装段一致：字体是按用户装的，所以 `$APPDATA` 必须是**该用户**的
  ; roaming（Rust 的 `app_data_dir()` 写的就是那里）。`SetContext` 在 perMachine
  ; 下会设成 all，那样这里会去 C:\ProgramData 找记录、永远找不到，字体永久残留。
  ; 与安装段一样显式钉死 current（理由与实测数据见安装段）。
  SetShellVarContext current
    StrCpy $R0 "${QMAIFONTRECORDDIR}\installed-fonts.txt"
    ; 记录在 → 按记录**精确**清理：只删真正装过的东西，包括"已从本次清单移除、
    ; 但仍留在机器上"的旧字体（那些只有记录里才有）。
    ; 记录不在 → 走下面的兜底表。记录由 Rust 在**启动时**写出，所以"记录不在"
    ; 只可能是"安装完之后从未启动过应用"；那种情况下字体是本安装器按
    ; QMAI_FONT_TABLE 装的，表里的名字与实际装的逐一对应。
    IfFileExists "$R0" 0 qmai_fonts_no_record
    FileOpen $R1 "$R0" r
  qmai_fonts_loop:
    FileRead $R1 $R2 ; 第 1 行：完整注册表值名（已含后缀与字重）
    IfErrors qmai_fonts_close
    ${UnStrTrimNewLines} $R2 $R2
    StrCmp $R2 "" qmai_fonts_close ; 空行 = 读完了
    FileRead $R1 $R3 ; 第 2 行：纯文件名（不含目录，全 ASCII）
    IfErrors qmai_fonts_close
    ${UnStrTrimNewLines} $R3 $R3
    StrCmp $R3 "" qmai_fonts_close
    ; 目录在这里拼，而不是用记录里的绝对路径：$LOCALAPPDATA 是原生 Unicode，
    ; 中文用户名不会像"按 ANSI 解码 UTF-8 记录"那样被读成乱码。
    StrCpy $R3 "${QMAIFONTDIR}\$R3"
    ; 从字体文件里删掉。被占用时 /REBOOTOK 保证重启后仍会删掉，
    ; 而不是静默留下一个孤儿字体文件。
    Delete /REBOOTOK "$R3"
    ; 值名原样使用：**不要**在这里拼 " (TrueType)"。
    ; 拼接规则若分散到 NSIS 里，加字重时必然有一处忘记改，
    ; 结果是卸载后 HKCU 里留下一批指向已删文件的悬空值。
    DeleteRegValue HKCU "${QMAIFONTKEY}" "$R2"
    Goto qmai_fonts_loop
  qmai_fonts_close:
    FileClose $R1
    Goto qmai_fonts_done
  qmai_fonts_no_record:
    ; 兜底：按编译期的表清理。与记录路径清理的是同一组目标，所以重复执行、
    ; 或与记录路径重叠都不会出错（`Delete` / `DeleteRegValue` 对不存在的东西
    ; 是静默成功的）。只有在"装完从未启动"这条分支里才会走到这里。
    !insertmacro QMAI_FONT_TABLE "uninstall"
  qmai_fonts_done:

    !insertmacro DeleteAppUserModelId

    ; Remove start menu shortcut
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; Remove desktop shortcuts
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; Remove registry information for add/remove programs
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ; Removes the Autostart entry for ${PRODUCTNAME} from the HKCU Run key if it exists.
  ; This ensures the program does not launch automatically after uninstallation if it exists.
  ; If it doesn't exist, it does nothing.
  ; We do this when not updating (to preserve the registry value on updates)
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ; Delete app data if the checkbox is selected
  ; and if not updating
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; Clear the install location $INSTDIR from registry
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    ; Clear the install language from registry
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ; Auto close if passive mode or updating
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd
Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
