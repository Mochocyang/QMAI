#!/usr/bin/env node
// QMAI 插件脚手架（**零依赖**）。
//
//   node sdk/create.mjs <目标目录> --template content-only|with-tools
//
// 为什么要有它：清单从 6 字段涨到 15+ 之后，"从零写一个能装上的插件"的成本全在
// 那些与业务无关的地方 —— schema 版本、插槽名、内容包格式、runtime 该不该有。
// 模板把这些问题一次性答完，作者只改 `name` / `description` / 提示词或 handler。
//
// 两个模板对应两种完全不同的插件（设计 §0）：
//   content-only：纯声明式（Tier 1），不跑任何代码，装 20 个也不占一个进程；
//   with-tools  ：Tier 2，宿主用 `node index.js` 起 MCP stdio 子进程，工具实现只写 handler。

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEMPLATES_DIR = fileURLToPath(new URL("./templates/", import.meta.url));
const RUNTIME_DIR = fileURLToPath(new URL("./runtime/", import.meta.url));

const TEMPLATES = ["content-only", "with-tools"];

/** 文本文件才做 id 替换；二进制原样拷。 */
const TEXT_EXTENSIONS = [".json", ".js", ".mjs", ".md", ".txt", ".ts"];

/**
 * 目录名 → 合法插件 id（`^[a-z0-9][a-z0-9-]{1,63}$`）。
 *
 * 直接拿目录名当 id 会踩两个坑：大写（大小写不敏感文件系统上撞名）与非 ASCII
 * （中文目录名很常见）。所以先规范化，不合法就退回模板里的默认 id。
 */
export function sanitizeId(raw) {
  const normalized = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(normalized)) return normalized;
  return "my-plugin";
}

function isDirectoryEmpty(dir) {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

function copyTemplate(fromDir, toDir, replacements, collected, rootDir) {
  mkdirSync(toDir, { recursive: true });
  for (const name of readdirSync(fromDir)) {
    const from = join(fromDir, name);
    const to = join(toDir, name);
    if (statSync(from).isDirectory()) {
      copyTemplate(from, to, replacements, collected, rootDir);
      continue;
    }
    const extension = name.slice(name.lastIndexOf("."));
    if (!TEXT_EXTENSIONS.includes(extension)) {
      copyFileSync(from, to);
    } else {
      let text = readFileSync(from, "utf8");
      for (const [needle, value] of replacements) text = text.split(needle).join(value);
      writeFileSync(to, text, "utf8");
    }
    collected.push(relative(rootDir, to).split("\\").join("/"));
  }
}

/**
 * 生成一个插件目录。
 *
 * @param {{ targetDir: string, template: string, id?: string, name?: string }} options
 * @returns {{ dir: string, id: string, template: string, files: string[] }}
 */
export function createPlugin(options) {
  const template = options.template ?? "content-only";
  if (!TEMPLATES.includes(template)) {
    throw new Error(`未知模板 "${template}"（可选：${TEMPLATES.join(" / ")}）`);
  }
  const dir = resolve(options.targetDir ?? "");
  if (!options.targetDir) throw new Error("必须给出目标目录");
  if (!isDirectoryEmpty(dir)) {
    // 拒绝而不是覆盖：这个目录里可能已经有一个作者写到一半的插件，
    // "静默覆盖掉别人的文件"是脚手架能犯的最不可原谅的错。
    throw new Error(`目标目录非空，已拒绝：${dir}（脚手架不会覆盖已有文件）`);
  }

  const id = sanitizeId(options.id ?? basename(dir));
  const name = options.name ?? (template === "content-only" ? "我的内容插件" : "我的工具插件");

  // 模板里所有要替换的占位都写成一个可搜的字面量，替换范围可控：
  // 改 id 只动 `"my-plugin"`（带引号），不会误伤描述文字里的同一串字符。
  const replacements = [
    ['"id": "my-plugin"', `"id": "${id}"`],
    ['id: "my-plugin"', `id: ${JSON.stringify(id)}`],
    ['"name": "我的内容插件"', `"name": ${JSON.stringify(name)}`],
    ['"name": "我的工具插件"', `"name": ${JSON.stringify(name)}`],
  ];

  const files = [];
  copyTemplate(join(TEMPLATES_DIR, template), dir, replacements, files, dir);

  if (template === "with-tools") {
    // 把运行时助手**拷进插件目录**，而不是让作者 `import` 插件目录之外的路径：
    // 宿主只装这一个目录，任何"指向 SDK 安装位置的相对路径"装上后都会断。
    const runtimeSource = join(RUNTIME_DIR, "qmai-plugin.mjs");
    const runtimeTarget = join(dir, "qmai-plugin.mjs");
    copyFileSync(runtimeSource, runtimeTarget);
    files.push("qmai-plugin.mjs");
  }

  return { dir, id, template, files };
}

export function main(argv) {
  const args = argv.slice();
  let template;
  let id;
  let name;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--template") {
      template = args[++index];
    } else if (argument.startsWith("--template=")) {
      template = argument.slice("--template=".length);
    } else if (argument === "--id") {
      id = args[++index];
    } else if (argument.startsWith("--id=")) {
      id = argument.slice("--id=".length);
    } else if (argument === "--name") {
      name = args[++index];
    } else if (argument.startsWith("--name=")) {
      name = argument.slice("--name=".length);
    } else if (argument.startsWith("-")) {
      process.stderr.write(`未知参数：${argument}\n`);
      return 2;
    } else {
      positional.push(argument);
    }
  }

  if (positional.length !== 1) {
    process.stderr.write("用法：node sdk/create.mjs <目标目录> --template content-only|with-tools [--id <id>] [--name <名称>]\n");
    return 2;
  }
  if (!TEMPLATES.includes(template)) {
    process.stderr.write(`必须用 --template 指定模板（可选：${TEMPLATES.join(" / ")}）\n`);
    return 2;
  }

  let created;
  try {
    created = createPlugin({ targetDir: positional[0], template, id, name });
  } catch (error) {
    process.stderr.write(`✖ ${error.message}\n`);
    return 1;
  }

  process.stdout.write(`✔ 已生成 ${created.template} 插件：${created.dir}\n`);
  process.stdout.write(`  id：${created.id}\n`);
  for (const file of created.files) process.stdout.write(`  + ${file}\n`);
  process.stdout.write("\n下一步：\n");
  process.stdout.write(`  1) 先本地校验：node sdk/validate.mjs "${created.dir}"\n`);
  process.stdout.write(`  2) 改 name / description${created.template === "with-tools" ? " / handler 实现" : " / 提示词与内容包"}，再跑一次校验\n`);
  process.stdout.write("  3) 在 QMAI 里用『从本地目录安装』选这个目录（设置 → 插件）\n");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
