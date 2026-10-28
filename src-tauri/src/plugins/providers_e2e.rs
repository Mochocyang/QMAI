//! T5：假 provider 插件的**端到端**验证。
//!
//! 这里没有任何 mock：每个用例都用 `tests/fixtures/plugins/fake-provider/` 里的零依赖
//! Node 脚本真的起一个插件进程，走真实的 spawn → MCP 握手 → 端口分配 → 令牌注入 →
//! `/health` 探活 → `/v1/models` 抓取，再用 reqwest 真的发 HTTP/SSE 请求。
//! 这是 T5 的全部价值所在：桩可以证明「我调用了函数」，只有真进程能证明「它能当供应商」。
//!
//! ## 为什么单独一个文件，而不是并进 `mod.rs` 的 `#[cfg(test)] mod tests`
//!
//! 1. `mod.rs` 已经 1600+ 行，且有 30+ 条纯逻辑单测；e2e 用的是另一套脚手架
//!    （临时插件根目录、真实进程、真实 HTTP），混进去会让「哪条测试要跑 Node」变得难分辨。
//! 2. 本文件由 `mod.rs` 的 `#[cfg(test)] mod providers_e2e;` 引入，所以
//!    `cargo test --lib` 与 `cargo test --lib plugins::` 都会跑到它（不是 `tests/` 下的
//!    集成测试，那些需要另建 crate）。
//! 3. `TempRoot` / `node_available` 这两个小 helper 在这里**另有一份**（`plugins::tests`
//!    里也有一份，但它是 tests 模块私有的）。合并需要把私有脚手架改成 `pub(super)`，
//!    等于让纯单测的脚手架跟着 e2e 一起变；二十来行重复换「两套测试互不牵动」，这里选后者。
//!
//! ## 环境变量污染
//!
//! 全程**不改** `QMAI_PLUGIN_HOME`，也不 `set_var` 任何东西：插件根目录一律通过
//! `autostart_all(state, root)` / `start_plugin(root, ...)` 的 `root` 参数注入
//! （本仓以前有过「改环境变量污染并行测试」的前科）。需要「`/health` 恒返 500」的
//! 变体时，也只往**子进程自己**的环境里塞开关（见 [`install_health_failing_variant`]）。
//!
//! ## 与前端的分工
//!
//! 第 7 条（SSE）验证的是 **fixture 自己**符合设计 3.2 的契约（多分片 + usage + `[DONE]`）。
//! 宿主侧「不解析、不改写、字节流透传到前端」由 T3/T4 的前端测试覆盖，不在这里重复。

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::paths;
use super::providers;
use super::registry::{PluginRegistry, RegistryEntry, SourceRecord};
use super::{autostart_all, manifest, PluginsState};

/// 安装目录名 == 清单 `id`（注册表 load 会校验 key 与 entry.id 一致）。
const PLUGIN_ID: &str = "fake-provider";
/// `contributes.providers[0].id`，同时也是 `PluginsState.providers` 的键。
const PROVIDER_ID: &str = "fake-provider";

// ── 脚手架 ───────────────────────────────────────────────────────────────

fn node_available() -> bool {
    // 与本仓既有约定一致（`plugins::tests::node_available`）：找不到 node 就跳过并打印原因，
    // 绝不假装通过。
    std::process::Command::new("node")
        .arg("--version")
        .output()
        .is_ok()
}

fn fixture_dir() -> PathBuf {
    // 用 CARGO_MANIFEST_DIR 而不是相对路径：`cargo test` 的 cwd 是 crate 根，
    // 但被 IDE 或 `--manifest-path` 调用时不一定，锚在清单目录上才稳。
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("plugins")
        .join("fake-provider")
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to)
        .unwrap_or_else(|e| panic!("创建目录 {} 失败：{e}", to.display()));
    for entry in std::fs::read_dir(from)
        .unwrap_or_else(|e| panic!("读取 fixture 目录 {} 失败：{e}", from.display()))
    {
        let entry = entry.expect("读取 fixture 条目");
        let target = to.join(entry.file_name());
        let file_type = entry.file_type().expect("读取 fixture 条目类型");
        if file_type.is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target)
                .unwrap_or_else(|e| panic!("复制 {} 失败：{e}", entry.path().display()));
        }
    }
}

/// 把 fixture 装进临时插件根目录，并顺手断言**清单本身**是合法的 schema 2 provider 清单。
///
/// 这一步同时是不显眼的护栏：如果哪天清单改坏了（provider id 与内置撞车、少 `net:listen`、
/// 字段拼错被 `deny_unknown_fields` 拒），失败会停在这里并带上具体错误码，而不是在
/// 「进程起不来」的现象上打转。
fn install_fixture(root: &Path, plugin_id: &str) -> PathBuf {
    let source = fixture_dir();
    assert!(
        source.join("plugin.json").is_file(),
        "找不到 fixture 清单：{}（T5 的 fixture 必须随仓库提交）",
        source.display()
    );
    let dir = paths::plugin_dir(root, plugin_id);
    copy_dir(&source, &dir);

    let raw = std::fs::read_to_string(dir.join("plugin.json")).expect("读 fixture 清单");
    let parsed = manifest::PluginManifest::parse(&raw)
        .unwrap_or_else(|e| panic!("fixture 清单不合法：{} {}", e.code(), e.detail));
    assert_eq!(parsed.schema, 2, "fixture 必须是 schema 2");
    assert_eq!(parsed.id, plugin_id, "清单 id 必须与安装目录名一致");
    assert_eq!(
        parsed.contributes.providers.len(),
        1,
        "fixture 只声明一个 provider（v2.0 只接第一个）"
    );
    assert_eq!(parsed.contributes.providers[0].id, PROVIDER_ID);
    assert!(
        parsed.permissions.iter().any(|p| p == "net:listen"),
        "provider 插件必须申请 net:listen"
    );
    dir
}

