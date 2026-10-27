//! `plugin.json` 清单契约：结构体 + 字段校验。
//!
//! 本模块只做「字符串 → 结构体」的解析与静态校验，**不碰任何 IO / 进程 / 网络**。
//! 路径归一化（canonical 前缀检查）属于安装器的职责，这里只做纯字符串层面的
//! 「相对路径、无 `..`」判断，因为清单可能来自尚未落盘的 zip 包。

use serde::{Deserialize, Serialize};

/// 运行时类型。serde 层只认小写三个值；其他值由 `parse` 单独兜底，
/// 以便给出契约里的 `E_RUNTIME_INVALID` 而不是笼统的 `E_JSON_INVALID`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeType {
    Node,
    Python,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginRuntime {
    #[serde(rename = "type")]
    pub entry_type: RuntimeType,
    pub entry: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// 默认常驻：第一期绝大多数插件都是服务型，反复冷启动代价高。
    #[serde(default = "default_true", rename = "keepAlive")]
    pub keep_alive: bool,
    #[serde(default = "default_timeout", rename = "startTimeoutMs")]
    pub start_timeout_ms: u64,
}

fn default_true() -> bool {
    true
}

fn default_timeout() -> u64 {
    10_000
}

/// 声明式工具参数（JSON Schema 的极简子集），只用于生成给模型的工具描述。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolParam {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub r#enum: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolDecl {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 用 BTreeMap 而不是 HashMap：注入宿主时参数顺序要稳定，避免提示词抖动。
    #[serde(default)]
    pub parameters: std::collections::BTreeMap<String, ToolParam>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contributes {
    #[serde(default)]
    pub tools: Vec<ToolDecl>,
    #[serde(default)]
    pub stages: Vec<String>,
    /// 第一期解析但不渲染（界面插件不在范围内，先接受字段以免未来清单改版）
    #[serde(default)]
    pub panels: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requires {
    #[serde(default)]
    pub qmai: Option<String>,
}

/// 作者信息。设计文档 4.1 的示例里有这一块，结构体必须接住，
/// 否则加上 `deny_unknown_fields` 后会把文档认可的清单判成非法。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Author {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifest {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    // 设计文档 4.1 示例里就有这三个，结构体必须接住，否则 deny_unknown_fields 会误伤文档认可的清单
    #[serde(default)]
    pub author: Option<Author>,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub requires: Option<Requires>,
    pub runtime: PluginRuntime,
    #[serde(default)]
    pub inject: Vec<String>,
    #[serde(default)]
    pub contributes: Contributes,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// 设计文档 8.2 第 6 步：安装完成后是否随 App 启动。
    /// 缺省 false —— 用户没点过「启用」前，不该拉起任何第三方进程。
    #[serde(default, rename = "autoStart")]
    pub auto_start: bool,
}

/// 校验失败：`code` 是暴露给前端的稳定错误码，`detail` 只用于日志与排障。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestError {
    pub code: &'static str,
    pub detail: String,
}

impl ManifestError {
    pub fn code(&self) -> &'static str {
        self.code
    }

    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

/// 宿主暴露给插件的服务名白名单（第一期只开这两个）
pub const KNOWN_INJECT: &[&str] = &["host.qmai.tools", "host.logger"];
/// 需用户逐项勾选的权限（设计文档 6.2 的「需用户勾选」行）
pub const KNOWN_PERMISSIONS: &[&str] =
    &["fs:project-read", "fs:project-write", "net:https", "llm:use"];

/// 宿主自动授予的权限：允许在清单里声明（旧文档/示例就是这么写的），但声明与否都不改变
/// 授予结果，也永远不进「需用户勾选」列表。别把它并进 KNOWN_PERMISSIONS —— 那会让
/// 任务 10 的权限弹窗把它当成需要用户同意的权限。
pub const AUTO_GRANTED_PERMISSIONS: &[&str] = &["data:write"];

/// 「可以在清单里写」的权限 = 需勾选的 + 自动授予的。写错成别的（如 `ui:panel`）才拒。
fn is_declarable_permission(perm: &str) -> bool {
    KNOWN_PERMISSIONS.contains(&perm) || AUTO_GRANTED_PERMISSIONS.contains(&perm)
}

