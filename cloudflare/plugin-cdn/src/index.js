/**
 * QMAI 插件市场的内容通道（Cloudflare Worker）
 *
 * 作用：把 GitHub 的内容（索引 JSON、插件 zip）经 qmai.pro 转发，缓解
 * `raw.githubusercontent.com` / `codeload.github.com` 在国内的不可达与抖动。
 *
 * 约定（与 gh-proxy.com 相同）：路径去掉前缀后就是完整目标 URL。
 *   GET https://qmai.pro/plugins-cdn/https://raw.githubusercontent.com/owner/repo/main/plugins/index.json
 *   GET https://qmai.pro/plugins-cdn/https://github.com/owner/repo/archive/refs/heads/main.zip
 *
 * ── 为什么必须有白名单 ──────────────────────────────────
 * 这是一个挂在**生产域名**上的转发器。如果允许任意目标，它会立刻变成一个
 * 开放代理：别人可以拿 qmai.pro 转发钓鱼站、绕过地区限制、刷流量，
 * 结果是我们的域名被浏览器/安全厂商标记，反噬所有正常用户。
 * 所以只放行插件市场真正需要的那几个主机，且只允许 GET/HEAD。
 */

const PREFIX = "/plugins-cdn/";

/** 只代理插件市场需要的主机。新增主机要重新评估滥用面。 */
const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "codeload.github.com",
  "api.github.com",
  "cdn.jsdelivr.net",
]);

/** 单个响应上限：插件包上限 8MB，留余量。超限直接拒绝，避免被当作大文件中转。 */
const MAX_BYTES = 16 * 1024 * 1024;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

/** 从请求里取出目标 URL；支持路径形式与 ?u= 形式。 */
function targetOf(url) {
  let raw = "";
  const at = url.pathname.indexOf(PREFIX);
  if (at >= 0) raw = url.pathname.slice(at + PREFIX.length);
  if (!raw) raw = url.searchParams.get("u") || "";
  // 路径里的 "https://" 可能被折叠成 "https:/" —— 补回来
  raw = raw.replace(/^(https?):\/?(\/)?/i, (m, scheme) => scheme + "://");
  return raw;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return corsPreflight();
    if (url.pathname === PREFIX + "health" || url.pathname === PREFIX + "health/") {
      return json({ ok: true, worker: "qmai-plugin-cdn", prefix: PREFIX });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "只支持 GET/HEAD" }, 405);
    }

    const raw = targetOf(url);
    if (!raw) {
      return json({ error: `用法：GET ${PREFIX}https://<host>/<path>` }, 400);
    }

    let target;
    try {
      target = new URL(raw);
    } catch {
      return json({ error: `目标 URL 无法解析：${raw.slice(0, 120)}` }, 400);
    }

    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return json({ error: "只允许 http/https" }, 400);
    }
    if (!ALLOWED_HOSTS.has(target.hostname)) {
      return json(
        { error: `主机不在白名单：${target.hostname}`, allowed: [...ALLOWED_HOSTS] },
        403,
      );
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: request.method,
        redirect: "follow",
        headers: {
          // GitHub 对无 UA 的请求可能 403/限流
          "user-agent": "qmai-plugin-cdn/1.0",
          accept: request.headers.get("accept") || "*/*",
        },
        // 只在命中缓存时复用；上游 404 不缓存
        cf: { cacheTtl: 300, cacheEverything: false },
      });
    } catch (error) {
      return json({ error: `上游请求失败：${String(error).slice(0, 200)}` }, 502);
    }

    if (request.method === "HEAD") {
      return new Response(null, {
        status: upstream.status,
        headers: {
          ...CORS,
          "content-type": upstream.headers.get("content-type") || "application/octet-stream",
        },
      });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return json({ error: `响应超过 ${MAX_BYTES} 字节上限` }, 413);
    }

    return new Response(buf, {
      status: upstream.status,
      headers: {
        ...CORS,
        "content-type": upstream.headers.get("content-type") || "application/octet-stream",
        "cache-control": upstream.headers.get("cache-control") || "public, max-age=300",
        // 让排查时能看出这是经 Worker 转发的
        "x-qmai-via": "plugin-cdn",
      },
    });
  },
};