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
   * list_shelf_books 现在返回**人能直接读的清单文本**（它会被 prepare 填进
   * 表单的「书架上的书」框，塞 JSON 进去等于让用户去解析转义符）。
   * 所以这里断言的是文本，而不是 JSON 字段。
   */
  const cases = [
    {
      name: "空书架 → 明确说明，不报错",
      response: { books: [] },
      check: (text) => assert.match(text, /书架上是空的/),
    },
    {
      name: "缺 chapterCount 也能用（只是不显示章数）",
      response: { books: [{ id: "a", title: "某书" }] },
      check: (text) => {
        assert.match(text, /《某书》/);
        assert.doesNotMatch(text, /章/);
      },
    },
    {
      name: "snake_case 的 chapter_count 也能读",
      response: { books: [{ id: "a", title: "某书", chapter_count: 12 }] },
      check: (text) => assert.match(text, /12 章/),
    },
  ];

  for (const item of cases) {
    it(item.name, async () => {
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
        // callTool 返回 { raw: MCP 结果对象, payload: 解析后的 JSON }。
        // 这里要的是**文本**，所以取 content[0].text。
        const { raw } = await callTool(client, "list_shelf_books");
        const text = raw?.content?.[0]?.text ?? "";
        item.check(text);
      } finally {
        client.stop();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  }

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

describe("按书名筛选（onlyBooks）", () => {
  /*
   * 为什么要这条：宿主的动态选项（勾选框）在部分环境里取不到，
   * 所以「选书」做成了手填书名的文本字段 —— 插件负责把书名翻译成 id
   * 再向宿主取样。这条链路容易断（大小写、分隔符、书名不完全一致）。
   */
  async function withHost(handler, run) {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => handler(req, res, body));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const client = await startPlugin({
      QMAI_HOST_URL: `http://127.0.0.1:${port}`,
      QMAI_HOST_TOKEN: "t",
    });
    try {
      await run(client);
    } finally {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  const shelf = {
    books: [
      { id: "id-1", title: "楚白", description: "", chapterCount: 2 },
      { id: "id-2", title: "黑雨之下", description: "", chapterCount: 12 },
    ],
  };

  it("书名命中时只取那几本", async () => {
    const sampled = [];
    await withHost(
      (req, res, body) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url.includes("/host/shelf/list")) {
          res.end(JSON.stringify(shelf));
        } else {
          const args = JSON.parse(body || "{}");
          sampled.push(...(args.ids ?? []));
          res.end(JSON.stringify({
            books: (args.ids ?? []).map((id) => ({
              id,
              title: shelf.books.find((b) => b.id === id).title,
              sample: "正文",
            })),
            totalSampleChars: 2,
          }));
        }
      },
      async (client) => {
        await callTool(client, "collect_writing_material", { onlyBooks: "楚白" });
      },
    );
    assert.deepEqual(sampled, ["id-1"]);
  });

  it("逗号与中文顿号都能分隔", async () => {
    const sampled = [];
    await withHost(
      (req, res, body) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url.includes("/host/shelf/list")) {
          res.end(JSON.stringify(shelf));
        } else {
          const args = JSON.parse(body || "{}");
          sampled.push(...(args.ids ?? []));
          res.end(JSON.stringify({ books: [], totalSampleChars: 0 }));
        }
      },
      async (client) => {
        await callTool(client, "collect_writing_material", { onlyBooks: "楚白，黑雨之下" });
      },
    );
    assert.deepEqual(sampled.sort(), ["id-1", "id-2"]);
  });

  it("书名一个都不匹配时，说明原因并列出书架上有哪些书", async () => {
    await withHost(
      (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(shelf));
      },
      async (client) => {
        const { payload } = await callTool(client, "collect_writing_material", { onlyBooks: "不存在的书" });
        assert.equal(payload.status, "empty");
        assert.match(payload.message, /没有找到匹配的书/);
        // 关键：告诉用户书架上有哪些，否则他不知道自己写错了什么
        assert.match(payload.message, /楚白/);
      },
    );
  });
});

describe("分析范围（默认只读当前书）", () => {
  /*
   * 真实故障：用户在写《黑雨之下》，点生成，输出里混进了书架上另外三本书的内容 ——
   * 因为早先的实现"留空 = 分析全部"。界面上没有任何提示，属于安静地做错事。
   *
   * 现在的约定：留空 = 当前书；填书名 = 这几本；填「全部」= 整架。
   */
  const shelf = {
    books: [
      { id: "id-current", title: "黑雨之下", description: "", chapterCount: 12 },
      { id: "id-other", title: "楚白", description: "", chapterCount: 2 },
    ],
  };

  async function runCase({ currentTitle, onlyBooks }) {
    const { createServer } = await import("node:http");
    const sampled = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url.includes("/host/project/info")) {
          res.end(JSON.stringify({ bookTitle: currentTitle }));
        } else if (req.url.includes("/host/shelf/list")) {
          res.end(JSON.stringify(shelf));
        } else {
          const args = JSON.parse(body || "{}");
          sampled.push(...(args.ids ?? []));
          res.end(JSON.stringify({ books: [], totalSampleChars: 0 }));
        }
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const client = await startPlugin({
      QMAI_HOST_URL: `http://127.0.0.1:${port}`,
      QMAI_HOST_TOKEN: "t",
    });
    try {
      await callTool(client, "collect_writing_material", { onlyBooks });
    } finally {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    }
    return sampled;
  }

  it("留空时只取样当前打开的那一本", async () => {
    const sampled = await runCase({ currentTitle: "黑雨之下", onlyBooks: "" });
    // 关键：不能把 id-other 也带上
    assert.deepEqual(sampled, ["id-current"]);
  });

  it("填「全部」时取样整个书架（不传 ids，由宿主返回全部）", async () => {
    const sampled = await runCase({ currentTitle: "黑雨之下", onlyBooks: "全部" });
    assert.deepEqual(sampled, []);
  });

  it("填书名时只取样这几本", async () => {
    const sampled = await runCase({ currentTitle: "黑雨之下", onlyBooks: "楚白" });
    assert.deepEqual(sampled, ["id-other"]);
  })

  it("没有打开项目且留空时，明确报错而不是偷偷读全部", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url.includes("/host/project/info")) {
        res.end(JSON.stringify({ bookTitle: "" }));
      } else {
        res.end(JSON.stringify(shelf));
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const client = await startPlugin({
      QMAI_HOST_URL: `http://127.0.0.1:${port}`,
      QMAI_HOST_TOKEN: "t",
    });
    try {
      const { payload } = await callTool(client, "collect_writing_material", { onlyBooks: "" });
      assert.equal(payload.status, "empty");
      assert.match(payload.message, /没有打开任何一本书/);
    } finally {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    }
  })
})
