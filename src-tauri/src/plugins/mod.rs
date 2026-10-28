//! 开放插件系统：清单、注册表、进程监管、宿主能力面、安装器。
//!
//! 插件 = 一个常驻子进程 + 一个 plugin.json。通信走 stdio JSON-RPC（MCP），
//! 插件反调宿主能力走本机回环 HTTP（按 permissions 拦截）。
//! 设计见 docs/superpowers/specs/2026-10-27-开放插件系统-design.md

// manifest::* 在任务 3+ 被 registry / mcp_bridge / installer 消费；在此之前
// dead_code 警告是预期状态，不要用 #[allow(dead_code)] 掩盖它。
pub mod host_api;
pub mod installer;
pub mod manifest;
pub mod mcp_bridge;
pub mod paths;
pub mod registry;
pub mod supervisor;

/// 在现有 Tokio 运行时上跑一个后台任务。
/// Tauri 启动后总有运行时；取不到时放弃（不 panic —— release 档是 panic=abort）。
pub fn spawn_task<F>(f: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(f);
    }
}

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::State;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt};
use tokio::sync::Mutex as AsyncMutex;

use registry::{PluginRegistry, RegistryEntry, SourceRecord};

/// 插件系统全局状态。
///
/// `running` 用异步锁：启用/停用过程要 await 子进程，std 锁会把整个 Tauri
/// 运行时卡死。句柄只在这个表里持有，卸载时先 remove 再 stop，避免持锁 await。
#[derive(Default)]
pub struct PluginsState {
    /// pluginId → 运行中的插件句柄
    pub running: Arc<AsyncMutex<HashMap<String, supervisor::LaunchHandle>>>,
    /// 宿主 API 端口（首次启用时启动，之后复用）
    pub host_port: Mutex<Option<u16>>,
}

