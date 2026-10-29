// `qmai-provider.mjs`（provider 端点助手）的测试。
//
// 全部打**真实端口**（`port: 0` 让内核分配）：provider 的坑几乎都在 HTTP/SSE 那一层
// —— 401 有没有生效、SSE 有没有 usage 帧、`[DONE]` 是不是最后、断开后上游停没停 ——
// 这些用 mock 的 req/res 测不出来。

import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { serveProvider } from "../runtime/qmai-provider.mjs";

function makeProvider(overrides = {}) {
  return {
    id: "test-provider",
    async models() {
      return [
        {
          id: "good-model",
          name: "好模型",
          maxInputTokens: 204800,
          maxOutputTokens: 8192,
          supportsToolCall: true,
        },
        // 故意缺 maxInputTokens：SDK 必须如实报告缺失，不能编一个默认窗口。
        { id: "no-window-model", maxOutputTokens: 4096 },
      ];
    },
    async chat(request, { onDelta }) {
      for (const piece of ["你", "好"]) onDelta(piece);
      return { usage: { promptTokens: 10, completionTokens: 2 } };
    },
    ...overrides,
  };
}

async function startServer(provider, { token = "test-token" } = {}) {
  const logs = [];
  const handle = serveProvider(provider, {
    port: 0,
    token,
    stderr: { write: (chunk) => logs.push(chunk) },
  });
  const port = await handle.ready;
  return { handle, port, logs };
}

function request(port, path, { method = "GET", token, body, raw, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const hasBody = body !== undefined || raw !== undefined;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on("error", reject);
    // `raw` 走原始字符串：测"请求体不是合法 JSON"必须绕过 JSON.stringify。
    req.end(raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body));
  });
}

test("/health 不鉴权就能 200（宿主探活不带令牌）", async () => {
  const { handle, port } = await startServer(makeProvider());
  try {
    const response = await request(port, "/health");
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.text).ok, true);
  } finally {
    await handle.close();
  }
});

test("/v1/* 必须带正确令牌：缺令牌 / 错令牌 → 401，对的 → 200", async () => {
  const { handle, port } = await startServer(makeProvider());
  try {
    assert.equal((await request(port, "/v1/models")).status, 401, "无令牌必须 401");
    assert.equal((await request(port, "/v1/models", { token: "wrong" })).status, 401, "错令牌必须 401");
    assert.equal((await request(port, "/v1/models", { token: "test-token" })).status, 200);
    assert.equal(
      (await request(port, "/v1/chat/completions", { method: "POST", body: {} })).status,
      401,
      "chat 端点同样要鉴权",
    );
  } finally {
    await handle.close();
  }
});

test("/v1/models 自动补 _qmai，但绝不编造窗口大小", async () => {
  const { handle, port, logs } = await startServer(makeProvider());
  try {
    const response = await request(port, "/v1/models", { token: "test-token" });
    const body = JSON.parse(response.text);
    assert.equal(body.object, "list");
    assert.equal(body.data.length, 2);

    const good = body.data.find((model) => model.id === "good-model");
    assert.equal(good.object, "model");
    assert.equal(good._qmai.maxInputTokens, 204800);
    assert.equal(good._qmai.maxOutputTokens, 8192);
    assert.equal(good._qmai.supportsToolCall, true);
    assert.equal(good._qmai.displayName, "好模型");
    // 平铺的能力字段被搬进 _qmai，顶层不再留一份（否则"到底谁生效"含糊）
    assert.equal(good.maxInputTokens, undefined);

    const missing = body.data.find((model) => model.id === "no-window-model");
    assert.equal(
      missing._qmai.maxInputTokens,
      undefined,
      "缺失的窗口必须保持缺失：编一个默认值会让宿主按假窗口塞上下文，上游直接 400",
    );
    assert.ok(
      logs.some((line) => line.includes("maxInputTokens") && line.includes("no-window-model")),
      "缺失时要有一条 stderr 警告，作者才不会以为模型被宿主吃了",
    );
  } finally {
    await handle.close();
  }
});

