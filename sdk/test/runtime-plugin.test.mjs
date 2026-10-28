// `qmai-plugin.mjs`（Tier 2 运行时助手）的协议测试。
//
// 打法：把内存流喂进去（比 spawn 子进程快、也不受端口/超时影响），
// 只有"进程真的退出了"和"真实管道下的 stdout 干净"两条必须用真进程验证。

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { definePlugin, PROTOCOL_VERSION } from "../runtime/qmai-plugin.mjs";

const RUNTIME_ENTRY = fileURLToPath(new URL("../runtime/qmai-plugin.mjs", import.meta.url));

/** 在内存流里起一个插件实例。 */
function startPlugin(plugin, options = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out = { stdout: "", stderr: "" };
  stdout.setEncoding("utf8");
  stderr.setEncoding("utf8");
  stdout.on("data", (chunk) => {
    out.stdout += chunk;
  });
  stderr.on("data", (chunk) => {
    out.stderr += chunk;
  });

  let exitCode;
  const handle = definePlugin(plugin, {
    stdin,
    stdout,
    stderr,
    env: options.env ?? {},
    exit: (code) => {
      exitCode = code;
    },
  });

  const lines = () => out.stdout.split("\n").filter((line) => line !== "");
  const frames = () => lines().map((line) => JSON.parse(line));
  return {
    handle,
    stdin,
    out,
    lines,
    frames,
    send: (payload) => stdin.write(`${JSON.stringify(payload)}\n`),
    sendRaw: (text) => stdin.write(text),
    exitCode: () => exitCode,
    stop: () => handle.stop(),
  };
}

function echoPlugin(extra = {}) {
  return {
    info: { id: "test-plugin", name: "测试插件", version: "1.0.0" },
    tools: {
      echo: {
        description: "原样返回",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        async handler(args) {
          return `echo:${args.text}`;
        },
      },
    },
    ...extra,
  };
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - startedAt > timeoutMs) throw new Error("等待响应超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("initialize / tools/list / tools/call 三行连发，回三行合法响应", async () => {
  const plugin = startPlugin(echoPlugin());
  plugin.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  plugin.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  plugin.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
  await waitFor(() => plugin.frames().length === 3);

  const [init, list, call] = plugin.frames();
  assert.equal(init.jsonrpc, "2.0");
  assert.equal(init.id, 1);
  assert.equal(init.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(init.result.serverInfo.name, "测试插件");
  assert.equal(init.result.serverInfo.version, "1.0.0");
  assert.deepEqual(init.result.capabilities, { tools: {} });

  assert.equal(list.id, 2);
  assert.equal(list.result.tools.length, 1);
  assert.equal(list.result.tools[0].name, "echo");
  // inputSchema 必须原样转给模型（坑 ③：宿主不修正作者的 schema）
  assert.deepEqual(list.result.tools[0].inputSchema, {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  });

  assert.equal(call.id, 3);
  assert.deepEqual(call.result, { content: [{ type: "text", text: "echo:hi" }] });
  plugin.stop();
});

test("脏行（非 JSON / 空行 / 非对象）静默跳过，后面还能正常分发", async () => {
  const plugin = startPlugin(echoPlugin());
  plugin.sendRaw("not json\n");
  plugin.sendRaw("\n");
  plugin.sendRaw("[1,2,3]\n");
  plugin.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await waitFor(() => plugin.frames().length === 1);

  const frames = plugin.frames();
  assert.equal(frames.length, 1, "脏行不能产生任何响应帧");
  assert.equal(frames[0].id, 1);
  plugin.stop();
});

test("未知方法回 -32601；通知（无 id）不回包", async () => {
  const plugin = startPlugin(echoPlugin());
  plugin.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  plugin.send({ jsonrpc: "2.0", id: 7, method: "resources/list", params: {} });
  await waitFor(() => plugin.frames().length >= 1);

  const frames = plugin.frames();
  assert.equal(frames.length, 1, "通知不该产生响应帧");
  assert.equal(frames[0].id, 7);
  assert.equal(frames[0].error.code, -32601);
  assert.match(frames[0].error.message, /未知方法/);
  plugin.stop();
});

test("调用不存在的工具回 -32602，而不是工具级 isError", async () => {
  const plugin = startPlugin(echoPlugin());
  plugin.send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope", arguments: {} } });
  await waitFor(() => plugin.frames().length === 1);

  const [frame] = plugin.frames();
  assert.equal(frame.error.code, -32602);
  assert.match(frame.error.message, /未知工具/);
  assert.equal(frame.result, undefined);
  plugin.stop();
});

test("handler 抛错 → isError: true，且进程不死（后续请求照常）", async () => {
  const plugin = startPlugin({
    info: { name: "boom", version: "1.0.0" },
    tools: {
      boom: {
        description: "always throws",
        inputSchema: { type: "object" },
        async handler() {
          throw new Error("上游 500：令牌可能过期了");
        },
      },
    },
  });
  plugin.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boom", arguments: {} } });
  plugin.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await waitFor(() => plugin.frames().length === 2);

  // 工具调用走 Promise 链（异步），所以响应顺序可能晚于紧随其后的 tools/list ——
  // 按 id 取，别按位置取。
  const frames = plugin.frames();
  const call = frames.find((frame) => frame.id === 1);
  const list = frames.find((frame) => frame.id === 2);
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /上游 500/);
  // 抛错写一份 stack 到 stderr，作者才能定位；但这不影响下一次调用。
  assert.match(plugin.out.stderr, /执行失败/);
  assert.equal(list.result.tools[0].name, "boom", "第二个请求仍然正常");
  plugin.stop();
});

