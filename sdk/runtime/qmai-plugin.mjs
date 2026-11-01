// QMAI 插件 SDK · Tier 2 运行时助手（**零依赖**，只用 Node 内置能力）。
//
// 这个文件是 `samples/plugins/chapter-metrics/index.js` 里那套手写样板的库化版本：
// 那个样例为了证明"协议不需要依赖"，把「按行读 stdin / 分发 / 出错 / 退出」全写了一遍，
// 60 行里只有 3 行是真正的业务。作者每次写新插件都要重抄一遍，而且每抄一遍就多一次
// 踩坑机会。这里把那 57 行收进库，作者只写工具实现。
//
// 它替作者挡掉的坑（编号对应 docs/plugins/authoring-guide.md 第 2 章）：
//
//   ① stdout 只写协议帧 —— 本文件是唯一往 stdout 写东西的地方，`ctx.log()` 一律走 stderr。
//      作者就算想污染 stdout 也得绕开 SDK 自己拿 process.stdout 用。
//   ③ inputSchema 原样转给模型 —— 声明什么就报什么，SDK 不"顺手修正"作者的 schema。
//      写错了是 S 级问题（模型会拒绝调用且宿主不报错），所以 sdk/validate.mjs 才要提示
//      清单 `parameters` 与运行期 `inputSchema` 的形状差异。
//   ⑨ 幂等 + 会清理 —— 不写临时文件、不缓存环境变量、EOF 立刻退出，不留孤儿进程。
//   ⑫ 常驻进程 —— 环境变量（端口/令牌/配置）只在启动时读一次进 ctx，不落盘。
//   ⑬ `"type": "module"` 的继承 —— 本文件是 `.mjs`，Node 无论目录里有没有
//      `package.json` 都按 ESM 加载，插件作者自己的 `index.js` 才需要关心这条。
//
// 本模块**不**做校验器该做的事（清单字段、插槽、内容包）：那些是 sdk/validate.mjs 的活。
// 运行期只保证"协议不出错、日志不串台、错误能到模型眼前"。

/** MCP 协议版本。宿主只认这个字符串（见 src-tauri/src/plugins/mcp_bridge.rs）。 */
export const PROTOCOL_VERSION = "2024-11-05";

/** JSON-RPC 错误码：方法不存在。 */
const RPC_METHOD_NOT_FOUND = -32601;
/** JSON-RPC 错误码：参数不合法（调用不存在的工具属于这一类）。 */
const RPC_INVALID_PARAMS = -32602;

/** 一行日志的大小上限：防止作者误把整章正文写进 stderr。 */
const MAX_LOG_BYTES = 8 * 1024;

function writeLine(stream, text) {
  try {
    stream.write(text.endsWith("\n") ? text : `${text}\n`);
  } catch {
    // 宿主关掉 stderr 管道时 write 会抛：日志写不出去不该让插件进程崩掉。
  }
}

/** 错误对象 → 单行可读文本（模型看 message，作者看 stack，两处都需要）。 */
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

