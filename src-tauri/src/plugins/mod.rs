//! 开放插件系统：清单、注册表、进程监管、宿主能力面、安装器。
//!
//! 插件 = 一个常驻子进程 + 一个 plugin.json。通信走 stdio JSON-RPC（MCP），
//! 插件反调宿主能力走本机回环 HTTP（按 permissions 拦截）。
//! 设计见 docs/superpowers/specs/2026-10-27-开放插件系统-design.md

// manifest::* 在任务 3+ 被 registry / mcp_bridge / installer 消费；在此之前
// dead_code 警告是预期状态，不要用 #[allow(dead_code)] 掩盖它。
pub mod config;
pub mod content;
pub mod host_api;
pub mod installer;
pub mod manifest;
pub mod mcp_bridge;
pub mod paths;
pub mod providers;
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
    /// 插件提供的 provider（providerId → 登记）。token 只在这里，从不落盘。
    pub providers: Arc<AsyncMutex<HashMap<String, providers::PluginProvider>>>,
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
    /// 清单里声明的 provider id（`contributes.providers[].id`）。
    ///
    /// 前端启用确认层靠它区分「工具插件」与「provider 插件」：后者的文案是
    /// 设计 §7 那段高危提示（它会看到用户与模型的完整对话）。
    /// 读不到清单就是空 vec —— 管理页仍要能列出并操作损坏的插件。
    pub provider_ids: Vec<String>,
    /// 清单里的静态声明面（`preview`，设计 §8）。
    ///
    /// 只用于**展示**：让插件中心/插槽在不启动插件进程的前提下就有东西可渲染。
    /// 调用真源仍是运行期（`tools/list`、`/v1/models`），两边不一致时以运行期为准。
    pub preview: Option<serde_json::Value>,
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
        // 由 `plugins_list` 单独补齐（它才知道插件目录在哪）；这里给空 vec 保证
        // 结构体没有「未初始化」的分支。
        provider_ids: Vec::new(),
        // 同上：静态声明面只有 `plugins_list` 读得到清单，装/启停路径给 None。
        preview: None,
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

