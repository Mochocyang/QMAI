use serde_json::{json, Value};

#[cfg(test)]
pub const TOOL_NAMES: [&str; 19] = [
    "list_bookshelf",
    "open_bookshelf",
    "get_current",
    "writing_conversation",
    "get_writing_progress",
    "stop_writing",
    "save_document",
    "update_document_title",
    "extract_memory",
    "format_chapter",
    "get_maintenance_status",
    "scan_memory_cleanup",
    "get_memory_cleanup_result",
    "apply_memory_cleanup",
    "keep_memory_cleanup_issues",
    "undo_memory_cleanup",
    "get_maintenance_progress",
    "stop_maintenance_task",
    "update_maintenance_settings",
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
                "发起或继续一次写作对话。background 为 true 时立即返回任务标识，使用 get_writing_progress 查询进度；默认等待完成。不传写作参数时使用当前界面值，且不改写界面选择。",
                json!({
                    "message": prop("用户要说的话"),
                    "projectPath": prop("项目目录。不传则使用当前打开的项目"),
                    "conversationId": prop("要继续的写作会话 id。不传则新建"),
                    "workflowMode": { "type": "string", "enum": ["fast", "standard", "strict", "discuss"], "description": "这一次的写作模式" },
                    "model": prop("这一次的写作模型 id"),
                    "reasoningDepth": { "type": "string", "enum": ["auto", "off", "low", "medium", "high", "max"], "description": "这一次的思考深度" },
                    "background": { "type": "boolean", "default": false, "description": "为 true 时后台执行，返回 runId、conversationId 和进度文件路径；断开客户端不取消任务" }
                }),
                vec!["message"]
            ),
            tool(
                "get_writing_progress",
                "查询 MCP 写作任务的实际阶段、工具状态和问题，不返回正文或思考。传 afterRevision 可等待变化，最长 30 秒；无变化时 changed 为 false。",
                json!({
                    "projectPath": prop("任务所属项目目录。不传则使用当前打开的项目"),
                    "runId": prop("writing_conversation 返回的任务 runId"),
                    "afterRevision": { "type": "integer", "minimum": 0, "description": "上次已读取的进度版本号" },
                    "waitMs": { "type": "integer", "minimum": 0, "maximum": 30000, "default": 0, "description": "进度未变化时最多等待的毫秒数，仅配合 afterRevision 生效" }
                }),
                vec!["runId"]
            ),
            tool(
                "stop_writing",
                "停止当前项目正在进行的写作生成，与界面「停止生成」相同。没有进行中的生成时会说明。",
                json!({
                    "projectPath": prop("项目目录。不传则使用当前打开的项目")
                }),
                vec![]
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
            ),
            tool("get_maintenance_status", "查询当前项目的记忆数量、超量提醒阈值、可用检测模型、扫描摘要及最近清理标识。", json!({
                "projectPath": prop("项目目录，必须是当前打开的项目")
            }), vec![]),
            tool("scan_memory_cleanup", "后台扫描六类来源记忆，只生成候选，不删除内容。返回 runId，用 get_maintenance_progress 查询，完成后分页读取候选。", json!({
                "projectPath": prop("项目目录，必须是当前打开的项目"),
                "model": prop("检测模型完整 ID，来自 get_maintenance_status.availableModels；不修改界面模型"),
                "fields": {"type":"array", "minItems":1, "uniqueItems":true, "items":{"type":"string", "enum":["knowledgeChanges","characterStateChanges","foreshadowingChanges","timelineEvents","newCanonFacts","conflicts"]}},
                "fromChapter": {"type":"integer", "minimum":1, "maximum":1000000, "description":"起始章，含本章；指定范围时只扫描正文章节快照"},
                "toChapter": {"type":"integer", "minimum":1, "maximum":1000000, "description":"结束章，含本章"}
            }), vec![]),
            tool("get_memory_cleanup_result", "分页查询有效扫描候选及删除、保留依据。返回 scanId，清理时必须原样提供。", json!({
                "projectPath": prop("项目目录，必须是当前打开的项目"), "scanId":prop("可选，指定扫描标识，过期会拒绝"),
                "offset":{"type":"integer", "minimum":0, "default":0}, "limit":{"type":"integer", "minimum":1, "maximum":100, "default":20}
            }), vec![]),
            tool("apply_memory_cleanup", "后台执行已审查候选：先备份，再从快照来源删除并同步 JSON、Markdown、人物 Skill 和检索索引。必须提供当前 scanId 和明确 issueIds；正文、大纲不变。完成后可撤销。", json!({
                "projectPath":prop("项目目录，必须是当前打开的项目"), "scanId":prop("有效扫描标识"),
                "issueIds":{"type":"array", "minItems":1, "maxItems":100, "items":{"type":"string", "minLength":1}}
            }), vec!["scanId","issueIds"]),
            tool("keep_memory_cleanup_issues", "保留指定候选，加入项目白名单，之后扫描不再重复建议删除同组记忆。", json!({
                "projectPath":prop("项目目录，必须是当前打开的项目"), "scanId":prop("有效扫描标识"),
                "issueIds":{"type":"array", "minItems":1, "maxItems":100, "items":{"type":"string", "minLength":1}}
            }), vec!["scanId","issueIds"]),
            tool("undo_memory_cleanup", "后台撤销最近一次清理，恢复来源和派生文档并同步索引。清理后的相关文件若有新修改则拒绝覆盖。", json!({
                "projectPath":prop("项目目录，必须是当前打开的项目"), "cleanupId":prop("可选，指定最近清理标识以防撤销错任务")
            }), vec![]),
            tool("get_maintenance_progress", "查询维护任务实际阶段、批次、日志及完成结果。断开客户端不取消任务，应用重启后的运行记录会标为 interrupted。", json!({
                "projectPath":prop("任务启动时返回的项目目录，切书后也可查询"), "runId":prop("维护工具返回的 runId"),
                "afterRevision":{"type":"integer", "minimum":0}, "waitMs":{"type":"integer", "minimum":0, "maximum":30000, "default":0}
            }), vec!["runId"]),
            tool("stop_maintenance_task", "只取消仍在运行的扫描。清理或撤销同步期间不能中断，清理完成后可用 undo_memory_cleanup 撤销。", json!({
                "projectPath":prop("任务启动时返回的项目目录"), "runId":prop("扫描任务 runId")
            }), vec!["runId"]),
            tool("update_maintenance_settings", "调整项目超量提醒开关、阈值和默认检测模型。超过阈值只提醒，不自动删除；同项目最多每七天提醒一次。", json!({
                "projectPath":prop("项目目录，必须是当前打开的项目"), "enabled":{"type":"boolean"}, "model":prop("可用检测模型完整 ID"),
                "cognitionChars":{"type":"integer", "minimum":100, "maximum":100000000},
                "limits":{"type":"object", "additionalProperties":false, "properties":{
                    "cognition":{"type":"integer", "minimum":1, "maximum":1000000}, "characters":{"type":"integer", "minimum":1, "maximum":1000000},
                    "foreshadowing":{"type":"integer", "minimum":1, "maximum":1000000}, "timeline":{"type":"integer", "minimum":1, "maximum":1000000}
                }}
            }), vec![])

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

    #[test]
    fn maintenance_tools_require_explicit_candidates_and_bound_progress_waits() {
        let listed = tools_list_result();
        let tools = listed["tools"].as_array().unwrap();
        let schema = |name: &str| tools.iter().find(|tool| tool["name"] == name).unwrap()["inputSchema"].clone();
        assert_eq!(schema("apply_memory_cleanup")["required"], json!(["scanId", "issueIds"]));
        assert_eq!(schema("keep_memory_cleanup_issues")["required"], json!(["scanId", "issueIds"]));
        assert_eq!(schema("get_maintenance_progress")["properties"]["waitMs"]["maximum"], 30000);
        assert_eq!(schema("scan_memory_cleanup")["properties"]["fields"]["items"]["enum"].as_array().unwrap().len(), 6);
        assert_eq!(schema("update_maintenance_settings")["properties"]["limits"]["additionalProperties"], false);
        for name in &TOOL_NAMES[10..] { assert_eq!(schema(name)["additionalProperties"], false); }
    }

    #[test]
    fn background_progress_schema_preserves_sync_default_and_bounded_waits() {
        let listed = tools_list_result();
        let tools = listed["tools"].as_array().unwrap();
        let writing = tools.iter().find(|tool| tool["name"] == "writing_conversation").unwrap();
        assert_eq!(writing["inputSchema"]["properties"]["background"]["default"], false);
        assert_eq!(writing["inputSchema"]["required"], json!(["message"]));
        let progress = tools.iter().find(|tool| tool["name"] == "get_writing_progress").unwrap();
        assert_eq!(progress["inputSchema"]["required"], json!(["runId"]));
        assert_eq!(progress["inputSchema"]["properties"]["waitMs"]["maximum"], 30000);
        assert_eq!(progress["inputSchema"]["properties"]["afterRevision"]["minimum"], 0);
    }
}
