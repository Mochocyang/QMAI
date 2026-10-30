/**
 * 书名生成插件的自测。
 *
 * 跑法（不需要宿主软件）：
 *   node --test "samples/plugins/title-forge/*.test.mjs"
 *
 * 它验的是**插件自己的逻辑**：调宿主接口时怎么拼 URL/头、宿主返回各种形状时
 * 怎么降级、三种风格的写作要求是否真的不同。宿主的真实接口行为由
 * `src-tauri/src/plugins/shelf.rs` 的 Rust 测试覆盖，两边各管一半。
 *
 * 为什么用注入而不是真起 HTTP 服务：插件对宿主的唯一接口就是 `fetch`，
 * 把它替换掉就能覆盖"403 / 500 / 空书架 / 有数据"全部路径，且测试快到可以常跑。
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/** 被测试的插件模块导出（index.js 调用即启动，所以这里用子进程隔离会更稳；见下）。 */
const PLUGIN_ENTRY = fileURLToPath(new URL("./index.js", import.meta.url));

/**
 * 用一个最小 MCP 客户端去驱动插件进程。
 *
 * 为什么不用 import：`definePlugin()` 一调用就接管 process.stdin/stdout 并开始循环。
 * 主进程里 import 会把测试自己的 stdio 也一起接走。用子进程跑，
 * 测试这边只做"发一行 JSON、读一行 JSON"，正好也是宿主真实做的事。
 */
async function startPlugin(env = {}) {
  const { spawn } = await import("node:child_process");

  const child = spawn(process.execPath, [PLUGIN_ENTRY], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

  let buffer = "";
  let stderr = "";
  const queue = [];
  const waiters = [];

  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let idx;
    // 插件必须一帧一行；按行切开后逐帧分发
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        throw new Error(`插件往 stdout 写了非 JSON 内容：${line.slice(0, 120)}`);
      }
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const next = () =>
    new Promise((resolve, reject) => {
      const queued = queue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      waiters.push(resolve);
      setTimeout(() => reject(new Error(`等待插件响应超时。stderr:\n${stderr}`)), 8000);
    });

  const request = async (payload) => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return next();
  };

  const stop = () => {
    try {
      child.stdin.end();
    } catch {
      /* 已退出 */
    }
    child.kill();
  };

  return { child, request, stop, stderr: () => stderr };
}

