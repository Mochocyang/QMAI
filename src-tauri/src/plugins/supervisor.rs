//! 进程监管器的纯逻辑层：状态机、崩溃预算、输出缓冲、工具名前缀映射、启动命令构造。
//!
//! 本模块**不持有任何运行中的进程**：真正的「启用/停用」接线留给后续任务，
//! 这里只沉淀可以被独立测试的判定逻辑，避免把状态迁移规则散落到命令层里。

use std::collections::VecDeque;
use std::time::Duration;

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

    pub fn exhausted(&self) -> bool {
        self.attempt >= 3
    }
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
/// 因为发给插件的 tools/call 里必须用原名，插件不认识带前缀的名字。
pub fn to_plugin_tool_name(host_name: &str) -> Option<&str> {
    host_name.split_once("__").map(|(_, rest)| rest)
}

// ── 子进程启动 ─────────────────────────────────────────

use tokio::process::Command;

/// 把清单里的 runtime 配置解析成可执行的命令。
///
/// 复用 commands::cli_resolver::find_cli_command 做跨平台命令发现（它已处理
/// macOS 登录 shell 的 PATH 与 Windows 的候选可执行名 + 结果缓存）。
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
                .map_err(|e| format!("找不到 Node（插件 {} 需要）：{e}", manifest.id))?;
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
            .map_err(|e| format!("找不到 Python（插件 {} 需要）：{e}", manifest.id))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_machine_allows_expected_transitions() {
        let mut s = ProcessState::Stopped;
        assert!(s.can_transition_to(ProcessState::Starting));
        s = ProcessState::Starting;
        assert!(s.can_transition_to(ProcessState::Running));
        s = ProcessState::Running;
        assert!(s.can_transition_to(ProcessState::Crashed));
        s = ProcessState::Crashed;
        assert!(s.can_transition_to(ProcessState::Starting));
    }

    #[test]
    fn state_machine_rejects_illegal_transitions() {
        assert!(!ProcessState::Stopped.can_transition_to(ProcessState::Running));
        assert!(!ProcessState::Running.can_transition_to(ProcessState::Starting));
        assert!(!ProcessState::DisabledByCrash.can_transition_to(ProcessState::Running));
    }

    #[test]
    fn crash_budget_stops_after_three() {
        let mut b = CrashBudget::default();
        assert_eq!(b.next_backoff(), Some(Duration::from_secs(1)));
        assert_eq!(b.next_backoff(), Some(Duration::from_secs(3)));
        assert_eq!(b.next_backoff(), Some(Duration::from_secs(9)));
        assert_eq!(b.next_backoff(), None);
        assert!(b.exhausted());
    }

    #[test]
    fn crash_budget_resets_after_stable_run() {
        let mut b = CrashBudget::default();
        b.next_backoff();
        b.next_backoff();
        b.reset();
        assert_eq!(b.next_backoff(), Some(Duration::from_secs(1)));
        assert!(!b.exhausted());
    }

    #[test]
    fn output_buffer_keeps_tail_only() {
        let mut buf = TailBuffer::new(16);
        buf.push(b"0123456789");
        buf.push(b"abcdefghij");
        assert_eq!(buf.as_lossy(), "456789abcdefghij");
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
    fn state_strings_are_stable_for_the_ui_contract() {
        // 前端 PluginSummary.processState 直接消费这些字符串，改名等于破坏界面契约
        assert_eq!(ProcessState::Stopped.as_str(), "stopped");
        assert_eq!(ProcessState::Starting.as_str(), "starting");
        assert_eq!(ProcessState::Running.as_str(), "running");
        assert_eq!(ProcessState::Failed.as_str(), "failed");
        assert_eq!(ProcessState::Crashed.as_str(), "crashed");
        assert_eq!(ProcessState::DisabledByCrash.as_str(), "disabled_by_crash");
    }
}