/// 读插件清单里声明的 provider id（`contributes.providers[].id`）。
///
/// 前端拿不到「这个插件是不是 provider 插件」就无法在启用时给高危确认（设计 §7），
/// 而清单只存在于 Rust 侧磁盘上，所以由这里补进 `PluginSummary`。
/// 读不到/清单损坏一律返回空 vec：管理页仍要能列出并操作损坏的插件。
fn manifest_provider_ids(dir: &Path) -> Vec<String> {
    let Ok(raw) = std::fs::read_to_string(dir.join("plugin.json")) else {
        return Vec::new();
    };
    match manifest::PluginManifest::parse(&raw) {
        Ok(parsed) => parsed
            .contributes
            .providers
            .into_iter()
            .map(|provider| provider.id)
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// 读清单里的静态声明面（`preview`，设计 §8）。
///
/// 用途仅限展示：插件中心要在**不启动进程**的前提下画出「这个插件提供哪些动作/灵感包」。
/// 读不到/清单损坏一律 `None` —— 管理页仍要能列出并操作损坏的插件。
fn manifest_preview(dir: &Path) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(dir.join("plugin.json")).ok()?;
    manifest::PluginManifest::parse(&raw).ok()?.preview
}

/// 读一个**已安装**插件目录里的清单。目录缺失、清单损坏都返回 `None`。
fn installed_manifest(root: &Path, plugin_id: &str) -> Option<manifest::PluginManifest> {
    let raw =
        std::fs::read_to_string(paths::plugin_dir(root, plugin_id).join("plugin.json")).ok()?;
    manifest::PluginManifest::parse(&raw).ok()
}

/// 检查 provider id 是否已被别的插件占用。
///
/// 模型复合键是 `providerId/modelId` —— 两个插件占用同一个 `providerId` 时，
/// 用户在选择器里无法分辨自己的数据流向了谁（设计 4.2 / D1）。
/// 清单校验（`manifest.rs`）只能看到自己那一份，查不到「别的已安装插件」，
/// 所以这一条只能在安装/启用时按注册表比对。
///
/// 别人的清单读不到（目录被手工删了、清单写坏了）就跳过那个插件：
/// 不能因为别人坏了，让用户装不上/启用不了新的。
fn ensure_provider_ids_free(
    root: &Path,
    self_id: &str,
    manifest: &manifest::PluginManifest,
) -> Result<(), String> {
    let ours = &manifest.contributes.providers;
    if ours.is_empty() {
        return Ok(());
    }
    let registry = PluginRegistry::load(root)?;
    for other in registry.list() {
        if other.id == self_id {
            continue;
        }
        let Some(other_manifest) = installed_manifest(root, &other.id) else {
            continue;
        };
        for provider in &other_manifest.contributes.providers {
            if ours.iter().any(|mine| mine.id == provider.id) {
                return Err(format!(
                    "provider id {} 已被插件 {} 占用",
                    provider.id, other.id
                ));
            }
        }
    }
    Ok(())
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
///
/// 清单声明了 `contributes.providers`（schema 2）时，额外在 spawn 前分配 provider 端口、
/// 生成 provider 令牌，并在握手成功后探活 + 抓模型，登记进 `state.providers`。
/// v1 插件（没有 providers）走的是和以前完全一样的路径。
async fn start_plugin(
    root: &Path,
    state: &PluginsState,
    entry: &RegistryEntry,
) -> Result<(), String> {
    let running = &state.running;
    let host_port = &state.host_port;
    if running.lock().await.contains_key(&entry.id) {
        return Ok(()); // 已在跑
    }

    let dir = paths::plugin_dir(root, &entry.id);
    let raw = std::fs::read_to_string(dir.join("plugin.json"))
        .map_err(|e| format!("读取清单失败：{e}"))?;
    let manifest = manifest::PluginManifest::parse(&raw)
        .map_err(|e| format!("清单校验失败 {}：{}", e.code(), e.detail))?;

    // 清单声明了 providers 才走这套；没声明就完全跳过（v1 插件零影响）。
    // 端口先 bind 0 拿号、再立刻释放交给插件去绑（设计 D4：只允许宿主分配，
    // 避免固定端口被用户本机已有的 Agent2API 之类服务抢占）。
    // v2.0 只接第一条声明：一个插件的端口/令牌是一对，多 provider 端口隔离留给后续版本。
    if manifest.contributes.providers.len() > 1 {
        eprintln!(
            "[plugins] {} 声明了 {} 个 provider，v2.0 只启用第一个",
            entry.id,
            manifest.contributes.providers.len()
        );
    }
    let provider_decl = manifest.contributes.providers.first().cloned();
    let provider_port = match &provider_decl {
        Some(_) => Some(providers::allocate_port()?),
        None => None,
    };
    let provider_token = provider_decl
        .as_ref()
        .map(|_| uuid::Uuid::new_v4().to_string());

    // 配置注入（设计 §6.3）：QMAI_CONFIG 与 QMAI_HOST_* 同一批 env —— 插件在 initialize
    // 之前就能读到自己的配置，不用在协议里多传一份可能被日志记下来的字段。
    // 必须在这里现取而不是缓存：密钥真值只在内存里，盘上只有占位符。
    // 配置读不出来就拒绝启动（与清单损坏同样处理）：带着「默认配置」静默跑起来，
    // 用户会以为自己的设置生效了，实际全是另一套参数。
    let config_json = config::config_env_json(root, &entry.id)?;

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
        ("QMAI_CONFIG", config_json.as_str()),
    ] {
        cmd.env(key, value);
    }
    // provider 的端口与令牌走环境变量（不改 initialize 的签名）：插件在 initialize
    // 之前就能读到，也不用在协议里多传一份可能被日志记下来的字段。
    // 令牌与 hostToken 同构：每插件随机、只存内存；插件必须校验它，否则本机任何
    // 进程都能白嫖它（进而白嫖用户账号额度）。
    if let (Some(port), Some(provider_token)) = (provider_port, provider_token.as_deref()) {
        cmd.env("QMAI_PROVIDER_PORT", port.to_string());
        cmd.env("QMAI_PROVIDER_TOKEN", provider_token);
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

            // provider 探活 + 抓模型。**放在这里、不握 running 锁**：探活最多等一个
            // startTimeoutMs，握着表锁做网络 IO 会把其它插件的启停全堵住。
            //
            // 探活/抓模型失败**不杀进程、也不让启动失败**：插件可能同时提供工具，
            // provider 只是它的一部分能力。失败只记进 last_error、ready=false，
            // 让界面灰显并给出原因（设计 6.3：失败不隐藏）。
            let provider = match (provider_decl, provider_port, provider_token) {
                (Some(decl), Some(port), Some(token)) => {
                    Some(register_provider(&manifest, &decl, port, token).await)
                }
                _ => None,
            };

            // 初始检查与这里之间可能有另一个并发 enable。插入前再查一次：
            // 已有句柄时停掉刚起的这一个，避免两个进程抢同一个 pluginId。
            let mut guard = running.lock().await;
            if guard.contains_key(&entry.id) {
                drop(guard);
                handle.stop().await;
                host_api::unregister_session(&token);
                return Ok(());
            }
            // 先登记 provider 再放句柄：反过来会留下「进程已在跑、前端却查不到 provider」
            // 的窗口。两个表都是短锁，且全仓只有「先 running 后 providers」这一个嵌套顺序
            // （stop/uninstall 都是先放 running 锁再清 providers），不会互等。
            if let Some(provider) = provider {
                state
                    .providers
                    .lock()
                    .await
                    .insert(provider.provider_id.clone(), provider);
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

/// 探活 + 抓模型，组装一条 provider 登记。
///
/// **任何失败都不抛出**：这里是「插件已经连握手都通过了」之后的一步，provider 只是
/// 插件能力的一部分（它还可能提供工具）。失败写成 `ready=false` + `last_error`，
/// 让界面灰显并给出原因，而不是把整个插件判成启动失败。
async fn register_provider(
    manifest: &manifest::PluginManifest,
    decl: &manifest::ProviderDecl,
    port: u16,
    token: String,
) -> providers::PluginProvider {
    let mut provider = providers::PluginProvider {
        plugin_id: manifest.id.clone(),
        provider_id: decl.id.clone(),
        name: decl.name.clone(),
        base_url: format!("http://127.0.0.1:{port}"),
        token,
        capabilities: decl.capabilities.clone(),
        settings_page: decl.settings_page_path.clone(),
        auth_kind: providers::auth_kind_name(decl.auth_kind).to_string(),
        models: Vec::new(),
        ready: false,
        last_error: None,
    };

    // 一个 client 复用到探活与抓模型：超时策略只有一处。60s 是探活/抓取的粗上限，
    // 真正的探活预算由下面按 startTimeoutMs 收紧。
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            provider.last_error = Some(format!("构造 HTTP client 失败：{error}"));
            return provider;
        }
    };

    let timeout = std::time::Duration::from_millis(manifest.runtime.start_timeout_ms);
    if let Err(error) = providers::wait_until_healthy(&client, &provider.base_url, timeout).await {
        provider.last_error = Some(error);
        return provider;
    }
    match providers::fetch_models(&client, &provider.base_url, &provider.token).await {
        Ok(models) => {
            provider.models = models;
            provider.ready = true;
        }
        Err(error) => {
            provider.last_error = Some(format!("抓取模型列表失败：{error}"));
        }
    }
    provider
}

/// 从登记表里移除某个插件的全部 provider（按 `plugin_id` 匹配）。
///
/// 与插件进程同生共死：token 随条目一起被丢弃，否则停用后前端还能现取到一个
/// 已经没用的令牌，模型列表也还留着这一组。
async fn drop_plugin_providers(
    provider_list: &Arc<AsyncMutex<HashMap<String, providers::PluginProvider>>>,
    plugin_id: &str,
) {
    provider_list
        .lock()
        .await
        .retain(|_, provider| provider.plugin_id != plugin_id);
}

/// 停止并移除一个运行中的插件。**先 remove 再 stop**：`stop()` 里要等子进程
/// 退出（最多 1 秒），不能在持着 running 表锁时 await。
async fn stop_plugin(state: &PluginsState, id: &str) {
    if let Some(handle) = state.running.lock().await.remove(id) {
        let token = handle.token.clone();
        handle.stop().await;
        // 进程没了，旧 token 必须立刻失效，否则残留的插件请求还能反调宿主。
        host_api::unregister_session(&token);
    }
    drop_plugin_providers(&state.providers, id).await;
    // 内容包缓存与插件同生共死（设计 §4 / D4）：内容随包分发、安装后不变，所以只在
    // 「不再信任这份内容」时清 —— 停用与卸载都走这里（卸载先调 stop_plugin 再删目录）。
    // 不清的话，已被删除的灵感库还能从内存里被读出来。
    content::invalidate(id);
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
        if let Err(error) = start_plugin(root, state, &entry).await {
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
    // 进程全停了，provider 登记也必须一起清：留着的条目会指向已经不存在的端点，
    // 界面重启后仍能查到一组永远连不上的 provider。
    state.providers.lock().await.clear();
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
    let base: Vec<(
        RegistryEntry,
        String,
        String,
        Vec<String>,
        Option<serde_json::Value>,
    )> = registry
        .list()
        .into_iter()
        .map(|entry| {
            let dir = paths::plugin_dir(&root, &entry.id);
            let (name, description) = manifest_display(&dir);
            // provider id 只有清单里有，前端没有别的途径知道「是不是 provider 插件」。
            let provider_ids = manifest_provider_ids(&dir);
            // 静态声明面（设计 §8）：只读清单，不启动插件就能渲染插件中心与插槽。
            let preview = manifest_preview(&dir);
            (entry, name, description, provider_ids, preview)
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
        .map(|(entry, name, description, provider_ids, preview)| {
            let (process_state, tool_count) =
                states.get(&entry.id).copied().unwrap_or(("stopped", 0));
            let mut summary =
                summary_from_entry(&entry, name, description, process_state, tool_count);
            summary.provider_ids = provider_ids;
            summary.preview = preview;
            summary
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

    // provider id 必须全局唯一，而清单校验看不到别的插件。冲突就回滚已发布的目录：
    // 装上一个永远抢不到 id 的插件，比装不上更糟（用户会以为它已经生效）。
    if let Some(manifest) = installed_manifest(&root, &outcome.plugin_id) {
        if let Err(error) = ensure_provider_ids_free(&root, &outcome.plugin_id, &manifest) {
            let _ = std::fs::remove_dir_all(&outcome.target);
            return Err(error);
        }
    }

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

/// 从本地目录安装插件：插件作者的开发闭环，也是验收时的手工测试入口。
///
/// 与 `plugins_install` 同一套编排（读注册表 → 装目录 → provider id 冲突检查 →
/// 写注册表 → 失败回滚已发布目录），区别只在「来源」：本地路径不做下载，
/// 注册表里记 `local:<绝对路径>` 以便日后追查这个插件是从哪台机器的哪个目录装来的。
#[tauri::command]
pub async fn plugins_install_local(
    state: State<'_, PluginsState>,
    path: String,
) -> Result<PluginSummary, String> {
    let root = state.root();
    // 与 plugins_install 同理：先读注册表再发布目录，读不出来就直接失败，
    // 不留一个装了但注册表里没有的孤儿目录
    let mut registry = PluginRegistry::load(&root)?;
    let outcome = installer::install_local(&root, std::path::Path::new(&path))?;

    // provider id 必须全局唯一（模型复合键是 providerId/modelId），清单校验看不到
    // 别的插件，所以装完必须按注册表再查一次；冲突就回滚目录，别留一个抢不到 id 的插件。
    if let Some(manifest) = installed_manifest(&root, &outcome.plugin_id) {
        if let Err(error) = ensure_provider_ids_free(&root, &outcome.plugin_id, &manifest) {
            let _ = std::fs::remove_dir_all(&outcome.target);
            return Err(error);
        }
    }

    let (name, description) = manifest_display(&paths::plugin_dir(&root, &outcome.plugin_id));

    let entry = RegistryEntry {
        id: outcome.plugin_id.clone(),
        version: outcome.version.clone(),
        enabled: false,
        granted_permissions: vec![],
        source: SourceRecord {
            repo: format!("local:{path}"),
            git_ref: outcome.git_ref.clone(),
            // 本地目录没有 commit 可记，与 GitHub 安装一样先填 git_ref（"local"），
            // 溯源依赖 repo 里的绝对路径 + 目录内容的实际形态。
            commit: outcome.git_ref,
            zip_sha256: outcome.zip_sha256,
            installed_at: chrono::Utc::now().to_rfc3339(),
        },
    };
    let summary = summary_from_entry(&entry, name, description, "stopped", 0);

    registry.upsert(entry);
    if let Err(e) = registry.save(&root) {
        // 注册表写失败 → 回滚目录，否则用户既看不见、也卸不掉这个插件
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

    // 启用时再查一次 provider id：安装时互不知情的两个插件，可能在对方之后才被装上；
    // 真正会让两个 provider 同时出现在模型列表里的时刻是「启用」，所以这里才是最后一道闸。
    if let Some(manifest) = installed_manifest(&root, &id) {
        ensure_provider_ids_free(&root, &id, &manifest)?;
    }

    entry.enabled = true;
    entry.granted_permissions = granted;
    registry.upsert(entry.clone());
    registry.save(&root)?;

    start_plugin(&root, state.inner(), &entry).await?;
    Ok(())
}

/// 停用插件：先杀进程（释放 stdio 与宿主 session），再把开关落盘。
#[tauri::command]
pub async fn plugins_disable(
    state: State<'_, PluginsState>,
    id: String,
) -> Result<(), String> {
    stop_plugin(state.inner(), &id).await;
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

    stop_plugin(state.inner(), &id).await;

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

/// 列出插件提供的 provider（**不含 token**，见 `providers::ProviderView`）。
#[tauri::command]
pub async fn plugins_providers(
    state: State<'_, PluginsState>,
) -> Result<Vec<providers::ProviderView>, String> {
    let providers = state.providers.lock().await;
    let mut views: Vec<providers::ProviderView> = providers
        .values()
        .map(providers::PluginProvider::view)
        .collect();
    // HashMap 顺序不稳定；排序避免界面每次刷新都跳顺序（与 plugins_tools 同理）。
    views.sort_by(|a, b| a.provider_id.cmp(&b.provider_id));
    Ok(views)
}

/// 现取 provider token（前端发请求前调用）。
///
/// **只走内存、绝不落盘**：计划第 0 节要求请求前现取，而不是把它写进
/// `providerConfigs[providerId].apiKey`（那会被 `project-store` 持久化）。
#[tauri::command]
pub async fn plugins_provider_auth(
    state: State<'_, PluginsState>,
    provider_id: String,
) -> Result<String, String> {
    let providers = state.providers.lock().await;
    providers
        .get(&provider_id)
        .map(|provider| provider.token.clone())
        .ok_or_else(|| format!("provider {provider_id} 未就绪"))
}

/// 「刷新模型」按钮触发的探活预算。
///
/// 不能用 `startTimeoutMs`：那是启动时给插件的宽限（默认 10s，provider 插件常配 15s），
/// 而这里是用户点了一下按钮在等 —— 一个已经死掉的插件不该把按钮按住十几秒。
/// 5s 对「本机回环 + 插件自己早就起来了」已经足够宽松。
const PROVIDER_REFRESH_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// 重新抓一次模型列表（界面的「刷新模型」按钮）。
#[tauri::command]
pub async fn plugins_provider_refresh_models(
    state: State<'_, PluginsState>,
    provider_id: String,
) -> Result<Vec<providers::ProviderModel>, String> {
    refresh_provider_models(state.inner(), &provider_id, PROVIDER_REFRESH_PROBE_TIMEOUT).await
}

// ── 插件配置（设计 §6.3）──────────────────────────────
//
// 四条命令都先过 `require_manifest`：pluginId 会拼成磁盘路径，而且「未安装的插件」
// 不该能读出/写入任何配置（否则一个笔误的 id 就悄悄建出一条配置记录）。
//
// 写命令的落盘失败语义：`set` / `set_secret` 先改内存再 `save`，落盘失败会把错误
// 抛给界面，但内存里已是新值（下一次成功的 save 会补写）。这里刻意不做内存回滚 ——
// 密钥真值本来就不落盘，回滚反而会让用户刚设好的密钥凭空消失。

/// 配置类命令的入口闸门：id 必须合法、插件必须真的装着。
fn require_manifest(root: &Path, plugin_id: &str) -> Result<manifest::PluginManifest, String> {
    if !manifest::is_valid_id(plugin_id) {
        return Err(format!("非法插件 id：{plugin_id}"));
    }
    installed_manifest(root, plugin_id).ok_or_else(|| format!("插件 {plugin_id} 未安装或清单损坏"))
}

/// 读一个插件的配置。
///
/// 密钥字段一律回 `""`：真值只注入插件进程（`QMAI_CONFIG`），不经界面回传 ——
/// 前端渲染时也不需要真值，只要知道「这个字段存在、要按密码框渲染」。
#[tauri::command]
pub async fn plugins_config_get(
    state: State<'_, PluginsState>,
    plugin_id: String,
) -> Result<serde_json::Value, String> {
    let root = state.root();
    let manifest = require_manifest(&root, &plugin_id)?;
    let schema = manifest
        .config_schema
        .unwrap_or_else(|| serde_json::json!({}));
    let store = config::shared(&root)?;
    let guard = store.lock().map_err(|_| "插件配置状态不可用".to_string())?;
    Ok(guard.get_for_client(&plugin_id, &schema))
}

/// 保存一个插件的配置（按清单里的 `configSchema` 校验后落盘）。
///
/// 没有 `configSchema` 的插件只接受空对象：既不放行任意键（插件读不懂自己没声明的
/// 配置），也不拒绝空表单保存（用户「清空」这个操作必须能成功）。
#[tauri::command]
pub async fn plugins_config_set(
    state: State<'_, PluginsState>,
    plugin_id: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let root = state.root();
    let manifest = require_manifest(&root, &plugin_id)?;
    let declared = manifest.config_schema;
    if declared.is_none()
        && !value
            .as_object()
            .map(|map| map.is_empty())
            .unwrap_or(false)
    {
        return Err("该插件未声明 configSchema，配置只能是空对象 {}".to_string());
    }
    let schema = declared.unwrap_or_else(|| serde_json::json!({}));
    let store = config::shared(&root)?;
    let mut guard = store.lock().map_err(|_| "插件配置状态不可用".to_string())?;
    guard.set(&plugin_id, value, &schema)?;
    guard.save(&root)
}

/// 单独设一个密钥字段。真值只写内存，盘上留占位符（设计 §6.3）。
#[tauri::command]
pub async fn plugins_config_secret_set(
    state: State<'_, PluginsState>,
    plugin_id: String,
    field: String,
    value: String,
) -> Result<(), String> {
    let root = state.root();
    let manifest = require_manifest(&root, &plugin_id)?;
    let schema = manifest
        .config_schema
        .unwrap_or_else(|| serde_json::json!({}));
    let store = config::shared(&root)?;
    let mut guard = store.lock().map_err(|_| "插件配置状态不可用".to_string())?;
    guard.set_secret(&plugin_id, &field, &value, &schema)?;
    guard.save(&root)
}

/// 某个密钥字段是否已在本进程内存里设过。
///
/// 重启后一定是 `false`：密钥不落盘，这条回答的正是「要不要提示用户重填」。
#[tauri::command]
pub async fn plugins_config_secret_has(
    state: State<'_, PluginsState>,
    plugin_id: String,
    field: String,
) -> Result<bool, String> {
    let root = state.root();
    require_manifest(&root, &plugin_id)?;
    let store = config::shared(&root)?;
    let guard = store.lock().map_err(|_| "插件配置状态不可用".to_string())?;
    Ok(guard.has_secret(&plugin_id, &field))
}

// ── 内容包（设计 §4，Tier 1：不启动插件进程）──────────────
//
// 两条命令都**不 spawn 任何进程**（D1）：内容包是磁盘上的 JSON，宿主自己读、自己
// 校验、自己渲染。装 20 个纯灵感包，进程表里应当仍然是 0 条。

/// 列出**已启用**插件的内容包元信息：够画一张卡片与一个筛选项，不含正文。
///
/// 不返回 items 是刻意的：插件中心的列表动辄涉及几十万条素材，一次搬进前端内存
/// 只会让"打开插件中心"变成几百毫秒的卡顿；用户点开哪个包，才去取哪个包的条目。
#[tauri::command]
pub async fn plugins_content_packs(
    state: State<'_, PluginsState>,
) -> Result<Vec<content::ContentPackMeta>, String> {
    Ok(content::list_packs(&state.root()))
}

/// 读一个内容包的全部条目，返回 **JSON 文本**。
///
/// 为什么返回文本而不是已验证的结构体：前端拿到后会用 `parseContentPack` 再校验一次。
/// 两道闸门是刻意的双保险 —— 宿主这道拦住"坏数据进 IPC"，前端那道拦住"界面拿到
/// 不可用的数据"（比如未来的 webview 直接读本地文件）。少了任何一道，另一道就得
/// 独自承担全部规则的演化，最终两边规则分叉、出现"宿主放过、界面报错"的割裂。
#[tauri::command]
pub async fn plugins_content_pack_items(
    state: State<'_, PluginsState>,
    pack_id: String,
) -> Result<String, String> {
    let root = state.root();
    // packId 形如 `<pluginId>/<packId>`（与 `ContentPackMeta.packId` 一致），
    // 拼成一体是为了让前端不必自己拼 key —— 拼错就是一句"找不到内容包"。
    let (plugin_id, inner_id) = match pack_id.split_once('/') {
        Some(parts) => parts,
        None => return Err(format!("内容包 {pack_id} 不存在")),
    };
    // 未安装的插件、或清单里没声明这个包：一律同一句话。
    // 区分两者会把「磁盘上有哪些目录」透给调用方，而调用方的 packId 可能来自任意
    // 输入（例如未来从链接带进来的参数）。
    let decl = if manifest::is_valid_id(plugin_id) {
        installed_manifest(&root, plugin_id).and_then(|manifest| {
            manifest
                .contributes
                .content_packs
                .into_iter()
                .find(|pack| pack.id == inner_id)
        })
    } else {
        None
    };
    let Some(decl) = decl else {
        return Err(format!("内容包 {pack_id} 不存在"));
    };

    let items =
        content::cached_pack_items(&paths::plugin_dir(&root, plugin_id), plugin_id, &decl)?;
    serde_json::to_string(&items).map_err(|error| format!("序列化内容包 {pack_id} 失败：{error}"))
}

/// 刷新模型的真实实现（命令层只做 `State` 解包），便于测试直接驱动。
///
/// **先探活、再抓模型**，顺序不能反：`ready` 只表示「`/health` 通过」。反过来先抓模型
/// 的话，一个 `/health` 恒失败的插件只要 `/v1/models` 能返回，就会把 `ready` 翻成 true ——
/// 同一个字段表达两件事，界面灰显与「要不要重试」的判据都会跟着歪。
///
/// `probe_timeout` 由调用方给：生产用 [`PROVIDER_REFRESH_PROBE_TIMEOUT`]，测试可以压短
/// （探活失败一定要等满这一轮，压缩它只影响用例耗时，不影响被测行为）。
async fn refresh_provider_models(
    state: &PluginsState,
    provider_id: &str,
    probe_timeout: std::time::Duration,
) -> Result<Vec<providers::ProviderModel>, String> {
    // 先把地址与令牌取出来再放锁：网络请求可能几百毫秒，握着 providers 表锁等它会把
    // 启用/停用（要登记/清理 provider）一起堵住。
    let (base_url, token) = {
        let providers = state.providers.lock().await;
        let provider = providers
            .get(provider_id)
            .ok_or_else(|| format!("provider {provider_id} 未就绪"))?;
        (provider.base_url.clone(), provider.token.clone())
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构造 HTTP client 失败：{e}"))?;

    // 第一步：探活。失败就把登记改成 `ready=false` 再返回 Err —— 只返回 Err 而不落登记
    // 的话，界面上的 `ready` 还是上一次的值，用户会看到「刷新失败，但卡片仍显示就绪」。
    // **不动 `models`**：用户只是点了下刷新，一次探活失败不该把已经看到的模型清掉。
    if let Err(error) = providers::wait_until_healthy(&client, &base_url, probe_timeout).await {
        if let Some(provider) = state.providers.lock().await.get_mut(provider_id) {
            provider.ready = false;
            provider.last_error = Some(error.clone());
        }
        return Err(error);
    }

    // 探活通过了：`ready` 与「/health 通过」是同一件事，先把这条定下来。
    // 后面抓模型失败只影响模型列表，不推翻「插件是健康的」这个结论。
    if let Some(provider) = state.providers.lock().await.get_mut(provider_id) {
        provider.ready = true;
    }

    // 第二步：抓模型。失败也返回 Err（界面要能提示），但原因只写进 `last_error`，
    // 不清缓存、不回退 `ready`。
    match providers::fetch_models(&client, &base_url, &token).await {
        Ok(models) => {
            if let Some(provider) = state.providers.lock().await.get_mut(provider_id) {
                provider.models = models.clone();
                provider.last_error = None;
            }
            Ok(models)
        }
        Err(error) => {
            let message = format!("抓取模型列表失败：{error}");
            if let Some(provider) = state.providers.lock().await.get_mut(provider_id) {
                provider.last_error = Some(message.clone());
            }
            Err(message)
        }
    }
}

// T5 的端到端验证（真 Node 进程 + 真 HTTP/SSE）。单独成文件而不并进下面的 `mod tests`：
// 那套脚手架（临时插件根目录、真进程、真网络）与纯逻辑单测不是一回事，混在一起会让
// 「哪条用例需要 node」变得难分辨。声明在 `#[cfg(test)]` 下，所以 `cargo test --lib`
// 会跑到（不是 `tests/` 下的集成测试）。
#[cfg(test)]
mod providers_e2e;

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

    /// 一个 schema 2 的 provider 清单（声明一条 provider，带 net:listen）。
    /// startTimeoutMs 取 1s：有 provider 的用例会真的等一轮探活，别拖成 10s。
    fn provider_manifest(plugin_id: &str, provider_id: &str) -> String {
        format!(
            r#"{{
                "schema": 2,
                "id": "{plugin_id}",
                "name": "Provider 插件",
                "version": "1.0.0",
                "runtime": {{ "type": "node", "entry": "index.js", "startTimeoutMs": 1000 }},
                "permissions": ["net:listen"],
                "contributes": {{ "providers": [{{ "id": "{provider_id}", "name": "上游", "authKind": "none" }}] }}
            }}"#
        )
    }

    fn parsed_manifest(raw: &str) -> manifest::PluginManifest {
        manifest::PluginManifest::parse(raw).expect("测试清单必须合法")
    }

    fn provider_registration(plugin_id: &str, provider_id: &str) -> providers::PluginProvider {
        providers::PluginProvider {
            plugin_id: plugin_id.to_string(),
            provider_id: provider_id.to_string(),
            name: provider_id.to_string(),
            base_url: "http://127.0.0.1:1".to_string(),
            token: "test-token".to_string(),
            capabilities: vec![],
            settings_page: None,
            auth_kind: "none".to_string(),
            models: vec![],
            ready: true,
            last_error: None,
        }
    }

    #[test]
    fn provider_ids_must_be_free_across_plugins() {
        let root = TempRoot::new("provider-id-conflict");
        write_plugin(
            root.path(),
            "other-plugin",
            &provider_manifest("other-plugin", "wb-connect"),
            None,
        );
        let mut registry = PluginRegistry::load(root.path()).expect("空注册表可加载");
        registry.upsert(sample_entry("other-plugin"));
        registry.save(root.path()).expect("保存注册表");

        let mine = parsed_manifest(&provider_manifest("my-plugin", "wb-connect"));
        let error = ensure_provider_ids_free(root.path(), "my-plugin", &mine)
            .expect_err("同一 provider id 不能被两个插件占用");

        assert!(error.contains("wb-connect"), "错误应指出冲突的 id：{error}");
        assert!(
            error.contains("other-plugin"),
            "错误应指出占用者，否则用户不知道该卸谁：{error}"
        );
    }

    #[test]
    fn provider_id_check_skips_self_and_broken_plugins() {
        let root = TempRoot::new("provider-id-self");
        write_plugin(
            root.path(),
            "my-plugin",
            &provider_manifest("my-plugin", "my-provider"),
            None,
        );
        // 清单坏掉的插件：跳过它，不能因为别人坏了让新插件装不上
        let broken = paths::plugin_dir(root.path(), "broken-plugin");
        std::fs::create_dir_all(&broken).expect("创建坏插件目录");
        std::fs::write(broken.join("plugin.json"), "{not json").expect("写坏清单");

        let mut registry = PluginRegistry::load(root.path()).expect("空注册表可加载");
        registry.upsert(sample_entry("my-plugin"));
        registry.upsert(sample_entry("broken-plugin"));
        registry.save(root.path()).expect("保存注册表");

        let mine = parsed_manifest(&provider_manifest("my-plugin", "my-provider"));
        ensure_provider_ids_free(root.path(), "my-plugin", &mine)
            .expect("自己的 provider id 不该和自己冲突；坏插件应被跳过");
    }

    #[tokio::test]
    async fn stop_plugin_drops_only_that_plugins_provider_registrations() {
        let state = PluginsState::default();
        {
            let mut providers = state.providers.lock().await;
            let p_one = provider_registration("plug-a", "p-one");
            let p_two = provider_registration("plug-b", "p-two");
            providers.insert("p-one".to_string(), p_one);
            providers.insert("p-two".to_string(), p_two);
        }

        stop_plugin(&state, "plug-a").await;

        let providers = state.providers.lock().await;
        assert!(
            !providers.contains_key("p-one"),
            "停用后该插件的 provider 必须消失（token 也随之丢弃）"
        );
        assert!(
            providers.contains_key("p-two"),
            "别的插件的 provider 不能被误删"
        );
    }

    /// 探活失败只写 `last_error`，不 panic、不把插件判成启动失败。
    /// 用一个「绑了端口但从不 accept」的 listener：连接能建立、永远没有响应，
    /// 探活必须按 startTimeoutMs 超时，而不是永久挂住或误判成功。
    #[tokio::test]
    async fn register_provider_records_probe_failure_instead_of_failing() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("绑定测试端口");
        let port = listener.local_addr().expect("读取端口").port();

        let manifest = parsed_manifest(&provider_manifest("probe-fail", "probe-fail"));
        let decl = manifest.contributes.providers[0].clone();
        let provider = register_provider(&manifest, &decl, port, "test-token".to_string()).await;

        assert!(!provider.ready, "探活不通过时不能标成 ready");
        let error = provider.last_error.as_deref().unwrap_or_default();
        assert!(
            error.contains("/health"),
            "失败原因必须能展示给用户（含探活目标）：{error:?}"
        );
        assert!(
            provider.models.is_empty(),
            "探活都没过就不该去抓模型（否则错误会被后一步覆盖）"
        );
        assert_eq!(provider.token, "test-token", "token 仍留在内存里供后续重试");
        assert_eq!(provider.auth_kind, "none");
    }

    /// provider 探活失败**不能**让插件启动失败、更不能杀进程：插件可能同时提供工具，
    /// provider 只是它的一部分能力（设计 6.3）。
    ///
    /// 用真实 Node 插件验证：它实现了 MCP（initialize / tools/list）但不实现 /health，
    /// 于是 provider 探活必然失败 —— 此时进程要活着、工具要在、provider 要登记成
    /// ready=false 并带原因（界面才能灰显而不是让整组消失）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn provider_probe_failure_keeps_the_plugin_running() {
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
      result: { tools: [{ name: "echo", description: "回声", inputSchema: { type: "object" } }] }
    }));
  }
});
"#;

        let root = TempRoot::new("provider-no-health");
        let id = "provider-no-health";
        let manifest = provider_manifest(id, "no-health");
        write_plugin(root.path(), id, &manifest, Some(("index.js", SERVER)));
        let entry = sample_entry(id);

        let state = PluginsState::default();
        *state.host_port.lock().expect("端口状态") = Some(1);

        start_plugin(root.path(), &state, &entry)
            .await
            .expect("provider 探活失败不能让插件启动失败");

        {
            let mut running = state.running.lock().await;
            let handle = running
                .get_mut(id)
                .expect("探活失败后插件进程必须还在 running 表里");
            assert_eq!(handle.state.as_str(), "running");
            assert_eq!(handle.tools.len(), 1, "工具能力不受 provider 探活失败影响");
            assert!(
                handle.child.try_wait().expect("查询子进程状态").is_none(),
                "探活失败不能杀插件进程"
            );
        }
        {
            let providers = state.providers.lock().await;
            let provider = providers
                .get("no-health")
                .expect("探活失败的 provider 也要登记，界面才能灰显并给原因");
            assert!(!provider.ready);
            assert!(
                provider
                    .last_error
                    .as_deref()
                    .unwrap_or_default()
                    .contains("/health"),
                "失败原因要能展示：{:?}",
                provider.last_error
            );
            assert_eq!(provider.plugin_id, id);
            assert!(provider.base_url.starts_with("http://127.0.0.1:"));
            assert!(
                !provider.token.is_empty(),
                "令牌已发给插件，登记要留着它供刷新/授权"
            );
        }

        stop_plugin(&state, id).await;
        assert!(
            state.providers.lock().await.is_empty(),
            "停用后 provider 登记必须一起清掉（token 也随之丢弃）"
        );
        assert!(
            state.running.lock().await.is_empty(),
            "停用后 running 表必须为空"
        );
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
        // T4：前端靠 providerIds 判断要不要用高危确认文案。
        assert_eq!(value["providerIds"], serde_json::json!([]));
        assert!(value.get("process_state").is_none());
    }

    #[test]
    fn manifest_provider_ids_reads_contributes_providers() {
        let root = TempRoot::new("manifest-provider-ids");
        let dir = write_plugin(
            root.path(),
            "wb-plugin",
            &provider_manifest("wb-plugin", "wb-connect"),
            None,
        );
        assert_eq!(manifest_provider_ids(&dir), vec!["wb-connect".to_string()]);

        // 没有清单（目录被手工删了）：空 vec，管理页仍要能列出该插件。
        assert!(manifest_provider_ids(&root.path().join("missing")).is_empty());

        // 工具插件不声明 providers：同样是空 vec，不能误判成 provider 插件。
        let tool_dir = write_plugin(
            root.path(),
            "tool-plugin",
            r#"{ "schema": 1, "id": "tool-plugin", "name": "工具", "version": "1.0.0",
                 "runtime": { "type": "node", "entry": "index.js", "startTimeoutMs": 1000 } }"#,
            None,
        );
        assert!(manifest_provider_ids(&tool_dir).is_empty());
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

        let error = start_plugin(root.path(), &state, &entry)
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

        let error = start_plugin(root.path(), &state, &entry)
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

        start_plugin(root.path(), &state, &entry)
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

        stop_plugin(&state, id).await;
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

        start_plugin(root.path(), &state, &entry)
            .await
            .expect("插件持续写 stderr 时握手仍应成功");

        {
            let running = state.running.lock().await;
            let handle = running.get(id).expect("启动后应有运行句柄");
            assert!(handle.tools.is_empty());
        }
        stop_plugin(&state, id).await;
    }

    /// `QMAI_CONFIG` 必须真的到达子进程（设计 §6.3：配置以环境变量注入）。
    ///
    /// A1 只用临时脚本验证过这件事，随后把脚本删了 —— 于是「配置注入」这条契约
    /// 在正式测试里没有任何护栏。这里用假 Node 插件（MCP stdio + 一个 `echo_env`
    /// 工具）把 `process.env.QMAI_CONFIG` 经 tools/call 回吐，断言宿主注入的配置
    /// 能被插件读到。
    ///
    /// 为什么断言的是「配置值」而不是「有 QMAI_CONFIG 这个变量」：注入一条
    /// 空对象 `{}` 也能让变量存在，但那对插件毫无意义；只有值传到才算契约成立。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_plugin_injects_qmai_config_into_the_plugin_process() {
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
        name: "echo_env", description: "回吐宿主注入的配置",
        inputSchema: { type: "object" }
      }] }
    }));
  } else if (req.method === "tools/call") {
    console.log(JSON.stringify({
      jsonrpc: "2.0", id: req.id,
      result: { content: [{ type: "text", text: String(process.env.QMAI_CONFIG) }] }
    }));
  }
});
"#;

        let root = TempRoot::new("qmai-config");
        // 插件 id 唯一：`config::shared` 是进程级单例，多个用例共用一张表，
        // 用不同 id 才不会互相看到对方的配置。
        let id = "config-echo";
        let manifest = format!(
            r#"{{
                "schema": 3,
                "id": "{id}",
                "name": "配置回声",
                "version": "1.0.0",
                "runtime": {{ "type": "node", "entry": "server.js", "startTimeoutMs": 5000 }},
                "configSchema": {{
                    "type": "object",
                    "properties": {{ "defaultCount": {{ "type": "number" }} }}
                }}
            }}"#
        );
        write_plugin(root.path(), id, &manifest, Some(("server.js", SERVER)));

        // 走生产同一条路径写配置：`start_plugin` 注入时读的就是这份进程级表，
        // 而密钥真值只活在内存里（盘上只有占位符），所以这里不能靠落盘来准备数据。
        let store = config::shared(root.path()).expect("取进程级配置表");
        store
            .lock()
            .expect("配置表可用")
            .set(
                id,
                json!({ "defaultCount": 7 }),
                &json!({ "type": "object", "properties": { "defaultCount": { "type": "number" } } }),
            )
            .expect("写入测试配置");

        let entry = sample_entry(id);
        let state = PluginsState::default();
        // 假端口：本用例不碰宿主 API，别为此真的起一个回环服务。
        *state.host_port.lock().expect("端口状态") = Some(1);

        start_plugin(root.path(), &state, &entry)
            .await
            .expect("插件应完成握手");

        {
            let mut running = state.running.lock().await;
            let handle = running.get_mut(id).expect("启动后应有运行句柄");
            let io = handle.io.clone();
            let _guard = io.lock().await;
            let text = invoke_tool_on(handle, "echo_env", &json!({}))
                .await
                .expect("tools/call 应回吐 QMAI_CONFIG");
            // 注入的是 JSON 文本（设计 §6.3）：解析成功才说明插件拿到的是可用的配置。
            let injected: serde_json::Value =
                serde_json::from_str(&text).unwrap_or_else(|error| {
                    panic!("QMAI_CONFIG 必须是 JSON 文本（实际 {text:?}）：{error}")
                });
            assert_eq!(
                injected["defaultCount"], 7,
                "宿主注入的配置必须真的到达子进程：{text}"
            );
        }

        stop_plugin(&state, id).await;
        assert!(
            state.running.lock().await.is_empty(),
            "停用后 running 表必须为空"
        );
    }
}