function errorStack(error) {
  if (error && typeof error === "object" && typeof error.stack === "string" && error.stack) {
    return error.stack;
  }
  return errorMessage(error);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析 `QMAI_CONFIG`（宿主注入的 JSON 字符串，对应清单里的 `configSchema`）。
 *
 * 解析失败给 `{}` 而不是抛：配置是用户/宿主写坏的可能性远高于"插件必须因此停摆"，
 * 而一个起不来的插件在界面上只会显示"启动失败"，用户完全看不出是配置写错了。
 * 所以降级为空配置 + stderr 一条 warn（作者能在日志里看到真实原因）。
 */
function readConfig(env, warn) {
  const raw = env.QMAI_CONFIG;
  if (raw === undefined || raw === null || String(raw).trim() === "") return {};
  try {
    const parsed = JSON.parse(String(raw));
    if (!isPlainObject(parsed)) {
      warn(`QMAI_CONFIG 不是 JSON 对象，已按空配置继续：${String(raw).slice(0, 200)}`);
      return {};
    }
    return parsed;
  } catch (error) {
    warn(`QMAI_CONFIG 不是合法 JSON，已按空配置继续：${errorMessage(error)}`);
    return {};
  }
}

function readPort(env) {
  const raw = env.QMAI_PROVIDER_PORT;
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

/**
 * 把作者写的工具声明整理成 `tools/list` 要的形状。
 *
 * `inputSchema` **原样透传**（坑 ③）：宿主把它原封不动转给模型，SDK 任何自作聪明的
 * 补全 —— 比如给缺 `type` 的 schema 补个 `"object"` —— 只会让"作者以为生效了"这件事
 * 更难发现。缺省时给一个合法的空对象 schema，那是最小可用值，不是猜测。
 */
function normalizeTools(plugin, warn) {
  const declared = isPlainObject(plugin.tools) ? plugin.tools : {};
  const tools = [];
  for (const [name, decl] of Object.entries(declared)) {
    if (!isPlainObject(decl)) {
      warn(`工具 ${name} 的声明不是对象，已跳过`);
      continue;
    }
    if (typeof decl.handler !== "function") {
      warn(`工具 ${name} 没有 handler 函数，已跳过（这个工具会永远无法调用）`);
      continue;
    }
    tools.push({
      name,
      description: typeof decl.description === "string" ? decl.description : "",
      inputSchema:
        decl.inputSchema === undefined
          ? { type: "object", properties: {} }
          : decl.inputSchema,
      handler: decl.handler,
    });
  }
  if (tools.length === 0) {
    warn("没有声明任何可调用的工具：tools/list 会返回空列表");
  }
  return tools;
}

/**
 * handler 的返回值 → MCP `tools/call` 的 result。
 *
 * 支持三种写法，越简单越推荐：
 *   - `return "结果文本"`            → 最常见，SDK 包成 content[0].text
 *   - `return { text, isError }`     → 工具级失败用这个（不是 JSON-RPC error）
 *   - `return { content: [...] }`    → 需要多段内容/图片时直接给 MCP 形状
 *
 * 为什么工具级失败**不用** JSON-RPC error：宿主的 `into_tool_call` 会把 `isError`
 * 的文本当作工具结果交给模型，模型因此能看到"为什么失败"并自己改正重试；
 * JSON-RPC error 是"请求本身不合法"，模型看不到，只会卡住（指南第 ⑦ 条）。
 */
function toCallResult(value) {
  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }
  if (Array.isArray(value) && value.every((part) => isPlainObject(part) && typeof part.type === "string")) {
    return { content: value };
  }
  if (isPlainObject(value)) {
    if (Array.isArray(value.content)) {
      const result = { content: value.content };
      if (value.isError === true) result.isError = true;
      return result;
    }
    let text = "";
    if (typeof value.text === "string") text = value.text;
    else if (value.text !== undefined) text = String(value.text);
    const result = { content: [{ type: "text", text }] };
    if (value.isError === true || value.error === true) result.isError = true;
    return result;
  }
  if (value === undefined || value === null) {
    // 空结果不报错（工具确实可能什么都不用说），但空的 text 会让界面上出现一个
    // 空白结果块 —— 所以给一句最短的说明，而不是静默的空串。
    return { content: [{ type: "text", text: "（工具没有返回内容）" }] };
  }
  return { content: [{ type: "text", text: String(value) }] };
}

/**
 * 注册插件并开始跑 MCP stdio 循环。**调用即启动**，不需要再 await。
 *
 * @param {object} plugin
 * @param {{ id?: string, name: string, version: string }} plugin.info
 * @param {Record<string, { description?: string, inputSchema?: object,
 *         handler: (args: object, ctx: object) => unknown | Promise<unknown> }>} plugin.tools
 * @param {object} [options] 仅供测试/自测注入（生产环境不要传）
 * @returns {{ ctx: object, tools: string[], stop: () => void }}
 */
export function definePlugin(plugin, options = {}) {
  if (!isPlainObject(plugin)) {
    throw new TypeError("definePlugin(plugin)：第一个参数必须是对象");
  }
  const spec = isPlainObject(plugin.info) ? plugin.info : {};
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const exit = typeof options.exit === "function" ? options.exit : (code) => process.exit(code);
  // 自测时作者会传自己的流进来：那时不能装 process 级 handler，否则会污染调用方进程。
  const ownsProcess = options.stdin === undefined && options.stdout === undefined;

  const name = typeof spec.name === "string" && spec.name.trim() ? spec.name.trim() : "qmai-plugin";
  const version =
    typeof spec.version === "string" && /^\d+\.\d+\.\d+$/.test(spec.version)
      ? spec.version
      : "0.0.0";
  const pluginId =
    (typeof env.QMAI_PLUGIN_ID === "string" && env.QMAI_PLUGIN_ID.trim()) ||
    (typeof spec.id === "string" && spec.id.trim()) ||
    name;

  const log = (message) => {
    // 坑 ①：stdout 是协议通道。作者的调试输出**只能**走这里。
    let text = typeof message === "string" ? message : String(message);
    if (text.length > MAX_LOG_BYTES) {
      text = `${text.slice(0, MAX_LOG_BYTES)}…（日志超长已截断）`;
    }
    writeLine(stderr, `[${name}] ${text}`);
  };

  if (version === "0.0.0") {
    log("info.version 不是三段 SemVer（如 1.0.0），initialize 里会报 0.0.0");
  }

  const ctx = {
    pluginId,
    log,
    config: readConfig(env, log),
    providerPort: readPort(env),
    providerToken:
      typeof env.QMAI_PROVIDER_TOKEN === "string" && env.QMAI_PROVIDER_TOKEN.trim()
        ? env.QMAI_PROVIDER_TOKEN
        : undefined,
  };

  const tools = normalizeTools(plugin, log);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const send = (frame) => {
    try {
      stdout.write(`${JSON.stringify(frame)}\n`);
    } catch {
      // 宿主关掉 stdout（或被 kill）：写不出去就是"该退出"的信号，别再抛。
    }
  };
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
  const replyError = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  const handleToolCall = (id, rawParams) => {
    const params = isPlainObject(rawParams) ? rawParams : {};
    const tool = byName.get(params.name);
    if (!tool) {
      // 调用未声明的工具是**请求不合法**，不是工具失败：宿主只会调用 tools/list 报过的
      // 工具，走到这里说明调用方（或作者自己写错了名字）手里的是过期列表。
      const available = tools.map((item) => item.name).join(" / ") || "无";
      replyError(
        id,
        RPC_INVALID_PARAMS,
        `未知工具：${String(params.name)}（本插件提供：${available}）`,
      );
      return;
    }
    if (params.arguments !== undefined && !isPlainObject(params.arguments)) {
      replyError(id, RPC_INVALID_PARAMS, "params.arguments 必须是对象");
      return;
    }
    const args = params.arguments ?? {};
    // 一律走 Promise 链：handler 同步抛错和 reject 在这里是同一件事，
    // 都不会让进程崩掉，也都必须回 isError（否则宿主只会报"调用超时"，更难查）。
    Promise.resolve()
      .then(() => tool.handler(args, ctx))
      .then((value) => reply(id, toCallResult(value)))
      .catch((error) => {
        log(`工具 ${tool.name} 执行失败：${errorStack(error)}`);
        reply(id, {
          content: [
            {
              type: "text",
              text: `工具执行失败（插件内部错误）：${errorMessage(error)}`,
            },
          ],
          isError: true,
        });
      });
  };

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      // 与宿主对称：非 JSON 行直接忽略，绝不能让整个进程崩掉（指南第 1 节）。
      log(`忽略一行非 JSON 输入：${trimmed.slice(0, 120)}`);
      return;
    }
    if (!isPlainObject(request)) return;

    const id = request.id;
    // 通知（没有 id）不回复：回了会成为宿主眼里的噪声帧。
    const isNotification = id === undefined || id === null;
    const method = request.method;

    if (typeof method !== "string") {
      if (!isNotification) replyError(id, RPC_INVALID_PARAMS, "缺少 method");
      return;
    }

    switch (method) {
      case "initialize":
        // 注意：**不要**把 request.params 打进日志 —— initialize 的 params._qmai.hostToken
        // 是宿主能力面凭据，落进日志等于把凭据交给日志读者。
        reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name, version },
          capabilities: { tools: {} },
        });
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        if (!isNotification) reply(id, {});
        return;
      case "tools/list":
        reply(id, {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
        return;
      case "tools/call":
        if (isNotification) {
          // 没有 id 就没有回包通道；静默执行会让"调了没反应"变得无法排查，直接忽略。
          log("收到没有 id 的 tools/call（通知形式），无法回包，已忽略");
          return;
        }
        handleToolCall(id, request.params);
        return;
      default:
        // 未知方法必须回错误，不能静默不回：静默会让宿主一直等到超时。
        if (!isNotification) replyError(id, RPC_METHOD_NOT_FOUND, `未知方法：${method}`);
    }
  };

  // ── stdin：按行收帧 ────────────────────────────────────────────────
  //
  // 不用 readline：协议就是 NDJSON，自己切 \n 最省事，也不依赖模块格式（坑 ⑬）。
  // `setEncoding("utf8")` 让 Node 用 StringDecoder 跨 chunk 解码：否则一个汉字被
  // TCP/管道切成两半时，`chunk.toString()` 会拼出乱码，工具收到的入参就坏了。
  let pending = "";
  const onData = (chunk) => {
    pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      handleLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  };
  const onEnd = () => {
    // 退出前把最后一行（可能没有换行符）处理掉，别丢掉宿主关管道前的最后一帧。
    if (pending.trim()) handleLine(pending);
    pending = "";
    // 坑 ⑨：stdin EOF = 宿主关管道（stop_plugin / App 退出）= 让我们退出。
    // 不退出的话进程会变成孤儿，用户任务管理器里会攒一串 node.exe。
    exit(0);
  };

  if (typeof stdin.setEncoding === "function") stdin.setEncoding("utf8");
  stdin.on("data", onData);
  stdin.on("end", onEnd);

  // ── 进程级兜底：出异常写 stderr，但**不让进程死** ───────────────────
  //
  // 宿主视角里"插件进程退出"= 插件坏了、要重启；而绝大多数 uncaught 异常只是
  // 某一次调用写坏了。死在半个请求上只会让用户看到"调用超时"，比回一条
  // isError 差得多。所以这里兜住并记录，让下一个请求还能正常处理。
  const onUncaught = (error) => {
    log(`未捕获异常（已忽略，进程继续）：${errorStack(error)}`);
  };
  const onUnhandledRejection = (reason) => {
    log(`未处理的 Promise 拒绝（已忽略，进程继续）：${errorStack(reason)}`);
  };
  if (ownsProcess) {
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUnhandledRejection);
    process.stdout.on("error", () => exit(0));
  }

  return {
    ctx,
    tools: tools.map((tool) => tool.name),
    /** 解绑所有监听（自测用；正常插件是被 EOF 结束的，不需要这个）。 */
    stop() {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      if (ownsProcess) {
        process.off("uncaughtException", onUncaught);
        process.off("unhandledRejection", onUnhandledRejection);
      }
    },
  };
}