/// 把探活预算压到 `ms`。
///
/// 失败用例一定要等满一轮 `startTimeoutMs`（`wait_until_healthy` 的预算就是它）。
/// fixture 里写的是 15s（真实插件的合理值），但让测试套干等 15 秒不值得：这里只改
/// 临时副本，行为不变。
fn shrink_start_timeout(dir: &Path, ms: u64) {
    let manifest_path = dir.join("plugin.json");
    let raw = std::fs::read_to_string(&manifest_path).expect("读清单");
    let mut value: serde_json::Value = serde_json::from_str(&raw).expect("fixture 清单应是 JSON");
    value["runtime"]["startTimeoutMs"] = serde_json::json!(ms);
    std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&value).expect("序列化清单"),
    )
    .expect("写清单");
}

/// 造一份「`/health` 恒返 500」的变体，用来验证探活失败路径（计划 §6 第 3 条）。
///
/// 真实脚本不改：把它改名成 `provider.js`，入口 `index.js` 只做两件事 —— 在**子进程内**
/// 打开开关，再加载真实脚本。
///
/// 为什么不是 `std::env::set_var("QMAI_FAKE_HEALTH_FAIL", "1")`：那是进程级全局状态，
/// 会同时影响并行跑着的其它用例（它们也会起同一个 fixture，于是集体探活失败）。
/// 子进程的环境变量是天然隔离的，测试之间不会互相踩。
fn install_health_failing_variant(dir: &Path) {
    let real_entry = dir.join("provider.js");
    std::fs::rename(dir.join("index.js"), &real_entry).expect("改名 fixture 入口");
    std::fs::write(
        dir.join("index.js"),
        "process.env.QMAI_FAKE_HEALTH_FAIL = \"1\";\nrequire(\"./provider.js\");\n",
    )
    .expect("写探活失败变体入口");
    // `startTimeoutMs` **同时**是握手预算和探活预算，所以这里不能压太狠：
    // 全量并行跑（600+ 用例）时 node 起来 + 握手的耗时能到 1 秒以上，压到 1.5s 会把
    // 「探活失败」的用例变成「握手超时」的假红（实跑复现过一次）。
    // 5s 给握手留够余量，同时探活失败最多只等 5s —— 与前一条用例并跑时，这点等待基本
    // 被其它用例盖掉，不会让整个套件慢多少。
    shrink_start_timeout(dir, 5_000);
}

/// 落一份「已启用」的注册表 —— `autostart_all` 只拉起 `enabled: true` 的条目。
fn write_registry(root: &Path, plugin_id: &str) {
    let mut registry = PluginRegistry::load(root).expect("空注册表可加载");
    registry.upsert(RegistryEntry {
        id: plugin_id.to_string(),
        version: "1.0.0".to_string(),
        enabled: true,
        // 用户在启用确认层勾选的就是它（provider 插件必须持有 net:listen）。
        granted_permissions: vec!["net:listen".to_string()],
        source: SourceRecord {
            repo: "local://src-tauri/tests/fixtures/plugins/fake-provider".to_string(),
            git_ref: "main".to_string(),
            commit: "fixture".to_string(),
            zip_sha256: "0".repeat(64),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
        },
    });
    registry.save(root).expect("写注册表");
}

/// 临时插件根目录；Drop 时清掉，避免测试在 %TEMP% 下越积越多。
struct TempRoot(PathBuf);

impl TempRoot {
    fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "qmai-plugins-e2e-{tag}-{}",
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
        // 删不掉不算测试失败，但**要重试**：Windows 上子进程的 cwd 会锁住插件目录，
        // 而 panic 展开时子进程是被 `kill_on_drop` 异步杀掉的 —— 删除可能抢在进程真正
        // 退出之前，于是留下垃圾目录（实跑里留下过 4 个）。
        for _ in 0..20 {
            match std::fs::remove_dir_all(&self.0) {
                Ok(()) => return,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(25)),
            }
        }
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 起好的一份 fixture：临时根目录 + 运行状态。
///
/// **字段顺序有意义**：`state` 必须在 `root` 前面。用例 panic 时（没走到 `stop()`）
/// Rust 按声明顺序 drop 字段，先 drop `state` 才会把子进程杀掉，之后 `TempRoot` 才能删掉
/// 目录；反过来会先删目录、再杀进程，留下一个删不掉的临时目录。
struct FakeProvider {
    state: PluginsState,
    root: TempRoot,
}

impl FakeProvider {
    /// 正常变体：`/health` 与 `/v1/*` 都按契约工作。
    async fn boot(tag: &str) -> Option<Self> {
        Self::boot_with(tag, false).await
    }

    /// 探活失败变体：`/health` 恒返 500，`/v1/*` 仍然可用。
    async fn boot_health_failing(tag: &str) -> Option<Self> {
        Self::boot_with(tag, true).await
    }

