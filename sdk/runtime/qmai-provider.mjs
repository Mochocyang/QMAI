// QMAI 插件 SDK · provider 助手（**零依赖**，只用 Node 内置能力）。
//
// provider 插件要同时扮演两个角色（设计 §3 / v2.0 契约）：
//   A) MCP stdio —— 交给 qmai-plugin.mjs，本文件不碰；
//   B) `127.0.0.1` 上的 OpenAI 兼容端点 —— 就是这份文件。
//
// 参照实现是 `src-tauri/tests/fixtures/plugins/fake-provider/index.js`（约 300 行，
// 其中一半是 fixture 专用的开关）。本文件把"必须做对、否则用户会出事"的那部分收进库：
//
//   1. 端口/令牌只从环境变量读，缺一个就**立即退出**（不留一个半残的端点）
//   2. `/health` 不鉴权（宿主探活时不带令牌），`/v1/*` 全部鉴权且用**常量时间比较**
//   3. `/v1/models` 自动补 `_qmai`（displayName 等），但**绝不替作者编造窗口大小**
//   4. SSE 必须带 usage 帧、必须以 `data: [DONE]` 收尾
//   5. 客户端断开 → 通过 `AbortSignal` 通知作者真的停手（不烧用户额度）
//   6. 只绑 `127.0.0.1`（不写 `0.0.0.0`：那会把用户的模型额度暴露给整个局域网）
//
// 作者只需要写两件事：`models()` 和 `chat()`。

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const BIND_HOST = "127.0.0.1";

/** SSE 分片的 id 前缀；同一进程内用递增序号，便于作者在日志里对齐。 */
let requestSequence = 0;

/** 会被搬进 `_qmai` 的能力字段（QMAI 的扩展位，不是 OpenAI 的标准字段）。 */
const ABILITY_KEYS = [
  "maxInputTokens",
  "maxOutputTokens",
  "supportsToolCall",
  "supportsVision",
  "creditMultiplier",
  "displayName",
];

function writeStderr(stderr, message) {
  try {
    stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  } catch {
    // stderr 管道被关掉不该让 provider 崩掉。
  }
}

