//! 进程监管器的纯逻辑层：状态机、崩溃预算、输出缓冲、工具名前缀映射、启动命令构造。
//!
//! 本模块**不持有任何运行中的进程**：真正的「启用/停用」接线留给后续任务，
//! 这里只沉淀可以被独立测试的判定逻辑，避免把状态迁移规则散落到命令层里。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{BufReader, Lines};
use tokio::process::{Child, ChildStdout};

// ── 状态机 ─────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessState {
    Stopped,
    Starting,
    Running,
    Failed,
    Crashed,
    DisabledByCrash,
}

impl ProcessState {
    /// 白名单式转移表：只有设计文档认可的组合返回 true。
    ///
    /// 用「穷举合法边」而不是「穷举非法边」，是为了让新增状态时默认被拒绝，
    /// 而不是被默认放行——状态机宽进宽出会让崩溃后的重复拉起变得不可控。
    pub fn can_transition_to(self, next: ProcessState) -> bool {
        use ProcessState::*;
        matches!(
            (self, next),
            (Stopped, Starting)
                | (Failed, Starting)
                | (Crashed, Starting)
                | (DisabledByCrash, Starting)
                | (Starting, Running)
                | (Starting, Failed)
                | (Running, Crashed)
                | (Running, Stopped)
                | (Running, DisabledByCrash)
                | (Failed, Stopped)
                | (Crashed, Stopped)
        )
    }

    /// 前端 PluginSummary.processState 直接消费这些字符串，属于界面契约，不要改名。
    pub fn as_str(self) -> &'static str {
        match self {
            ProcessState::Stopped => "stopped",
            ProcessState::Starting => "starting",
            ProcessState::Running => "running",
            ProcessState::Failed => "failed",
            ProcessState::Crashed => "crashed",
            ProcessState::DisabledByCrash => "disabled_by_crash",
        }
    }
}

// ── 崩溃预算 ───────────────────────────────────────────

/// 崩溃重启预算：1s / 3s / 9s，用尽后停用（设计文档 7.2）
#[derive(Debug, Default)]
pub struct CrashBudget {
    attempt: u32,
}

impl CrashBudget {
    /// 下一次重启前的退避时长；预算用尽返回 None
    pub fn next_backoff(&mut self) -> Option<Duration> {
        // 指数退避 1s / 3s / 9s；第 4 次崩溃即预算耗尽，转为 disabled_by_crash。
        let backoff = match self.attempt {
            0 => Duration::from_secs(1),
            1 => Duration::from_secs(3),
            2 => Duration::from_secs(9),
            _ => return None,
        };
        self.attempt += 1;
        Some(backoff)
    }

    /// 稳定运行后清零（避免长期稳定 + 偶发一次崩溃就被停用）
    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    // 故意**不提供** exhausted()：它在第 3 次 backoff 发出的那一瞬间（刚拿到 9s 退避）
    // 就已经是 true，任务 12 里「拿到 backoff → 重启 → 查 exhausted()」会立刻误判停用。
    // 唯一的耗尽信号是 next_backoff() 返回 None，不需要第二个真值来源。
}

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

// ── 工具名前缀映射（设计文档 9.2）─────────────────────

/// `<pluginId 里的 - 换成 _>` + `__` + `<toolName>`。
///
/// 加前缀是因为 ToolRegistry.register 是 Map.set：插件若声明一个叫 read_chapter 的工具，
/// 不加前缀就会静默覆盖内置工具。
pub fn to_host_tool_name(plugin_id: &str, tool: &str) -> String {
    format!("{}__{}", plugin_id.replace('-', "_"), tool)
}

/// 反向还原插件内的原名；不是插件工具名（不含 `__`）返回 None。
///
/// 发给插件的 tools/call 必须用原名，插件不认识带前缀的名字。
///
/// **只对「确定来自插件注册」的 host 名调用**：内置工具名若自身含 `__`，
/// 这里会把它误判成插件工具。调用方（任务 9/12）不得拿它对任意工具名做判断。
pub fn to_plugin_tool_name(host_name: &str) -> Option<&str> {
    host_name.split_once("__").map(|(_, rest)| rest)
}

// ── 子进程启动 ─────────────────────────────────────────

use tokio::process::Command;

