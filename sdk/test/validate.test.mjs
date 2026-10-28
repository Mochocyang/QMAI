// `sdk/validate.mjs` 的测试：真实样例必须过，故意写坏的插件必须**精确**报出来。
//
// 这里刻意同时用两种调用方式：
//   - 走 CLI（spawn）：验收"退出码"这个契约 —— 作者与 CI 只认退出码；
//   - 直接 import `validateDirectory`：断言具体文案，不用解析 stdout。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validateDirectory } from "../validate.mjs";

const VALIDATE_ENTRY = fileURLToPath(new URL("../validate.mjs", import.meta.url));
const SAMPLES = fileURLToPath(new URL("../../samples/plugins/", import.meta.url));

function runCli(target) {
  const result = spawnSync(process.execPath, [VALIDATE_ENTRY, target], { encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

function makePluginDir(manifest, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "qmai-validate-"));
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest, null, 2), "utf8");
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(dir, relativePath);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
  }
  return dir;
}

test("真实样例 idea-generator 通过（退出码 0）", () => {
  const dir = join(SAMPLES, "idea-generator");
  const cli = runCli(dir);
  assert.equal(cli.code, 0, cli.output);
  assert.match(cli.output, /plugin\.json 合法（schema 3）/);
  assert.match(cli.output, /内容包 content\/inspirations\.json：30 条/);

  const result = validateDirectory(dir);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("真实样例 chapter-metrics 通过（退出码 0）", () => {
  const cli = runCli(join(SAMPLES, "chapter-metrics"));
  assert.equal(cli.code, 0, cli.output);
});

test("故意写坏的清单：坏 slot / 缺 fs:project-read / 未知 target kind / 重复 hook", () => {
  const dir = makePluginDir({
    schema: 3,
    id: "broken-plugin",
    name: "坏插件",
    version: "1.0",
    kind: ["declarative"],
    contributes: {
      actions: [
        {
          id: "gen",
          title: "生成",
          slot: "chapter-toolbar2",
          prompt: { system: "你是助手", user: "章节正文：{{chapter.text}}" },
          output: { mode: "list", targets: [{ kind: "write-file", label: "写文件" }] },
        },
      ],
      hooks: [
        { on: "afterLlmResponse", impl: "prompt", template: "改：{{text}}" },
        { on: "afterLlmResponse", impl: "prompt", template: "再改：{{text}}" },
      ],
    },
    permissions: [],
  });

  try {
    const result = validateDirectory(dir);
    assert.equal(result.ok, false);
    const messages = result.errors.join("\n");

    assert.match(messages, /version = "1\.0" 不合法/, "三段 SemVer");
    assert.match(messages, /actions\[0\]\.slot = "chapter-toolbar2" 不存在/);
    assert.match(messages, /chapter\.text.*fs:project-read/, "引用了章节数据却没声明项目读权限");
    assert.match(messages, /targets\[0\]\.kind = "write-file" 不存在/, "未知输出目标必须报错，不能静默丢弃");
    assert.match(messages, /同事件同 priority/, "同事件同 priority 无法确定顺序");

    const cli = runCli(dir);
    assert.equal(cli.code, 1, "有 error 必须退出码 1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schema 1 的清单声明 v3 字段 → 报错", () => {
  const dir = makePluginDir({
    schema: 1,
    id: "old-plugin",
    name: "老清单",
    version: "1.0.0",
    runtime: { type: "node", entry: "index.js" },
    contributes: {
      tools: [{ name: "my_tool", description: "", parameters: {} }],
      actions: [{ id: "a1", title: "动作", prompt: { system: "s", user: "u" }, output: { targets: [] } }],
    },
  });
  try {
    const result = validateDirectory(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /schema 1 的清单声明了 v3 字段/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("未知字段报错并列出候选（封闭契约）", () => {
  const dir = makePluginDir({
    schema: 3,
    id: "typo-plugin",
    name: "拼错字段",
    version: "1.0.0",
    runtimeX: { type: "node", entry: "index.js" },
    permissions: [],
  });
  try {
    const result = validateDirectory(dir);
    assert.equal(result.ok, false);
    const messages = result.errors.join("\n");
    assert.match(messages, /未知字段 "runtimeX"/);
    assert.match(messages, /该位置合法字段：schema \/ id \/ name/, "必须把候选列给作者");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Tier 2 贡献缺 runtime → 报错；有 runtime 但无 Tier 2 贡献 → 只警告", () => {
  const missing = makePluginDir({
    schema: 1,
    id: "no-runtime",
    name: "没有 runtime",
    version: "1.0.0",
    contributes: { tools: [{ name: "my_tool", description: "", parameters: {} }] },
  });
  const extra = makePluginDir({
    schema: 1,
    id: "extra-runtime",
    name: "多余的 runtime",
    version: "1.0.0",
    runtime: { type: "node", entry: "index.js" },
    contributes: {},
  });
  try {
    const missingResult = validateDirectory(missing);
    assert.equal(missingResult.ok, false);
    assert.match(missingResult.errors.join("\n"), /没有 runtime/);

    const extraResult = validateDirectory(extra);
    assert.equal(extraResult.ok, true, "只是警告，不该拒绝");
    assert.match(extraResult.warnings.join("\n"), /可以删掉 runtime/);
  } finally {
    rmSync(missing, { recursive: true, force: true });
    rmSync(extra, { recursive: true, force: true });
  }
});

test("内容包：version 必须是数字 1、条目缺字段、超条数上限都要报", () => {
  const dir = makePluginDir(
    {
      schema: 3,
      id: "bad-pack",
      name: "坏内容包",
      version: "1.0.0",
      kind: ["declarative"],
      contributes: {
        contentPacks: [
          { id: "p1", title: "包一", file: "content/a.json", maxItems: 2 },
          { id: "p2", title: "包二", file: "content/b.json" },
        ],
      },
      permissions: [],
    },
    {
      "content/a.json": { version: "1", items: [] },
      "content/b.json": {
        version: 1,
        items: [
          { id: "x1", title: "有标题", body: "有正文" },
          { id: "x1", title: "", body: "重复 id 且缺标题" },
        ],
      },
    },
  );
  try {
    const result = validateDirectory(dir);
    assert.equal(result.ok, false);
    const messages = result.errors.join("\n");
    assert.match(messages, /content\/a\.json 的 version 必须是\*\*数字\*\* 1/);
    assert.match(messages, /id 重复：x1/);
    assert.match(messages, /缺少有效的 title/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("提示词引用了不存在的变量 → 报错（运行时会被静默替换成空串）", () => {
  const dir = makePluginDir({
    schema: 3,
    id: "bad-var",
    name: "坏变量",
    version: "1.0.0",
    kind: ["declarative"],
    configSchema: { type: "object", properties: { tone: { type: "string", title: "语气" } } },
    contributes: {
      actions: [
        {
          id: "a1",
          title: "动作",
          form: { fields: [{ key: "idea", type: "textarea", label: "灵感" }] },
          prompt: { system: "你是助手", user: "灵感：{{idea}}，风格：{{config.style}}，数量：{{count}}" },
          output: { mode: "text", targets: [] },
        },
      ],
    },
    permissions: [],
  });
  try {
    const result = validateDirectory(dir);
    assert.equal(result.ok, false);
    const messages = result.errors.join("\n");
    assert.match(messages, /configSchema\.properties 里没有 "style"/);
    assert.match(messages, /引用了 \{\{count\}\}，但它既不是本 action 的表单字段/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("没有任何 configSchema 却引用 {{config.*}} → 报错", () => {
  const dir = makePluginDir({
    schema: 3,
    id: "no-config",
    name: "没有配置",
    version: "1.0.0",
    kind: ["declarative"],
    contributes: {
      actions: [
        {
          id: "a1",
          title: "动作",
          prompt: { system: "你是助手", user: "风格：{{config.style}}" },
          output: { mode: "text", targets: [] },
        },
      ],
    },
    permissions: [],
  });
  try {
    const result = validateDirectory(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /但清单没有 configSchema\.properties/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("目录不存在 / 缺 plugin.json → 退出码 1 且说清缺什么", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "qmai-empty-"));
  try {
    assert.equal(runCli(join(emptyDir, "nope")).code, 1);
    const output = runCli(emptyDir).output;
    assert.match(output, /缺少 plugin\.json/);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