async function callTool(client, name, args = {}) {
  const frame = await client.request({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  assert.ok(frame.result, `工具 ${name} 应返回 result，实际：${JSON.stringify(frame)}`);
  const text = frame.result.content?.[0]?.text ?? "";
  return { raw: frame.result, payload: safeParse(text) };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

describe("书名生成插件", () => {
  it("tools/list 报出三个工具", async () => {
    const client = await startPlugin();
    try {
      const frame = await client.request({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      const names = (frame.result?.tools ?? []).map((tool) => tool.name).sort();
      assert.deepEqual(names, ["collect_writing_material", "list_name_styles", "list_shelf_books"]);
    } finally {
      client.stop();
    }
  });

  it("list_name_styles 返回三种风格，且三者要求互不相同", async () => {
    const client = await startPlugin();
    try {
      const { payload } = await callTool(client, "list_name_styles");
      assert.equal(payload.status, "ok");
      assert.equal(payload.styles.length, 3);

      const ids = payload.styles.map((s) => s.id).sort();
      assert.deepEqual(ids, ["fanqie", "literary", "xuanhuan"]);

      // 三种风格的核心差异必须真的写在不同指令里，否则模型会生成同一种味道
      const instructions = payload.styles.map((s) => s.instruction);
      assert.equal(new Set(instructions).size, 3, "三种风格的写作要求不应重复");

      const literary = payload.styles.find((s) => s.id === "literary");
      assert.match(literary.instruction, /4–6 字/);
      // 四字格风格必须明确禁止网文直白词，否则会被带跑
      assert.match(literary.instruction, /严禁使用/);

      const fanqie = payload.styles.find((s) => s.id === "fanqie");
      assert.match(fanqie.instruction, /逗号分句/);
    } finally {
      client.stop();
    }
  });

  it("没有宿主地址时，工具返回可读错误而不是崩掉", async () => {
    const client = await startPlugin({ QMAI_HOST_URL: "" });
    try {
      const frame = await client.request({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_shelf_books", arguments: {} },
      });
      // 工具失败必须走 result + isError，模型才看得见原因（见指南第 ⑦ 条）
      const text = frame.result?.content?.[0]?.text ?? "";
      assert.match(text, /宿主地址缺失|QMAI_HOST_URL/);
    } finally {
      client.stop();
    }
  });
});

describe("对宿主返回值的容错", () => {
  /*
   * 宿主可能返回：空书架、缺字段、camelCase 与 snake_case 混用（Rust 侧是 camelCase，
   * 但历史数据可能存在别的形状）。插件不能因为少了 chapterCount 就整条崩掉 ——
   * 书名生成只要书名就够，其余是加分项。
   */
  const cases = [
    {
      name: "空书架 → 明确说明，不报错",
      response: { books: [] },
      expectStatus: "empty",
      expectMessage: /还没有书/,
    },
    {
      name: "缺 chapterCount 也能用",
      response: { books: [{ id: "a", title: "某书", description: "简介" }] },
      expectStatus: "ok",
      check: (payload) => assert.equal(payload.books[0].chapterCount, 0),
    },
    {
      name: "snake_case 的 chapter_count 也能读",
      response: { books: [{ id: "a", title: "某书", chapter_count: 12 }] },
      expectStatus: "ok",
      check: (payload) => assert.equal(payload.books[0].chapterCount, 12),
    },
  ];

  for (const item of cases) {
    it(item.name, async () => {
      // 起一个最小 HTTP 服务扮演宿主
      const { createServer } = await import("node:http");
      const server = createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(item.response));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();

      const client = await startPlugin({
        QMAI_HOST_URL: `http://127.0.0.1:${port}`,
        QMAI_HOST_TOKEN: "test-token",
      });
      try {
        const { payload } = await callTool(client, "list_shelf_books");
        assert.equal(payload?.status, item.expectStatus);
        if (item.expectMessage) assert.match(payload.message, item.expectMessage);
        if (item.check) item.check(payload);
      } finally {
        client.stop();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  }

  it("宿主返回 403 时，错误信息里带状态码（便于分辨『没授权』和『书架空』）", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "E_PERMISSION", permission: "fs:shelf-read" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    const client = await startPlugin({
      QMAI_HOST_URL: `http://127.0.0.1:${port}`,
      QMAI_HOST_TOKEN: "test-token",
    });
    try {
      const frame = await client.request({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_shelf_books", arguments: {} },
      });
      const text = frame.result?.content?.[0]?.text ?? "";
      assert.match(text, /403/);
      assert.equal(frame.result?.isError, true);
    } finally {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("collect_writing_material 把多本书拼成带分隔的素材", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          books: [
            { id: "a", title: "挖矿记", description: "挖矿成神", chapterCount: 3, sample: "他举起镐子。" },
            { id: "b", title: "诸神鱼", description: "鱼龙混杂", chapterCount: 5, sample: "鱼游过神像。" },
          ],
          totalSampleChars: 14,
        }),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    const client = await startPlugin({
      QMAI_HOST_URL: `http://127.0.0.1:${port}`,
      QMAI_HOST_TOKEN: "t",
    });
    try {
      const { payload } = await callTool(client, "collect_writing_material", { ids: ["a", "b"] });
      assert.equal(payload.status, "ok");
      assert.equal(payload.bookCount, 2);
      assert.match(payload.material, /【第 1 本】《挖矿记》/);
      assert.match(payload.material, /【第 2 本】《诸神鱼》/);
      // 两本书之间必须有分隔，否则模型会把两本的正文当成同一本
      assert.match(payload.material, /---/);
    } finally {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