    /// 返回 `None` **只表示本机没有 node**（调用方打印跳过原因后 return）。
    /// 其它任何失败都直接 panic：T5 要的就是「真起不来」这种证据，不能被降级成跳过。
    async fn boot_with(tag: &str, health_failing: bool) -> Option<Self> {
        if !node_available() {
            return None;
        }
        let root = TempRoot::new(tag);
        let dir = install_fixture(root.path(), PLUGIN_ID);
        if health_failing {
            install_health_failing_variant(&dir);
        }
        write_registry(root.path(), PLUGIN_ID);

        let state = PluginsState::default();
        // 用假端口，避免测试真的起一个宿主 API 服务（与 `plugins::tests` 同款做法）：
        // fixture 从不反调宿主，`register_session` 也不需要服务在线。
        *state.host_port.lock().expect("宿主端口状态") = Some(1);

        let fake = Self { root, state };
        fake.start_expecting(health_failing).await;

        // 插件都没起来的话，后面每条断言都会在「没有 provider」上失败，报错位置离真正
        // 的原因很远。这里先卡住一次，并指向上面 `[plugins] ... 自动启动失败` 的日志。
        assert!(
            fake.provider().await.is_some(),
            "插件已自动启动，但 provider 没有登记（插件进程可能没起来：看上方 [plugins] 日志）"
        );
        Some(fake)
    }

    /// 启动到「provider 进入预期状态」，允许**一次**重试。
    ///
    /// 预期状态：正常变体 `ready == true`；探活失败变体 `ready == false` 且原因是插件自己
    /// 返 500（否则这条用例会因为别的原因「恰好」通过，什么也没证明）。
    ///
    /// 重试的原因只有一个，而且是环境/实现层面的，不是插件作者写错了：宿主
    /// `providers::allocate_port()` 是「bind 0 拿到号 → 立刻关闭 → 把号交给插件」，
    /// 从释放到插件真正 `listen()` 之间隔着一整个 spawn + MCP 握手（几百毫秒）。
    /// 这条窗口里别的进程（包括本测试套件里并行跑的其它用例）完全可能拿走同一个端口，
    /// 于是插件 bind 失败、连接层面根本没人在监听。
    ///
    /// 设计 D4（v2.0 定稿，`382bc275`）明确：宿主只分配一次端口、**不做**重分配，也不引入
    /// 专用错误码 —— 端口冲突只靠随后的 `/health` 兜底（插件进程不会因此崩，只是
    /// `ready=false` + 可读的 `last_error`）。这是有意的产品取舍，不是遗漏。
    ///
    /// 但它对测试套件意味着偶发假红：端口窗口是真实存在的（已在一次 620 条全量跑里复现）。
    /// 所以**测试这边**替它重试一次 —— 被测行为（真进程、真 HTTP、ready 语义）一点没变，
    /// 只是别让环境噪声冒充回归。重试仍然只允许一次，第二次失败照旧报错。
    ///
    /// 只对**纯传输层**失败重试：错误里出现了 HTTP 状态码（例如 `/health` 返 500）
    /// 说明插件起来了但作者写错了，那不是端口抢占，重试只会把真 bug 掩盖成偶发。
    async fn start_expecting(&self, health_failing: bool) {
        for attempt in 1..=2u8 {
            autostart_all(&self.state, self.root.path())
                .await
                .expect("autostart_all 本身不该报错（单个插件失败只记日志）");

            let provider = self.provider().await;
            let plugin_missing = provider.is_none();
            let (ready, last_error) = match provider {
                Some(provider) => (provider.ready, provider.last_error.unwrap_or_default()),
                None => (false, String::new()),
            };
            let as_expected = if health_failing {
                // 探活失败变体：必须是「/health 返回 500」这种失败，而不是连不上。
                !ready && last_error.contains("返回 500")
            } else {
                ready
            };
            if as_expected {
                return;
            }

            // 两种「不是插件作者的错」的失败，允许重试一次：
            // - 插件压根没登记：spawn / 握手在满负载下超时（本机 620 条并行跑时出现过一次
            //   「1500ms 内未完成握手」）；
            // - 连接层面没人监听：探活原因里只有传输层失败（`请求 … 失败`）、没有任何 HTTP
            //   状态码（`返回 <code>`）—— 也就是上面说的端口抢占。不依赖 reqwest 的报错原文。
            let port_race_only = last_error.contains("未通过 /health 探活")
                && last_error.contains("请求 ")
                && !last_error.contains("返回 ");
            assert!(
                plugin_missing || port_race_only,
                "provider 没有进入预期状态（health_failing={health_failing}），且不是端口抢占/启动超时：{last_error}（插件进程可能没起来：看上方 [plugins] 日志）"
            );
            assert!(
                attempt == 1,
                "重试后仍未进入预期状态（不是一次性的环境问题，别把它当偶发）：{last_error}"
            );
            eprintln!(
                "[e2e] 第 1 次启动的 provider 未进入预期状态（{}），重试一次",
                if plugin_missing {
                    "插件没起来：spawn/握手在满负载下超时".to_string()
                } else {
                    format!("端口在宿主释放与插件 bind 之间被抢走（D4 定稿：宿主不重分配，只靠 /health 兜底）：{last_error}")
                }
            );
            // 清进程与登记；下一次 autostart_all 会重新分配一个新端口。
            super::shutdown_all(&self.state)
                .await
                .expect("停掉本次启动的插件");
        }
    }

