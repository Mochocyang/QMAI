//! 插件配置引擎：落盘、校验、注入。
//!
//! 设计见 `docs/superpowers/specs/2026-10-28-插件平台v3-设计.md` §6.3。三条硬约束：
//!
//! 1. 标了 `x-qmai-secret` 的字段**永不落盘**：盘上只有 `__secret__` 占位，真值只活在
//!    进程内存里（与 provider token 同一策略）。密钥写在磁盘上等于随备份、同步盘、
//!    崩溃报告一起漏出去。
//! 2. 校验失败就拒绝保存，绝不静默用默认值顶替 —— 用户以为设置生效了、插件却在用
//!    另一套参数，是最难查的一类问题。
//! 3. schema 里不认识的关键字一律忽略：宿主早晚要加特性，加特性时不能把已经装好的
//!    老插件一起卡死。

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 配置文件与 `.registry.json` 平级，都放在插件根目录下。
pub const CONFIG_FILE_NAME: &str = ".configs.json";

/// 盘上格式版本。读到更高版本必须拒绝（与注册表同理：降级运行会静默丢字段）。
const CURRENT_VERSION: u32 = 1;

/// 密钥字段在盘上的占位符。特意选一个「一眼不像真值」的常量：
/// 人工排查 `cat .configs.json` 时能立刻分清「这里有过密钥」与「这里存了明文」。
pub const SECRET_PLACEHOLDER: &str = "__secret__";

/// 标记密钥字段的 schema 扩展关键字（非标准 JSON Schema，宿主私有约定）。
pub const SECRET_KEYWORD: &str = "x-qmai-secret";

fn config_path(root: &Path) -> PathBuf {
    root.join(CONFIG_FILE_NAME)
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    version: u32,
    /// BTreeMap 而不是 HashMap：写盘顺序稳定，用户 diff 时才看得出「到底哪个插件变了」。
    #[serde(default)]
    configs: BTreeMap<String, Value>,
}

/// 一个插件根目录下的全部插件配置。
///
/// 密钥真值放在 `secrets`（内存），`file` 里只有占位符 —— 这就是
/// 「密钥不落盘」那条安全断言的实现依据：唯一写盘入口 `save` 只序列化 `file`。
#[derive(Debug, Default)]
pub struct PluginConfigStore {
    file: ConfigFile,
    /// (pluginId, field) → 真值。进程重启即失效：密钥必须由用户重新填写，
    /// 这是刻意的（不落盘 ⇒ 无法在重启后还原）。
    secrets: HashMap<(String, String), String>,
}