impl PluginsState {
    fn root(&self) -> PathBuf {
        paths::plugins_root()
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub process_state: String,
    pub granted_permissions: Vec<String>,
    pub tool_count: usize,
    pub source_repo: String,
    pub source_commit: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginToolDescriptor {
    pub plugin_id: String,
    /// 插件内的原名（不带宿主注入用的 `<pluginId>__` 前缀）
    pub name: String,
    pub description: String,
    /// 原样透传 tools/list 的 inputSchema，宿主不重写参数契约
    pub parameters: serde_json::Value,
}

/// 把注册表条目与运行期快照拼成前端契约。抽成纯函数是为了能直接测字段映射，
/// 不必为了验证 `toolCount` 去起一个真实进程。
fn summary_from_entry(
    entry: &RegistryEntry,
    name: String,
    description: String,
    process_state: &str,
    tool_count: usize,
) -> PluginSummary {
    PluginSummary {
        id: entry.id.clone(),
        name,
        version: entry.version.clone(),
        description,
        enabled: entry.enabled,
        process_state: process_state.to_string(),
        granted_permissions: entry.granted_permissions.clone(),
        tool_count,
        source_repo: entry.source.repo.clone(),
        source_commit: entry.source.commit.clone(),
    }
}

fn describe_tool(plugin_id: &str, decl: &mcp_bridge::PluginToolDecl) -> PluginToolDescriptor {
    PluginToolDescriptor {
        plugin_id: plugin_id.to_string(),
        name: decl.name.clone(),
        description: decl.description.clone(),
        parameters: decl.input_schema.clone(),
    }
}

/// 用户勾选的权限必须来自白名单；`data:write` 允许出现在清单/参数里，
/// 但宿主永远自动授予它（host_api::require 会对它直接放行）。
fn validate_granted_permissions(granted: &[String]) -> Result<(), String> {
    for permission in granted {
        if !manifest::KNOWN_PERMISSIONS.contains(&permission.as_str())
            && !manifest::AUTO_GRANTED_PERMISSIONS.contains(&permission.as_str())
        {
            return Err(format!("未知权限：{permission}"));
        }
    }
    Ok(())
}

/// 从插件目录读展示信息。读不到或清单坏了都降级为空串：
/// 管理页仍应能列出（并操作）一个磁盘上损坏的插件，而不是整页报错。
fn manifest_display(dir: &Path) -> (String, String) {
    let Ok(raw) = std::fs::read_to_string(dir.join("plugin.json")) else {
        return (String::new(), String::new());
    };
    match manifest::PluginManifest::parse(&raw) {
        Ok(parsed) => (parsed.name, parsed.description),
        Err(_) => (String::new(), String::new()),
    }
}

/// 读一条与 `expected_id` 配对的 JSON-RPC 响应。
///
/// 跳过空行、非 JSON 的调试输出、通知（无 id）和超时后补发的旧响应；
/// 若插件在给出响应前关闭 stdout，立即返回错误而不是永久等待。
async fn read_rpc_response<R>(
    stdout: &mut tokio::io::Lines<R>,
    expected_id: u64,
    phase: &str,
) -> Result<mcp_bridge::RpcMessage, String>
where
    R: AsyncBufRead + Unpin,
{
    loop {
        let Some(line) = stdout
            .next_line()
            .await
            .map_err(|e| format!("读取插件输出失败：{e}"))?
        else {
            return Err(format!("插件在{phase}阶段关闭了 stdout"));
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<mcp_bridge::RpcMessage>(line) else {
            // 插件往 stdout 打调试信息很常见，不能因此判握手失败。
            continue;
        };
        if message.id.as_ref().and_then(serde_json::Value::as_u64) == Some(expected_id) {
            return Ok(message);
        }
    }
}

/// 启动一个插件：建会话 → 拼环境变量 → spawn → 握手 → 拉工具清单 → 存句柄。
/// 任一步失败都把已建资源清干净（杀进程、注销 session），不留半成品。
async fn start_plugin(
    root: &Path,
    running: &Arc<AsyncMutex<HashMap<String, supervisor::LaunchHandle>>>,
    host_port: &Mutex<Option<u16>>,
    entry: &RegistryEntry,
) -> Result<(), String> {
    if running.lock().await.contains_key(&entry.id) {
        return Ok(()); // 已在跑
    }

    let dir = paths::plugin_dir(root, &entry.id);
    let raw = std::fs::read_to_string(dir.join("plugin.json"))
        .map_err(|e| format!("读取清单失败：{e}"))?;
    let manifest = manifest::PluginManifest::parse(&raw)
        .map_err(|e| format!("清单校验失败 {}：{}", e.code(), e.detail))?;

    // 宿主 API：首次启动，之后复用同一个端口。std 锁只包住启动动作，不跨 await。
    let port = {
        let mut guard = host_port.lock().map_err(|_| "状态不可用".to_string())?;
        if guard.is_none() {
            *guard = Some(host_api::start(host_api::shared_state())?);
        }
        guard.expect("上面刚保证 Some")
    };
    let host_url = format!("http://127.0.0.1:{port}");

    // 每个插件一个 token，绑定身份与已授予权限。
    let token = uuid::Uuid::new_v4().to_string();
    host_api::register_session(
        &token,
        host_api::PluginSession {
            plugin_id: entry.id.clone(),
            granted: entry.granted_permissions.clone(),
            // 项目根暂不注入：宿主还不知道「当前打开项目」。
            // 没这一步时 /host/project/read 会返回 E_NO_PROJECT，属预期（第二期再接）。
            project_root: None,
            data_root: paths::plugin_data_dir(root, &entry.id),
        },
    );

    let mut cmd = match supervisor::build_command(&dir, &manifest).await {
        Ok(command) => command,
        Err(error) => {
            host_api::unregister_session(&token);
            return Err(error);
        }
    };
    for (key, value) in [
        ("QMAI_HOST_URL", host_url.as_str()),
        ("QMAI_HOST_TOKEN", token.as_str()),
        ("QMAI_PLUGIN_ID", entry.id.as_str()),
    ] {
        cmd.env(key, value);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            host_api::unregister_session(&token);
            return Err(format!("启动插件进程失败：{error}"));
        }
    };

    let Some(stdin) = child.stdin.take() else {
        let _ = child.kill().await;
        host_api::unregister_session(&token);
        return Err("无法获取插件 stdin".into());
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill().await;
        host_api::unregister_session(&token);
        return Err("无法获取插件 stdout".into());
    };
    let stdout = tokio::io::BufReader::new(stdout).lines();

    // stderr 是 piped 的，没人读的话管道写满后插件会阻塞在写日志上，
    // 表现为「握手超时」或「工具调用无响应」。必须持续排空。
    //
    // 按字节块读而不是 `lines()`：非 UTF-8 字节会让 `Lines` 直接返回错误，
    // 一旦 break 就停止了排空，等于又回到卡死；块读也不会被没有换行的超长行撑爆内存。
    if let Some(mut stderr) = child.stderr.take() {
        let plugin_id = entry.id.clone();
        spawn_task(async move {
            use tokio::io::AsyncReadExt;
            let mut tail = supervisor::TailBuffer::new(64 * 1024);
            let mut chunk = [0u8; 8 * 1024];
            loop {
                match stderr.read(&mut chunk).await {
                    Ok(0) => break, // 进程退出，管道关闭
                    Ok(n) => tail.push(&chunk[..n]),
                    Err(_) => break,
                }
            }
            let text = tail.as_lossy();
            if !text.trim().is_empty() {
                // 插件退出时把它最后的 stderr 尾巴打出来，便于定位崩溃原因
                eprintln!("[plugins] {plugin_id} 的最后 stderr（尾部 64KB）：\n{text}");
            }
        });
    }

    let mut handle = supervisor::LaunchHandle {
        plugin_id: entry.id.clone(),
        token: token.clone(),
        child,
        stdin,
        stdout,
        counter: supervisor::RequestCounter::default(),
        tools: Vec::new(),
        state: supervisor::ProcessState::Starting,
        io: Arc::new(AsyncMutex::new(())),
    };

    // 握手 + 拉工具清单，整体受 startTimeoutMs 约束。
    let timeout = std::time::Duration::from_millis(manifest.runtime.start_timeout_ms);
    let handshake = async {
        let initialize_id = handle.counter.next();
        let initialize = mcp_bridge::initialize_request(
            initialize_id,
            &entry.id,
            &host_url,
            &token,
            &entry.granted_permissions,
        );
        let line = serde_json::to_string(&initialize).map_err(|e| e.to_string())?;
        handle
            .stdin
            .write_all(format!("{line}\n").as_bytes())
            .await
            .map_err(|e| format!("发送 initialize 失败：{e}"))?;
        handle.stdin.flush().await.map_err(|e| e.to_string())?;

        let response = read_rpc_response(&mut handle.stdout, initialize_id, "握手").await?;
        if let Some(error) = response.error.as_ref() {
            return Err(format!(
                "initialize 返回错误 - {}: {}",
                error.code, error.message
            ));
        }

        let list_id = handle.counter.next();
        let list = mcp_bridge::tools_list_request(list_id);
        let line = serde_json::to_string(&list).map_err(|e| e.to_string())?;
        handle
            .stdin
            .write_all(format!("{line}\n").as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        handle.stdin.flush().await.map_err(|e| e.to_string())?;

        let response = read_rpc_response(&mut handle.stdout, list_id, "tools/list").await?;
        response.into_tool_list()
    };

    match tokio::time::timeout(timeout, handshake).await {
        Ok(Ok(tools)) => {
            handle.tools = tools;
            handle.state = supervisor::ProcessState::Running;
            // 初始检查与这里之间可能有另一个并发 enable。插入前再查一次：
            // 已有句柄时停掉刚起的这一个，避免两个进程抢同一个 pluginId。
            let mut guard = running.lock().await;
            if guard.contains_key(&entry.id) {
                drop(guard);
                handle.stop().await;
                host_api::unregister_session(&token);
                return Ok(());
            }
            guard.insert(entry.id.clone(), handle);
            Ok(())
        }
        Ok(Err(error)) => {
            let _ = handle.child.kill().await;
            host_api::unregister_session(&token);
            Err(format!("插件 {} 握手失败：{error}", entry.id))
        }
        Err(_) => {
            let _ = handle.child.kill().await;
            host_api::unregister_session(&token);
            Err(format!(
                "插件 {} 在 {} ms 内未完成握手",
                entry.id, manifest.runtime.start_timeout_ms
            ))
        }
    }
}

/// 停止并移除一个运行中的插件。**先 remove 再 stop**：`stop()` 里要等子进程
/// 退出（最多 1 秒），不能在持着 running 表锁时 await。
async fn stop_plugin(
    running: &Arc<AsyncMutex<HashMap<String, supervisor::LaunchHandle>>>,
    id: &str,
) {
    if let Some(handle) = running.lock().await.remove(id) {
        let token = handle.token.clone();
        handle.stop().await;
        // 进程没了，旧 token 必须立刻失效，否则残留的插件请求还能反调宿主。
        host_api::unregister_session(&token);
    }
}

/// App 启动后拉起所有已启用的插件。
///
/// 重启后注册表里 `enabled: true` 的插件本来只在「用户点启用」那一刻被拉起，
/// 界面于是长期停在「已停止 + 停用按钮」，用户必须停用再启用才能恢复。
///
/// `root` 由调用方传入（`paths::plugins_root()`），不在函数里读环境变量：
/// 这样测试可以注入临时目录，不必改 `QMAI_PLUGIN_HOME`（改环境变量会污染并行测试）。
///
/// 单个插件失败不能影响其它插件，也不能阻断启动：只记录日志。
/// 失败时注册表里的 enabled 保持 true —— 用户看到「已停止」可以手动重试，
/// 比悄悄把 enabled 改成 false（用户没做任何操作却丢了启用状态）更好。
pub async fn autostart_all(state: &PluginsState, root: &Path) -> Result<(), String> {
    let registry = PluginRegistry::load(root)?;
    // 先把要启动的条目捞出来，避免在 await 期间还引用 registry
    let targets: Vec<RegistryEntry> = registry
        .list()
        .into_iter()
        .filter(|entry| entry.enabled)
        .collect();
    for entry in targets {
        if let Err(error) = start_plugin(root, &state.running, &state.host_port, &entry).await {
            eprintln!("[plugins] 自动启动 {} 失败：{error}", entry.id);
        }
    }
    Ok(())
}

/// 停掉所有运行中的插件。App 退出清理与 `plugins_shutdown_all` 命令共用。
pub(crate) async fn shutdown_all(state: &PluginsState) -> Result<(), String> {
    // 先整体 drain：不在持锁状态下逐个等子进程退出。
    let handles: Vec<supervisor::LaunchHandle> = {
        let mut guard = state.running.lock().await;
        guard.drain().map(|(_, handle)| handle).collect()
    };
    for handle in handles {
        let token = handle.token.clone();
        handle.stop().await;
        host_api::unregister_session(&token);
    }
    Ok(())
}

/// 在一个已确认存活的句柄上执行一次 tools/call。
///
/// 调用方必须先持有 `handle.io` 锁；这里不自己加锁，是为了把「取锁 → 调用」
/// 的顺序留在命令层，测试也能直接复用同一段协议编排。
async fn invoke_tool_on(
    handle: &mut supervisor::LaunchHandle,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<String, String> {
    // tools/list 是工具的真源；不接受调用清单里不存在/尚未上报的工具。
    if !handle.tools.iter().any(|tool| tool.name == tool_name) {
        return Err(format!("插件 {} 没有工具 {tool_name}", handle.plugin_id));
    }

    let request_id = handle.counter.next();
    let request = mcp_bridge::tool_call_request(request_id, tool_name, arguments);
    let line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    handle
        .stdin
        .write_all(format!("{line}\n").as_bytes())
        .await
        .map_err(|e| format!("发送 tools/call 失败：{e}"))?;
    handle.stdin.flush().await.map_err(|e| e.to_string())?;
    let response = read_rpc_response(&mut handle.stdout, request_id, "tools/call").await?;
    response.into_tool_call()
}

// ── Tauri 命令 ─────────────────────────────────────────

/// 列出全部已安装插件。运行状态与工具数取内存句柄；磁盘上的清单只补展示字段。
#[tauri::command]
pub async fn plugins_list(state: State<'_, PluginsState>) -> Result<Vec<PluginSummary>, String> {
    let root = state.root();
    let registry = PluginRegistry::load(&root)?;

    // 先读磁盘（可能慢），再拿 running 锁；避免因为读清单把启停命令堵住。
    let base: Vec<(RegistryEntry, String, String)> = registry
        .list()
        .into_iter()
        .map(|entry| {
            let (name, description) = manifest_display(&paths::plugin_dir(&root, &entry.id));
            (entry, name, description)
        })
        .collect();

    let states: HashMap<String, (&'static str, usize)> = {
        let running = state.running.lock().await;
        running
            .iter()
            .map(|(id, handle)| (id.clone(), (handle.state.as_str(), handle.tools.len())))
            .collect()
    };

    Ok(base
        .into_iter()
        .map(|(entry, name, description)| {
            let (process_state, tool_count) = states
                .get(&entry.id)
                .copied()
                .unwrap_or(("stopped", 0));
            summary_from_entry(&entry, name, description, process_state, tool_count)
        })
        .collect())
}

/// 从 GitHub 安装插件。装完默认关闭，用户勾选权限并点「启用」后才会拉起进程。
#[tauri::command]
pub async fn plugins_install(
    state: State<'_, PluginsState>,
    source: String,
) -> Result<PluginSummary, String> {
    let root = state.root();
    // 先读注册表再发布目录：注册表读不出来（损坏/版本过新）时直接失败，
    // 不会先把目录装出去、再因为读注册表失败留下一个孤儿
    let mut registry = PluginRegistry::load(&root)?;
    let outcome = installer::install(&root, &source).await?;
    let (name, description) = manifest_display(&paths::plugin_dir(&root, &outcome.plugin_id));

    let entry = RegistryEntry {
        id: outcome.plugin_id.clone(),
        version: outcome.version.clone(),
        enabled: false,
        granted_permissions: vec![],
        source: SourceRecord {
            repo: source,
            git_ref: outcome.git_ref.clone(),
            // GitHub archive zip 不含 commit SHA；commit 暂时填 ref，追溯仍可依赖
            // repo + ref + zip_sha256。要真 SHA 得再打一次 GitHub API，第一期不做。
            commit: outcome.git_ref,
            zip_sha256: outcome.zip_sha256,
            installed_at: chrono::Utc::now().to_rfc3339(),
        },
    };
    let summary = summary_from_entry(&entry, name, description, "stopped", 0);

    registry.upsert(entry);
    if let Err(e) = registry.save(&root) {
        // 目录已经发布但注册表没记上 → 回滚，否则留下一个用户看不见、也卸不掉的孤儿
        let _ = std::fs::remove_dir_all(&outcome.target);
        return Err(format!("写入插件注册表失败，已回滚安装：{e}"));
    }
    Ok(summary)
}

/// 启用插件：先落盘（enabled + 权限），再拉起进程。
///
/// 启动失败**不回滚** enabled：磁盘上保留用户的启用意图，命令把错误返回给界面。
#[tauri::command]
pub async fn plugins_enable(
    state: State<'_, PluginsState>,
    id: String,
    granted: Vec<String>,
) -> Result<(), String> {
    validate_granted_permissions(&granted)?;
    let root = state.root();
    let mut registry = PluginRegistry::load(&root)?;
    let mut entry = registry
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("插件 {id} 未安装"))?;

    entry.enabled = true;
    entry.granted_permissions = granted;
    registry.upsert(entry.clone());
    registry.save(&root)?;

    start_plugin(&root, &state.running, &state.host_port, &entry).await?;
    Ok(())
}

/// 停用插件：先杀进程（释放 stdio 与宿主 session），再把开关落盘。
#[tauri::command]
pub async fn plugins_disable(
    state: State<'_, PluginsState>,
    id: String,
) -> Result<(), String> {
    stop_plugin(&state.running, &id).await;
    let root = state.root();
    let mut registry = PluginRegistry::load(&root)?;
    registry.set_enabled(&id, false)?;
    registry.save(&root)
}

/// 卸载插件：停进程 → 删注册表 → 删插件目录 → 按需删私有数据。
#[tauri::command]
pub async fn plugins_uninstall(
    state: State<'_, PluginsState>,
    id: String,
    delete_data: bool,
) -> Result<(), String> {
    // id 会直接拼成磁盘路径。注册表加载时虽然校验过，但命令参数来自前端，
    // 不能拿一个没经过注册表的任意字符串去 remove_dir_all。
    if !manifest::is_valid_id(&id) {
        return Err(format!("非法插件 id：{id}"));
    }

    stop_plugin(&state.running, &id).await;

    let root = state.root();
    let mut registry = PluginRegistry::load(&root)?;
    registry.remove(&id);
    registry.save(&root)?;

    let dir = paths::plugin_dir(&root, &id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("删除插件目录失败：{e}"))?;
    }
    if delete_data {
        let data_dir = paths::plugin_data_dir(&root, &id);
        if data_dir.exists() {
            std::fs::remove_dir_all(&data_dir)
                .map_err(|e| format!("删除插件数据目录失败：{e}"))?;
        }
    }
    Ok(())
}

/// 列出运行中插件由 tools/list 报出的工具，供前端注入工具面板。
#[tauri::command]
pub async fn plugins_tools(
    state: State<'_, PluginsState>,
) -> Result<Vec<PluginToolDescriptor>, String> {
    let mut tools = Vec::new();
    {
        let running = state.running.lock().await;
        for handle in running.values() {
            for decl in &handle.tools {
                tools.push(describe_tool(&handle.plugin_id, decl));
            }
        }
    }
    // HashMap 顺序不稳定；排序避免界面每次刷新都跳顺序。
    tools.sort_by(|a, b| {
        a.plugin_id
            .cmp(&b.plugin_id)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(tools)
}

/// 调用运行中插件的一个工具，返回拼接后的文本结果。
///
/// 整个「写请求 → 读响应」周期独占该插件的 stdio（io 锁），否则并发调用会把
/// 响应串台。超时 30 秒，避免一个卡死的插件永久占住命令。
#[tauri::command]
pub async fn plugins_invoke_tool(
    state: State<'_, PluginsState>,
    plugin_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<String, String> {
    let mut running = state.running.lock().await;
    let handle = running
        .get_mut(&plugin_id)
        .ok_or_else(|| format!("插件 {plugin_id} 未运行"))?;

    let io = handle.io.clone();
    let _io_guard = io.lock().await;

    match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        invoke_tool_on(handle, &tool_name, &arguments),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(format!(
            "插件 {plugin_id} 的工具 {tool_name} 在 30 秒内未返回结果"
        )),
    }
}

/// 停掉所有运行中的插件。App 退出时会自动调用；这个命令是备用入口
/// （例如前端在重启插件系统前主动清场），正常退出不依赖它。
#[tauri::command]
pub async fn plugins_shutdown_all(state: State<'_, PluginsState>) -> Result<(), String> {
    shutdown_all(&state).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::mcp_bridge::PluginToolDecl;
    use crate::plugins::registry::{RegistryEntry, SourceRecord};
    use serde_json::json;
    use std::path::{Path, PathBuf};

    fn sample_entry(id: &str) -> RegistryEntry {
        RegistryEntry {
            id: id.to_string(),
            version: "1.2.0".to_string(),
            enabled: true,
            granted_permissions: vec!["fs:project-read".to_string()],
            source: SourceRecord {
                repo: "https://github.com/owner/repo".to_string(),
                git_ref: "main".to_string(),
                commit: "main".to_string(),
                zip_sha256: "0".repeat(64),
                installed_at: "2026-01-01T00:00:00Z".to_string(),
            },
        }
    }

    /// 临时插件根目录；Drop 时清掉，避免测试在 %TEMP% 下越积越多。
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "qmai-plugins-cmd-{tag}-{}",
                uuid::Uuid::new_v4()
            ));
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

    /// 写一个最小可解析的插件目录。`entry_source` 为 Some 时写入 runtime.entry 指向的脚本。
    fn write_plugin(
        root: &Path,
        id: &str,
        manifest: &str,
        entry_source: Option<(&str, &str)>,
    ) -> PathBuf {
        let dir = paths::plugin_dir(root, id);
        std::fs::create_dir_all(&dir).expect("创建插件目录");
        std::fs::write(dir.join("plugin.json"), manifest).expect("写 plugin.json");
        if let Some((name, source)) = entry_source {
            std::fs::write(dir.join(name), source).expect("写插件入口");
        }
        dir
    }

    #[test]
    fn summary_from_entry_exposes_the_frontend_contract() {
        let entry = sample_entry("chapter-insights");
        let summary = summary_from_entry(
            &entry,
            "章节洞察".to_string(),
            "分析章节节奏".to_string(),
            "running",
            3,
        );

        assert_eq!(summary.id, "chapter-insights");
        assert_eq!(summary.name, "章节洞察");
        assert_eq!(summary.description, "分析章节节奏");
        assert_eq!(summary.version, "1.2.0");
        assert!(summary.enabled);
        assert_eq!(summary.process_state, "running");
        assert_eq!(summary.tool_count, 3);
        assert_eq!(summary.granted_permissions, vec!["fs:project-read"]);
        assert_eq!(summary.source_repo, "https://github.com/owner/repo");
        assert_eq!(summary.source_commit, "main");

        // 前端 TS 按 camelCase 消费；漏 rename_all 时字段会变成 snake_case。
        let value = serde_json::to_value(&summary).expect("summary 可序列化");
        assert_eq!(value["processState"], "running");
        assert_eq!(value["grantedPermissions"][0], "fs:project-read");
        assert_eq!(value["toolCount"], 3);
        assert_eq!(value["sourceRepo"], "https://github.com/owner/repo");
        assert_eq!(value["sourceCommit"], "main");
        assert!(value.get("process_state").is_none());
    }

    #[test]
    fn permission_validation_accepts_known_and_auto_granted_only() {
        assert!(validate_granted_permissions(&permissions(&[
            "fs:project-read",
            "fs:project-write",
            "net:https",
            "llm:use",
            "data:write",
        ]))
        .is_ok());

        let err = validate_granted_permissions(&permissions(&["ui:panel"])).unwrap_err();
        assert!(err.contains("ui:panel"), "错误消息应指出具体权限：{err}");
    }

    #[tokio::test]
    async fn rpc_response_reader_skips_noise_and_stale_ids() {
        let raw = concat!(
            "this is a debug line, not json\n",
            "\n",
            r#"{"jsonrpc":"2.0","method":"notifications/progress"}"#,
            "\n",
            // 上一条超时请求迟到的响应：id 不匹配，必须跳过，不能被当成当前调用结果。
            r#"{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"stale"}]}}"#,
            "\n",
            r#"{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"fresh"}]}}"#,
            "\n",
        );
        let (mut writer, reader) = tokio::io::duplex(4096);
        writer.write_all(raw.as_bytes()).await.expect("写入测试流");
        drop(writer);

        let mut lines = tokio::io::BufReader::new(reader).lines();
        let message = read_rpc_response(&mut lines, 3, "tools/call")
            .await
            .expect("应读到 id=3 的响应");
        assert_eq!(
            message.id.as_ref().and_then(serde_json::Value::as_u64),
            Some(3)
        );
        assert_eq!(message.into_tool_call().expect("解析内容"), "fresh");
    }

    #[tokio::test]
    async fn rpc_response_reader_reports_closed_stdout() {
        let (writer, reader) = tokio::io::duplex(64);
        drop(writer);
        let mut lines = tokio::io::BufReader::new(reader).lines();
        let error = read_rpc_response(&mut lines, 1, "握手")
            .await
            .expect_err("stdout 关闭时必须立即报错，不能永久等待");
        assert!(error.contains("关闭了 stdout"), "错误应说明 EOF：{error}");
    }

    #[test]
    fn tool_descriptor_passes_the_original_schema_through() {
        let decl = PluginToolDecl {
            name: "analyze".to_string(),
            description: "分析章节".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": { "chapterPath": { "type": "string" } },
            }),
        };
        let descriptor = describe_tool("chapter-insights", &decl);
        assert_eq!(descriptor.plugin_id, "chapter-insights");
        assert_eq!(descriptor.name, "analyze");
        assert_eq!(descriptor.description, "分析章节");
        assert_eq!(descriptor.parameters, decl.input_schema);

        let value = serde_json::to_value(&descriptor).expect("descriptor 可序列化");
        assert_eq!(value["pluginId"], "chapter-insights");
        assert_eq!(value["parameters"]["properties"]["chapterPath"]["type"], "string");
        assert!(value.get("plugin_id").is_none());
    }