    /// 当前登记（克隆一份，避免测试里持锁跨 await）。
    async fn provider(&self) -> Option<providers::PluginProvider> {
        self.state.providers.lock().await.get(PROVIDER_ID).cloned()
    }

    /// 已在 boot 里断言过存在；这条给「存在是前置条件」的用例用。
    async fn expect_ready_provider(&self) -> providers::PluginProvider {
        let provider = self.provider().await.expect("provider 必须已登记");
        assert!(
            provider.ready,
            "provider 应当已就绪，lastError={:?}",
            provider.last_error
        );
        provider
    }

    fn root(&self) -> &Path {
        self.root.path()
    }

    /// 停进程 + 注销宿主 session。
    ///
    /// **必须在用例结束前调用**：Windows 上子进程的 cwd 会锁住插件目录，
    /// 临时目录要等进程真的退出才能删掉；而 `Drop` 里不能 await。
    async fn stop(self) {
        super::shutdown_all(&self.state)
            .await
            .expect("停掉所有插件");
    }
}

fn http_client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .expect("构造 reqwest client")
}

/// 从 `baseUrl` 里取端口（宿主分配的，测试不允许写死）。
fn port_of(base_url: &str) -> u16 {
    base_url
        .rsplit(':')
        .next()
        .and_then(|port| port.parse().ok())
        .unwrap_or_else(|| panic!("baseUrl 里应当有端口：{base_url}"))
}

/// 发一次 HTTP 请求，**只对传输层失败**重试一次。
///
/// 全量并行跑（600+ 用例 + 8 个 node 子进程）时，本机偶发把 `127.0.0.1` 解析失败报成
/// `dns error (11001)` —— 一次全量跑里真的复现过。那是环境噪声，不是插件行为，不该让用例假红。
/// **HTTP 状态码不重试**：401 / 500 / 200 正是断言的目标，重试等于掩盖被测行为。
///
/// 用 `try_clone` 而不是重跑构造逻辑：json body 是字节，可克隆；真克隆不了就直接报错，
/// 不静默退化成「只试一次」。
async fn send_request(builder: reqwest::RequestBuilder) -> reqwest::Response {
    let retry = builder
        .try_clone()
        .expect("请求体应可克隆（重试用），否则这条用例无法抗偶发连接失败");
    match builder.send().await {
        Ok(response) => response,
        Err(first_error) => retry.send().await.unwrap_or_else(|retry_error| {
            panic!("插件端点连不上（已重试一次）：{retry_error}（第一次：{first_error}）")
        }),
    }
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_files(&path, out);
        } else if file_type.is_file() {
            out.push(path);
        }
    }
}

// ── 计划 §6 第 1 条 ─────────────────────────────────────────────────────

/// 装 → 自动启动 → provider 就绪 → 模型列表里该有的有、该丢的丢。
///
/// 走 `autostart_all(state, root)`（它接收 root 参数，不必改 `QMAI_PLUGIN_HOME`）。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn end_to_end_provider_becomes_ready_with_models() {
    let Some(fake) = FakeProvider::boot("ready").await else {
        eprintln!("跳过：本机没有可执行的 node");
        return;
    };

    let provider = fake.expect_ready_provider().await;
    assert!(!provider.token.is_empty(), "宿主必须给 provider 生成令牌");
    assert_eq!(provider.plugin_id, PLUGIN_ID);
    assert_eq!(provider.provider_id, PROVIDER_ID);
    assert_eq!(provider.last_error, None, "就绪状态下不该有失败原因");
    assert!(
        provider.base_url.starts_with("http://127.0.0.1:"),
        "端点必须绑在回环地址上（设计 D4）：{}",
        provider.base_url
    );
    assert_eq!(provider.auth_kind, "none");
    assert_eq!(provider.capabilities, vec!["models.refresh".to_string()]);

    let ids: Vec<&str> = provider.models.iter().map(|m| m.id.as_str()).collect();
    // fixture 声明了 3 个模型，缺窗口的那个必须被宿主丢掉 —— 精确断言数量，
    // 否则「3 个都在」也会被 contains 断言放过。
    assert_eq!(
        provider.models.len(),
        2,
        "fixture 声明 3 个模型，缺 maxInputTokens 的那个必须被宿主丢弃，实际：{ids:?}"
    );
    assert!(ids.contains(&"good-model"), "完整声明的模型必须留下：{ids:?}");
    assert!(
        ids.contains(&"small-window-model"),
        "丢弃是按模型而不是按插件：同插件的其它模型必须留下：{ids:?}"
    );
    assert!(
        !ids.contains(&"no-window-model"),
        "缺 maxInputTokens 的模型必须被丢弃（设计 3.4：剪裁依赖它）：{ids:?}"
    );

    // `plugins_providers()` 返回的就是 `view()`：里面绝不能有令牌（计划第 0 节）。
    let view = serde_json::to_value(provider.view()).expect("视图可序列化");
    assert!(view.get("token").is_none(), "给前端的视图不能有 token 字段");
    assert!(
        !serde_json::to_string(&view)
            .expect("视图可序列化")
            .contains(&provider.token),
        "给前端的视图里不能出现 provider token"
    );
    assert_eq!(view["ready"], true);
    assert_eq!(view["baseUrl"], provider.base_url);
    assert_eq!(view["models"].as_array().map(Vec::len), Some(2));

    fake.stop().await;
}

