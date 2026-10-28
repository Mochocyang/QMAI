// 假 provider 插件（T5 fixture）：一个**零依赖** Node 脚本，同时扮演两个角色。
//
// A) MCP stdio 服务端：v2 的握手仍然走 MCP（`initialize` / `tools/list`）。
//    宿主 `start_plugin` 必须先握手成功，才会去探活 provider 端点。
//    本 fixture 是 provider 而不是工具插件，所以 tools/list 返回空列表。
// B) OpenAI 兼容 provider 端点：在**宿主动态分配**的 127.0.0.1:<port> 上提供
//    `/health`、`/v1/models`、`/v1/chat/completions`（设计 3.1）。
//
// 契约要点（改这个文件前先看设计 3.1 / 3.2 / 3.4）：
// - 端口与令牌只从环境变量读（`QMAI_PROVIDER_PORT` / `QMAI_PROVIDER_TOKEN`），
//   不读 `initialize` 的 `_qmai`：插件在 initialize 之前就能读到，且协议里不必多传一份。
// - `/v1/*` 必须校验 `Authorization: Bearer <token>`：否则本机任何进程都能白嫖它
//   （进而白嫖用户的账号额度）。令牌为空时**一律拒绝**（fail closed）。
// - `/health` **不**校验令牌：宿主探活时还拿不到 provider 令牌（它只带在 /v1/* 上）。
// - `no-window-model` 故意缺 `maxInputTokens`：宿主必须丢弃它。fixture 必须真的把它
//   返回出来，否则「宿主在丢」这件事就无法证明。
// - SSE 必须原样以 `data: [DONE]` 结尾，并且带一个 `usage` 分片：没有 usage，
//   QMAI 的用量统计会全是 0（设计 3.2）。
//
// 探活开关（仅供测试，**不属于** provider 契约）：
//   - 启动值：`QMAI_FAKE_HEALTH_FAIL=1` → `/health` 恒返 500；
//   - 运行中切换：`POST /__fixture/health-fail`（要 Bearer）`{"fail": true|false}`
//     —— 让用例能在**同一个实例**上把 /health 切坏再切好，见
//     `refresh_models_does_not_flip_ready_when_health_is_failing`。

"use strict";

const http = require("node:http");
const readline = require("node:readline");

const PORT = Number(process.env.QMAI_PROVIDER_PORT || "");
const TOKEN = process.env.QMAI_PROVIDER_TOKEN || "";
// 运行期可切换（见下面的控制端点）：启动值来自环境变量，之后测试可以改成 true/false。
let healthFail = process.env.QMAI_FAKE_HEALTH_FAIL === "1";

// 零依赖、无 node_modules：所有行为都写在这个文件里，装上即可跑。

if (!PORT) {
  process.stderr.write("[fake-provider] 缺少 QMAI_PROVIDER_PORT，无法启动 provider 端点\n");
  process.exit(1);
}

// ── B) provider 端点：模型目录（设计 3.4）────────────────────────────────

const MODELS = [
  {
    id: "good-model",
    object: "model",
    owned_by: "fake-provider",
    _qmai: {
      displayName: "好模型",
      maxInputTokens: 204800,
      maxOutputTokens: 8192,
      supportsToolCall: true,
      supportsVision: false,
      creditMultiplier: 0.5,
    },
  },
  {
    // 故意缺 `_qmai.maxInputTokens`：上下文裁剪依赖它，设计 3.4 要求宿主丢弃该模型
    // （不是拒绝整个插件 —— 同一插件的其它模型仍必须可用）。
    id: "no-window-model",
    object: "model",
    owned_by: "fake-provider",
    _qmai: {
      displayName: "缺窗口模型",
      maxOutputTokens: 8192,
    },
  },
  {
    // 小窗口：用来验证 T4 修复（窗口不被下限抬高），所以故意和 good-model 差一个量级。
    id: "small-window-model",
    object: "model",
    owned_by: "fake-provider",
    _qmai: {
      displayName: "小窗口模型",
      maxInputTokens: 32768,
      maxOutputTokens: 4096,
      supportsToolCall: false,
    },
  },
];

const REPLY_PIECES = ["你好，", "我是假 provider 插件，", "这是一段流式回复。"];
const USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
// 分片之间留一点间隔：让客户端真的看到多个数据块，而不是一次 write 里收完整段。
// 断言仍然按 SSE 帧计（TCP 合包与否不该让测试变 flaky），但真实流式行为要有。
const SSE_PIECE_DELAY_MS = 40;

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