test("流式：多分片 + usage 帧 + 以 data: [DONE] 收尾", async () => {
  const { handle, port } = await startServer(makeProvider());
  try {
    const response = await request(port, "/v1/chat/completions", {
      method: "POST",
      token: "test-token",
      body: { model: "good-model", stream: true, messages: [{ role: "user", content: "hi" }] },
    });
    assert.equal(response.status, 200);

    const frames = response.text
      .split("\n\n")
      .map((block) => block.trim())
      .filter((block) => block !== "")
      .map((block) => block.replace(/^data: /, ""));

    assert.ok(frames.length >= 4, `至少应有 role/两个分片/usage/[DONE]，实际：${frames.length}`);
    assert.equal(frames.at(-1), "[DONE]", "data: [DONE] 必须是最后一帧");

    const contentFrames = frames
      .filter((frame) => frame !== "[DONE]")
      .map((frame) => JSON.parse(frame))
      .filter((frame) => frame.choices?.[0]?.delta?.content);
    assert.deepEqual(
      contentFrames.map((frame) => frame.choices[0].delta.content),
      ["你", "好"],
    );

    const usageFrame = frames
      .filter((frame) => frame !== "[DONE]")
      .map((frame) => JSON.parse(frame))
      .find((frame) => frame.usage !== undefined);
    assert.ok(usageFrame, "必须有 usage 帧，否则 QMAI 的用量统计会全是 0");
    assert.deepEqual(usageFrame.usage, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
    assert.deepEqual(usageFrame.choices, [], "usage 帧的 choices 为空（include_usage 语义）");
  } finally {
    await handle.close();
  }
});

test("非流式（stream:false）：普通 JSON + usage", async () => {
  const { handle, port } = await startServer(makeProvider());
  try {
    const response = await request(port, "/v1/chat/completions", {
      method: "POST",
      token: "test-token",
      body: { model: "good-model", stream: false, messages: [] },
    });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.text);
    assert.equal(body.object, "chat.completion");
    assert.equal(body.choices[0].message.role, "assistant");
    assert.equal(body.choices[0].message.content, "你好", "非流式由 onDelta 拼成完整回复");
    assert.equal(body.usage.total_tokens, 12);
  } finally {
    await handle.close();
  }
});