// ── 计划 §6 第 2 条 ─────────────────────────────────────────────────────

/// 不带令牌直接打端点 → 401；带对的令牌 → 200。
///
/// 这条防的是「本机任何进程都能白嫖插件，进而白嫖用户的账号额度」（设计 3.3）。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn provider_endpoint_rejects_requests_without_the_token() {
    let Some(fake) = FakeProvider::boot("auth").await else {
        eprintln!("跳过：本机没有可执行的 node");
        return;
    };

    let provider = fake.expect_ready_provider().await;
    // 令牌走 `plugins_provider_auth` 同一条路：那个命令的实现就是
    // `providers.get(provider_id).map(|p| p.token.clone())`，这里读的是同一个字段。
    let token = provider.token.clone();
    assert!(!token.is_empty(), "没有令牌，这条断言就没有意义");
    let url = format!("{}/v1/models", provider.base_url);
    let client = http_client(Duration::from_secs(5));

        let anonymous = send_request(client.get(&url)).await;
    assert_eq!(
        anonymous.status().as_u16(),
        401,
        "不带 Authorization 必须 401（否则本机任何进程都能白嫖）"
    );
    let body = anonymous.text().await.expect("读 401 响应体");
    assert!(
        body.contains("unauthorized"),
        "401 响应体应说明原因：{body}"
    );

    // 有 Authorization 但令牌不对：也必须 401。只判「有没有这个头」等于没鉴权。
    let wrong_token = send_request(client.get(&url).bearer_auth("definitely-not-the-token")).await;
    assert_eq!(
        wrong_token.status().as_u16(),
        401,
        "错的令牌也必须 401，不能只判 Authorization 头存在"
    );

    let authorized = send_request(client.get(&url).bearer_auth(&token)).await;
    assert_eq!(
        authorized.status().as_u16(),
        200,
        "带正确令牌必须 200（宿主抓模型走的就是这条）"
    );
    let payload: serde_json::Value = authorized.json().await.expect("模型列表应是 JSON");
    // 端点本身返回 3 个：丢弃缺窗口的模型是**宿主侧**的行为（第 1 条已验证），
    // 这里不顺带把两件事混在一起。
    assert_eq!(
        payload["data"].as_array().map(Vec::len),
        Some(3),
        "fixture 应返回全部 3 个模型：{payload}"
    );

    fake.stop().await;
}

// ── 计划 §6 第 3 条 ─────────────────────────────────────────────────────

/// 探活失败：插件照常启动、进程不被杀，provider 记成 `ready=false` + `last_error`。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn provider_probe_failure_marks_not_ready_without_killing_the_plugin() {
    let Some(fake) = FakeProvider::boot_health_failing("probe-fail").await else {
        eprintln!("跳过：本机没有可执行的 node");
        return;
    };

    // `start_plugin` / `autostart_all` 都返回了 Ok（boot 里已解构），这里确认登记内容。
    let provider = fake
        .provider()
        .await
        .expect("探活失败的 provider 也要登记，界面才能灰显并给出原因");
    assert!(!provider.ready, "探活没过就不能标成 ready");
    let error = provider.last_error.clone().unwrap_or_default();
    assert!(
        error.contains("/health"),
        "失败原因要能展示给用户（含探活目标）：{error}"
    );
    assert!(
        error.contains("500"),
        "要把插件的 HTTP 状态码带出来，否则分不清「没监听」和「起了但返 500」：{error}"
    );
    assert!(
        provider.models.is_empty(),
        "探活都没过就不该去抓模型（否则错误会被后一步覆盖）"
    );

    // 最关键的半条：进程必须还活着。provider 只是插件能力的一部分，探活失败不等于插件坏了。
    {
        let mut running = fake.state.running.lock().await;
        let handle = running
            .get_mut(PLUGIN_ID)
            .expect("探活失败后插件进程必须还在 running 表里");
        assert_eq!(handle.state.as_str(), "running", "插件状态不该被探活失败拖成失败");
        assert!(
            handle
                .child
                .try_wait()
                .expect("查询子进程状态")
                .is_none(),
            "探活失败不能杀插件进程"
        );
    }

    fake.stop().await;
}

// ── 计划 §6 第 4 条 ─────────────────────────────────────────────────────