function authorized(req) {
  // 令牌为空时一律拒绝：宿主没注入令牌属于严重配置错误，不能退化成「谁都能用」。
  if (!TOKEN) return false;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    // 客户端中途断开：按空 body 收尾，交给调用方回 400，而不是永远挂着这个 Promise。
    req.on("error", () => resolve(""));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function handleChatCompletions(req, res) {
  const raw = await readBody(req);
  let body = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "invalid json body" });
      return;
    }
  }
  const model = typeof body.model === "string" ? body.model : "good-model";
  const content = REPLY_PIECES.join("");

  // OpenAI 的默认是非流式；这里按 `stream: false` 显式判 —— 没写 stream 时按流式回，
  // 因为 QMAI 的写作链路一定带 stream: true，fixture 默认就测那条路。
  if (body.stream === false) {
    sendJson(res, 200, {
      id: "chatcmpl-fake",
      object: "chat.completion",
      created: 0,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      // 非流式同样要带 usage：没有它，用量统计会全是 0（设计 3.2 第 3 条）。
      usage: USAGE,
    });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // 反代常见的缓冲开关；这里没有反代，写上只是让契约更明确。
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  // 关 Nagle：小分片要立刻出去，否则「流式」会被内核攒成一次性交付。
  if (res.socket) res.socket.setNoDelay(true);

  for (const piece of REPLY_PIECES) {
    // 客户端断开（用户点「停止」）时不要再继续写：设计 3.2 第 4 条要求插件真的停下，
    // 这里没有上游可停，但「停止产出」这个语义要演示出来。
    if (res.writableEnded || res.destroyed) return;
    res.write(
      sseFrame({
        id: "chatcmpl-fake",
        object: "chat.completion.chunk",
        model,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      }),
    );
    await sleep(SSE_PIECE_DELAY_MS);
  }

  // usage 分片：`choices` 为空是 stream_options.include_usage 的语义，客户端按「有没有
  // usage 字段」取值，不会把它当成内容。
  res.write(sseFrame({ id: "chatcmpl-fake", object: "chat.completion.chunk", model, choices: [], usage: USAGE }));
  // `[DONE]` 必须原样出现在最后：少这一帧，客户端会一直等流结束。
  res.write("data: [DONE]\n\n");
  res.end();
}

// ── 仅测试用：运行中切换 /health ─────────────────────────────────────────
//
// 这个端点**不属于** provider 契约（设计 3.1 的路径固定为 /health、/v1/models、
// /v1/chat/completions），它只为 T5 能证明「同一个实例在运行中从健康变成不健康」而存在：
// 只靠启动时的环境变量，测试只能拿到「一开始就不健康」的实例，而那里根本没有已缓存的
// 模型可断言「刷新失败不清缓存」。
//
// 和 /v1/* 一样要求 Bearer：即使是 fixture，也不留一个不鉴权的写入口。
const CONTROL_HEALTH_PATH = "/__fixture/health-fail";

async function handleControlHealth(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const raw = await readBody(req);
  let body = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "invalid json body" });
      return;
    }
  }
  healthFail = body.fail === true;
  process.stderr.write(`[fake-provider] 测试开关：healthFail=${healthFail ? "1" : "0"}\n`);
  sendJson(res, 200, { ok: true, healthFail });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  // /health 在鉴权之前：宿主探活只发一个裸 GET，不带 provider 令牌。
  if (req.method === "GET" && url.pathname === "/health") {
    if (healthFail) {
      sendJson(res, 500, { ok: false, error: "health check disabled by fixture" });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // 除 /health 外只提供 /v1/* 与那个测试控制端点；其余一律 404
  // （别把 /login 之类做成半成品让人误会）。
  const isControl = url.pathname === CONTROL_HEALTH_PATH;
  if (!isControl && !url.pathname.startsWith("/v1/")) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  if (!authorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (isControl) {
    handleControlHealth(req, res).catch((error) => {
      if (res.writableEnded) return;
      sendJson(res, 500, { error: `fixture internal error: ${error && error.message}` });
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    sendJson(res, 200, { object: "list", data: MODELS });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    handleChatCompletions(req, res).catch((error) => {
      if (res.writableEnded) return;
      sendJson(res, 500, { error: `fixture internal error: ${error && error.message}` });
    });
    return;
  }
  sendJson(res, 404, { error: "not found" });
});

server.on("error", (error) => {
  process.stderr.write(`[fake-provider] 监听 127.0.0.1:${PORT} 失败：${error && error.message}\n`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(
    `[fake-provider] provider 端点在 http://127.0.0.1:${PORT}（healthFail=${healthFail ? "1" : "0"}）\n`,
  );
});

// ── A) MCP stdio 服务端（宿主握手用）────────────────────────────────────

function sendRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    // 插件往 stdout 打调试信息很常见；宿主自己也忽略非 JSON 行，这里对称处理。
    return;
  }
  // 通知（没有 id）不需要回包；回了反而会成为宿主眼里的噪声。
  if (req.id === undefined || req.id === null) return;

  switch (req.method) {
    case "initialize":
      sendRpc({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "fake-provider", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      });
      break;
    case "tools/list":
      // 本 fixture 是 provider，不提供任何工具（但必须能回，否则握手不通过）。
      sendRpc({ jsonrpc: "2.0", id: req.id, result: { tools: [] } });
      break;
    default:
      // 未知方法：按 JSON-RPC 回错误，而不是静默不回 —— 静默会让宿主等到超时。
      sendRpc({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
      break;
  }
});

// stdin EOF = 宿主让我们退出（stop_plugin 先关 stdin）。立刻退出，别留孤儿进程。
rl.on("close", () => process.exit(0));
