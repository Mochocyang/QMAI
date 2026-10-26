//! 并发探活：测出哪条更新通道能通、多快。
//!
//! 探测对象是 `latest.json` 这种几百字节的小文件 —— 既验证"连通"，
//! 也验证"这个通道真的能取到更新清单"（jsDelivr 对 release 资产会 404）。
//!
//! 为什么连接超时单独设成 3 秒：用户抱怨过"点检查更新毫无反应 20 秒"。
//! 那种体感来自 TCP 连不上却一直等到总超时；连不上就该**立刻**换下一条。

use std::time::{Duration, Instant};

use crate::updater::channels::DIRECT_CHANNEL_ID;

pub const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
pub const PROBE_TOTAL_TIMEOUT: Duration = Duration::from_secs(5);
/// 探活结果缓存 10 分钟：网络状况不会一秒一变，每次都全量探活纯属浪费。
pub const PROBE_TTL_MS: i64 = 10 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeResult {
    pub channel_id: String,
    pub available: bool,
    pub rtt_ms: Option<u64>,
}

#[derive(Debug, Default)]
pub struct ProbeCache {
    content: Vec<ProbeResult>,
    at_ms: i64,
}

impl ProbeCache {
    pub fn store(&mut self, results: Vec<ProbeResult>, now_ms: i64) {
        self.content = results;
        self.at_ms = now_ms;
    }

    pub fn fresh(&self, now_ms: i64) -> Option<&[ProbeResult]> {
        if self.content.is_empty() || now_ms - self.at_ms > PROBE_TTL_MS {
            return None;
        }
        Some(&self.content)
    }
}

pub fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(PROBE_CONNECT_TIMEOUT)
        .timeout(PROBE_TOTAL_TIMEOUT)
        .user_agent("QMaiWrite-Updater")
        .build()
        .map_err(|error| format!("updater.client:{error}"))
}

/// 探一条 URL。任何失败都只是"不可用"，不是错误 ——
/// 「某条通道挂了」对用户来说不该是一条报错，只是换个通道的事。
pub fn probe_url(client: &reqwest::blocking::Client, url: &str) -> ProbeResult {
    // 返回的 `channel_id` 为空，由调用方回填 —— 这里不该假装知道自己在探哪条通道。
    let started = Instant::now();
    let available = client
        .get(url)
        .send()
        .map(|response| response.status().is_success())
        .unwrap_or(false);
    ProbeResult {
        channel_id: String::new(),
        available,
        rtt_ms: if available {
            Some(started.elapsed().as_millis() as u64)
        } else {
            None
        },
    }
}

/// 下载尝试顺序：可用的按 RTT 升序，不可用的排后面，`direct` 永远垫底。
///
/// 为什么 direct 垫底：它是唯一不依赖第三方、也永远不会"服务下线"的那条。
/// 即使探活时它很慢甚至失败，也留着最后一次尝试机会。
pub fn order_for_download(mut probed: Vec<ProbeResult>) -> Vec<ProbeResult> {
    probed.sort_by_key(|item| {
        let is_direct = item.channel_id == DIRECT_CHANNEL_ID;
        let bucket = if !is_direct {
            if item.available { 0 } else { 1 }
        } else {
            2
        };
        (bucket, item.rtt_ms.unwrap_or(u64::MAX))
    });
    probed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// 起一个极简 HTTP 替身：固定回一段 JSON。
    fn serve(body: &'static str) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let hits = Arc::new(AtomicUsize::new(0));
        let hits_clone = hits.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                hits_clone.fetch_add(1, Ordering::SeqCst);
                let mut buffer = [0u8; 1024];
                let _ = stream.read(&mut buffer);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (format!("http://127.0.0.1:{port}"), hits)
    }

    #[test]
    fn reachable_channel_is_reported_available_with_rtt() {
        let (base, _hits) = serve(r#"{"version":"1.0.0"}"#);
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let result = probe_url(&client, &base);
        assert!(result.available);
        assert!(result.rtt_ms.is_some());
    }

    #[test]
    fn unreachable_channel_is_unavailable_not_an_error() {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(400))
            .build()
            .unwrap();
        // 这个端口通常没人监听，连接会被立刻拒绝 —— 应该得到「不可用」，而不是 panic
        let result = probe_url(&client, "http://127.0.0.1:1/");
        assert!(!result.available);
        assert!(result.rtt_ms.is_none());
    }

    #[test]
    fn ordering_puts_available_first_then_by_rtt_and_keeps_direct_last() {
        let probed = vec![
            ProbeResult { channel_id: "slow".into(), available: true, rtt_ms: Some(900) },
            ProbeResult { channel_id: DIRECT_CHANNEL_ID.into(), available: true, rtt_ms: Some(100) },
            ProbeResult { channel_id: "fast".into(), available: true, rtt_ms: Some(200) },
            ProbeResult { channel_id: "dead".into(), available: false, rtt_ms: None },
        ];
        let ordered = order_for_download(probed);
        let ids: Vec<&str> = ordered.iter().map(|item| item.channel_id.as_str()).collect();
        // 可用的按 RTT 从小到大；不可用的排最后；direct 永远垫底兜底
        assert_eq!(ids, vec!["fast", "slow", "dead", DIRECT_CHANNEL_ID]);
    }

    #[test]
    fn direct_stays_last_even_when_it_is_the_fastest() {
        let probed = vec![
            ProbeResult { channel_id: DIRECT_CHANNEL_ID.into(), available: true, rtt_ms: Some(10) },
            ProbeResult { channel_id: "mirror".into(), available: true, rtt_ms: Some(500) },
        ];
        let ids: Vec<String> = order_for_download(probed)
            .into_iter()
            .map(|item| item.channel_id)
            .collect();
        assert_eq!(ids, vec!["mirror".to_string(), "direct".to_string()]);
    }

    #[test]
    fn cache_expires_after_ttl() {
        let mut cache = ProbeCache::default();
        let result = ProbeResult {
            channel_id: "fast".into(),
            available: true,
            rtt_ms: Some(120),
        };
        cache.store(vec![result], 1_700_000_000_000);
        assert!(cache.fresh(1_700_000_000_000 + 60_000).is_some(), "10 分钟内算新鲜");
        assert!(cache.fresh(1_700_000_000_000 + 11 * 60_000).is_none(), "超过 10 分钟要重探");
    }

    #[test]
    fn empty_cache_is_never_fresh() {
        let cache = ProbeCache::default();
        assert!(cache.fresh(i64::MAX).is_none());
    }

    #[test]
    fn probe_results_can_be_parsed_into_the_cache_shape() {
        // 时间戳用的是毫秒；用负数/极大值都不能 panic
        let mut cache = ProbeCache::default();
        cache.store(Vec::new(), 0);
        assert!(cache.fresh(0).is_none(), "空结果不算新鲜，要允许重探");
    }
}