/// 停用后：provider 从 registry 消失、进程停掉、端口可被重新绑定。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disabling_the_plugin_removes_the_provider_and_frees_the_port() {
    let Some(fake) = FakeProvider::boot("disable").await else {
        eprintln!("跳过：本机没有可执行的 node");
        return;
    };

    let provider = fake.expect_ready_provider().await;
    let base_url = provider.base_url.clone();
    let port = port_of(&base_url);

    // 与 `plugins_disable` 命令同一段编排：先 `stop_plugin`（杀进程 + 清 provider 登记），
    // 再把开关落盘。命令层只多了 `State` 解包，不必为了它去构造 Tauri 的 `State`。
    super::stop_plugin(&fake.state, PLUGIN_ID).await;
    {
        let mut registry = PluginRegistry::load(fake.root()).expect("注册表可加载");
        registry.set_enabled(PLUGIN_ID, false).expect("插件应在注册表里");
        registry.save(fake.root()).expect("保存注册表");
    }

    assert!(
        fake.provider().await.is_none(),
        "停用后该 provider 必须从 registry 消失（token 也随之丢弃）"
    );
    assert!(
        fake.state.running.lock().await.is_empty(),
        "停用后 running 表必须为空"
    );

    // 端点真的不可用了：连接应当被拒绝，而不是「进程还在但没人查」。
    let client = http_client(Duration::from_secs(2));
    assert!(
        client
            .get(format!("{base_url}/health"))
            .send()
            .await
            .is_err(),
        "停用后旧端点必须连不上"
    );

    // 端口交还给内核：能重新 bind 才算「收回了」。Windows 上活跃连接会让端口短暂
    // 处于 TIME_WAIT，所以给一个短暂的重试窗口；真被占用时不可能 2 秒后突然空闲。
    let mut last_error = String::new();
    let mut freed = false;
    for _ in 0..40 {
        match std::net::TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => {
                drop(listener);
                freed = true;
                break;
            }
            Err(error) => {
                last_error = error.to_string();
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
    assert!(
        freed,
        "停用后端口 {port} 必须能被重新绑定，最后一次错误：{last_error}"
    );

    // 只杀进程不落盘的话，下次启动 `autostart_all` 又会把它拉起来。
    let registry = PluginRegistry::load(fake.root()).expect("注册表可加载");
    assert_eq!(
        registry.get(PLUGIN_ID).map(|entry| entry.enabled),
        Some(false),
        "停用必须落盘"
    );

    fake.stop().await;
}

// ── 计划 §6 第 5 条 ─────────────────────────────────────────────────────

/// 走完第 1 条之后，遍历整个插件根目录（含 `.registry.json`），任何文件里都搜不到令牌。
///
/// 这是计划第 0 节那条硬约束的自动化版本：令牌只在内存，请求前现取。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn provider_token_is_never_written_to_disk() {
    let Some(fake) = FakeProvider::boot("token-on-disk").await else {
        eprintln!("跳过：本机没有可执行的 node");
        return;
    };

    let provider = fake.expect_ready_provider().await;
    let token = provider.token.clone();
    assert!(token.len() >= 32, "令牌应是完整的 uuid：{token:?}");
    assert!(
        fake.state.running.lock().await.contains_key(PLUGIN_ID),
        "插件进程应在跑（令牌此刻只应存在于内存与子进程环境里）"
    );

    let mut files = Vec::new();
    collect_files(fake.root(), &mut files);

    // 别让「一个文件都没扫到」这种空转通过。
    assert!(
        files.len() >= 3,
        "应至少扫到清单、入口与注册表，实际 {:?}",
        files
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
    );
    assert!(
        files
            .iter()
            .any(|path| path.file_name().map(|name| name == ".registry.json").unwrap_or(false)),
        "必须包含 .registry.json：{:?}",
        files
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
    );

    // 注：`<id>.data/` 只在插件通过 HostApi 写数据之后才存在，这个 fixture 不写，
    // 所以这里不强行造一个来假装验证过；一旦它存在，下面的递归遍历自然覆盖。
    for path in &files {
        let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("读 {} 失败：{e}", path.display()));
        let text = String::from_utf8_lossy(&bytes);
        assert!(
            !text.contains(&token),
            "provider token 落盘了：{}",
            path.display()
        );
        assert!(
            !path.to_string_lossy().contains(&token),
            "文件名里出现了 provider token：{}",
            path.display()
        );
    }

    fake.stop().await;
}

// ── 计划 §6 第 6 条 ─────────────────────────────────────────────────────

/// 插件声明的上下文窗口原样到达宿主：小窗口不被下限抬高（T4 修复的后端侧确认）。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn plugin_provider_models_carry_their_declared_context_window() {
    let Some(fake) = FakeProvider::boot("window").await else {
        eprintln!("跳过：本机没有可执行的 node");
        return;
    };

    let provider = fake.expect_ready_provider().await;

    let small = provider
        .models
        .iter()
        .find(|model| model.id == "small-window-model")
        .expect("small-window-model 必须在列");
    assert_eq!(
        small.max_input_tokens, 32_768,
        "小窗口必须原样透传：T4 修的就是「不再被下限抬到 204800」"
    );
    assert_eq!(small.max_output_tokens, 4_096);
    assert!(!small.supports_tool_call, "没声明 supportsToolCall 就应是 false");
    assert_eq!(small.name, "小窗口模型", "展示名应取 _qmai.displayName");

    let good = provider
        .models
        .iter()
        .find(|model| model.id == "good-model")
        .expect("good-model 必须在列");
    assert_eq!(good.max_input_tokens, 204_800);
    assert_eq!(good.max_output_tokens, 8_192);
    assert!(good.supports_tool_call);
    assert_eq!(good.credit_multiplier, Some(0.5));

    // 同一份列表里两个窗口必须不同：相等就说明有一处的值被另一处覆盖（或都被抬到了同一个下限）。
    assert_ne!(good.max_input_tokens, small.max_input_tokens);

    fake.stop().await;
}

// ── 计划 §6 第 7 条 ─────────────────────────────────────────────────────

