//! 进程监管器的纯逻辑层：进程状态、输出缓冲、启动命令构造与运行句柄。
//!
//! 本模块**不持有任何运行中的进程**：它只沉淀可以被独立测试的判定逻辑，
//! 真正的「启用/停用」由 `mod.rs` 接线。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{BufReader, Lines};
use tokio::process::{Child, ChildStdout};

// ── 进程状态 ───────────────────────────────────────────

/// 一个插件进程此刻的状态。
///
/// **只保留宿主真的会返回给前端的值**。`Failed` / `DisabledByCrash` 曾经在这里，
/// 但没有任何一条路径构造过它们：宿主不自动重启（见下方「崩溃处理」），也就不存在
/// 「因崩溃被停用」这一档；而启动失败是同步返回的 `Err`（界面走 error toast），
/// 不是一种常驻状态。留着它们等于在枚举里承诺一条从未启用的状态机。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessState {
    /// 该跑却没跑：用户没启用 / 主动停用 / 崩溃后等用户决定。
    Stopped,
    /// 进程已 spawn，握手（initialize + tools/list）还没完成。
    Starting,
    /// 握手通过，句柄已在 `running` 表里。
    Running,
    /// 曾经在跑，后来意外退出（崩溃）。崩溃报告见 `mod.rs` 的 `CrashReport`。
    Crashed,
}

impl ProcessState {
    /// 前端 PluginSummary.processState 直接消费这些字符串，属于界面契约，不要改名。
    ///
    /// 前端 `types.ts` 的联合类型里还列着 `failed` / `disabled_by_crash`（多一个
    /// 永远不会收到的分支对它是无害的），但宿主这边不再有产生它们的路径。
    pub fn as_str(self) -> &'static str {
        match self {
            ProcessState::Stopped => "stopped",
            ProcessState::Starting => "starting",
            ProcessState::Running => "running",
            ProcessState::Crashed => "crashed",
        }
    }
}

// ── 崩溃处理：不自动重启 ───────────────────────────────
//
// 这里曾有一个 `CrashBudget`（1s / 3s / 9s 指数退避，用尽后转为 disabled_by_crash），
// 并且有一张「11 条合法边」的 `can_transition_to` 状态转移表。两者从未被构造/调用，
// 也**不打算接线**，所以整段删除：
//
// - 我们**不自动重启**崩溃的插件。自动重启会掩盖插件作者的 bug：带着同一个 bug 反复
//   重启，用户和作者看到的都只是一串「已重启」，真正的原因被埋掉。
// - 更危险的是「启动即崩」：spawn → 立刻退出 → 退避 → 再 spawn 的循环会在用户机器上
//   形成 spawn 风暴（每次都要建进程、连回环 HTTP、拉工具清单），一条坏插件就能把本机
//   资源拖垮。
// - 宿主侧已有更明确的处理：崩溃即停止（摘 `running`、清 `providers`、注销 token），
//   并在界面上如实显示「异常退出」，由用户决定是否重新启用。一次明确的用户决定，
//   比一个自动重试的循环更容易定位问题。
//
// 保留 `CrashBudget` 等于给后来人一个「我们有退避保护」的错觉，所以不留空壳。

// ── 输出缓冲 ───────────────────────────────────────────

/// 只保留尾部 N 字节，防止插件疯狂打印打爆内存（设计文档 7.2：上限 64KB）
pub struct TailBuffer {
    limit: usize,
    data: VecDeque<u8>,
}