    fn permissions(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn node_available() -> bool {
        std::process::Command::new("node")
            .arg("--version")
            .output()
            .is_ok()
    }

    /// 用 binary 类型 + 不存在的入口：spawn 必然失败，用来验证「失败后不留半成品」。
    /// 选 binary 而不是 node，是为了让这条用例不依赖测试机装了 Node。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_plugin_cleans_up_when_binary_entry_is_missing() {
        let root = TempRoot::new("missing-binary");
        let id = "binary-fail";
        let manifest = format!(
            r#"{{
                "schema": 1,
                "id": "{id}",
                "name": "失败插件",
                "version": "1.0.0",
                "runtime": {{ "type": "binary", "entry": "missing-entry.exe", "startTimeoutMs": 1000 }}
            }}"#
        );
        write_plugin(root.path(), id, &manifest, None);
        let entry = sample_entry(id);

        let state = PluginsState::default();
        // 用假端口避免测试真的起一个宿主 API 服务；本用例在 spawn 阶段就失败，不会访问它。
        *state.host_port.lock().expect("端口状态") = Some(1);

        let error = start_plugin(root.path(), &state.running, &state.host_port, &entry)
            .await
            .expect_err("入口不存在时必须启动失败");

        assert!(
            error.contains("启动插件进程失败"),
            "错误应指出 spawn 失败，实际：{error}"
        );
        assert!(
            state.running.lock().await.is_empty(),
            "失败的插件不能留在 running 表里"
        );
        // session 是在 spawn 之前建的；失败路径必须注销，否则插件目录删了 token 仍然有效。
        assert_eq!(
            host_api::sessions_for_plugin(id),
            0,
            "失败后必须注销该插件的宿主 API session"
        );
    }

    /// Node 立刻退出：验证「进程起来了但握手前关闭 stdout」也能清干净。
    /// 机器没有 Node 时降级为跳过（仓库其它 node 相关用例也遵循这个约定）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_plugin_cleans_up_when_plugin_exits_before_handshake() {
        if !node_available() {
            eprintln!("跳过：本机没有可执行的 node");
            return;
        }

        let root = TempRoot::new("node-exit");
        let id = "node-exit";
        let manifest = format!(
            r#"{{
                "schema": 1,
                "id": "{id}",
                "name": "秒退插件",
                "version": "1.0.0",
                "runtime": {{ "type": "node", "entry": "exit.js", "startTimeoutMs": 5000 }}
            }}"#
        );
        write_plugin(
            root.path(),
            id,
            &manifest,
            Some(("exit.js", "process.exit(0);\n")),
        );
        let entry = sample_entry(id);

        let state = PluginsState::default();
        *state.host_port.lock().expect("端口状态") = Some(1);

        let error = start_plugin(root.path(), &state.running, &state.host_port, &entry)
            .await
            .expect_err("插件在握手前退出时必须报错");

        // 正常情况下是 stdout 先 EOF（握手失败）；机器负载很高时可能在 Node
        // 启动完成前就撞上 startTimeoutMs。两种都属于「启动失败」，都要清干净。
        assert!(
            error.contains("握手失败") || error.contains("未完成握手"),
            "错误应指出启动/握手阶段失败，实际：{error}"
        );
        assert!(
            state.running.lock().await.is_empty(),
            "握手失败的插件不能留在 running 表里"
        );
        assert_eq!(
            host_api::sessions_for_plugin(id),
            0,
            "握手失败后必须注销该插件的宿主 API session"
        );
    }

    /// 真实 Node 进程跑完整生命周期：握手 → tools/list → tools/call → 停用。
    /// 这不是 mock 进程；没有 Node 时跳过，和上一条失败路径的降级策略一致。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_invoke_and_stop_a_real_plugin_process() {
        if !node_available() {
            eprintln!("跳过：本机没有可执行的 node");
            return;
        }

        const SERVER: &str = r#"
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.method === "initialize") {
    console.log(JSON.stringify({
      jsonrpc: "2.0", id: req.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } }
    }));
  } else if (req.method === "tools/list") {
    console.log(JSON.stringify({
      jsonrpc: "2.0", id: req.id,
      result: { tools: [{
        name: "echo", description: "回声",
        inputSchema: { type: "object", properties: { text: { type: "string" } } }
      }] }
    }));
  } else if (req.method === "tools/call") {
    console.log(JSON.stringify({
      jsonrpc: "2.0", id: req.id,
      result: { content: [{ type: "text", text: String(req.params.arguments.text) }] }
    }));
  }
});
"#;

        let root = TempRoot::new("node-echo");
        let id = "node-echo";
        let manifest = format!(
            r#"{{
                "schema": 1,
                "id": "{id}",
                "name": "回声插件",
                "version": "1.0.0",
                "runtime": {{ "type": "node", "entry": "server.js", "startTimeoutMs": 5000 }}
            }}"#
        );
        write_plugin(root.path(), id, &manifest, Some(("server.js", SERVER)));
        let entry = sample_entry(id);

        let state = PluginsState::default();
        *state.host_port.lock().expect("端口状态") = Some(1);

        start_plugin(root.path(), &state.running, &state.host_port, &entry)
            .await
            .expect("真实 Node 插件应完成握手");

        {
            let mut running = state.running.lock().await;
            let handle = running.get_mut(id).expect("启动后应有运行句柄");
            assert_eq!(handle.tools.len(), 1);
            assert_eq!(handle.tools[0].name, "echo");

            let io = handle.io.clone();
            let _guard = io.lock().await;
            let result = invoke_tool_on(handle, "echo", &json!({ "text": "你好" }))
                .await
                .expect("tools/call 应返回文本");
            assert_eq!(result, "你好");
        }

        stop_plugin(&state.running, id).await;
        assert!(
            state.running.lock().await.is_empty(),
            "停用后 running 表必须为空"
        );
        assert_eq!(
            host_api::sessions_for_plugin(id),
            0,
            "停用后宿主 API session 必须注销"
        );
    }

    /// 启动时自动拉起：注册表为空是首次启动的正常状态，必须成功返回而不是报错。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn autostart_all_returns_ok_for_an_empty_registry() {
        let root = TempRoot::new("autostart-empty");
        let state = PluginsState::default();

        autostart_all(&state, root.path())
            .await
            .expect("空注册表不应报错");

        assert!(
            state.running.lock().await.is_empty(),
            "没有已启用插件时不应有任何运行句柄"
        );
        // 没有插件要启动，就不该顺手把宿主 API 服务起起来。
        assert!(
            state.host_port.lock().expect("端口状态").is_none(),
            "空注册表不应启动宿主 API"
        );
    }

    /// 已启用但磁盘上缺清单（用户手工删过目录、拷贝不完整）：单条失败只记日志，
    /// 不能阻断启动，也不能把注册表里的 enabled 悄悄改成 false。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn autostart_all_keeps_going_and_keeps_enabled_when_one_plugin_fails() {
        let root = TempRoot::new("autostart-broken");
        let mut registry = PluginRegistry::load(root.path()).expect("空注册表可加载");
        // sample_entry 的 enabled 是 true，但这里不写插件目录 → start_plugin 读清单失败
        registry.upsert(sample_entry("ghost-plugin"));
        let mut off = sample_entry("off-plugin");
        off.enabled = false;
        registry.upsert(off);
        registry.save(root.path()).expect("保存注册表");

        let state = PluginsState::default();
        autostart_all(&state, root.path())
            .await
            .expect("单个插件启动失败不能阻断启动");

        assert!(
            state.running.lock().await.is_empty(),
            "启动失败的插件不能留在 running 表里"
        );
        let after = PluginRegistry::load(root.path()).expect("重新加载注册表");
        assert!(
            after.get("ghost-plugin").expect("条目仍在").enabled,
            "启动失败不能悄悄把 enabled 改成 false"
        );
        assert_eq!(
            host_api::sessions_for_plugin("ghost-plugin"),
            0,
            "启动失败的插件不能留下宿主 API session"
        );
    }

    /// stderr 必须被持续排空：否则管道写满后插件会阻塞在写日志上，握手永远等不到。
    /// 用真实 Node 进程先往 stderr 灌约 256KB（远超 Windows 管道缓冲区），再正常应答握手。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_plugin_drains_stderr_while_the_plugin_keeps_logging() {
        if !node_available() {
            eprintln!("跳过：本机没有可执行的 node");
            return;
        }

        const SERVER: &str = r#"