/// 真流式读 `/v1/chat/completions`：至少 3 个内容分片、出现 `usage`、以 `[DONE]` 结束。
///
/// 这条验证的是 **fixture 自己**符合设计 3.2 的契约；宿主侧的 SSE 透传由 T3/T4 的
/// 前端测试覆盖（这里不重复，也不假装覆盖了）。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn provider_sse_stream_delivers_multiple_chunks_and_usage() {
    let Some(fake) = FakeProvider::boot("sse").await else {
        eprintln!("跳过：本机没有可执行的 node");
        return;
    };

    let provider = fake.expect_ready_provider().await;
    let url = format!("{}/v1/chat/completions", provider.base_url);
    let client = http_client(Duration::from_secs(10));

    let response = send_request(
        client
            .post(&url)
            .bearer_auth(&provider.token)
            .json(&serde_json::json!({
                "model": "good-model",
                "stream": true,
                "messages": [{ "role": "user", "content": "写一句测试" }],
            })),
    )
    .await;
    assert_eq!(response.status().as_u16(), 200, "SSE 请求应 200");

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    assert!(
        content_type.starts_with("text/event-stream"),
        "流式响应必须是 text/event-stream：{content_type:?}"
    );

    // 逐块读（`Response::chunk()` 不需要额外的 feature，也不新增依赖）。
    // **按字节累积、最后才解码**：分块会切在多字节 UTF-8 字符中间，逐块 lossy 解码会
    // 把中文变成替换符，然后测试会以「内容不对」的形式误导人。
    let mut response = response;
    let mut raw: Vec<u8> = Vec::new();
    let mut reads = 0usize;
    while let Some(chunk) = response.chunk().await.expect("读取流式分块") {
        reads += 1;
        raw.extend_from_slice(&chunk);
    }
    let text = String::from_utf8(raw).expect("SSE 报文应是合法 UTF-8");

    let events: Vec<&str> = text
        .split("\n\n")
        .filter(|event| !event.trim().is_empty())
        .collect();
    let mut pieces: Vec<String> = Vec::new();
    let mut usage: Option<serde_json::Value> = None;
    let mut done_at: Option<usize> = None;

    for (index, event) in events.iter().enumerate() {
        // SSE 的 `data:` 后面可以没有空格（规范允许），两种都认。
        let payload = event.lines().find_map(|line| {
            line.strip_prefix("data: ")
                .or_else(|| line.strip_prefix("data:"))
                .map(str::trim)
        });
        let Some(payload) = payload else {
            continue;
        };
        if payload == "[DONE]" {
            done_at = Some(index);
            continue;
        }
        let value: serde_json::Value =
            serde_json::from_str(payload).unwrap_or_else(|e| panic!("每个 data 帧都应是 JSON：{payload}（{e}）"));
        if let Some(choices) = value.get("choices").and_then(|choices| choices.as_array()) {
            for choice in choices {
                if let Some(piece) = choice
                    .get("delta")
                    .and_then(|delta| delta.get("content"))
                    .and_then(|content| content.as_str())
                {
                    if !piece.is_empty() {
                        pieces.push(piece.to_string());
                    }
                }
            }
        }
        if let Some(found) = value.get("usage").filter(|usage| !usage.is_null()) {
            usage = Some(found.clone());
        }
    }

    assert_eq!(
        pieces.len(),
        3,
        "应有 3 个内容分片（设计 3.2：不能一次性给完），实际 {pieces:?}"
    );
    assert!(
        pieces.iter().all(|piece| !piece.is_empty()),
        "内容分片不能为空：{pieces:?}"
    );
    {
        let unique: std::collections::HashSet<&String> = pieces.iter().collect();
        assert_eq!(unique.len(), 3, "分片内容应互不相同，否则可能是同一帧被重复读到：{pieces:?}");
    }
    let reassembled = pieces.concat();
    assert!(
        !reassembled.trim().is_empty(),
        "拼接后的正文不能为空：{pieces:?}"
    );

    let usage = usage.expect("SSE 必须带一个 usage 分片，否则用量统计会全是 0（设计 3.2 第 3 条）");
    assert_eq!(usage["prompt_tokens"], 10, "usage.prompt_tokens 应原样透传");
    assert_eq!(usage["completion_tokens"], 5, "usage.completion_tokens 应原样透传");
    assert_eq!(usage["total_tokens"], 15, "usage.total_tokens 应原样透传");

    let done_at = done_at.expect("SSE 必须以 data: [DONE] 结束，否则客户端会一直等流结束");
    assert_eq!(
        done_at,
        events.len() - 1,
        "[DONE] 必须是最后一帧（后面还有 {} 帧）",
        events.len() - 1 - done_at
    );

    // 真流式的旁证：分片间隔 40ms，若客户端一次读完全部内容，说明链路把流整体缓冲了。
    assert!(
        reads >= 2,
        "流式读只拿到 {reads} 次数据，说明整体缓冲了（fixture 的分片间隔是 40ms）"
    );

    // 同一 fixture 的非流式分支顺手验证（不加新用例，省一次进程启动）：
    // `stream: false` 必须回普通 JSON，且同样带 usage。
    let json_response = send_request(
        client
            .post(&url)
            .bearer_auth(&provider.token)
            .json(&serde_json::json!({
                "model": "good-model",
                "stream": false,
                "messages": [{ "role": "user", "content": "写一句测试" }],
            })),
    )
    .await;
    assert_eq!(json_response.status().as_u16(), 200);
    let json_content_type = json_response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    assert!(
        json_content_type.starts_with("application/json"),
        "stream=false 必须是普通 JSON：{json_content_type:?}"
    );
    let payload: serde_json::Value = json_response.json().await.expect("非流式响应应是 JSON");
    assert_eq!(payload["usage"]["total_tokens"], 15, "非流式响应也必须带 usage");
    assert!(
        payload["choices"][0]["message"]["content"]
            .as_str()
            .map(|content| !content.is_empty())
            .unwrap_or(false),
        "非流式响应应有正文：{payload}"
    );

    fake.stop().await;
}