impl PluginConfigStore {
    /// 文件不存在 → 空配置（首次使用是正常状态）；文件损坏 → 报错，
    /// 绝不当作空配置返回后再被 `save` 覆盖（那等于把用户的配置抹掉）。
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = config_path(root);
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self {
                    file: ConfigFile {
                        version: CURRENT_VERSION,
                        configs: BTreeMap::new(),
                    },
                    secrets: HashMap::new(),
                });
            }
            Err(error) => {
                return Err(format!("读取插件配置失败 {}：{error}", path.display()));
            }
        };
        let mut file: ConfigFile = serde_json::from_str(&text)
            .map_err(|error| format!("插件配置损坏 {}：{error}", path.display()))?;
        // 手写或极旧的文件没有 version 字段（serde 默认 0），统一视为当前版本
        if file.version == 0 {
            file.version = CURRENT_VERSION;
        }
        if file.version > CURRENT_VERSION {
            // 降级运行会把读不懂的字段丢掉再回写，等于静默丢配置。
            return Err(format!(
                "插件配置版本 {} 高于本程序支持的 {}，请升级软件后再试（{}）",
                file.version,
                CURRENT_VERSION,
                path.display()
            ));
        }
        Ok(Self {
            file,
            // 盘上没有真值可读：重启后密钥一定是「未设置」状态。
            secrets: HashMap::new(),
        })
    }

    /// 盘上存的原样值（密钥字段是占位符）。缺失返回 `{}`。
    pub fn get(&self, plugin_id: &str) -> Value {
        self.file
            .configs
            .get(plugin_id)
            .cloned()
            .unwrap_or_else(|| Value::Object(serde_json::Map::new()))
    }

    /// 面向界面的读取：密钥字段一律回空串。
    ///
    /// 界面只需要知道「这个字段存在、且要按表单渲染」，不需要也不应该拿到真值 ——
    /// 真值只往插件进程里注入。前端把空串原样回传时，`set` 会把它按占位符处理。
    pub fn get_for_client(&self, plugin_id: &str, schema: &Value) -> Value {
        let mut value = self.get(plugin_id);
        if let Some(map) = value.as_object_mut() {
            for field in secret_fields(schema) {
                if map.contains_key(&field) {
                    map.insert(field, Value::String(String::new()));
                }
            }
        }
        value
    }

    /// 注入插件进程用的配置：占位符换成内存里的真值。
    ///
    /// 走的是 `get`（盘上值）+ 内存覆盖，而不是「盘上值再拼一遍」：插件读到的必须和
    /// 界面显示的其他字段完全一致，只差密钥。
    pub fn config_for_env(&self, plugin_id: &str) -> Value {
        let mut value = self.get(plugin_id);
        if let Some(map) = value.as_object_mut() {
            for ((id, field), secret) in &self.secrets {
                if id == plugin_id {
                    map.insert(field.clone(), Value::String(secret.clone()));
                }
            }
        }
        value
    }

    /// 校验后存入内存（调用方负责 `save`）。
    pub fn set(&mut self, plugin_id: &str, mut value: Value, schema: &Value) -> Result<(), String> {
        validate_against_schema(&value, schema)?;
        // 密钥字段一律改写成占位符：调用方（前端表单）很可能把用户刚输入的密钥
        // 塞在同一个 value 里，照抄落盘就是把密钥写成明文。真值只能走 `set_secret`。
        if let Some(map) = value.as_object_mut() {
            for field in secret_fields(schema) {
                if map.contains_key(&field) {
                    map.insert(field, Value::String(SECRET_PLACEHOLDER.to_string()));
                }
            }
        }
        self.file.configs.insert(plugin_id.to_string(), value);
        Ok(())
    }

    /// 单独设一个密钥：真值只进内存，盘上留占位符。
    pub fn set_secret(
        &mut self,
        plugin_id: &str,
        field: &str,
        value: &str,
        schema: &Value,
    ) -> Result<(), String> {
        if !is_secret_field(schema, field) {
            // 只允许写 schema 里明确标过 `x-qmai-secret` 的字段：否则插件作者写错一个
            // 字段名就能往配置里塞任意内容，而用户在设置页上完全看不到它。
            return Err(format!(
                "配置字段 {field} 未标记 {SECRET_KEYWORD}，不能作为密钥保存"
            ));
        }
        if value.is_empty() {
            // 空值等同于「清除」：否则用户永远删不掉一个填错的密钥。
            self.secrets
                .remove(&(plugin_id.to_string(), field.to_string()));
        } else {
            self.secrets.insert(
                (plugin_id.to_string(), field.to_string()),
                value.to_string(),
            );
        }
        // 盘上必须有占位符，否则重启后连「这个字段被设置过」都看不出来。
        let entry = self
            .file
            .configs
            .entry(plugin_id.to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if let Some(map) = entry.as_object_mut() {
            map.insert(
                field.to_string(),
                Value::String(SECRET_PLACEHOLDER.to_string()),
            );
        }
        Ok(())
    }

    pub fn has_secret(&self, plugin_id: &str, field: &str) -> bool {
        self.secrets
            .contains_key(&(plugin_id.to_string(), field.to_string()))
    }

    /// 原子写盘。写入前做最后一道「真值不落盘」的结构化断言。
    pub fn save(&self, root: &Path) -> Result<(), String> {
        let path = config_path(root);
        let payload = ConfigFile {
            version: CURRENT_VERSION,
            configs: self.file.configs.clone(),
        };
        for ((plugin_id, field), secret) in &self.secrets {
            // 结构比对（而不是 `text.contains(secret)`）：短密钥（如 "1"）用子串判断
            // 会天天误报，反而逼人把这道保险删掉。
            if let Some(value) = payload.configs.get(plugin_id) {
                if value_contains_string(value, secret) {
                    return Err(format!(
                        "拒绝写盘：插件 {plugin_id} 的密钥字段 {field} 会以明文落盘"
                    ));
                }
            }
        }
        let text = serde_json::to_string_pretty(&payload)
            .map_err(|error| format!("序列化插件配置失败：{error}"))?;
        crate::atomic_file::write_bytes_atomically(&path, text.as_bytes())
    }
}