const fs = require("fs");
const readline = require("readline");

// 先把 stderr 灌到远超管道缓冲区：没人排空时 writeSync 会一直阻塞，
// 下面的 readline 永远注册不上，宿主只能等到握手超时。
const chunk = "x".repeat(8192) + "\n";
for (let i = 0; i < 32; i++) fs.writeSync(2, chunk);

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.method === "initialize") {
    console.log(JSON.stringify({
      jsonrpc: "2.0", id: req.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } }
    }));
  } else if (req.method === "tools/list") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { tools: [] } }));
  }
});
"#;

        let root = TempRoot::new("node-stderr");
        let id = "node-stderr";
        let manifest = format!(
            r#"{{
                "schema": 1,
                "id": "{id}",
                "name": "话痨插件",
                "version": "1.0.0",
                "runtime": {{ "type": "node", "entry": "chatty.js", "startTimeoutMs": 5000 }}
            }}"#
        );
        write_plugin(root.path(), id, &manifest, Some(("chatty.js", SERVER)));
        let entry = sample_entry(id);

        let state = PluginsState::default();
        *state.host_port.lock().expect("端口状态") = Some(1);

        start_plugin(root.path(), &state.running, &state.host_port, &entry)
            .await
            .expect("插件持续写 stderr 时握手仍应成功");

        {
            let running = state.running.lock().await;
            let handle = running.get(id).expect("启动后应有运行句柄");
            assert!(handle.tools.is_empty());
        }
        stop_plugin(&state.running, id).await;
    }
}