test("ctx.log 只写 stderr：stdout 里每一行都是合法协议帧", async () => {
  const plugin = startPlugin({
    info: { name: "logger", version: "1.0.0" },
    tools: {
      noisy: {
        description: "用了 log",
        inputSchema: { type: "object" },
        async handler(args, ctx) {
          ctx.log("这是一条调试日志 hello-stdout");
          ctx.log({ nested: true });
          return "done";
        },
      },
    },
  });
  plugin.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "noisy", arguments: {} } });
  await waitFor(() => plugin.frames().length === 1);

  assert.ok(!plugin.out.stdout.includes("hello-stdout"), "日志绝不能出现在 stdout");
  assert.match(plugin.out.stderr, /hello-stdout/);
  for (const line of plugin.lines()) {
    const frame = JSON.parse(line);
    assert.equal(frame.jsonrpc, "2.0");
  }
  plugin.stop();
});

test("跨 chunk 的半个 UTF-8 字符不会把入参汉字劈坏", async () => {
  const plugin = startPlugin(echoPlugin());
  const line = Buffer.from(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { text: "汉字" } } })}\n`,
    "utf8",
  );
  // 在"汉"字的 3 个字节中间切开：不做跨 chunk 解码就会拼出乱码。
  const cut = line.indexOf(Buffer.from("汉", "utf8")) + 1;
  plugin.stdin.write(line.subarray(0, cut));
  await new Promise((resolve) => setTimeout(resolve, 10));
  plugin.stdin.write(line.subarray(cut));
  await waitFor(() => plugin.frames().length === 1);

  assert.equal(plugin.frames()[0].result.content[0].text, "echo:汉字");
  plugin.stop();
});

test("ctx：pluginId / config / providerPort / providerToken 都从环境变量来", async () => {
  const plugin = startPlugin(
    {
      info: { name: "ctx", version: "1.0.0" },
      tools: {
        dump: {
          description: "回显上下文",
          inputSchema: { type: "object" },
          async handler(args, ctx) {
            return JSON.stringify({
              pluginId: ctx.pluginId,
              config: ctx.config,
              providerPort: ctx.providerPort,
              providerToken: ctx.providerToken,
            });
          },
        },
      },
    },
    {
      env: {
        QMAI_PLUGIN_ID: "env-plugin",
        QMAI_CONFIG: '{"style":"爆点"}',
        QMAI_PROVIDER_PORT: "51999",
        QMAI_PROVIDER_TOKEN: "secret",
      },
    },
  );
  plugin.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dump", arguments: {} } });
  await waitFor(() => plugin.frames().length === 1);

  const context = JSON.parse(plugin.frames()[0].result.content[0].text);
  assert.equal(context.pluginId, "env-plugin");
  assert.deepEqual(context.config, { style: "爆点" });
  assert.equal(context.providerPort, 51999);
  assert.equal(context.providerToken, "secret");
  plugin.stop();
});

test("ctx.config 解析失败 → {} 且只 warn，不让插件起不来", async () => {
  const plugin = startPlugin(echoPlugin(), { env: { QMAI_CONFIG: "{不是 json" } });
  assert.deepEqual(plugin.handle.ctx.config, {});
  assert.match(plugin.out.stderr, /QMAI_CONFIG/);

  plugin.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await waitFor(() => plugin.frames().length === 1);
  assert.equal(plugin.frames()[0].result.tools.length, 1);
  plugin.stop();
});

test("stdin EOF → exit(0)，且没换行符的最后一行也会被处理", async () => {
  const plugin = startPlugin(echoPlugin());
  plugin.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "initialize", params: {} }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  plugin.stdin.end();
  await waitFor(() => plugin.exitCode() !== undefined);

  assert.equal(plugin.exitCode(), 0);
  assert.equal(plugin.frames()[0].id, 9, "关管道前的最后一帧不能被丢掉");
});

test("真实子进程：stdout 只有协议帧、日志走 stderr、EOF 后进程退出", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qmai-plugin-test-"));
  const entry = join(dir, "plugin.mjs");
  writeFileSync(
    entry,
    [
      `import { definePlugin } from ${JSON.stringify(pathToFileURL(RUNTIME_ENTRY).href)}`,
      "definePlugin({",
      '  info: { name: "spawned", version: "1.0.0" },',
      "  tools: {",
      '    echo: { description: "echo", inputSchema: { type: "object" }, async handler(args, ctx) {',
      '      ctx.log("handler-ran"); console.error("raw-stderr-line"); return `ok:${args.text}`;',
      "    } },",
      "  },",
      "});",
    ].join("\n"),
    "utf8",
  );

  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "x" } } })}\n`,
    );
    await waitFor(() => stdout.split("\n").filter(Boolean).length >= 2);
    child.stdin.end();
    const code = await exited;

    assert.equal(code, 0, "stdin EOF 后必须自己退出，不留孤儿进程");
    const lines = stdout.split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      const frame = JSON.parse(line); // 解析失败就是"stdout 被污染了"
      assert.equal(frame.jsonrpc, "2.0");
    }
    assert.equal(JSON.parse(lines[1]).result.content[0].text, "ok:x");
    assert.match(stderr, /handler-ran/);
    assert.match(stderr, /raw-stderr-line/);
  } finally {
    if (child.exitCode === null) child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