/// 递归判断 JSON 里是否有字符串与 `needle` 完全相同。
fn value_contains_string(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(text) => text == needle,
        Value::Array(items) => items.iter().any(|item| value_contains_string(item, needle)),
        Value::Object(map) => map.values().any(|item| value_contains_string(item, needle)),
        _ => false,
    }
}

/// 进程级配置实例。
///
/// 为什么必须是单例：密钥真值不落盘，只活在这份内存表里。若每个命令各自 `load` 一份，
/// 刚通过 `plugins_config_secret_set` 设进去的密钥，在下一次 `plugins_config_get`
/// 或插件启动注入时就查不到（两份互不可见的内存表）。
static SHARED: OnceLock<Mutex<PluginConfigStore>> = OnceLock::new();

/// 取进程级实例，首次调用时按 `root` 加载。
///
/// 宿主只有一个插件根，所以初始化后不再跟随 `root` 变化。测试请直接构造
/// `PluginConfigStore`，不要走这里 —— 共享状态会跨用例互相污染。
pub fn shared(root: &Path) -> Result<&'static Mutex<PluginConfigStore>, String> {
    if let Some(store) = SHARED.get() {
        return Ok(store);
    }
    let store = PluginConfigStore::load(root)?;
    // 并发下可能已经有别的线程先 set 成功：忽略这里的 Err，最后统一从 SHARED 取。
    let _ = SHARED.set(Mutex::new(store));
    SHARED.get().ok_or_else(|| "插件配置初始化失败".to_string())
}

/// 组装注入插件进程的 `QMAI_CONFIG`（含只在内存里的密钥真值）。
pub fn config_env_json(root: &Path, plugin_id: &str) -> Result<String, String> {
    let store = shared(root)?;
    let guard = store.lock().map_err(|_| "插件配置状态不可用".to_string())?;
    serde_json::to_string(&guard.config_for_env(plugin_id))
        .map_err(|error| format!("序列化插件配置失败：{error}"))
}

/// schema 顶层 `properties` 里标了 `x-qmai-secret: true` 的字段名。
///
/// 只处理顶层：配置表单（SchemaForm）本来就只渲染顶层字段，嵌套密钥没有入口，
/// 这里也就不给「以为嵌套也受保护」的错觉。
pub fn secret_fields(schema: &Value) -> Vec<String> {
    let mut fields = Vec::new();
    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return fields;
    };
    for (name, property) in properties {
        if property.get(SECRET_KEYWORD).and_then(Value::as_bool) == Some(true) {
            fields.push(name.clone());
        }
    }
    fields
}

/// 某个字段是否被声明为密钥字段。
pub fn is_secret_field(schema: &Value, field: &str) -> bool {
    schema
        .get("properties")
        .and_then(|properties| properties.get(field))
        .and_then(|property| property.get(SECRET_KEYWORD))
        .and_then(Value::as_bool)
        == Some(true)
}