// ── `ready` 只有一种语义（`/health` 通过）─────────────────────────────────

/// `/health` 恒失败时刷新模型：必须返回 Err、`ready` 保持 false、**已缓存的模型不被清空**。
///
/// 用**运行中切换**（fixture 的 `POST /__fixture/health-fail`）而不是「起一个探活失败的
/// 新实例」：新实例在启动时就没抓到过模型，「缓存没被清空」会退化成「空列表还是空的」，
/// 几乎证明不了任何事。同一个实例上先健康（已有缓存）再切坏，断言才有真内容；
/// 再切回健康还能顺带证明 `ready` 会随探活恢复。
///
/// 这条防的是一个具体的错法：刷新时先抓模型、抓成功就 `ready = true` —— 于是一个
/// `/health` 恒 500 的插件，只要 `/v1/models` 能返回，就会被界面判成「就绪」，
/// 「要不要重试」的判据也跟着失真。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refresh_models_does_not_flip_ready_when_health_is_failing() {
    let Some(fake) = FakeProvider::boot("refresh-ready").await else {
        eprintln!("跳过：本机没有可执行的 node");
        return;
    };

    // 前置：正常启动 → ready=true 且已缓存模型（下面「不清缓存」才有对象可断言）。
    let provider = fake.expect_ready_provider().await;
    let cached: Vec<String> = provider.models.iter().map(|model| model.id.clone()).collect();
    assert_eq!(
        cached.len(),
        2,
        "前置：正常启动应已抓到 2 个模型（缺窗口那个被丢弃），实际 {cached:?}"
    );

    let client = http_client(Duration::from_secs(10));
    let control = format!("{}/__fixture/health-fail", provider.base_url);
    let health = format!("{}/health", provider.base_url);

    // 1) 运行中把 /health 切坏，并确认开关真的生效（否则这条用例可能在测一个空开关）。
    let toggled = send_request(
        client
            .post(&control)
            .bearer_auth(&provider.token)
            .json(&serde_json::json!({ "fail": true })),
    )
    .await;
    assert_eq!(toggled.status().as_u16(), 200, "控制端点应接受切换");
    let probe = send_request(client.get(&health)).await;
    assert_eq!(probe.status().as_u16(), 500, "开关必须真的让 /health 返 500");

    // 2) 刷新：探活失败 → Err + ready=false + 原因落库 + **缓存不清**。
    //    探活预算压到 800ms：被测行为与超时长度无关，只是别让用例干等 5 秒
    //   （与启动用例压缩 startTimeoutMs 同一取舍）。
    let error = super::refresh_provider_models(&fake.state, PROVIDER_ID, Duration::from_millis(800))
        .await
        .expect_err("探活失败时刷新必须返回 Err（界面才能提示）");
    assert!(error.contains("/health"), "错误应说明是探活失败：{error}");

    let after = fake.provider().await.expect("provider 仍在登记表里");
    assert!(
        !after.ready,
        "ready 只表示 /health 通过：/health 返 500 时绝不能是 true（本用例要防的就是这个）"
    );
    let last_error = after.last_error.clone().unwrap_or_default();
    assert!(
        last_error.contains("/health"),
        "探活失败原因必须落进登记里（界面要显示）：{last_error:?}"
    );
    assert!(
        last_error.contains("500"),
        "原因里要能看到插件的状态码，否则分不清「没监听」和「起了但 500」：{last_error:?}"
    );
    let ids_after: Vec<String> = after.models.iter().map(|model| model.id.clone()).collect();
    assert_eq!(
        ids_after, cached,
        "刷新失败不能清掉已缓存的模型（用户只是点了下刷新，不是要清空列表）"
    );

    // 3) 切回健康：刷新应成功，ready 回到 true、上一次的失败原因被清掉、模型仍是那两个。
    let restored = send_request(
        client
            .post(&control)
            .bearer_auth(&provider.token)
            .json(&serde_json::json!({ "fail": false })),
    )
    .await;
    assert_eq!(restored.status().as_u16(), 200);
    let probe = send_request(client.get(&health)).await;
    assert_eq!(probe.status().as_u16(), 200, "切回后 /health 必须恢复 200");

    let models = super::refresh_provider_models(&fake.state, PROVIDER_ID, Duration::from_millis(800))
        .await
        .expect("健康恢复后刷新应成功");
    assert_eq!(models.len(), 2, "刷新应重新抓到 2 个模型");
    let recovered = fake.provider().await.expect("provider 仍在登记表里");
    assert!(recovered.ready, "健康恢复后 ready 必须回到 true");
    assert_eq!(recovered.last_error, None, "成功刷新应清掉上一次的失败原因");
    assert_eq!(
        recovered
            .models
            .iter()
            .map(|model| model.id.clone())
            .collect::<Vec<_>>(),
        cached
    );

    fake.stop().await;
}