test("客户端断开 → chat() 收到的 signal 立刻 abort（不烧用户额度）", async () => {
  let observedSignal;
  let aborted = false;
  const provider = makeProvider({
    async chat(request, { onDelta, signal }) {
      observedSignal = signal;
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      // 慢慢吐 20 片：客户端在中途断开，作者应能靠 signal 立刻停手。
      for (let index = 0; index < 20; index += 1) {
        if (signal.aborted) throw signal.reason;
        onDelta(`片${index}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { usage: { promptTokens: 1, completionTokens: 20 } };
    },
  });
  const { handle, port, logs } = await startServer(provider);
  try {
    await new Promise((resolve) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/v1/chat/completions",
          method: "POST",
          headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
        },
        (res) => {
          res.once("data", () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on("error", () => resolve());
      req.end(JSON.stringify({ model: "good-model", stream: true, messages: [] }));
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(observedSignal, "chat() 必须收到 signal");
    assert.equal(aborted, true, "用户点「停止」后插件必须真的停手，否则额度继续被烧");
    assert.ok(logs.some((line) => line.includes("客户端断开")));
  } finally {
    await handle.close();
  }
});

test("缺端口或缺令牌 → 立刻 exit(1)，不启动一个半残的端点", async () => {
  for (const env of [{}, { QMAI_PROVIDER_PORT: "5000" }, { QMAI_PROVIDER_TOKEN: "t" }]) {
    const errors = [];
    const exitCodes = [];
    const handle = serveProvider(makeProvider(), {
      env,
      stderr: { write: (chunk) => errors.push(chunk) },
      exit: (code) => exitCodes.push(code),
    });
    assert.equal(handle, undefined, "不该返回可用的 server");
    assert.deepEqual(exitCodes, [1]);
    assert.ok(errors.length > 0, "必须往 stderr 说清缺什么");
  }
});

test("没有 chat() → 拒绝启动（而不是起得来、每次调用 500）", async () => {
  const errors = [];
  const exitCodes = [];
  const handle = serveProvider(
    { id: "no-chat", models: async () => [] },
    { port: 0, token: "t", stderr: { write: (chunk) => errors.push(chunk) }, exit: (code) => exitCodes.push(code) },
  );
  assert.equal(handle, undefined);
  assert.deepEqual(exitCodes, [1]);
  assert.ok(errors.some((line) => line.includes("chat")));
});

test("只绑 127.0.0.1（不暴露给局域网）", async () => {
  const { handle } = await startServer(makeProvider());
  try {
    const address = handle.server.address();
    assert.equal(address.address, "127.0.0.1");
  } finally {
    await handle.close();
  }
});

test("未知路径 404；已知路径的错方法 405", async () => {
  const { handle, port } = await startServer(makeProvider());
  try {
    assert.equal((await request(port, "/v1/embeddings", { token: "test-token" })).status, 404);
    assert.equal((await request(port, "/v1/models", { method: "POST", token: "test-token", body: {} })).status, 405);
  } finally {
    await handle.close();
  }
});

test("chat() 抛错：进流后给 error 帧，但仍以 [DONE] 收尾（客户端不会一直等）", async () => {
  const provider = makeProvider({
    async chat(request, { onDelta }) {
      onDelta("已经发出的一片");
      throw new Error("上游 429：额度不足");
    },
  });
  const { handle, port, logs } = await startServer(provider);
  try {
    const response = await request(port, "/v1/chat/completions", {
      method: "POST",
      token: "test-token",
      body: { model: "good-model", stream: true, messages: [] },
    });
    const frames = response.text
      .split("\n\n")
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => block.replace(/^data: /, ""));
    assert.equal(frames.at(-1), "[DONE]");
    const errorFrame = frames
      .filter((frame) => frame !== "[DONE]")
      .map((frame) => JSON.parse(frame))
      .find((frame) => frame.error !== undefined);
    assert.match(errorFrame.error.message, /429/);
    assert.ok(logs.some((line) => line.includes("chat() 抛错")));
  } finally {
    await handle.close();
  }
});

// ── `POST /login/credential`（paste-token / import-file 的入口）──────────
//
// 这个端点接的是**用户令牌**，所以除了功能，还要盯两件事：
//   1. 状态码要精确（404 = 没实现、400 = 输入不合法、401 = 令牌不对、405 = 方法不对）
//      —— 宿主把「状态码 + 响应体前 200 字」原样展示给用户，码错了用户就被指错方向；
//   2. 凭证内容绝不出现在日志/错误信息里（用户一贴反馈截图就泄了）。

/** 一眼能认出来的假令牌：任何断言里出现它都说明泄漏了。 */
const SECRET = "sk-live-QMAI-should-never-be-logged";

test("/login/credential：没实现 onCredential → 404（而不是 500）", async () => {
  const { handle, port, logs } = await startServer(makeProvider());
  try {
    const response = await request(port, "/login/credential", {
      method: "POST",
      token: "test-token",
      body: { kind: "paste-token", value: SECRET },
    });
    assert.equal(response.status, 404, "作者没实现这个端点：404 让他一眼知道要加 onCredential，500 会让他去翻日志");
    const body = JSON.parse(response.text);
    assert.match(String(body.error), /\/login\/credential/, "错误信息要指名是哪个端点没实现");
    assert.equal(body.error.includes(SECRET), false, "错误信息里不能出现用户凭据");
    assert.equal(logs.join("").includes(SECRET), false);
  } finally {
    await handle.close();
  }
});

test("/login/credential：鉴权与 /v1/* 一致（缺 / 错令牌 → 401）", async () => {
  const seen = [];
  const provider = makeProvider({
    async onCredential(credential) {
      seen.push(credential);
      return { ok: true };
    },
  });
  const { handle, port } = await startServer(provider);
  try {
    const body = { kind: "paste-token", value: SECRET };
    const missing = await request(port, "/login/credential", { method: "POST", body });
    assert.equal(missing.status, 401, "没有 Bearer 必须 401");
    const wrong = await request(port, "/login/credential", { method: "POST", token: "wrong", body });
    assert.equal(wrong.status, 401, "错令牌必须 401（常量时间比较，见 qmai-provider.mjs 注释）");
    assert.equal(seen.length, 0, "鉴权失败绝不能把凭据交给 onCredential");
    assert.equal(wrong.text.includes(SECRET), false);
  } finally {
    await handle.close();
  }
});

test("/login/credential：回调收到 {kind,value,filename}，返回值原样回给宿主", async () => {
  const seen = [];
  const provider = makeProvider({
    async onCredential(credential) {
      seen.push(credential);
      return { ok: true, message: "登录成功" };
    },
  });
  const { handle, port } = await startServer(provider);
  try {
    const imported = await request(port, "/login/credential", {
      method: "POST",
      token: "test-token",
      body: { kind: "import-file", value: SECRET, filename: "auth.txt" },
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(JSON.parse(imported.text), { ok: true, message: "登录成功" }, "message 要透传给卡片");

    const pasted = await request(port, "/login/credential", {
      method: "POST",
      token: "test-token",
      body: { kind: "paste-token", value: SECRET },
    });
    assert.equal(pasted.status, 200);

    assert.deepEqual(seen[0], { kind: "import-file", value: SECRET, filename: "auth.txt" });
    assert.deepEqual(seen[1], {
      kind: "paste-token",
      value: SECRET,
      filename: undefined,
    }, "paste-token 没有 filename，应当是 undefined 而不是空串");
  } finally {
    await handle.close();
  }
});

test("/login/credential：返回 undefined → {ok:true}（允许只做副作用）", async () => {
  let called = 0;
  const provider = makeProvider({
    async onCredential() {
      called += 1;
      // 什么都不返回：作者可能只把凭据写进自己的数据目录，不想多说一句。
    },
  });
  const { handle, port } = await startServer(provider);
  try {
    const response = await request(port, "/login/credential", {
      method: "POST",
      token: "test-token",
      body: { kind: "paste-token", value: SECRET },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.text), { ok: true });
    assert.equal(called, 1);
  } finally {
    await handle.close();
  }
});

test("/login/credential：onCredential 抛错 → 400 且 body 含错误信息", async () => {
  const provider = makeProvider({
    async onCredential() {
      throw new Error("令牌应以 sk- 开头");
    },
  });
  const { handle, port } = await startServer(provider);
  try {
    const response = await request(port, "/login/credential", {
      method: "POST",
      token: "test-token",
      body: { kind: "paste-token", value: SECRET },
    });
    assert.equal(response.status, 400, "可预期的业务失败用 400（500 会让作者以为插件崩了）");
    const body = JSON.parse(response.text);
    assert.match(body.error, /sk- 开头/, "宿主把响应体原样展示给用户，原因必须写清");
    assert.equal(response.text.includes(SECRET), false);
  } finally {
    await handle.close();
  }
});

test("/login/credential：GET → 405（固定是 POST）", async () => {
  const provider = makeProvider({ async onCredential() { return { ok: true }; } });
  const { handle, port } = await startServer(provider);
  try {
    const response = await request(port, "/login/credential", { token: "test-token" });
    assert.equal(response.status, 405);
    assert.match(JSON.parse(response.text).error, /POST/);
  } finally {
    await handle.close();
  }
});

test("/login/credential：凭证不进日志、不进 400 文案（含非法 JSON 的解析报错）", async () => {
  const provider = makeProvider({
    async onCredential() {
      return { ok: true };
    },
  });
  const { handle, port, logs } = await startServer(provider);
  try {
    // 1) 正常收下：日志里只有路径，不该有 body。
    await request(port, "/login/credential", {
      method: "POST",
      token: "test-token",
      body: { kind: "paste-token", value: SECRET },
    });

    // 2) 非法 JSON：Node 的 JSON.parse 报错会带上输入片段（`"sk-..." is not valid JSON`），
    //    所以 SDK 必须换掉那条文案 —— 否则用户凭据会出现在界面与日志里。
    const broken = await request(port, "/login/credential", {
      method: "POST",
      token: "test-token",
      raw: `{"kind":"paste-token","value":"${SECRET}"`,
    });
    assert.equal(broken.status, 400);
    assert.equal(broken.text.includes(SECRET), false, "400 文案里不能回显请求体");

    // 3) 缺字段的 400 同样不该把已有内容回显出来。
    const noKind = await request(port, "/login/credential", {
      method: "POST",
      token: "test-token",
      body: { value: SECRET },
    });
    assert.equal(noKind.status, 400);
    assert.equal(noKind.text.includes(SECRET), false);

    assert.equal(logs.join("").includes(SECRET), false, "用户凭据绝对不能进 stderr");
  } finally {
    await handle.close();
  }
});