/// 按 JSON Schema **子集**校验配置值。
///
/// 支持：`type` / `properties` / `required` / `additionalProperties: false` / `enum` /
/// `minimum` / `maximum` / `minLength` / `maxLength` / `minItems` / `maxItems` / `items`。
/// 其余关键字（`title` / `default` / `format` / `pattern` / `x-qmai-*` 等）**一律忽略**：
/// 拒绝未知关键字会把「宿主加了新特性」变成「老插件装不上」。
///
/// 错误信息是给用户看的中文，带字段路径，例如
/// `配置字段 style 的值 "x" 不在允许范围内（可选：简洁/爆点/文艺）`。
pub fn validate_against_schema(value: &Value, schema: &Value) -> Result<(), String> {
    validate_at(value, schema, "")
}

fn validate_at(value: &Value, schema: &Value, path: &str) -> Result<(), String> {
    // 非对象 schema（`{}` / `true`）表示「不约束」，宽松是刻意的。
    let Some(schema) = schema.as_object() else {
        return Ok(());
    };

    if let Some(expected) = schema.get("type").and_then(Value::as_str) {
        // 认不出的 type 值当「不约束」：那是我们还没实现的类型，不该拒掉插件。
        if !type_matches(value, expected) {
            return Err(format!(
                "{}的类型必须是 {expected}，实际是 {}",
                field_label(path),
                json_type_name(value)
            ));
        }
    }

    if let Some(options) = schema.get("enum").and_then(Value::as_array) {
        if !options.iter().any(|option| option == value) {
            return Err(format!(
                "{}的值 {} 不在允许范围内（可选：{}）",
                field_label(path),
                quoted(value),
                option_labels(options)
            ));
        }
    }

    if let Some(number) = value.as_f64() {
        if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64) {
            if number < minimum {
                return Err(format!(
                    "{}不能小于 {minimum}（实际 {number}）",
                    field_label(path)
                ));
            }
        }
        if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64) {
            if number > maximum {
                return Err(format!(
                    "{}不能大于 {maximum}（实际 {number}）",
                    field_label(path)
                ));
            }
        }
    }

    if let Some(text) = value.as_str() {
        // 按字符数而不是字节数：中文标题按字节算会莫名超限，作者根本想不到。
        let length = text.chars().count();
        if let Some(minimum) = schema.get("minLength").and_then(Value::as_u64) {
            if (length as u64) < minimum {
                return Err(format!(
                    "{}至少需要 {minimum} 个字符（实际 {length} 个）",
                    field_label(path)
                ));
            }
        }
        if let Some(maximum) = schema.get("maxLength").and_then(Value::as_u64) {
            if (length as u64) > maximum {
                return Err(format!(
                    "{}不能超过 {maximum} 个字符（实际 {length} 个）",
                    field_label(path)
                ));
            }
        }
    }

    if let Some(items) = value.as_array() {
        if let Some(minimum) = schema.get("minItems").and_then(Value::as_u64) {
            if (items.len() as u64) < minimum {
                return Err(format!(
                    "{}至少需要 {minimum} 项（实际 {} 项）",
                    field_label(path),
                    items.len()
                ));
            }
        }
        if let Some(maximum) = schema.get("maxItems").and_then(Value::as_u64) {
            if (items.len() as u64) > maximum {
                return Err(format!(
                    "{}不能超过 {maximum} 项（实际 {} 项）",
                    field_label(path),
                    items.len()
                ));
            }
        }
        if let Some(item_schema) = schema.get("items") {
            for (index, item) in items.iter().enumerate() {
                validate_at(item, item_schema, &format!("{path}[{index}]"))?;
            }
        }
    }

    if let Some(map) = value.as_object() {
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            for name in required.iter().filter_map(Value::as_str) {
                // 缺失与 null 都算未填：前端把「用户清空了这个框」当 null 传是常态。
                match map.get(name) {
                    Some(Value::Null) | None => {
                        return Err(format!(
                            "{}为必填项，不能为空",
                            field_label(&join_path(path, name))
                        ));
                    }
                    _ => {}
                }
            }
        }
        let properties = schema.get("properties").and_then(Value::as_object);
        let forbids_extra =
            schema.get("additionalProperties").and_then(Value::as_bool) == Some(false);
        for (key, entry) in map {
            match properties.and_then(|properties| properties.get(key)) {
                Some(child_schema) => validate_at(entry, child_schema, &join_path(path, key))?,
                None if forbids_extra => {
                    // 写成拼错的字段名时，用户会以为配置生效了。这条错误必须点名罪魁。
                    return Err(format!(
                        "{}不是插件声明过的配置字段（additionalProperties = false）",
                        field_label(&join_path(path, key))
                    ));
                }
                // 未声明且允许额外字段：按宽松原则放过
                None => {}
            }
        }
    }

    Ok(())
}