/// 把清单里的 runtime 配置解析成可执行的命令。
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
    manifest: &super::manifest::PluginManifest,
) -> Result<Command, String> {
    use super::manifest::RuntimeType;
    let entry_path = plugin_dir.join(&manifest.runtime.entry);
    let mut cmd = match manifest.runtime.entry_type {
        RuntimeType::Node => {
            let node = crate::commands::cli_resolver::find_cli_command("node", &["node.exe", "node"])
                .await
                .map_err(|e| {
                    format!(
                        "找不到 Node（插件 {} 需要）：{e}。请安装 Node.js 并确保 node 在 PATH 中",
                        manifest.id
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
                    "找不到 Python（插件 {} 需要）：{e}。请安装 Python 3 并确保 python3/python 在 PATH 中",
                    manifest.id
                )
            })?;
            let mut c = Command::new(py);
            c.arg(&entry_path);
            c
        }
        RuntimeType::Binary => Command::new(&entry_path),
    };
    cmd.args(&manifest.runtime.args);
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
    fn state_machine_matches_the_documented_edges_exactly() {
        use ProcessState::*;
        // 规格允许的 11 条边，逐条穷举；漏一条或少一条都会红。
        let allowed = [
            (Stopped, Starting),
            (Failed, Starting),
            (Crashed, Starting),
            (DisabledByCrash, Starting),
            (Starting, Running),
            (Starting, Failed),
            (Running, Crashed),
            (Running, Stopped),
            (Running, DisabledByCrash),
            (Failed, Stopped),
            (Crashed, Stopped),
        ];
        let all = [Stopped, Starting, Running, Failed, Crashed, DisabledByCrash];
        for from in all {
            for to in all {
                let expected = allowed.iter().any(|(f, t)| *f == from && *t == to);
                assert_eq!(
                    from.can_transition_to(to),
                    expected,
                    "转移 {} → {} 应为 {}",
                    from.as_str(),
                    to.as_str(),
                    expected
                );
            }
        }
    }

    #[test]
    fn crash_budget_stops_after_three() {
        let mut b = CrashBudget::default();
        assert_eq!(b.next_backoff(), Some(Duration::from_secs(1)));
        assert_eq!(b.next_backoff(), Some(Duration::from_secs(3)));
        assert_eq!(b.next_backoff(), Some(Duration::from_secs(9)));
        // 耗尽信号只有这一个：None。这里不再用 exhausted() 断言，
        // 因为 attempt==3 的那一瞬间（刚拿到 9s）它就已经是 true 了，容易被误用。
        assert_eq!(b.next_backoff(), None);
    }

    #[test]
    fn crash_budget_resets_after_stable_run() {
        let mut b = CrashBudget::default();
        b.next_backoff();
        b.next_backoff();
        b.reset();
        assert_eq!(b.next_backoff(), Some(Duration::from_secs(1)));
    }

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
    fn tool_name_roundtrip_strips_prefix() {
        assert_eq!(
            to_host_tool_name("chapter-insights", "analyze"),
            "chapter_insights__analyze"
        );
        assert_eq!(
            to_plugin_tool_name("chapter_insights__analyze").unwrap(),
            "analyze"
        );
        // 不带前缀的内置工具名不应被误认成插件工具
        assert!(to_plugin_tool_name("read_chapter").is_none());
    }

    #[test]
    fn tool_name_roundtrip_handles_underscores_inside_tool_names() {
        // 插件 id 不允许 `_`，工具名允许，所以按第一个 `__` 切分是安全的
        assert_eq!(
            to_host_tool_name("chapter-insights", "analyze__deep"),
            "chapter_insights__analyze__deep"
        );
        assert_eq!(
            to_plugin_tool_name("chapter_insights__analyze__deep").unwrap(),
            "analyze__deep"
        );
    }

    #[test]
    fn state_strings_are_stable_for_the_ui_contract() {
        // 前端 PluginSummary.processState 直接消费这些字符串，改名等于破坏界面契约
        assert_eq!(ProcessState::Stopped.as_str(), "stopped");
        assert_eq!(ProcessState::Starting.as_str(), "starting");
        assert_eq!(ProcessState::Running.as_str(), "running");
        assert_eq!(ProcessState::Failed.as_str(), "failed");
        assert_eq!(ProcessState::Crashed.as_str(), "crashed");
        assert_eq!(ProcessState::DisabledByCrash.as_str(), "disabled_by_crash");
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
