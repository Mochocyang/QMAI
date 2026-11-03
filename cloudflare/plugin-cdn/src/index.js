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
 * 这是一个挂在**生产域名**上的转发器。若允许任意目标，它会立刻变成开放代理：
 * 别人可以拿 qmai.pro 转发钓鱼站、绕地区限制、刷流量，结果是我们的域名被
 * 浏览器与安全厂商标记，反噬所有正常用户。所以只放行市场真正需要的主机，且只允许 GET/HEAD。
 *
 * ── 为什么必须流式转发 ──────────────────────────────────
 * Workers 免费档的 CPU 配额是 **10ms/请求**（等待网络不计入）。早先的实现是
 * `await upstream.arrayBuffer()` 再 `new Response(buf)` —— 对 2MB 的 zip 要整段
 * 读进内存并复制一遍，几毫秒 CPU 就没了，8MB 的包有撞上限的风险（撞上返回 Error 1102）。
 * 改成把 `upstream.body` 直接交给 Response 之后，字节不经过 JS 堆，
 * CPU 只花在请求分发上（微秒级），内存占用也从"整个包"降到几 KB。
 */

const PREFIX = "/plugins-cdn/";

/** 只代理插件市场需要的主机。新增主机要重新评估滥用面。 */
const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "codeload.github.com",
  "api.github.com",
  "cdn.jsdelivr.net",
  // GitHub 的 release 下载会 302 到这里：不放进白名单会让所有 release 包失败。
  "objects.githubusercontent.com",
]);

/**
 * 允许回给浏览器的 content-type（小写、不含参数）。
 *
 * 这个 Worker 挂在主域 `qmai.pro/plugins-cdn/*` 下，是**同源**的。
 * 把上游的 content-type 原样透传，等于让白名单上的任意主机决定
 * 「在 qmai.pro 这个源里渲染什么」—— 一个 `text/html` 响应就会变成
 * 挂在官网域名下的钓鱼页。所以这里改成白名单放行，其余一律降级成
 * 二进制下载（配合 nosniff + 附件头，浏览器不会当页面执行）。
 */
const ALLOWED_CONTENT_TYPES = new Set([
  "application/json",
  "application/zip",
  "application/octet-stream",
  "application/x-zip-compressed",
  "text/plain",
  "text/markdown",
  "application/vnd.github+json",
]);

/** 把上游 content-type 归一成允许值。 */
function safeContentType(upstream) {
  const raw = (upstream.headers.get("content-type") || "").toLowerCase();
  const base = raw.split(";")[0].trim();
  if (base && ALLOWED_CONTENT_TYPES.has(base)) return raw;
  return "application/octet-stream";
}

/** 单个响应上限：插件包上限 8MB，留余量。 */
const MAX_BYTES = 16 * 1024 * 1024;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,OPTIONS",
  "access-control-expose-headers": "x-qmai-via,content-length",
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

/**
 * 给流加一个「总量上限」护栏：content-length 缺失时也能拦住超大响应。
 * 只做计数，不缓存字节 —— 所以对 CPU 与内存几乎无成本。
 */
function cappedStream(body, limit) {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          controller.error(new Error(`响应超过 ${limit} 字节上限`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

const baseHeaders = (upstream, extra = {}) => ({
  ...CORS,
  "content-type": safeContentType(upstream),
  "cache-control": upstream.headers.get("cache-control") || "public, max-age=300",
  // 排查时能看出这是经 Worker 转发的
  "x-qmai-via": "plugin-cdn",
  // 禁止浏览器"猜"内容类型：归一后的 octet-stream 才能真的当下载处理。
  "x-content-type-options": "nosniff",
  // 万一上游 contentType 被放过，也不让它加载任何子资源、执行脚本。
  "content-security-policy": "default-src 'none'; sandbox",
  // 让宿主的 zip 校验、以及浏览器预检都能读到真实长度
  ...(upstream.headers.get("content-length")
    ? { "content-length": upstream.headers.get("content-length") }
    : {}),
  ...extra,
});

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
          "user-agent": "qmai-plugin-cdn/1.1",
          accept: request.headers.get("accept") || "*/*",
        },
        // 上游重复拉取（同一个插件包被多人下载）交给 Cloudflare 边缘缓存，
        // 少打扰 GitHub，也顺带降低被限流的概率。
        cf: { cacheTtl: 300, cacheEverything: false },
      });
    } catch (error) {
      return json({ error: `上游请求失败：${String(error).slice(0, 200)}` }, 502);
    }

    /*
     * 跟随重定向之后必须复核**最终**落点。
     *
     * 只校验入参 URL 是不够的：`github.com/...` 可以 302 到任意第三方，
     * 那一步由 fetch 自己跟了，Worker 就成了开放代理（且挂在主域下）。
     * Response.url 是最终 URL，据此再查一次白名单。
     */
    if (upstream.url) {
      let finalHost = "";
      try {
        finalHost = new URL(upstream.url).hostname;
      } catch {
        finalHost = "";
      }
      if (!finalHost || !ALLOWED_HOSTS.has(finalHost)) {
        try {
          upstream.body?.cancel();
        } catch {}
        return json(
          { error: `重定向落点不在白名单：${finalHost || "无法解析"}`, allowed: [...ALLOWED_HOSTS] },
          403,
        );
      }
    }

    if (request.method === "HEAD") {
      return new Response(null, { status: upstream.status, headers: baseHeaders(upstream) });
    }

    // 有 content-length 就按它判；没读到长度才退回流式计数护栏。
    //
    // ⚠️ 这里必须显式区分「缺失」与「0」：`Number(null || "")` 得到的是 0（不是 NaN），
    // 写成 `Number.isFinite(declared)` 会在 codeload 走 `Transfer-Encoding: chunked`
    // （没有 content-length）时**把护栏整个跳过** —— 实测曾放行一个 67MB 的 zip。
    // 用 null 判断才是正确的"缺失"信号。
    const rawLength = upstream.headers.get("content-length");
    const declared = rawLength === null ? Number.NaN : Number(rawLength);
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      try {
        upstream.body?.cancel();
      } catch {}
      return json({ error: `响应超过 ${MAX_BYTES} 字节上限` }, 413);
    }

    if (!upstream.body) {
      return new Response(null, { status: upstream.status, headers: baseHeaders(upstream) });
    }

    const body = Number.isFinite(declared) ? upstream.body : cappedStream(upstream.body, MAX_BYTES);
    return new Response(body, { status: upstream.status, headers: baseHeaders(upstream) });
  },
};