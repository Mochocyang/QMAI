//! WorkBuddy 账号登录：把「用自己的 WorkBuddy 账号登录一次」变成 QMAI 里可用的模型。
//!
//! ── 这一层解决什么 ──────────────────────────────────────────
//! QMAI 原来的模型来源只有两种形态：**HTTP 接口**（预制 API / 自定义）与
//! **本机 CLI 子进程**（claude / codex / cursor / antigravity）。WorkBuddy 两者
//! 都不是：它是标准 OpenAI 协议的上游，但鉴权与请求头是它私有的 —— 必须拼一串
//! 客户端身份头、注入首条 system 消息、token 到期要自己续。
//!
//! 因此本模块在**应用进程内**起一个极小的 OpenAI 兼容网关（[`gateway`]），
//! 对外只暴露 `/health`、`/v1/models`、`/v1/chat/completions` 三条。前端于是
//! 可以把它当成一个普通供应方：模型列表、连通性测试、流式对话、中断、上下文
//! 超限裁剪、`max_tokens` 降级、用量统计，全部复用既有代码，一行不改。
//!
//! ── 子模块分工（每条都能单独测）─────────────────────────────
//!   `endpoints` 两版（国内 / 国际）端点、UA、platform 常量与 URL 拼装（纯函数）
//!   `crypto`    AES-256-GCM + `enc1:` 信封 + 密钥文件（纯 IO，不懂业务）
//!   `accounts`  账号结构、加密落盘、按 uid 幂等、优先级与可用性
//!   `login`     `auth/state` → 轮询 `auth/token` → `login/account` → 落库
//!   `import`    凭证文件解析（嵌套 / 扁平 / 判版本）、桌面端登录态定位
//!   `refresh`   `auth/token/refresh`（单飞）
//!   `models`    `/v3/config` 目录解析、缓存、内置兜底、OpenAI 列表形状
//!   `chat`      私有头集合、system 注入、错误分类
//!   `gateway`   axum 三路由、一次性令牌、SSE 透传
//!   `commands`  对前端暴露的 Tauri 命令
//!
//! ── 两条硬约束 ─────────────────────────────────────────────
//!   1. **凭证只在 Rust 侧流转**：任何 IPC 返回值、日志、错误文案里都不得出现
//!      accessToken / refreshToken 明文。对外视图见 `AccountStore::public_view`。
//!   2. **不整体复制 Agent2API 代码**：那套实现是 MIT + 附加声明（禁止商业用途 /
//!      二次分发牟利），与本仓库的 GPL-3.0 冲突。本模块只使用其**协议事实**
//!      （端点、头名、字段、握手顺序），实现自己写。
//!
//! ── 本期范围 ───────────────────────────────────────────────
//! 只接**国内版**（`copilot.tencent.com`）。国际版的常量、文件名、UA 已经在
//! [`endpoints`] 里备好，二期只需要放开 UI 上的分段与「恢复 Google / GitHub
//! 入口」的注入脚本，不动结构。

pub mod accounts;
pub mod chat;
pub mod commands;
pub mod crypto;
pub mod endpoints;
pub mod gateway;
pub mod import;
pub mod login;
pub mod login_window;
pub mod logging;
pub mod models;
pub mod refresh;

/// 测试用的临时目录：不引入 `tempfile` 依赖（本 crate 的 dev-dependencies 很薄，
/// 加一个只为一件事服务的 crate 不划算）。
#[cfg(test)]
pub(crate) mod test_support {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;

    /// 建一个本进程内唯一的临时目录（进程号 + 纳秒），已存在则复用。
    pub fn temp_dir() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut path = std::env::temp_dir();
        path.push(format!("qmai-workbuddy-test-{}-{nanos}", std::process::id()));
        let _ = std::fs::create_dir_all(&path);
        path
    }

    /// 一个只会按顺序吐固定响应的 HTTP 替身。
    ///
    /// ── 为什么手写而不是引 mock 库 ────────────────────────────
    /// 本 crate 的 dev-dependencies 很薄，而这里需要的只是「按顺序回 N 个响应」。
    /// 起一个真实监听端口的好处是被测代码走的是**真实 reqwest 路径**（TLS 关掉的
    /// 情况下），连接建立、头解析、超时都算在内，比 trait mock 更接近线上。
    pub struct StubServer {
        pub base: String,
        handle: Option<std::thread::JoinHandle<()>>,
    }

    impl StubServer {
        /// `responses` 依次对应第 1..N 个请求（每个响应处理一条连接）。
        pub fn spawn(responses: Vec<(u16, String)>) -> StubServer {
            let listener = TcpListener::bind("127.0.0.1:0").expect("绑定替身端口失败");
            let port = listener.local_addr().unwrap().port();
            let handle = std::thread::spawn(move || {
                for (status, body) in responses {
                    let Ok((mut stream, _)) = listener.accept() else {
                        return;
                    };
                    // 读请求（读到空行即头结束；body 我们不看）
                    let mut buffer = [0u8; 8192];
                    let _ = stream.read(&mut buffer);
                    let reason = match status {
                        200 => "OK",
                        400 => "Bad Request",
                        401 => "Unauthorized",
                        404 => "Not Found",
                        429 => "Too Many Requests",
                        500 => "Internal Server Error",
                        _ => "OK",
                    };
                    let response = format!(
                        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.as_bytes().len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                }
            });
            StubServer {
                base: format!("http://127.0.0.1:{port}"),
                handle: Some(handle),
            }
        }
    }

    impl Drop for StubServer {
        fn drop(&mut self) {
            // ── 为什么**不** join ─────────────────────────────
            // 替身线程阻塞在 `accept()` 上：一个用例只发了 1 个请求、却排了 3 个
            // 响应时，最后那个 `accept()` 永远不会返回。join 会把「用例已经跑完」
            // 变成「用例挂到测试框架超时」，排查成本极高。
            // 线程随测试进程退出即可（端口会随进程释放），这里只丢弃句柄。
            let _ = self.handle.take();
        }
    }
}
