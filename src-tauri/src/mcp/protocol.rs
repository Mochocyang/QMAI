use serde_json::{json, Value};

pub const TOOL_NAMES: [&str; 8] = [
    "list_bookshelf",
    "open_bookshelf",
    "get_current",
    "writing_conversation",
    "save_document",
    "update_document_title",
    "extract_memory",
    "format_chapter",
];

pub fn jsonrpc_error(id: Value, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": -32000, "message": message }
    })
}

pub fn jsonrpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn tool(name: &str, description: &str, properties: Value, required: Vec<&str>) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        }
    })
}

fn prop(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

pub fn tools_list_result() -> Value {
    json!({
        "tools": [
            tool(
                "list_bookshelf",
                "列出书架上的全部书，包含书名、id 和路径。",
                json!({}),
                vec![]
            ),
            tool(
                "open_bookshelf",
                "从书架打开一本书，并切换到这本书。书名、id、路径至少提供一个。同名书有多本时请改用 id 或路径。",
                json!({
                    "name": prop("书名"),
                    "id": prop("书的 id"),
                    "path": prop("书的项目目录")
                }),
                vec![]
            ),
            tool(
                "get_current",
                "获取当前打开的书，以及正在打开的文件。没有打开的书时会说明。",
                json!({}),
                vec![]
            ),
            tool(
                "writing_conversation",
                "发起或继续一次写作对话。不传 workflowMode、model、reasoningDepth 时使用青幕当前界面的写作模式、写作模型和思考深度，且不改写界面选择。",
                json!({
                    "message": prop("用户要说的话"),
                    "projectPath": prop("项目目录。不传则使用当前打开的项目"),
                    "conversationId": prop("要继续的写作会话 id。不传则新建"),
                    "workflowMode": { "type": "string", "enum": ["fast", "standard", "strict", "discuss"], "description": "这一次的写作模式" },
                    "model": prop("这一次的写作模型 id"),
                    "reasoningDepth": { "type": "string", "enum": ["auto", "off", "low", "medium", "high", "max"], "description": "这一次的思考深度" }
                }),
                vec!["message"]
            ),
            tool(
                "save_document",
                "原子保存章节或大纲 Markdown。不排版，不改正式稿状态，不提取记忆。",
                json!({
                    "projectPath": prop("项目目录。不传则使用当前打开的项目"),
                    "path": prop("章节或大纲文件的绝对路径"),
                    "content": prop("完整 Markdown"),
                    "overwrite": { "type": "boolean", "description": "编辑器有未保存修改时是否覆盖" }
                }),
                vec!["path", "content"]
            ),
            tool(
                "update_document_title",
                "修改章节或大纲标题，同时更新 frontmatter、一级标题和文件名。",
                json!({
                    "projectPath": prop("项目目录。不传则使用当前打开的项目"),
                    "path": prop("文件绝对路径"),
                    "title": prop("新标题")
                }),
                vec!["path", "title"]
            ),
            tool(
                "extract_memory",
                "提取章节或大纲记忆。不排版正文。非正式章节默认拒绝。",
                json!({
                    "projectPath": prop("项目目录。不传则使用当前打开的项目"),
                    "path": prop("章节或大纲文件的绝对路径"),
                    "allowDraft": { "type": "boolean", "description": "为 true 时允许提取草稿章节" }
                }),
                vec!["path"]
            ),
            tool(
                "format_chapter",
                "按编辑器「一键排版」整理章节正文。大纲路径会拒绝。",
                json!({
                    "projectPath": prop("项目目录。不传则使用当前打开的项目"),
                    "path": prop("章节文件的绝对路径")
                }),
                vec!["path"]
            )
        ]
    })
}

pub fn handle_jsonrpc(message: &Value, call_tool: &mut dyn FnMut(&Value) -> Result<Value, String>) -> Option<Value> {
    let id = message.get("id").cloned();
    let Some(id) = id else {
        return None;
    };
    let method = message.get("method").and_then(|value| value.as_str()).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(|value| value.as_str()).unwrap_or("2024-11-05"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "qmai", "version": env!("CARGO_PKG_VERSION") }
        })),
        "tools/list" => Ok(tools_list_result()),
        "tools/call" => call_tool(&params),
        _ => Err(format!("不支持的 MCP 方法：{method}")),
    };
    Some(match result {
        Ok(result) => jsonrpc_result(id, result),
        Err(message) => jsonrpc_error(id, &message),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tools_list_contains_the_agent_tools() {
        let result = tools_list_result();
        let names: Vec<&str> = result["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, TOOL_NAMES);
    }

    #[test]
    fn initialize_and_tool_errors_keep_the_request_id() {
        let init = handle_jsonrpc(
            &json!({"jsonrpc":"2.0","id":7,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}),
            &mut |_| Ok(json!({})),
        ).unwrap();
        assert_eq!(init["id"], 7);
        assert_eq!(init["result"]["serverInfo"]["name"], "qmai");

        let failed = handle_jsonrpc(
            &json!({"jsonrpc":"2.0","id":"call-1","method":"tools/call","params":{"name":"save_document"}}),
            &mut |_| Err("青幕写作没有响应 MCP 调用。".to_string()),
        ).unwrap();
        assert_eq!(failed["id"], "call-1");
        assert_eq!(failed["error"]["message"], "青幕写作没有响应 MCP 调用。");
    }

    #[test]
    fn notifications_do_not_produce_a_response() {
        let response = handle_jsonrpc(
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            &mut |_| Ok(json!({})),
        );
        assert!(response.is_none());
    }
}