/// id 会直接当目录名用（`<root>/<id>`），所以收紧到「小写字母数字连字符」，
/// 避免大小写不敏感文件系统上的重名覆盖，也避免空格等需要转义的字符。
fn is_valid_id(id: &str) -> bool {
    let len = id.chars().count();
    if !(2..=64).contains(&len) {
        return false;
    }
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 只接受完整三段式 `x.y.z`（纯数字）。预发布/构建元数据第一期不支持：
/// 宿主只做「版本展示 + 是否可升级」的粗比较，收窄格式比日后放宽更安全。
fn is_valid_semver(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// entry 是从插件目录起算的相对路径。这里先做纯字符串层面的一票否决
/// （绝对路径 / 含 `..` 段），canonical 前缀检查留给安装器，因为此时清单
/// 可能还没落盘，无法 canonical。
fn is_safe_relative(entry: &str) -> bool {
    if entry.trim().is_empty() {
        return false;
    }
    // 清单里的字符串最终会当路径用：NUL 会让所有 fs 调用返回 InvalidInput；
    // 首尾空白在 Windows 上指向另一个文件名。都该在解析期拒掉。
    if entry.chars().any(char::is_control) || entry != entry.trim() {
        return false;
    }
    // 末尾带分隔符说明作者写的是目录，不是入口文件。
    if entry.ends_with('/') || entry.ends_with('\\') {
        return false;
    }
    let path = std::path::Path::new(entry);
    // Windows 上 `/etc/passwd` 的 is_absolute() 为 false（只有根没有前缀），
    // 所以分隔符开头单独判一次，保证跨平台语义一致。
    if path.is_absolute()
        || entry.starts_with('/')
        || entry.starts_with('\\')
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::Prefix(_)))
    {
        return false;
    }
    // `/` 和 `\` 都要切：清单作者可能在 Windows 上写反斜杠，只用 split('/')
    // 会把 `..\..\evil.js` 当成单个安全段放过。
    let segs: Vec<&str> = entry.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    // 最后一段必须是真文件名：`.` / `sub/` 这种目录值装上之后才在 spawn 时炸，
    // 报错位置离作者写的字段很远。
    match segs.last() {
        Some(last) if *last != "." && *last != ".." => {}
        _ => return false,
    }
    !segs.iter().any(|s| *s == "..")
}

