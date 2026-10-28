// `sdk/create.mjs` 的测试，重点是**端到端自证**：
// 生成出来的目录必须能通过 `validate.mjs`（退出码 0）。脚手架能生成、校验器却判它
// 不合法，是这类工具最丢人的 bug —— 而它只会在作者第一次用的时候暴露。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createPlugin, sanitizeId } from "../create.mjs";
import { validateDirectory } from "../validate.mjs";

const CREATE_ENTRY = fileURLToPath(new URL("../create.mjs", import.meta.url));
const VALIDATE_ENTRY = fileURLToPath(new URL("../validate.mjs", import.meta.url));

function runCli(entry, args) {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `qmai-create-${prefix}-`));
}

test("content-only 模板：生成 → 通过校验（端到端）", () => {
  const base = makeTempDir("content");
  const target = join(base, "my-content-plugin");
  try {
    const created = createPlugin({ targetDir: target, template: "content-only" });
    assert.equal(created.template, "content-only");
    assert.ok(existsSync(join(target, "plugin.json")));
    assert.ok(existsSync(join(target, "content", "items.json")));
    assert.ok(existsSync(join(target, "README.md")));
    // 纯声明式插件不该带任何可执行入口
    assert.equal(existsSync(join(target, "index.js")), false);

    const manifest = JSON.parse(readFileSync(join(target, "plugin.json"), "utf8"));
    assert.equal(manifest.schema, 3);
    assert.deepEqual(manifest.kind, ["declarative"]);
    assert.equal(manifest.runtime, undefined, "纯 Tier 1 必须没有 runtime");
    assert.equal(manifest.contributes.actions.length, 1);
    assert.equal(manifest.contributes.contentPacks.length, 1);
    assert.equal(manifest.id, "my-content-plugin", "id 从目录名派生");
    assert.ok(manifest.configSchema, "模板必须带 configSchema");
    assert.ok(manifest.preview, "模板必须带 preview");

    const validation = validateDirectory(target);
    assert.equal(validation.ok, true, validation.errors.join("\n"));

    const cli = runCli(VALIDATE_ENTRY, [target]);
    assert.equal(cli.code, 0, cli.output);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("with-tools 模板：生成 → 通过校验，且 index.js 用 definePlugin 而不是手写样板", () => {
  const base = makeTempDir("tools");
  const target = join(base, "my-tool-plugin");
  try {
    const created = createPlugin({ targetDir: target, template: "with-tools", name: "我的工具" });
    assert.ok(existsSync(join(target, "index.js")));
    assert.ok(existsSync(join(target, "qmai-plugin.mjs")), "运行时助手必须拷进插件目录（宿主只装这一个目录）");
    assert.ok(existsSync(join(target, "package.json")), "package.json 的 type=module 是指南第 ⑬ 条的解法");

    const packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    assert.equal(packageJson.type, "module");

    const index = readFileSync(join(target, "index.js"), "utf8");
    assert.match(index, /from "\.\/qmai-plugin\.mjs"/);
    assert.match(index, /definePlugin\(/);
    // 不能把 MCP 样板抄回来：手写 stdin 循环说明 SDK 没起作用
    assert.doesNotMatch(index, /process\.stdin\.on\(/, "生成物里不该出现手写的 stdio 循环");

    const manifest = JSON.parse(readFileSync(join(target, "plugin.json"), "utf8"));
    assert.equal(manifest.schema, 1);
    assert.ok(manifest.runtime, "Tier 2 必须有 runtime");
    assert.equal(manifest.runtime.entry, "index.js");
    assert.equal(manifest.contributes.tools.length, 1);
    assert.deepEqual(manifest.permissions, [], "模板默认零权限");
    assert.equal(manifest.id, "my-tool-plugin");

    const validation = validateDirectory(target);
    assert.equal(validation.ok, true, validation.errors.join("\n"));

    const cli = runCli(VALIDATE_ENTRY, [target]);
    assert.equal(cli.code, 0, cli.output);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("CLI：打印下一步引导，且生成的目录能通过 validate", () => {
  const base = makeTempDir("cli");
  const target = join(base, "smoke-plugin");
  try {
    const created = runCli(CREATE_ENTRY, [target, "--template", "content-only"]);
    assert.equal(created.code, 0, created.output);
    assert.match(created.output, /已生成 content-only 插件/);
    assert.match(created.output, /validate\.mjs/);
    assert.match(created.output, /从本地目录安装/);

    assert.equal(runCli(VALIDATE_ENTRY, [target]).code, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("目标目录非空 → 拒绝（绝不覆盖作者写到一半的插件）", () => {
  const base = makeTempDir("nonempty");
  try {
    writeFileSync(join(base, "keep.txt"), "别删我", "utf8");
    const cli = runCli(CREATE_ENTRY, [base, "--template", "content-only"]);
    assert.equal(cli.code, 1);
    assert.match(cli.output, /目标目录非空/);
    assert.ok(existsSync(join(base, "keep.txt")), "原有文件必须原样保留");

    assert.throws(() => createPlugin({ targetDir: base, template: "with-tools" }), /目标目录非空/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("缺 --template / 未知模板 → 退出码 2（用法错误，不是插件错误）", () => {
  const base = makeTempDir("usage");
  try {
    assert.equal(runCli(CREATE_ENTRY, [join(base, "a")]).code, 2);
    assert.equal(runCli(CREATE_ENTRY, [join(base, "b"), "--template", "nope"]).code, 2);
    assert.equal(runCli(CREATE_ENTRY, []).code, 2);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("sanitizeId：目录名里的非法字符不会变成非法 id", () => {
  assert.equal(sanitizeId("My Plugin!"), "my-plugin");
  assert.equal(sanitizeId("中文插件"), "my-plugin", "全非 ASCII 时退回默认 id");
  assert.equal(sanitizeId("a"), "my-plugin", "1 位太短，不合法");
  assert.equal(sanitizeId("good-id-2"), "good-id-2");
});

test("生成的两个模板在真实目录层级下都不依赖 SDK 之外的路径", () => {
  const base = makeTempDir("selfcontained");
  try {
    for (const template of ["content-only", "with-tools"]) {
      const target = join(base, template);
      mkdirSync(target, { recursive: true });
      createPlugin({ targetDir: target, template });
      for (const file of ["plugin.json"]) {
        const text = readFileSync(join(target, file), "utf8");
        assert.doesNotMatch(text, /sdk\//, `${template}/${file} 不能引用 SDK 目录（装上后不存在）`);
      }
      if (template === "with-tools") {
        const index = readFileSync(join(target, "index.js"), "utf8");
        assert.doesNotMatch(index, /\.\.\//, "入口不能引用插件目录之外的相对路径");
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