impl TailBuffer {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            data: VecDeque::with_capacity(limit),
        }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        if self.limit == 0 {
            return;
        }
        // 单次输出就超限时直接裁到尾部，避免先塞进去再一个个弹（大日志块场景）
        if chunk.len() >= self.limit {
            self.data.clear();
            self.data
                .extend(chunk[chunk.len() - self.limit..].iter().copied());
            return;
        }
        self.data.extend(chunk.iter().copied());
        while self.data.len() > self.limit {
            self.data.pop_front();
        }
    }

    /// 插件输出可能被截断在多字节 UTF-8 中间，所以用 lossy 而不是 from_utf8。
    pub fn as_lossy(&self) -> String {
        let bytes: Vec<u8> = self.data.iter().copied().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

// ── 工具名的前缀规则 ───────────────────────────────────
//
// 工具名的 `<pluginId>__<tool>` 前缀规则在前端 `src/lib/plugins/tool-bridge.ts` 唯一实现。
// 这里曾有一份 Rust 副本（`to_host_tool_name` / `to_plugin_tool_name`），从未被调用，
// 已删除以免两处规则漂移。

// ── 子进程启动 ─────────────────────────────────────────

use tokio::process::Command;

/// 把清单里的 runtime 配置解析成可执行的命令。
///
/// 接收 `&PluginRuntime` 而不是整份清单：`runtime` 在 v3 起是 `Option`（纯 Tier 1 插件
/// 没有它，设计 D1），所以「有没有 runtime」必须由**调用方**判断（`start_plugin` 已把
/// `None` 的分支挡在前面）。写成 `manifest: &PluginManifest` 再在内部 `expect`，等于把
/// 一个调用方本该保证的前提藏进库函数，读代码的人看不出来它凭什么能 unwrap。
/// `plugin_id` 只是为了错误文案能指出是哪个插件缺解释器。
///
/// 复用 commands::cli_resolver::find_cli_command 做跨平台命令发现（它已处理
/// macOS 登录 shell 的 PATH 与 Windows 的候选可执行名 + 结果缓存）。
///
/// 命令行的拼装顺序是 `[解释器] <entry> <runtime.args...>`：清单里的 args **追加在
/// 入口路径之后**，对 Node/Python 就是脚本自己的 argv。想让解释器生效的 flag
/// （例如 `--no-warnings`、`-u`）没有单独的字段，必须自己写进 args —— 注意那样它
/// 会落在脚本路径**之后**，需要排在最前的解释器参数目前只能靠不带 args 的包装脚本实现。
pub async fn build_command(
    plugin_dir: &std::path::Path,
    plugin_id: &str,
    runtime: &super::manifest::PluginRuntime,
) -> Result<Command, String> {
    use super::manifest::RuntimeType;
    let entry_path = plugin_dir.join(&runtime.entry);
    let mut cmd = match runtime.entry_type {
        RuntimeType::Node => {
            let node = crate::commands::cli_resolver::find_cli_command("node", &["node.exe", "node"])
                .await
                .map_err(|e| {
                    format!(
                        "找不到 Node（插件 {plugin_id} 需要）：{e}。请安装 Node.js 并确保 node 在 PATH 中"
                    )
                })?;
            let mut c = Command::new(node);
            c.arg(&entry_path);
            c
        }
        RuntimeType::Python => {
            let py = crate::commands::cli_resolver::find_cli_command(
                "python3",
                &["python.exe", "python3.exe"],
            )
            .await
            .map_err(|e| {
                format!(
                    "找不到 Python（插件 {plugin_id} 需要）：{e}。请安装 Python 3 并确保 python3/python 在 PATH 中"
                )
            })?;
            let mut c = Command::new(py);
            c.arg(&entry_path);
            c
        }
        RuntimeType::Binary => Command::new(&entry_path),
    };
    cmd.args(&runtime.args);
    // 入口可能是相对路径（插件自己的资源也是），不设 cwd 会让插件按宿主的工作目录找文件。
    cmd.current_dir(plugin_dir);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    // 没有它，宿主异常退出时子进程会被留成孤儿（Windows 上尤其明显）
    cmd.kill_on_drop(true);
    // Windows：不弹控制台窗口（与 claude_cli / codex_cli 等既有实现一致）。
    // 这里用的是 tokio::process::Command 自带的 creation_flags，不需要再引入
    // std 的 CommandExt trait（引入会变成 unused import）。
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

// ── 运行句柄 ───────────────────────────────────────────

/// JSON-RPC 请求 id 发生器（每个插件一个，单调递增）。
///
/// 响应必须按 id 配对：插件可能先发 `notifications/...`，也可能在超时后补发
/// 上一条请求的结果；只读「下一行」会把别的消息当成当前响应。
#[derive(Default)]
pub struct RequestCounter {
    next_id: AtomicU64,
}

impl RequestCounter {
    pub fn next(&self) -> u64 {
        // JSON-RPC 的 id=0 在部分实现里会被当成「未设置」，从 1 开始最稳。
        self.next_id.fetch_add(1, Ordering::SeqCst) + 1
    }
}

/// 一个正在运行的插件：子进程 + 它的 stdio + 运行期工具清单。
///
/// 这里不实现 Drop：`Child` 已由 `build_command` 设了 `kill_on_drop(true)`，
/// 句柄被丢弃时进程会被杀掉，这是忘记调用 [`LaunchHandle::stop`] 时的最后保险。
pub struct LaunchHandle {
    pub plugin_id: String,
    pub token: String,
    pub child: Child,
    pub stdin: tokio::process::ChildStdin,
    pub stdout: Lines<BufReader<ChildStdout>>,
    pub counter: RequestCounter,
    pub tools: Vec<super::mcp_bridge::PluginToolDecl>,
    pub state: ProcessState,
    /// 独占 stdio 的锁：tools/call 的请求与响应必须成对，两个调用并发写同一个
    /// stdin 会让响应串台。调用方拿到它之后再碰 stdin/stdout。
    pub io: Arc<tokio::sync::Mutex<()>>,
}

impl LaunchHandle {
    /// 优雅停止：先关 stdin（MCP 约定的退出信号），1 秒内没退就强杀。
    pub async fn stop(mut self) {
        // ChildStdin 的 Drop 会关闭管道；插件读到 EOF 后应自行退出。
        drop(self.stdin);
        match tokio::time::timeout(Duration::from_secs(1), self.child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                // kill() 自带 wait，确保返回时进程已经真的没了。
                let _ = self.child.kill().await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_buffer_keeps_tail_only() {
        let mut buf = TailBuffer::new(16);
        buf.push(b"0123456789");
        buf.push(b"abcdefghij");
        assert_eq!(buf.as_lossy(), "456789abcdefghij");
    }

    #[test]
    fn output_buffer_handles_large_and_degenerate_chunks() {
        // 单个 chunk 就超过上限：走快路径，只保留该 chunk 的尾部
        let mut big = TailBuffer::new(4);
        big.push(&[b'x'; 40]);
        assert_eq!(big.as_lossy(), "xxxx");

        // 恰好等于上限
        let mut exact = TailBuffer::new(4);
        exact.push(b"abcdef");
        assert_eq!(exact.as_lossy(), "cdef");

        // limit == 0 不能 panic，且不持有内容
        let mut zero = TailBuffer::new(0);
        zero.push(b"anything");
        assert_eq!(zero.as_lossy(), "");
    }

    #[test]
    fn state_strings_are_stable_for_the_ui_contract() {
        // 前端 PluginSummary.processState 直接消费这些字符串，改名等于破坏界面契约。
        // 这里只列宿主**真的会返回**的四档；`failed` / `disabled_by_crash` 已随
        // 未接线的状态机一起删除（前端联合类型里多留两个分支是无害的）。
        assert_eq!(ProcessState::Stopped.as_str(), "stopped");
        assert_eq!(ProcessState::Starting.as_str(), "starting");
        assert_eq!(ProcessState::Running.as_str(), "running");
        assert_eq!(ProcessState::Crashed.as_str(), "crashed");
    }

    #[test]
    fn request_counter_is_monotonic_from_one() {
        let counter = RequestCounter::default();
        // 从 1 开始而不是 0：JSON-RPC 的 0 常被某些实现当成非法/未设置 id。
        assert_eq!(counter.next(), 1);
        assert_eq!(counter.next(), 2);
        assert_eq!(counter.next(), 3);
    }
}