/// 工具名注入宿主时会加 `<pluginId>__` 前缀，插件内部只允许下划线风格，
/// 以免和内置工具的命名习惯冲突、也避免模型看到混合风格的名字。
fn is_valid_tool_name(name: &str) -> bool {
    let len = name.chars().count();
    if !(3..=64).contains(&len) {
        return false;
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

impl PluginManifest {
    /// 解析 + 校验。字段级错误返回第一个命中的错误码。
    pub fn parse(raw: &str) -> Result<Self, ManifestError> {
        let value: serde_json::Value = serde_json::from_str(raw)
            .map_err(|e| ManifestError::new("E_JSON_INVALID", e.to_string()))?;
        // enum 字段先单独校验：直接反序列化会把未知值折叠成 E_JSON_INVALID，
        // 而契约里 runtime.type 的非法值有自己的错误码。
        if let Some(t) = value
            .get("runtime")
            .and_then(|r| r.get("type"))
            .and_then(|t| t.as_str())
        {
            if !matches!(t, "node" | "python" | "binary") {
                return Err(ManifestError::new("E_RUNTIME_INVALID", t.to_string()));
            }
        }
        let m: PluginManifest = serde_json::from_value(value)
            .map_err(|e| ManifestError::new("E_JSON_INVALID", e.to_string()))?;
        m.validate()?;
        Ok(m)
    }

    /// 字段级校验。顺序即优先级：越基础、越容易一次修对的错误越先报，
    /// 这样作者改清单时一次只看到一个问题，而不是级联报错。
    fn validate(&self) -> Result<(), ManifestError> {
        if self.schema != 1 {
            return Err(ManifestError::new(
                "E_SCHEMA_UNSUPPORTED",
                format!("schema = {}", self.schema),
            ));
        }
        if !is_valid_id(&self.id) {
            return Err(ManifestError::new("E_ID_INVALID", self.id.clone()));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 64 {
            return Err(ManifestError::new("E_NAME_INVALID", self.name.clone()));
        }
        if !is_valid_semver(&self.version) {
            return Err(ManifestError::new(
                "E_VERSION_INVALID",
                self.version.clone(),
            ));
        }
        if !is_safe_relative(&self.runtime.entry) {
            return Err(ManifestError::new(
                "E_ENTRY_INVALID",
                self.runtime.entry.clone(),
            ));
        }
        // 下限 1s 防止插件作者把超时设成 0 导致永不等待；上限 60s 防止
        // 一个坏插件把宿主启动流程拖死。
        if !(1_000..=60_000).contains(&self.runtime.start_timeout_ms) {
            return Err(ManifestError::new(
                "E_START_TIMEOUT_INVALID",
                self.runtime.start_timeout_ms.to_string(),
            ));
        }
        for svc in &self.inject {
            if !KNOWN_INJECT.contains(&svc.as_str()) {
                return Err(ManifestError::new("E_INJECT_UNKNOWN", svc.clone()));
            }
        }
        for perm in &self.permissions {
            if !is_declarable_permission(perm) {
                return Err(ManifestError::new("E_PERMISSION_UNKNOWN", perm.clone()));
            }
        }
        let mut seen = std::collections::HashSet::new();
        for tool in &self.contributes.tools {
            if !is_valid_tool_name(&tool.name) {
                return Err(ManifestError::new("E_TOOL_NAME_INVALID", tool.name.clone()));
            }
            if !seen.insert(tool.name.as_str()) {
                // 注入 ToolRegistry 是 Map.set：同名后写覆盖先写，作者会以为两个工具都在。
                return Err(ManifestError::new(
                    "E_TOOL_NAME_INVALID",
                    format!("{} (duplicate)", tool.name),
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINIMAL: &str = r#"{
      "schema": 1,
      "id": "chapter-insights",
      "name": "章节洞察",
      "version": "1.2.0",
      "runtime": { "type": "node", "entry": "index.js" }
    }"#;

    #[test]
    fn parses_minimal_manifest_with_defaults() {
        let m = PluginManifest::parse(MINIMAL).expect("should parse");
        assert_eq!(m.id, "chapter-insights");
        assert_eq!(m.runtime.entry_type, RuntimeType::Node);
        assert!(m.runtime.keep_alive);
        assert_eq!(m.runtime.start_timeout_ms, 10_000);
        assert!(m.permissions.is_empty());
        assert!(m.contributes.tools.is_empty());
    }

    #[test]
    fn rejects_wrong_schema_version() {
        let err = PluginManifest::parse(&MINIMAL.replace("\"schema\": 1", "\"schema\": 2"))
            .unwrap_err();
        assert_eq!(err.code(), "E_SCHEMA_UNSUPPORTED");
    }

    #[test]
    fn rejects_uppercase_or_spaced_id() {
        for bad in ["My-Plugin", "my plugin", "", "-bad", "a"] {
            let src = MINIMAL.replace("chapter-insights", bad);
            let err = PluginManifest::parse(&src).unwrap_err();
            assert_eq!(err.code(), "E_ID_INVALID", "input: {bad}");
        }
    }

    #[test]
    fn rejects_non_semver_version() {
        let src = MINIMAL.replace("1.2.0", "1.2");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_VERSION_INVALID"
        );
    }

    #[test]
    fn rejects_unknown_runtime_type() {
        let src = MINIMAL.replace("\"node\"", "\"ruby\"");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_RUNTIME_INVALID"
        );
    }

    #[test]
    fn rejects_unknown_permission() {
        let src = MINIMAL.replace(
            "\"runtime\"",
            "\"permissions\": [\"root:everything\"], \"runtime\"",
        );
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_PERMISSION_UNKNOWN"
        );
    }

    #[test]
    fn rejects_entry_escaping_plugin_dir() {
        let src = MINIMAL.replace("\"index.js\"", "\"../../evil.js\"");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_ENTRY_INVALID"
        );
    }

    #[test]
    fn rejects_absolute_entry() {
        let src = MINIMAL.replace("\"index.js\"", "\"/etc/passwd\"");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_ENTRY_INVALID"
        );
    }

    #[test]
    fn rejects_unknown_inject_target() {
        let src = MINIMAL.replace(
            "\"runtime\"",
            "\"inject\": [\"host.nonexistent\"], \"runtime\"",
        );
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_INJECT_UNKNOWN"
        );
    }

    #[test]
    fn rejects_tool_name_with_bad_chars() {
        let src = MINIMAL.replace(
            "\"runtime\"",
            "\"contributes\": {\"tools\": [{\"name\": \"Bad-Name\", \"description\": \"x\"}]}, \"runtime\"",
        );
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_TOOL_NAME_INVALID"
        );
    }

    const FULL_DOC_EXAMPLE: &str = r#"{
      "schema": 1,
      "id": "chapter-insights",
      "name": "章节洞察",
      "version": "1.2.0",
      "description": "后台分析章节，产出节奏与伏笔报告",
      "author": { "name": "某某", "url": "https://github.com/someone" },
      "license": "MIT",
      "requires": { "qmai": ">=4.4.0" },
      "runtime": { "type": "node", "entry": "index.js", "args": ["--stdio"], "keepAlive": true, "startTimeoutMs": 10000 },
      "inject": ["host.qmai.tools", "host.logger"],
      "contributes": {
        "tools": [{ "name": "analyze_chapter_rhythm", "description": "分析指定章节的叙事节奏",
          "parameters": { "chapterPath": { "type": "string", "description": "章节文件路径", "required": true } } }],
        "stages": ["planning"],
        "panels": []
      },
      "permissions": ["fs:project-read", "net:https"],
      "autoStart": true
    }"#;

    #[test]
    fn rejects_misspelled_field_instead_of_silently_ignoring_it() {
        // 拼错字段若被静默忽略，作者会以为申请到了权限，实际是空集 —— 必须在解析期炸。
        let src = MINIMAL.replace("\"version\"", "\"permissionss\": [\"fs:project-write\"], \"version\"");
        let err = PluginManifest::parse(&src).unwrap_err();
        assert_eq!(err.code(), "E_JSON_INVALID");
        assert!(
            err.detail.contains("permissionss"),
            "detail 应指出拼错的字段: {}",
            err.detail
        );
    }

    #[test]
    fn accepts_the_documented_full_manifest() {
        // 设计文档 4.1 的示例清单必须原样通过，否则 deny_unknown_fields 就变成了误伤
        let m = PluginManifest::parse(FULL_DOC_EXAMPLE).expect("设计文档 4.1 示例必须合法");
        assert_eq!(m.author.as_ref().map(|a| a.name.as_str()), Some("某某"));
        assert_eq!(m.license, "MIT");
        assert!(m.auto_start);
        assert_eq!(m.permissions, vec!["fs:project-read", "net:https"]);
        assert_eq!(m.contributes.tools.len(), 1);
    }

    #[test]
    fn accepts_declared_auto_granted_data_write() {
        let src = MINIMAL.replace("\"version\"", "\"permissions\": [\"data:write\", \"net:https\"], \"version\"");
        let m = PluginManifest::parse(&src).expect("data:write 声明应被接受");
        assert_eq!(m.permissions, vec!["data:write", "net:https"]);
    }

    #[test]
    fn rejects_ui_panel_permission_until_phase_two() {
        // 设计 6.2：ui:panel「第二期 · 现阶段不可申请」—— 这条才该拒
        let src = MINIMAL.replace("\"version\"", "\"permissions\": [\"ui:panel\"], \"version\"");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_PERMISSION_UNKNOWN"
        );
    }

    #[test]
    fn rejects_entries_that_are_not_a_file_name() {
        for bad in [".", "sub/", "index.js/", " index.js", "index.js ", "ind\u{0}ex.js"] {
            let src = MINIMAL.replace("\"index.js\"", &serde_json::to_string(bad).unwrap());
            assert_eq!(
                PluginManifest::parse(&src).unwrap_err().code(),
                "E_ENTRY_INVALID",
                "entry: {bad:?}"
            );
        }
    }

    #[test]
    fn rejects_duplicate_tool_names() {
        let src = MINIMAL.replace(
            "\"runtime\"",
            "\"contributes\": {\"tools\": [{\"name\": \"aa_tool\"}, {\"name\": \"aa_tool\"}]}, \"runtime\"",
        );
        let err = PluginManifest::parse(&src).unwrap_err();
        assert_eq!(err.code(), "E_TOOL_NAME_INVALID");
        assert!(err.detail.contains("duplicate"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_empty_or_too_long_name() {
        for bad in ["   ", &"a".repeat(65)] {
            let src = MINIMAL.replace("\"name\": \"章节洞察\"", &format!("\"name\": \"{bad}\""));
            assert_eq!(
                PluginManifest::parse(&src).unwrap_err().code(),
                "E_NAME_INVALID",
                "name: {bad:?}"
            );
        }
    }

    #[test]
    fn start_timeout_range_is_inclusive() {
        let with = |ms: u64| {
            MINIMAL.replace(
                "\"entry\": \"index.js\"",
                &format!("\"entry\": \"index.js\", \"startTimeoutMs\": {ms}"),
            )
        };
        for ok in [1_000u64, 60_000] {
            assert!(PluginManifest::parse(&with(ok)).is_ok(), "{ok} 应被接受");
        }
        for bad in [999u64, 60_001] {
            assert_eq!(
                PluginManifest::parse(&with(bad)).unwrap_err().code(),
                "E_START_TIMEOUT_INVALID",
                "{bad} 应被拒绝"
            );
        }
    }

    #[test]
    fn rejects_truncated_json() {
        assert_eq!(
            PluginManifest::parse("{\"schema\": 1, \"id\":").unwrap_err().code(),
            "E_JSON_INVALID"
        );
    }

    #[test]
    fn error_detail_carries_the_offending_value() {
        // detail 是排障唯一线索；丢了实际值等于让人对着「清单非法」猜
        let src = MINIMAL.replace("\"index.js\"", "\"../../evil.js\"");
        let err = PluginManifest::parse(&src).unwrap_err();
        assert_eq!(err.code(), "E_ENTRY_INVALID");
        assert_eq!(err.detail, "../../evil.js");
    }
}
