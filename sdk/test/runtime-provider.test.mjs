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

function request(port, path, { method = "GET", token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
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
    req.end(body === undefined ? undefined : JSON.stringify(body));
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
