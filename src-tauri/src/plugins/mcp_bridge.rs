//! MCP 桥：stdio 上 JSON-RPC 2.0 消息的构造与解析（纯函数，无 IO）。
//!
//! 宿主与插件是一对子进程关系，每行一条 JSON（NDJSON）。这里只负责「把请求
//! 拼成正确的形状」和「把响应的内容取出来」，进程读写、握手顺序、超时属于
//! 任务 12 的 supervisor/握手流程，不在这里做。

use serde_json::{json, Value};

/// 一条 JSON-RPC 消息（响应形态：有 result 或 error）
///
/// `id` 保留原值不消费：任务 12 的握手/并发调用要按 id 把响应配对回请求，
/// 所以解析与取值都按引用进行，不把消息吃掉。
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
#[derive(Debug, Clone, PartialEq)]
pub struct PluginToolDecl {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

impl RpcMessage {
    /// 解析 tools/list 的响应 → 工具声明列表
    pub fn into_tool_list(&self) -> Result<Vec<PluginToolDecl>, String> {
        if let Some(e) = self.error.as_ref() {
            // 带方法名，日志里才看得出是哪一步失败。
            return Err(format!("tools/list 失败 - {}: {}", e.code, e.message));
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
    pub fn into_tool_call(&self) -> Result<String, String> {
        if let Some(e) = self.error.as_ref() {
            return Err(format!("tools/call 失败 - {}: {}", e.code, e.message));
        }
        let result = self
            .result
            .as_ref()
            .ok_or_else(|| "tools/call 响应缺少 result.content".to_string())?;
        // MCP 允许「工具执行失败但 JSON-RPC 成功」：result.isError=true。
        // 不区分的话，插件的错误文案会被当成正常工具结果喂给模型。
        let is_error = result
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let content = result
            .get("content")
            .and_then(Value::as_array)
            .ok_or_else(|| "tools/call 响应缺少 result.content".to_string())?;

        // MCP 的 content 是异构数组（text / image / resource…），当前宿主只
        // 消费纯文本；只按 type 判定，不能因为元素带了 text 字段就收下——
        // 否则 image 的 base64 会漏进模型上下文。
        let texts: Vec<&str> = content
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect();

        if is_error {
            let detail = texts.join("\n");
            return Err(if detail.is_empty() {
                "tools/call 工具级错误（isError=true，但结果不含 text 内容）".to_string()
            } else {
                format!("tools/call 工具级错误 - {detail}")
            });
        }
        // 空输出与「调用成功但没有内容」在模型眼里无法区分，会让故障变成谜。
        if texts.is_empty() {
            return Err("tools/call 结果不含任何 text 内容".into());
        }
        Ok(texts.join("\n"))
    }
}

/// 构造 initialize 请求。
///
/// `_qmai` 是宿主私有的扩展字段，把宿主能力面的地址与 token 交给插件
/// （插件之后用它反调 HostApi，见设计文档 5.3）。
///
/// 警告：请求体里含 `hostToken`（能力面凭据）。**不得**把整个 params 写进
/// 日志或错误信息——tracing / Debug 打印会落盘，等于把凭据泄给日志读者。
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
        assert_eq!(req["jsonrpc"], "2.0");
        assert_eq!(req["method"], "initialize");
        // 协议版本是宿主与插件的契约，写错会让握手直接失败，所以钉死。
        assert_eq!(req["params"]["protocolVersion"], "2024-11-05");
        assert_eq!(req["params"]["_qmai"]["pluginId"], "abc");
        assert_eq!(req["params"]["_qmai"]["hostToken"], "tok");
        assert_eq!(
            req["params"]["_qmai"]["grantedPermissions"][0],
            "fs:project-read"
        );
        assert_eq!(req["params"]["capabilities"]["tools"], json!({}));
    }

    #[test]
    fn builds_tools_list_request() {
        let req = tools_list_request(7);
        assert_eq!(req["jsonrpc"], "2.0");
        assert_eq!(req["id"], 7);
        assert_eq!(req["method"], "tools/list");
        assert_eq!(req["params"], json!({}));
    }

