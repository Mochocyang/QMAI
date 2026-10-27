//! MCP 桥：stdio 上 JSON-RPC 2.0 消息的构造与解析（纯函数，无 IO）。
//!
//! 宿主与插件是一对子进程关系，每行一条 JSON（NDJSON）。这里只负责「把请求
//! 拼成正确的形状」和「把响应的内容取出来」，进程读写、握手顺序、超时属于
//! 任务 12 的 supervisor/握手流程，不在这里做。

use serde_json::{json, Value};

/// 一条 JSON-RPC 消息（响应形态：有 result 或 error）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RpcMessage {
    #[serde(default)]
    pub id: Option<Value>,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<RpcErrorBody>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RpcErrorBody {
    pub code: i64,
    pub message: String,
}

/// 插件通过 tools/list 声明的工具。
///
/// 工具的真源是运行期的 `tools/list`，不是清单里的 `contributes.tools`。
/// 清单里那份只用于「安装前预览 / 管理页展示」；真正注入 `ToolRegistry` 的
/// 必须是插件启动后 `tools/list` 报出来的。理由是两份真源会漂移（设计文档
/// 6.3 引用的 DSH 教训：两处 registry 不一致 → 静默失败）。
#[derive(Debug, Clone)]
pub struct PluginToolDecl {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

impl RpcMessage {
    /// 解析 tools/list 的响应 → 工具声明列表
    pub fn into_tool_list(self) -> Result<Vec<PluginToolDecl>, String> {
        if let Some(e) = self.error {
            return Err(format!("{}: {}", e.code, e.message));
        }
        // 缺 key 与「列表为空」必须区分：前者说明插件协议实现有问题，
        // 静默当成空列表会让故障一路漂到「插件装好了却没有工具」才暴露。
        let tools = self
            .result
            .as_ref()
            .and_then(|r| r.get("tools"))
            .and_then(Value::as_array)
            .ok_or_else(|| "tools/list 响应缺少 result.tools".to_string())?;

        let mut decls = Vec::with_capacity(tools.len());
        for item in tools {
            // 没名字的工具注册不进 ToolRegistry，与其塞个空串进去不如跳过。
            let Some(name) = item.get("name").and_then(Value::as_str) else {
                continue;
            };
            decls.push(PluginToolDecl {
                name: name.to_string(),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                // 无 schema 的工具按「不收参数」处理，否则注入注册表时下游
                // 拿不到可用的 JSON Schema。
                input_schema: item
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
            });
        }
        Ok(decls)
    }

    /// 解析 tools/call 的响应 → 拼接所有 type=="text" 的 content
    pub fn into_tool_call(self) -> Result<String, String> {
        if let Some(e) = self.error {
            return Err(format!("{}: {}", e.code, e.message));
        }
        let content = self
            .result
            .as_ref()
            .and_then(|r| r.get("content"))
            .and_then(Value::as_array)
            .ok_or_else(|| "tools/call 响应缺少 result.content".to_string())?;

        // MCP 的 content 是异构数组（text / image / resource…），当前宿主只
        // 消费纯文本；其它类型直接忽略，免得把二进制塞进对话上下文。
        let text = content
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n");
        Ok(text)
    }
}

/// 构造 initialize 请求。
///
/// `_qmai` 是宿主私有的扩展字段，把宿主能力面的地址与 token 交给插件
/// （插件之后用它反调 HostApi，见设计文档 5.3）。
pub fn initialize_request(
    id: u64,
    plugin_id: &str,
    host_url: &str,
    token: &str,
    granted: &[String],
) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "clientInfo": {
                "name": "qmai",
                // 用编译期版本号，避免宿主与上报的版本对不上时难以追查。
                "version": env!("CARGO_PKG_VERSION"),
            },
            "capabilities": { "tools": {} },
            // _qmai 不是 MCP 标准字段（标准实现会忽略未知 key），
            // 借 initialize 一次性把能力面凭据下发，省掉自定义握手轮次。
            "_qmai": {
                "pluginId": plugin_id,
                "hostUrl": host_url,
                "hostToken": token,
                "grantedPermissions": granted,
            }
        }
    })
}

pub fn tools_list_request(id: u64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/list",
        // 空 params 而不是省略：部分 MCP 实现要求该字段存在。
        "params": {}
    })
}

pub fn tool_call_request(id: u64, name: &str, arguments: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/call",
        "params": { "name": name, "arguments": arguments }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_initialize_request() {
        let req = initialize_request(
            1,
            "abc",
            "http://127.0.0.1:9",
            "tok",
            &["fs:project-read".into()],
        );
        assert_eq!(req["method"], "initialize");
        assert_eq!(req["params"]["_qmai"]["pluginId"], "abc");
        assert_eq!(req["params"]["_qmai"]["hostToken"], "tok");
        assert_eq!(
            req["params"]["_qmai"]["grantedPermissions"][0],
            "fs:project-read"
        );
        assert_eq!(req["params"]["capabilities"]["tools"], json!({}));
    }

    #[test]
    fn parses_tools_list_result() {
        let raw = r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[
            {"name":"analyze","description":"d","inputSchema":{"type":"object","properties":{}}}
        ]}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        let tools = msg.into_tool_list().expect("tools");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "analyze");
        assert_eq!(tools[0].description, "d");
    }

    #[test]
    fn error_response_is_surfaced() {
        let raw = r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"no such tool"}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        let err = msg.into_tool_call().unwrap_err();
        assert!(err.contains("no such tool"), "err: {err}");
    }

    #[test]
    fn extracts_text_content_from_tool_result() {
        let raw = r#"{"jsonrpc":"2.0","id":4,"result":{"content":[
            {"type":"text","text":"第一段"},{"type":"text","text":"第二段"}
        ]}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        assert_eq!(msg.into_tool_call().unwrap(), "第一段\n第二段");
    }

    #[test]
    fn missing_tools_key_is_an_error_not_empty_list() {
        // 静默返回空列表会让「插件装好了但没工具」变成一个无提示的谜
        let raw = r#"{"jsonrpc":"2.0","id":2,"result":{}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        assert!(msg.into_tool_list().is_err());
    }

    #[test]
    fn non_text_content_is_ignored() {
        // 插件可能回 image / resource 等类型，这里只取 text
        let raw = r#"{"jsonrpc":"2.0","id":4,"result":{"content":[
            {"type":"image","data":"..."},{"type":"text","text":"ok"}
        ]}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        assert_eq!(msg.into_tool_call().unwrap(), "ok");
    }

    #[test]
    fn tool_list_items_without_name_are_skipped_and_schema_defaults() {
        let raw = r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[
            {"description":"no name"},
            {"name":"ok_one"}
        ]}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        let tools = msg.into_tool_list().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "ok_one");
        assert_eq!(tools[0].description, "");
        assert_eq!(
            tools[0].input_schema,
            json!({"type":"object","properties":{}})
        );
    }
}