/// `type` 关键字是否匹配。未知类型返回 `true`（宽松，等同「不约束」）。
fn type_matches(value: &Value, expected: &str) -> bool {
    match expected {
        "object" => value.is_object(),
        "string" => value.is_string(),
        "number" => value.is_number(),
        // 5.0 也算 integer：前端 number 输入框经常把 5 序列化成 5.0
        "integer" => match value.as_f64() {
            Some(number) => number.is_finite() && number.fract() == 0.0,
            None => false,
        },
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "null" => value.is_null(),
        _ => true,
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// 字段路径 → 面向用户的标签。顶层用「配置」，其余带上完整路径。
fn field_label(path: &str) -> String {
    if path.is_empty() {
        "配置".to_string()
    } else {
        format!("配置字段 {path}")
    }
}

fn join_path(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
}

/// 把一个值渲染成错误信息里「实际是什么」的样子（字符串带引号，数字原样）。
fn quoted(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "<无法显示>".to_string())
}

/// `enum` 的可选清单：字符串不带引号更好读（与设计文档的报错示例一致）。
fn option_labels(options: &[Value]) -> String {
    options
        .iter()
        .map(|option| match option {
            Value::String(text) => text.clone(),
            other => quoted(other),
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 测试用临时插件根目录；Drop 时清理，避免在 %TEMP% 下越积越多。
    struct TempRoot(std::path::PathBuf);

    impl TempRoot {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("qmai-plugin-config-{tag}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("创建临时插件根目录");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 设计 §6.3 里那份 configSchema 的形状（含一个密钥字段）
    fn sample_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "defaultCount": { "type": "number", "title": "默认备选数量", "default": 5, "minimum": 1, "maximum": 10 },
                "style": { "type": "string", "title": "书名风格", "enum": ["简洁", "爆点", "文艺"] },
                "apiKey": { "type": "string", "title": "API Key", "format": "password", "x-qmai-secret": true }
            },
            "required": ["apiKey"]
        })
    }

    #[test]
    fn validates_required_and_type() {
        let schema = json!({
            "type": "object",
            "properties": {
                "defaultCount": { "type": "number" },
                "style": { "type": "string" }
            },
            "required": ["defaultCount"]
        });

        // 缺必填
        let err = validate_against_schema(&json!({}), &schema).unwrap_err();
        assert!(err.contains("defaultCount"), "错误应点名字段：{err}");
        assert!(err.contains("必填"), "错误应说明是必填：{err}");

        // 类型不对
        let err = validate_against_schema(&json!({ "defaultCount": "5" }), &schema).unwrap_err();
        assert!(
            err.contains("配置字段 defaultCount"),
            "错误应带字段路径：{err}"
        );
        assert!(err.contains("number"), "错误应带期望类型：{err}");
        assert!(err.contains("string"), "错误应带实际类型：{err}");

        // 整体不是对象
        assert!(validate_against_schema(&json!([]), &schema).is_err());

        // 合法值
        assert!(validate_against_schema(&json!({ "defaultCount": 5 }), &schema).is_ok());
        // null 也算未填（前端「清空」的常态表示）
        assert!(
            validate_against_schema(&json!({ "defaultCount": null }), &schema).is_err(),
            "null 必须按未填处理"
        );
    }

    #[test]
    fn validates_enum_and_range() {
        let schema = sample_schema();

        let err =
            validate_against_schema(&json!({ "apiKey": "k", "style": "x" }), &schema).unwrap_err();
        assert!(err.contains("配置字段 style"), "错误应带字段路径：{err}");
        assert!(err.contains("\"x\""), "错误应带实际值：{err}");
        assert!(err.contains("简洁/爆点/文艺"), "错误应列出可选值：{err}");

        for bad in [0, 11] {
            let err =
                validate_against_schema(&json!({ "apiKey": "k", "defaultCount": bad }), &schema)
                    .unwrap_err();
            assert!(err.contains("defaultCount"), "错误应带字段路径：{err}");
        }

        // 边界值必须包含（minimum/maximum 是闭区间）
        for ok in [1, 10] {
            assert!(
                validate_against_schema(&json!({ "apiKey": "k", "defaultCount": ok }), &schema)
                    .is_ok(),
                "{ok} 应被接受"
            );
        }

        // 字符串长度约束
        let length_schema = json!({
            "type": "object",
            "properties": { "note": { "type": "string", "minLength": 2, "maxLength": 4 } }
        });
        assert!(validate_against_schema(&json!({ "note": "a" }), &length_schema).is_err());
        assert!(validate_against_schema(&json!({ "note": "abcde" }), &length_schema).is_err());
        assert!(validate_against_schema(&json!({ "note": "中文" }), &length_schema).is_ok());

        // 数组项数约束
        let items_schema = json!({
            "type": "object",
            "properties": { "tags": { "type": "array", "minItems": 1, "maxItems": 2, "items": { "type": "string" } } }
        });
        assert!(validate_against_schema(&json!({ "tags": [] }), &items_schema).is_err());
        assert!(
            validate_against_schema(&json!({ "tags": ["a", "b", "c"] }), &items_schema).is_err()
        );
        let err = validate_against_schema(&json!({ "tags": [1] }), &items_schema).unwrap_err();
        assert!(err.contains("tags[0]"), "数组项错误应带下标：{err}");
    }

    #[test]
    fn rejects_additional_properties_when_forbidden() {
        let schema = sample_schema();
        let err = validate_against_schema(&json!({ "apiKey": "k", "stlye": "简洁" }), &schema)
            .unwrap_err();
        assert!(err.contains("stlye"), "错误应点名拼错的字段：{err}");

        // 没写 additionalProperties 时按宽松处理（等于 true）
        let open_schema = json!({
            "type": "object",
            "properties": { "style": { "type": "string" } }
        });
        assert!(validate_against_schema(&json!({ "extra": 1 }), &open_schema).is_ok());
    }

    #[test]
    fn ignores_unknown_schema_keywords() {
        // 宿主加特性时（新关键字、新 format、新 x-qmai-* 扩展）不能把老插件卡死
        let schema = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "插件配置",
            "additionalProperties": false,
            "unevaluatedProperties": false,
            "x-qmai-version": 2,
            "properties": {
                "style": {
                    "type": "string",
                    "title": "书名风格",
                    "description": "给谁看",
                    "default": "简洁",
                    "pattern": "^[\\s\\S]*$",
                    "format": "select",
                    "x-qmai-widget": "radio",
                    "enum": ["简洁", "爆点", "文艺"]
                },
                "future": { "type": "some-type-we-do-not-know-yet" }
            }
        });
        // 未知 type 值 = 不约束；其余未知关键字全部忽略
        assert!(validate_against_schema(
            &json!({ "style": "简洁", "future": { "anything": true } }),
            &schema
        )
        .is_ok());
        // 认识的关键字仍要生效
        assert!(validate_against_schema(&json!({ "style": "x" }), &schema).is_err());
        // 空 schema / 非对象 schema 一律放过
        assert!(validate_against_schema(&json!({ "a": 1 }), &json!({})).is_ok());
        assert!(validate_against_schema(&json!({ "a": 1 }), &json!(true)).is_ok());
    }

    #[test]
    fn secret_field_is_not_written_to_disk() {
        const PLAINTEXT: &str = "sk-live-plaintext-do-not-store";
        let root = TempRoot::new("secret-disk");
        let schema = sample_schema();

        let mut store = PluginConfigStore::load(root.path()).expect("空配置可加载");
        // 前端很可能把密钥真值塞在同一个 value 里回传 —— `set` 必须把它按占位符处理
        store
            .set(
                "idea-generator",
                json!({ "defaultCount": 5, "apiKey": PLAINTEXT }),
                &schema,
            )
            .expect("合法配置应被接受");
        store
            .set_secret("idea-generator", "apiKey", PLAINTEXT, &schema)
            .expect("密钥字段可写入");
        store.save(root.path()).expect("保存应成功");

        let raw = std::fs::read_to_string(config_path(root.path())).expect("配置文件应存在");
        // 安全断言：盘上不能出现真值，只能有占位符
        assert!(
            !raw.contains(PLAINTEXT),
            "密钥真值绝不能落盘，实际文件内容：{raw}"
        );
        assert!(raw.contains(SECRET_PLACEHOLDER), "盘上应有占位符：{raw}");
        assert!(raw.contains("defaultCount"), "普通字段要照常落盘：{raw}");
        assert!(raw.contains("\"version\": 1"), "盘上契约要带版本：{raw}");

        // 内存里真值仍在
        assert!(store.has_secret("idea-generator", "apiKey"));
        // 界面读不到真值
        let client = store.get_for_client("idea-generator", &schema);
        assert_eq!(client["apiKey"], json!(""));
        // 盘上读回来只有占位符（重启后密钥必须重新填）
        let reloaded = PluginConfigStore::load(root.path()).expect("可重新加载");
        assert_eq!(
            reloaded.get("idea-generator")["apiKey"],
            json!(SECRET_PLACEHOLDER)
        );
        assert!(!reloaded.has_secret("idea-generator", "apiKey"));
    }

    #[test]
    fn secret_survives_in_memory_and_serializes_into_env_json() {
        const PLAINTEXT: &str = "sk-env-injected";
        let root = TempRoot::new("secret-env");
        let schema = sample_schema();

        let mut store = PluginConfigStore::load(root.path()).expect("空配置可加载");
        store
            .set_secret("idea-generator", "apiKey", PLAINTEXT, &schema)
            .expect("密钥字段可写入");
        store
            .set(
                "idea-generator",
                json!({ "style": "爆点", "apiKey": "" }),
                &schema,
            )
            .expect("合法配置应被接受");

        // 注入用：占位符换成内存真值，其他字段原样
        let env_value = store.config_for_env("idea-generator");
        assert_eq!(env_value["apiKey"], json!(PLAINTEXT));
        assert_eq!(env_value["style"], json!("爆点"));
        let env_json = serde_json::to_string(&env_value).expect("可序列化为 QMAI_CONFIG");
        assert!(
            env_json.contains(PLAINTEXT),
            "注入 JSON 必须含真值：{env_json}"
        );

        // 落盘再读回：真值不会回来
        store.save(root.path()).expect("保存应成功");
        let reloaded = PluginConfigStore::load(root.path()).expect("可重新加载");
        assert_eq!(
            reloaded.config_for_env("idea-generator")["apiKey"],
            json!(SECRET_PLACEHOLDER)
        );
        assert!(!reloaded.has_secret("idea-generator", "apiKey"));
    }

    #[test]
    fn rejects_secret_write_for_unmarked_field() {
        let root = TempRoot::new("secret-unmarked");
        let mut store = PluginConfigStore::load(root.path()).expect("空配置可加载");
        let err = store
            .set_secret("idea-generator", "defaultCount", "5", &sample_schema())
            .expect_err("未标 x-qmai-secret 的字段不能当密钥写");
        assert!(err.contains("defaultCount"), "错误应点名字段：{err}");
        assert!(!store.has_secret("idea-generator", "defaultCount"));
    }

    #[test]
    fn set_rejects_invalid_value_and_keeps_previous_config() {
        let root = TempRoot::new("set-invalid");
        let schema = sample_schema();
        let mut store = PluginConfigStore::load(root.path()).expect("空配置可加载");
        store
            .set(
                "idea-generator",
                json!({ "style": "简洁", "apiKey": "k" }),
                &schema,
            )
            .expect("首次保存应成功");

        // 校验失败不能改动已经存好的配置（用户改错一个字段不该把整份配置清空）
        assert!(store
            .set("idea-generator", json!({ "style": "不存在" }), &schema)
            .is_err());
        assert_eq!(
            store.get("idea-generator")["style"],
            json!("简洁"),
            "校验失败时旧配置必须原样保留"
        );
    }

    #[test]
    fn save_is_atomic() {
        let root = TempRoot::new("atomic");
        let schema = sample_schema();
        let mut store = PluginConfigStore::load(root.path()).expect("空配置可加载");
        store
            .set(
                "idea-generator",
                json!({ "defaultCount": 3, "apiKey": "k" }),
                &schema,
            )
            .expect("合法配置应被接受");
        store.save(root.path()).expect("首次保存应成功");

        // 写完能读回
        let reloaded = PluginConfigStore::load(root.path()).expect("可重新加载");
        assert_eq!(reloaded.get("idea-generator")["defaultCount"], json!(3));

        // 覆盖保存也要成功，且不留 `.tmp` 残留（atomic_file 的约定）
        store
            .set(
                "idea-generator",
                json!({ "defaultCount": 9, "apiKey": "k" }),
                &schema,
            )
            .expect("合法配置应被接受");
        store.save(root.path()).expect("覆盖保存应成功");
        let again = PluginConfigStore::load(root.path()).expect("可重新加载");
        assert_eq!(again.get("idea-generator")["defaultCount"], json!(9));

        let leftovers: Vec<String> = std::fs::read_dir(root.path())
            .expect("可列目录")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "不应残留临时文件：{leftovers:?}");
    }

    #[test]
    fn corrupt_config_file_is_an_error_not_empty() {
        let root = TempRoot::new("corrupt");
        std::fs::write(config_path(root.path()), "{not json").expect("写坏文件");
        // 当成空配置返回，下一次 save 就会把用户配置整体清空
        assert!(PluginConfigStore::load(root.path()).is_err());
    }

    #[test]
    fn future_config_version_is_rejected() {
        let root = TempRoot::new("future");
        std::fs::write(
            config_path(root.path()),
            r#"{"version": 99, "configs": {}}"#,
        )
        .expect("写高版本文件");
        let err = PluginConfigStore::load(root.path()).expect_err("高版本配置必须拒绝加载");
        assert!(err.contains("版本"), "错误应说明版本不兼容：{err}");
    }

    #[test]
    fn shared_store_is_process_wide_and_env_json_is_valid() {
        // 走一次真实注入路径（不断言与 root 相关的内容：共享实例只初始化一次，
        // 断言它「对这个 root 的配置」会与其他用例互相污染）。
        let root = TempRoot::new("shared");
        let json_text =
            config_env_json(root.path(), "never-installed-plugin").expect("注入路径必须可用");
        let parsed: Value = serde_json::from_str(&json_text).expect("QMAI_CONFIG 必须是合法 JSON");
        assert!(parsed.is_object(), "注入的配置必须是对象：{json_text}");
    }
}