    #[test]
    fn builds_tool_call_request() {
        let req = tool_call_request(8, "analyze", &json!({"path": "a.rs"}));
        assert_eq!(req["jsonrpc"], "2.0");
        assert_eq!(req["id"], 8);
        assert_eq!(req["method"], "tools/call");
        assert_eq!(req["params"]["name"], "analyze");
        assert_eq!(req["params"]["arguments"], json!({"path": "a.rs"}));
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
        // 带上方法名，否则日志里只看到一个错误码，看不出是哪一步失败。
        assert_eq!(
            msg.into_tool_call().unwrap_err(),
            "tools/call 失败 - -32601: no such tool"
        );
    }

    #[test]
    fn tools_list_error_is_surfaced_with_code_and_message() {
        let raw = r#"{"jsonrpc":"2.0","id":9,"error":{"code":-32603,"message":"boom"}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        assert_eq!(
            msg.into_tool_list().unwrap_err(),
            "tools/list 失败 - -32603: boom"
        );
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
        assert_eq!(
            msg.into_tool_list().unwrap_err(),
            "tools/list 响应缺少 result.tools"
        );
    }

    #[test]
    fn missing_content_key_is_an_error() {
        let raw = r#"{"jsonrpc":"2.0","id":4,"result":{}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        assert_eq!(
            msg.into_tool_call().unwrap_err(),
            "tools/call 响应缺少 result.content"
        );
    }

    #[test]
    fn non_text_content_is_ignored() {
        // 关键：image 元素**带** text 字段。若不按 type 过滤，base64 会漏进模型上下文。
        let raw = r#"{"jsonrpc":"2.0","id":4,"result":{"content":[
            {"type":"image","text":"SHOULD_NOT_APPEAR"},
            {"type":"text","text":"ok"}
        ]}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        let out = msg.into_tool_call().unwrap();
        assert_eq!(out, "ok");
        assert!(
            !out.contains("SHOULD_NOT_APPEAR"),
            "非 text 内容不得进入结果: {out}"
        );
    }

    #[test]
    fn tool_call_with_no_readable_text_is_an_error() {
        // content 形状不对（不是数组）：不能被当成「成功但没有输出」。
        let raw = r#"{"jsonrpc":"2.0","id":4,"result":{"content":{"type":"image"}}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        assert!(msg.into_tool_call().is_err());
    }

    #[test]
    fn tool_call_with_only_non_text_content_is_an_error() {
        // 数组里全是非 text：空输出会被模型读成「成功但没内容」，必须报错。
        let raw = r#"{"jsonrpc":"2.0","id":4,"result":{"content":[
            {"type":"image","text":"AAAA"}
        ]}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        assert_eq!(
            msg.into_tool_call().unwrap_err(),
            "tools/call 结果不含任何 text 内容"
        );
    }

    #[test]
    fn tool_level_error_result_is_surfaced_as_err() {
        // MCP 的工具级失败：JSON-RPC 成功但 result.isError=true。
        let raw = r#"{"jsonrpc":"2.0","id":4,"result":{"isError":true,"content":[
            {"type":"text","text":"文件不存在"}
        ]}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        let err = msg.into_tool_call().unwrap_err();
        assert!(
            err.contains("文件不存在"),
            "err 应带上插件的原始文案: {err}"
        );
    }

    #[test]
    fn id_is_kept_after_parsing_so_responses_can_be_paired() {
        // 任务 12 要按 id 把响应配对回请求，解析不能顺手把 id 吃掉。
        let raw = r#"{"jsonrpc":"2.0","id":42,"result":{"content":[{"type":"text","text":"ok"}]}}"#;
        let msg: RpcMessage = serde_json::from_str(raw).unwrap();
        assert_eq!(msg.id, Some(json!(42)));
        assert_eq!(msg.into_tool_call().unwrap(), "ok");
        assert_eq!(msg.id, Some(json!(42)));
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