function errorMessage(error) {
  if (error === null || error === undefined) return "未知错误";
  if (typeof error === "string") return error;
  if (typeof error === "object" && typeof error.message === "string" && error.message) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

/**
 * 常量时间的令牌比较。
 *
 * 为什么不能写 `header === `Bearer ${token}``：字符串相等在第一个不同的字节就短路返回，
 * 于是"猜对前缀几个字节"会体现在响应耗时上。这个端点跑在**用户本机**，没有网络抖动
 * 掩盖差异，本机任何进程（包括浏览器里的一段脚本、以及用户装的另一个插件）都能反复
 * 试探并逐字节爆破出 provider 令牌；拿到令牌就能白嫖用户的模型额度 —— 这正是本 SDK
 * 要替作者挡住的事，而不是留一条"注意用安全比较"的注释。
 *
 * 为什么先 sha256 再比较：`timingSafeEqual` 要求两个 Buffer 等长，长度不等时会立刻返回
 * （等于泄露了令牌长度）。先各自取 32 字节摘要，长度差异就被抹平，比较本身也稳定在
 * 常数时间。
 */
function tokensMatch(presented, expected) {
  if (typeof presented !== "string" || presented === "") return false;
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function readBody(req, limitBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        // 超限就丢弃并让调用方回 413：把整个 body 读进内存再判，等于给了本机任意进程
        // 一个"发 1GB 就能撑爆插件"的入口。
        reject(new Error(`请求体超过 ${limitBytes} 字节`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * 模型声明 → `/v1/models` 的条目，并补齐 `_qmai`。
 *
 * **`maxInputTokens` / `maxOutputTokens` 缺失时绝不补默认值。**
 * 宿主用 `maxInputTokens` 算上下文裁剪：补一个"看起来合理的"默认值（比如 32768）
 * 比缺字段更糟 —— 缺字段时宿主会丢弃这个模型（用户看得见"模型没出现"），而编造的
 * 窗口会让宿主按假窗口塞上下文，上游直接 400，而报错里完全看不出是我们的字段不准
 * （指南 §3.2 明确写了这个双向事故）。所以这里只如实透传，缺失就记 warn 并保持缺失。
 */
function toModelEntry(model, warn) {
  const source = typeof model === "object" && model !== null ? model : {};
  const id = typeof source.id === "string" && source.id.trim() ? source.id : undefined;
  if (!id) {
    warn("models() 返回了一个没有 id 的模型，已跳过（宿主用 id 生成模型复合键）");
    return undefined;
  }
  const displayName =
    (typeof source.name === "string" && source.name.trim()) ||
    (typeof source.displayName === "string" && source.displayName.trim()) ||
    id;

  const entry = { object: "model", ...source, id };
  const qmai = { ...(typeof source._qmai === "object" && source._qmai !== null ? source._qmai : {}) };
  // 作者可以平铺写能力字段（`{ id, maxInputTokens, ... }`，最好写），也可以已经写成
  // `_qmai`（想显式控制时）。两种都收：SDK 把平铺的那些搬进 `_qmai` 并从顶层删掉，
  // 因为 `maxInputTokens` 不是 OpenAI 的模型字段，留在顶层只会让"到底谁生效"含糊。
  for (const key of ABILITY_KEYS) {
    if (source[key] !== undefined && qmai[key] === undefined) qmai[key] = source[key];
    delete entry[key];
  }
  qmai.displayName =
    typeof qmai.displayName === "string" && qmai.displayName.trim() ? qmai.displayName : displayName;
  entry.name = typeof source.name === "string" && source.name.trim() ? source.name : displayName;
  entry._qmai = qmai;

  if (!Number.isFinite(qmai.maxInputTokens)) {
    warn(
      `模型 ${id} 缺少真实的 maxInputTokens：宿主会**丢弃**这个模型（请填上游声明的输入窗口，别填估算值）`,
    );
  }
  if (!Number.isFinite(qmai.maxOutputTokens)) {
    warn(`模型 ${id} 缺少 maxOutputTokens：宿主无法为它规划输出预算，请补上真实值`);
  }

  return entry;
}

/** `usage: { promptTokens, completionTokens }` → OpenAI 的 snake_case。 */
function toWireUsage(usage) {
  const source = typeof usage === "object" && usage !== null ? usage : {};
  const prompt = Number.isFinite(source.promptTokens) ? source.promptTokens : 0;
  const completion = Number.isFinite(source.completionTokens) ? source.completionTokens : 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number.isFinite(source.totalTokens) ? source.totalTokens : prompt + completion,
  };
}

/**
 * 启动 provider 端点。
 *
 * @param {object} provider
 * @param {() => Promise<Array<object>> | Array<object>} provider.models 模型目录（真源）
 * @param {(request: object, ctx: { onDelta: (text: string) => void,
 *          signal: AbortSignal }) => Promise<{ usage?: object, text?: string } | void>} provider.chat
 * @param {string} [provider.id] 仅用于日志与 /health
 * @param {object} [options] 仅供测试/自测覆盖端口与令牌（生产环境走环境变量）
 * @returns {{ server: import("node:http").Server, ready: Promise<number>,
 *             close: () => Promise<void>, port: () => number | undefined }}
 */
export function serveProvider(provider, options = {}) {
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const exit = typeof options.exit === "function" ? options.exit : (code) => process.exit(code);
  const label = `[qmai-provider${provider && provider.id ? `:${provider.id}` : ""}]`;
  const warn = (message) => writeStderr(stderr, `${label} ${message}`);

  const port = options.port !== undefined ? options.port : Number(env.QMAI_PROVIDER_PORT);
  const token = options.token !== undefined ? options.token : env.QMAI_PROVIDER_TOKEN;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    // 缺端口就退出，不要退化成"随便挑一个"：宿主只会去连它分配的那个端口，
    // 挑别的端口等于插件看起来起来了、却永远连不上。
    writeStderr(stderr, `${label} 缺少或非法的 QMAI_PROVIDER_PORT（收到：${String(env.QMAI_PROVIDER_PORT)}），无法启动`);
    exit(1);
    return undefined;
  }
  if (typeof token !== "string" || token.trim() === "") {
    // 令牌缺失时**必须**拒绝启动：没有令牌的端点对本机所有进程开放，
    // 等于把用户的模型额度挂在 127.0.0.1 上白送。
    writeStderr(stderr, `${label} 缺少 QMAI_PROVIDER_TOKEN，拒绝启动（无鉴权的 provider 端点等于白送用户额度）`);
    exit(1);
    return undefined;
  }
  if (!provider || typeof provider.chat !== "function") {
    // 没有 chat 的 provider 起得来但每次调用都 500 —— 作者只会看到"模型不能用"。
    // 启动期直接拒掉，错误位置离原因最近。
    writeStderr(stderr, `${label} 缺少 chat(request, { onDelta, signal }) 函数，拒绝启动`);
    exit(1);
    return undefined;
  }
  if (typeof provider.models !== "function") {
    warn("没有 models() 函数：/v1/models 会返回空列表，宿主里看不到任何模型");
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      warn(`处理 ${req.method} ${req.url} 时出错：${errorMessage(error)}`);
      if (!res.headersSent) sendJson(res, 500, { error: { message: errorMessage(error) } });
      else if (!res.writableEnded) res.end();
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${BIND_HOST}`);

    // `/health` 在鉴权之前：宿主探活只发一个裸 GET，不带 provider 令牌。
    if (url.pathname === "/health") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: { message: "只支持 GET" } });
        return;
      }
      sendJson(res, 200, { ok: true, provider: provider && provider.id ? provider.id : undefined });
      return;
    }

    if (!url.pathname.startsWith("/v1/")) {
      // 不认识的路径一律 404，别留一个半成品端点让人误会。
      sendJson(res, 404, { error: { message: "not found" } });
      return;
    }

    // 全部 `/v1/*` 必须带 `Authorization: Bearer <token>`（设计 §3.2）。
    const authorization = req.headers.authorization;
    const presented =
      typeof authorization === "string" && /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : "";
    if (!tokensMatch(presented, token)) {
      sendJson(res, 401, { error: { message: "unauthorized" } });
      return;
    }

    if (url.pathname === "/v1/models") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: { message: "只支持 GET" } });
        return;
      }
      const listed = typeof provider.models === "function" ? await provider.models() : [];
      const data = [];
      for (const model of Array.isArray(listed) ? listed : []) {
        const entry = toModelEntry(model, warn);
        if (entry) data.push(entry);
      }
      sendJson(res, 200, { object: "list", data });
      return;
    }

    if (url.pathname === "/v1/chat/completions") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: { message: "只支持 POST" } });
        return;
      }
      await handleChat(req, res);
      return;
    }

    sendJson(res, 404, { error: { message: "not found" } });
  }

  async function handleChat(req, res) {
    let body;
    try {
      const raw = await readBody(req);
      body = raw.trim() ? JSON.parse(raw) : {};
    } catch (error) {
      sendJson(res, 400, { error: { message: `请求体不是合法 JSON：${errorMessage(error)}` } });
      return;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      sendJson(res, 400, { error: { message: "请求体必须是 JSON 对象" } });
      return;
    }

    const wantStream = body.stream === true;
    const model = typeof body.model === "string" ? body.model : "";

    // ── 客户端断开 → 真的停手 ──────────────────────────────────────
    //
    // 这是本 SDK 最"值钱"的一段：用户点「停止」或关掉界面后，如果插件还在往上游
    // 请求，用户的额度会继续被烧，而界面上什么都不会显示（指南 §3.3 第 3 条把这条
    // 列为最容易忽略、也最让用户心疼的一条）。
    //
    // 判定方式：响应还没写完就收到 close，说明连接被掐断（正常结束会走 res.end()，
    // 那时 `res.writableEnded` 已经是 true）。`req.on("close")` 单独用不可靠 ——
    // 在部分 Node 版本里请求体读完就会触发它，会把"读完 body"误判成"客户端走了"，
    // 所以两个事件都挂、统一用 `writableEnded` 兜底。
    const controller = new AbortController();
    const abortIfDisconnected = () => {
      if (res.writableEnded) return;
      if (controller.signal.aborted) return;
      controller.abort(new Error("客户端已断开"));
    };
    req.on("close", abortIfDisconnected);
    res.on("close", abortIfDisconnected);

    const callContext = {
      model,
      messages: Array.isArray(body.messages) ? body.messages : [],
      temperature: Number.isFinite(body.temperature) ? body.temperature : undefined,
      maxTokens: Number.isFinite(body.max_tokens) ? body.max_tokens : undefined,
      stream: wantStream,
      // 原样给出请求体：OpenAI 的参数集比本 SDK 认识的多，作者要用 `tools` /
      // `response_format` 等字段时不必等 SDK 升级。
      raw: body,
      signal: controller.signal,
    };

    const created = Math.floor(Date.now() / 1000);
    const completionId = `chatcmpl-qmai-${++requestSequence}`;

    if (!wantStream) {
      let text = "";
      const result = await provider.chat(callContext, {
        onDelta: (piece) => {
          if (typeof piece === "string") text += piece;
        },
        signal: controller.signal,
      });
      if (res.writableEnded) return;
      const finalText = typeof result?.text === "string" ? result.text : text;
      sendJson(res, 200, {
        id: completionId,
        object: "chat.completion",
        created,
        model,
        choices: [{ index: 0, message: { role: "assistant", content: finalText }, finish_reason: "stop" }],
        // 非流式也要带 usage：没有它，QMAI 的用量统计会全是 0。
        usage: toWireUsage(result?.usage),
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // 没有反代也会写这两个头：它们把"不要缓冲"写成契约，作者拷走代码不会丢。
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    // 关 Nagle：小分片要立刻出去，否则"流式"会被内核攒成一次性交付。
    res.socket?.setNoDelay(true);

    const writeFrame = (payload) => {
      if (res.writableEnded || res.destroyed) return false;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      return true;
    };
    const chunkFrame = (delta, finishReason = null) => ({
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });

    writeFrame(chunkFrame({ role: "assistant" }));

    let result;
    try {
      result = await provider.chat(callContext, {
        onDelta: (piece) => {
          if (typeof piece !== "string" || piece === "") return;
          if (!writeFrame(chunkFrame({ content: piece }))) {
            // 写不出去说明客户端已经走了：立刻中止，别继续消耗上游额度。
            abortIfDisconnected();
            throw controller.signal.reason ?? new Error("客户端已断开");
          }
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        // 用户主动中止：这不是错误，安静收尾即可（日志里留一条，便于作者确认自己真的停了）。
        warn("客户端断开，已中止本次生成");
        if (!res.writableEnded) res.end();
        return;
      }
      warn(`chat() 抛错：${errorMessage(error)}`);
      // 已经进入流式了就不能再改状态码：用一个 error 事件收尾，再补 [DONE]，
      // 客户端才不会一直等到超时。
      writeFrame({ error: { message: errorMessage(error), type: "plugin_error" } });
      res.write("data: [DONE]\n\n");
      if (!res.writableEnded) res.end();
      return;
    }

    if (res.writableEnded || res.destroyed) return;

    writeFrame(chunkFrame({}, "stop"));
    // usage 分片：`choices` 为空是 `stream_options.include_usage` 的语义，
    // 客户端按"有没有 usage 字段"取值，不会把它当成内容（指南 §3.3 第 2 条）。
    if (result?.usage !== undefined) {
      writeFrame({ id: completionId, object: "chat.completion.chunk", created, model, choices: [], usage: toWireUsage(result.usage) });
    } else {
      warn("chat() 没有返回 usage：用量统计会记为 0（请在返回里给 { usage: { promptTokens, completionTokens } }）");
      writeFrame({ id: completionId, object: "chat.completion.chunk", created, model, choices: [], usage: toWireUsage({}) });
    }
    // `data: [DONE]` 必须原样出现在最后：少这一帧客户端会一直等流结束；
    // 多一帧附加事件在它后面，严格客户端会把它当错误（指南 §3.3 第 1 条）。
    res.write("data: [DONE]\n\n");
    res.end();
  }

  // 只绑 `127.0.0.1`：绑 `0.0.0.0` 会让局域网里的任何人拿到用户的模型额度。
  server.on("error", (error) => {
    writeStderr(stderr, `${label} 监听 ${BIND_HOST}:${port} 失败：${errorMessage(error)}`);
    exit(1);
  });

  const ready = new Promise((resolve) => {
    server.listen(port, BIND_HOST, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      writeStderr(stderr, `${label} provider 端点在 http://${BIND_HOST}:${actual}`);
      resolve(actual);
    });
  });

  return {
    server,
    ready,
    port() {
      const address = server.address();
      return typeof address === "object" && address ? address.port : undefined;
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}
