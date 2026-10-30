#!/usr/bin/env node
// QMAI 插件校验器（**零依赖**，只用 Node 内置）。
//
//   node sdk/validate.mjs <插件目录> [<插件目录> …]
//
// 为什么需要它：`plugin.json` 是**封闭契约**（宿主开了 deny_unknown_fields），清单从 6 个
// 字段涨到 15+ 之后，作者靠在 QMAI 里"装一下试试"来试错，一轮只能发现一个错。这个 CLI
// 在本地一次报全，且规则与宿主**逐条对齐**。
//
// 规则的权威来源（按优先级）：
//   1. `src-tauri/src/plugins/manifest.rs` —— 清单字段与所有 E_* 错误码
//   2. `src-tauri/src/plugins/content.rs` —— 内容包数据结构（版本、条目、5MB/5000 条）
//   3. `src/lib/plugins/declarative/*.ts` —— 前端那一侧的白名单（输出目标 kind、表单字段类型、
//      插槽变量命名空间）。清单里 `form` / `output` / `limits` 是裸 Value，宿主只透传，
//      真正的白名单在前端；所以校验器必须照前端那份来，否则会出现"校验器放过、界面丢弃"。
//
// 与宿主的两处**刻意差异**（都在报告里注明）：
//   - 宿主 `PluginManifest::validate` 命中第一个错误就返回；这里**一次列出所有错误**，
//     因为本地改清单是作者的编辑循环，一轮修完比一轮改一个快得多。
//   - 宿主对 `output.targets[].kind` 不做校验（前端只是 `console.warn` 后**静默丢弃**那个
//     按钮）。这个"静默"是已知缺口（A2/E）：作者会以为按钮声明生效了。校验器把它升级成
//     **error**，让问题在本地就暴露。

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── 常量：逐个对应 Rust 侧的那一行 ────────────────────────────────────────

/** `manifest.rs` 的 `CURRENT_SCHEMA`。 */
const CURRENT_SCHEMA = 3;
/** v3 字段所需的最低 schema（`V3_SCHEMA`）。 */
const V3_SCHEMA = 3;
/** `KNOWN_KINDS`：目前只有 `declarative` 有语义。 */
const KNOWN_KINDS = ["declarative"];
/** `HOOK_EVENTS`（事件名 + 默认超时；默认超时只用于提示，不参与校验）。 */
const HOOK_EVENTS = [
  ["beforeLlmRequest", 8_000],
  ["afterLlmResponse", 8_000],
  ["beforeChapterDraft", 15_000],
  ["afterChapterDraft", 15_000],
  ["beforeReview", 15_000],
  ["afterReview", 15_000],
  ["beforePolish", 15_000],
  ["afterPolish", 15_000],
  ["onLlmUsage", 2_000],
  ["onChapterCompleted", 2_000],
];
const HOOK_EVENT_NAMES = HOOK_EVENTS.map(([name]) => name);
/** `MAX_HOOK_TIMEOUT_MS`。 */
const MAX_HOOK_TIMEOUT_MS = 120_000;
/** `SLOT_IDS`：受控资源，新增需评审。 */
const SLOT_IDS = [
  "chapter-toolbar",
  "inspiration-browser",
  "editor-context-menu",
  "outline-toolbar",
  "analysis-toolbar",
  "plugin-center",
];
/** `SLOT_API_VERSIONS`：插槽语义变了就 bump。 */
const SLOT_API_VERSIONS = {
  "chapter-toolbar": 1,
  "inspiration-browser": 1,
  "editor-context-menu": 1,
  "outline-toolbar": 1,
  "analysis-toolbar": 1,
  "plugin-center": 1,
};
/** `KNOWN_INJECT`。 */
const KNOWN_INJECT = ["host.qmai.tools", "host.logger"];
/** `KNOWN_PERMISSIONS`（需用户逐项勾选）。 */
const KNOWN_PERMISSIONS = ["fs:project-read", "fs:shelf-read", "fs:project-write", "net:https", "llm:use", "net:listen"];
/** `AUTO_GRANTED_PERMISSIONS`（自动授予，声明与否都一样）。 */
const AUTO_GRANTED_PERMISSIONS = ["data:write"];
/** `BUILTIN_PROVIDER_IDS`：模型复合键是 `providerId/modelId`，撞名用户就分不清。 */
const BUILTIN_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "azure",
  "ollama",
  "custom",
  "minimax",
  "claude-code",
  "codex-cli",
  "cursor-cli",
  "antigravity-cli",
];
/** `KNOWN_PROVIDER_CAPABILITIES`。 */
const KNOWN_PROVIDER_CAPABILITIES = ["models.refresh", "balance.query", "checkin"];

/** `content.rs` 的 `MAX_PACK_BYTES`（单包 5MB）。 */
const MAX_PACK_BYTES = 5 * 1024 * 1024;
/** `content.rs` 的 `DEFAULT_MAX_ITEMS`（单包 5000 条硬顶）。 */
const DEFAULT_MAX_ITEMS = 5000;

/**
 * action 的 `output.targets[].kind` 白名单 = 前端 `OUTPUT_TARGET_KINDS`。
 * 只有四种「写点什么」的通道，**没有** 任意路径写入（设计 D2）。
 */
const OUTPUT_TARGET_KINDS = ["project-field", "insert-at-cursor", "clipboard", "chapter-note"];
/**
 * 内容包条目额外允许 `run-action`（前端 `CONTENT_ITEM_TARGET_KINDS`）：
 * 它什么都不写，只是再跑同一插件内的另一个 action。
 */
const CONTENT_ITEM_TARGET_KINDS = [...OUTPUT_TARGET_KINDS, "run-action"];
/** 前端 `OutputMode`；未知值降级为 `text`（设计 D3），所以只是 warning。 */
const OUTPUT_MODES = ["list", "text", "json"];
/** 前端 `presentation`。 */
const PRESENTATIONS = ["chips", "markdown", "plain"];
/** 前端 `FIELD_TYPES`（本期 6 种）；未知类型降级为 text + warning。 */
const FIELD_TYPES = ["text", "textarea", "number", "select", "multiselect", "toggle"];
/**
 * 宿主目前真正有写通道的项目字段（前端 `WRITABLE_PROJECT_FIELDS` = `["bookTitle"]`）。
 *
 * 设计 §7.3 列了 5 个字段，但当前代码只接通了书名 —— 所以这里**只 warn**：
 * 声明 `bookIntro` / `protagonist` 这类目标不是清单非法，只是那个按钮到运行时会禁用。
 */
const WRITABLE_PROJECT_FIELDS = ["bookTitle"];

// 各对象允许的字段（= Rust 结构体字段 + serde rename），用于复刻 deny_unknown_fields。
const MANIFEST_KEYS = [
  "schema",
  "id",
  "name",
  "version",
  "description",
  "author",
  "license",
  "requires",
  "runtime",
  "kind",
  "inject",
  "contributes",
  "permissions",
  "autoStart",
  "configSchema",
  "preview",
  "slots",
  "requiresSlot",
];
const AUTHOR_KEYS = ["name", "url"];
const REQUIRES_KEYS = ["qmai"];
const RUNTIME_KEYS = ["type", "entry", "args", "keepAlive", "startTimeoutMs"];
const CONTRIBUTES_KEYS = ["tools", "stages", "panels", "providers", "contentPacks", "actions", "hooks"];
const TOOL_KEYS = ["name", "description", "parameters"];
const PROVIDER_KEYS = [
  "id",
  "name",
  "description",
  "authKind",
  "settingsPagePath",
  "authDomains",
  "capabilities",
];
const CONTENT_PACK_KEYS = ["id", "title", "description", "file", "maxItems", "actions", "slot"];
const ACTION_KEYS = ["id", "title", "description", "slot", "form", "prompt", "output", "limits", "model", "prepare"];
const PROMPT_KEYS = ["system", "user"];
const HOOK_KEYS = ["on", "impl", "template", "tool", "priority", "timeoutMs", "gate"];

/** `interpolate.ts` 的 `TOKEN_PATTERN`：`\{{` 是转义，`{{ name }}` 才是变量。 */
const TOKEN_PATTERN_SOURCE = String.raw`\\\{\{|\{\{\s*([^{}]*?)\s*\}\}`;

// ── 基础判定：与 Rust 的同名函数一一对应 ────────────────────────────────

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** `is_valid_id`：`^[a-z0-9][a-z0-9-]{1,63}$`（2..64 位，会直接当目录名用）。 */
function isValidId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{1,63}$/.test(id);
}

/** `is_valid_semver`：只认纯数字三段（预发布/构建元数据本期不支持）。 */
function isValidSemver(version) {
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version);
}

/** `is_safe_relative`（入口文件）：相对路径、无 `..`、最后一段是真文件名。 */
function isSafeRelative(entry) {
  if (typeof entry !== "string") return false;
  if (entry.trim() === "" || entry !== entry.trim()) return false;
  if (/[\u0000-\u001f\u007f]/.test(entry)) return false;
  if (entry.endsWith("/") || entry.endsWith("\\")) return false;
  if (entry.startsWith("/") || entry.startsWith("\\")) return false;
  // Windows 盘符（`C:…`）：Rust 侧靠 `Component::Prefix` 拒掉，这里用正则等价表达。
  if (/^[A-Za-z]:/.test(entry)) return false;
  const segments = entry.split(/[/\\]/).filter((segment) => segment !== "");
  const last = segments[segments.length - 1];
  if (!last || last === "." || last === "..") return false;
  return !segments.includes("..");
}

/** `is_valid_tool_name`：`^[a-z][a-z0-9_]{2,63}$`。 */
function isValidToolName(name) {
  return typeof name === "string" && /^[a-z][a-z0-9_]{2,63}$/.test(name);
}

/** `is_valid_provider_id`：`^[a-z][a-z0-9-]{1,31}$`，且不含 `/`。 */
function isValidProviderId(id) {
  return typeof id === "string" && !id.includes("/") && /^[a-z][a-z0-9-]{1,31}$/.test(id);
}

/** `is_valid_content_pack_id`：`^[a-z][a-z0-9-]{0,31}$`（会当 DOM key / 按钮 id 用）。 */
function isValidContentPackId(id) {
  return typeof id === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(id);
}

/** `is_safe_content_file`：白名单字符 + 无空段/`.`/`..` + 不以 `/` 开头。 */
function isSafeContentFile(file) {
  if (typeof file !== "string") return false;
  if (file.trim() === "" || file !== file.trim()) return false;
  if (/[\u0000-\u001f\u007f]/.test(file)) return false;
  if (!/^[A-Za-z0-9\-_./]+$/.test(file)) return false;
  if (file.startsWith("/")) return false;
  const segments = file.split("/");
  return !segments.some((segment) => segment === "" || segment === "." || segment === "..");
}

/** `is_valid_settings_page_path`：只接受站内绝对路径。 */
function isValidSettingsPagePath(path) {
  return typeof path === "string" && path.startsWith("/") && !path.includes("..") && !path.includes("://");
}

/** `is_valid_auth_domain`：受控登录窗口的导航白名单，宁严勿宽。 */
function isValidAuthDomain(domain) {
  if (typeof domain !== "string") return false;
  const value = domain.trim();
  if (!value || value.includes("*") || value.includes("://") || value.includes("/")) return false;
  if (value.startsWith(".") || value.endsWith(".")) return false;
  if (value.toLowerCase() === "localhost") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false; // IPv4
  if (!value.includes(".")) return false;
  return /^[A-Za-z0-9\-.]+$/.test(value);
}

/** 内容包生效条数上限：`0`/缺省 → 5000，再夹到 5000 硬顶（`resolve_item_limit`）。 */
function resolveItemLimit(declared) {
  const limit = Number.isInteger(declared) && declared > 0 ? declared : DEFAULT_MAX_ITEMS;
  return Math.min(limit, DEFAULT_MAX_ITEMS);
}

/** 抽出提示词里引用的变量名（与 `collectVariables` 同语义：去重、保留首次出现顺序）。 */
function collectTemplateVariables(template) {
  const names = [];
  const pattern = new RegExp(TOKEN_PATTERN_SOURCE, "g");
  let match;
  while ((match = pattern.exec(template)) !== null) {
    // `match[1] === undefined` 表示命中的是转义 `\{{`，不是变量。
    if (match[1] === undefined) continue;
    const name = match[1].trim();
    if (name === "") continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// ── 报告 ─────────────────────────────────────────────────────────────

function createReport(target) {
  return {
    target,
    passes: [],
    errors: [],
    warnings: [],
    infos: [],
    /** 内容包 id → 实际条目数（供 preview 一致性检查用）。 */
    packCounts: new Map(),
  };
}

function pass(result, text) {
  result.passes.push(text);
}
function fail(result, text) {
  result.errors.push(text);
}
function warn(result, text) {
  result.warnings.push(text);
}
function hint(result, text) {
  result.infos.push(text);
}

/** 复刻 `deny_unknown_fields`：未知字段一律拒装，并把候选列出来。 */
function checkKeys(value, allowed, where, result) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(
        result,
        `${where} 含未知字段 "${key}"：清单是封闭契约，宿主会直接拒装（该位置合法字段：${allowed.join(" / ")}）`,
      );
    }
  }
}

/** 缩进检查：不是硬契约，但样例与文档统一 2 空格，diff 才不会整文件抖动。 */
function checkIndent(raw, result) {
  const lines = raw.split(/\r?\n/);
  let tabLines = 0;
  let oddLines = 0;
  for (const line of lines) {
    if (/^[ ]*\t/.test(line)) tabLines += 1;
    const indent = /^( +)/.exec(line);
    if (indent && indent[1].length % 2 === 1) oddLines += 1;
  }
  if (tabLines > 0) {
    warn(result, `plugin.json 有 ${tabLines} 行用 Tab 缩进：QMAI 的样例与文档统一用 2 空格，建议改成空格`);
  } else if (oddLines > 0) {
    warn(result, `plugin.json 有 ${oddLines} 行缩进不是 2 的倍数：建议统一 2 空格缩进`);
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────

/**
 * 校验一个插件目录。
 *
 * @param {string} target 目录路径（相对或绝对）
 * @returns {{ target: string, passes: string[], errors: string[], warnings: string[],
 *             infos: string[], packCounts: Map<string, number>, ok: boolean }}
 */
export function validateDirectory(target) {
  const result = createReport(target);
  const dir = resolve(target);

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(result, `插件目录不存在或不是目录：${target}`);
    return finish(result);
  }
  const manifestPath = join(dir, "plugin.json");
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    fail(result, `插件根目录缺少 plugin.json：${manifestPath}（清单必须在根，不能放进子目录）`);
    return finish(result);
  }

  const raw = readFileSync(manifestPath, "utf8");
  checkIndent(raw, result);

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    fail(result, `plugin.json 不是合法 JSON：${error.message}`);
    return finish(result);
  }
  if (!isPlainObject(manifest)) {
    fail(result, "plugin.json 顶层必须是对象");
    return finish(result);
  }

  validateManifest(dir, manifest, result);
  return finish(result);
}

function finish(result) {
  result.ok = result.errors.length === 0;
  return result;
}

function validateManifest(dir, manifest, result) {
  // 1) 契约形状 → 2) 身份字段 → 3) 分层（runtime）→ 4) 权限 → 5) 贡献 → 6) v3 声明面。
  // 顺序与 `PluginManifest::validate` 一致：越基础、越容易一次修对的越靠前。
  checkKeys(manifest, MANIFEST_KEYS, "plugin.json", result);

  const schema = manifest.schema;
  if (!Number.isInteger(schema) || schema < 1 || schema > CURRENT_SCHEMA) {
    fail(result, `schema = ${JSON.stringify(schema)} 不支持（合法：1 / 2 / 3）`);
  }
  if (!isValidId(manifest.id)) {
    fail(
      result,
      `id = ${JSON.stringify(manifest.id)} 不合法：只能小写字母/数字/连字符，2..64 位，且首字符不能是连字符（它会直接当安装目录名）`,
    );
  }
  if (!isNonEmptyString(manifest.name)) {
    fail(result, "name 不能为空");
  } else if ([...manifest.name].length > 64) {
    fail(result, `name 太长（${[...manifest.name].length} 字符，上限 64）`);
  }
  if (!isValidSemver(manifest.version)) {
    fail(result, `version = ${JSON.stringify(manifest.version)} 不合法：必须是三段纯数字 SemVer（1.2 / v1.0 / 1.0.0-beta 都会被拒）`);
  }

  if (manifest.author !== undefined) {
    if (!isPlainObject(manifest.author)) fail(result, "author 必须是对象（{\"name\": …, \"url\": …}）");
    else checkKeys(manifest.author, AUTHOR_KEYS, "author", result);
  }
  if (manifest.requires !== undefined) {
    if (!isPlainObject(manifest.requires)) fail(result, "requires 必须是对象（{\"qmai\": \">=4.4.0\"}）");
    else checkKeys(manifest.requires, REQUIRES_KEYS, "requires", result);
  }
  if (manifest.autoStart !== undefined && typeof manifest.autoStart !== "boolean") {
    fail(result, "autoStart 必须是布尔值");
  }

  const kinds = readStringArray(manifest.kind, "kind", result);
  for (const kind of kinds) {
    if (!KNOWN_KINDS.includes(kind)) {
      // 与宿主同一条：未知 kind 只忽略，不拒装（老宿主也得能装新层级的包）。
      warn(result, `kind 里的 "${kind}" 宿主不认识（已知：${KNOWN_KINDS.join(" / ")}），会被忽略，不影响安装`);
    }
  }

  const permissions = readStringArray(manifest.permissions, "permissions", result);
  const inject = readStringArray(manifest.inject, "inject", result);
  for (const service of inject) {
    if (!KNOWN_INJECT.includes(service)) {
      fail(result, `inject 里的 "${service}" 不存在（合法：${KNOWN_INJECT.join(" / ")}）`);
    }
  }
  for (const permission of permissions) {
    if (!KNOWN_PERMISSIONS.includes(permission) && !AUTO_GRANTED_PERMISSIONS.includes(permission)) {
      fail(
        result,
        `permissions 里的 "${permission}" 不存在（合法：${[...KNOWN_PERMISSIONS, ...AUTO_GRANTED_PERMISSIONS].join(" / ")}）`,
      );
    }
  }
  if (permissions.includes("fs:project-write")) {
    hint(result, "permissions 声明了 fs:project-write：用户会看到这一项并犹豫，确认你真的需要写项目文件");
  }

  const contributes = isPlainObject(manifest.contributes) ? manifest.contributes : {};
  if (manifest.contributes !== undefined && !isPlainObject(manifest.contributes)) {
    fail(result, "contributes 必须是对象");
  }
  checkKeys(contributes, CONTRIBUTES_KEYS, "contributes", result);

  const tools = asArray(contributes.tools);
  const providers = asArray(contributes.providers);
  const hooks = asArray(contributes.hooks);
  const packs = asArray(contributes.contentPacks);
  const actions = asArray(contributes.actions);
  for (const [key, value] of [
    ["tools", contributes.tools],
    ["providers", contributes.providers],
    ["hooks", contributes.hooks],
    ["contentPacks", contributes.contentPacks],
    ["actions", contributes.actions],
    ["stages", contributes.stages],
  ]) {
    if (value !== undefined && !Array.isArray(value)) fail(result, `contributes.${key} 必须是数组`);
  }

  // ── 分层规则（设计 D1 / `needs_runtime`）────────────────────────────
  const processHooks = hooks.filter((hook) => isPlainObject(hook) && hook.impl === "process");
  const needsRuntime = tools.length > 0 || providers.length > 0 || processHooks.length > 0;
  const hasRuntime = isPlainObject(manifest.runtime);
  if (needsRuntime && !hasRuntime) {
    fail(
      result,
      "声明了需要执行的贡献（contributes.tools / providers / impl=process 的 hooks），但没有 runtime：宿主没有可启动的入口（E_RUNTIME_REQUIRED）",
    );
  }
  if (hasRuntime && !needsRuntime) {
    warn(result, "清单用了 runtime，但没有任何 Tier 2 贡献（tools / providers / impl=process 的 hook），可以删掉 runtime");
  }
  if (manifest.runtime !== undefined && !isPlainObject(manifest.runtime)) {
    fail(result, "runtime 必须是对象（{\"type\":\"node\",\"entry\":\"index.js\"}）");
  }
  if (hasRuntime) checkRuntime(manifest.runtime, result);

  checkTools(tools, result);
  checkProviders(providers, permissions, schema, result);
  checkV3Gate(schema, manifest, packs, actions, hooks, result);
  checkContentPacks(dir, packs, actions, result);
  checkActions(actions, manifest, permissions, result);
  checkHooks(hooks, tools, result);
  checkSlots(manifest, result);
  checkConfigSchema(manifest, result);
  checkPreview(manifest, result, packs);

  if (result.errors.length === 0) {
    pass(result, `plugin.json 合法（schema ${schema}）`);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value, where, result) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail(result, `${where} 必须是字符串数组`);
    return [];
  }
  const out = [];
  value.forEach((item, index) => {
    if (typeof item !== "string") fail(result, `${where}[${index}] 必须是字符串`);
    else out.push(item);
  });
  return out;
}

function checkRuntime(runtime, result) {
  checkKeys(runtime, RUNTIME_KEYS, "runtime", result);
  if (runtime.type !== undefined && !["node", "python", "binary"].includes(runtime.type)) {
    fail(result, `runtime.type = ${JSON.stringify(runtime.type)} 不支持（合法：node / python / binary）`);
  } else if (runtime.type === undefined) {
    fail(result, "runtime.type 必须声明（node / python / binary）");
  }
  if (runtime.entry === undefined) {
    fail(result, "runtime.entry 必须声明（相对插件根的入口文件，例如 index.js）");
  } else if (!isSafeRelative(runtime.entry)) {
    fail(
      result,
      `runtime.entry = ${JSON.stringify(runtime.entry)} 不合法：必须是插件目录内的相对路径，不能有 .. / 绝对路径 / 反斜杠结尾`,
    );
  }
  if (runtime.keepAlive !== undefined && typeof runtime.keepAlive !== "boolean") {
    fail(result, "runtime.keepAlive 必须是布尔值");
  }
  if (runtime.args !== undefined) {
    if (!Array.isArray(runtime.args) || runtime.args.some((item) => typeof item !== "string")) {
      fail(result, "runtime.args 必须是字符串数组");
    }
  }
  if (runtime.startTimeoutMs !== undefined) {
    const ms = runtime.startTimeoutMs;
    if (!Number.isInteger(ms) || ms < 1_000 || ms > 60_000) {
      fail(result, `runtime.startTimeoutMs = ${JSON.stringify(ms)} 超出范围（1000..60000）`);
    }
  }
}

function checkTools(tools, result) {
  const seen = new Set();
  tools.forEach((tool, index) => {
    const where = `contributes.tools[${index}]`;
    if (!isPlainObject(tool)) {
      fail(result, `${where} 必须是对象`);
      return;
    }
    checkKeys(tool, TOOL_KEYS, where, result);
    if (!isValidToolName(tool.name)) {
      fail(
        result,
        `${where}.name = ${JSON.stringify(tool.name)} 不合法：小写字母开头，只含小写字母/数字/下划线，3..64 位（宿主会加 <插件id>__ 前缀）`,
      );
    } else if (seen.has(tool.name)) {
      fail(result, `${where}.name = "${tool.name}" 重复：注入 ToolRegistry 时后写覆盖先写，作者会以为两个工具都在`);
    } else {
      seen.add(tool.name);
    }
    if (tool.parameters !== undefined && !isPlainObject(tool.parameters)) {
      fail(result, `${where}.parameters 必须是对象（参数名 → {type, description, required}）`);
    }
  });
  if (tools.length > 0) {
    hint(
      result,
      "清单里的 contributes.tools[].parameters 是「参数映射」，运行期 tools/list 的 inputSchema 才是 JSON Schema，宿主以运行期为准 —— 改一处务必同步另一处",
    );
  }
  return seen;
}

function checkProviders(providers, permissions, schema, result) {
  if (providers.length === 0) return;
  if (schema === 1) {
    fail(result, "schema 1 的清单不能声明 contributes.providers（需要 schema 2+，否则那个模型永远不出现在模型列表里）");
  }
  if (!permissions.includes("net:listen")) {
    fail(result, "声明了 providers 但没有 net:listen 权限：宿主不会为它分配端口，插件会处于「声明了却绑不上」的状态");
  }
  // 「providers 必须有 runtime」不在这里报：那属于分层规则（`needs_runtime`），
  // 已经在 validateManifest 里以更本质的说法报过，重复报只会让作者以为有两处要改。
  const seen = new Set();
  providers.forEach((provider, index) => {
    const where = `contributes.providers[${index}]`;
    if (!isPlainObject(provider)) {
      fail(result, `${where} 必须是对象`);
      return;
    }
    checkKeys(provider, PROVIDER_KEYS, where, result);
    if (!isValidProviderId(provider.id)) {
      fail(result, `${where}.id = ${JSON.stringify(provider.id)} 不合法：小写字母开头，只含小写字母/数字/连字符，2..32 位，不能含 /`);
    } else if (BUILTIN_PROVIDER_IDS.includes(provider.id)) {
      fail(result, `${where}.id = "${provider.id}" 与内置 provider 重名：模型复合键会撞车，用户分不清数据流向谁`);
    } else if (seen.has(provider.id)) {
      fail(result, `${where}.id = "${provider.id}" 重复：前端按 id 建索引时后者覆盖前者`);
    } else {
      seen.add(provider.id);
    }
    if (!isNonEmptyString(provider.name)) {
      fail(result, `${where}.name 不能为空`);
    } else if ([...provider.name].length > 64) {
      fail(result, `${where}.name 太长（上限 64 字符）`);
    }
    const authKind = provider.authKind;
    if (authKind === undefined) {
      fail(result, `${where}.authKind 必须声明（none / browser-login / paste-token / import-file）`);
    } else if (!["none", "browser-login", "paste-token", "import-file"].includes(authKind)) {
      fail(result, `${where}.authKind = ${JSON.stringify(authKind)} 不合法（合法：none / browser-login / paste-token / import-file）`);
    } else if (authKind === "browser-login") {
      if (asArray(provider.authDomains).length === 0) {
        fail(result, `${where} 的 authKind = browser-login 时必须声明 authDomains（受控登录窗口的导航白名单）`);
      }
      // 只 warn 不 error：缺 settingsPagePath 时宿主**不拒装**，只是把卡片上的
      // 「登录/设置」按钮禁用（没有页面可加载）。校验器把"宿主会静默禁用一个功能"
      // 升级成可见的提示，但仍按宿主的口径放行 —— 作者可能就想先装上、后补页面。
      if (!isNonEmptyString(provider.settingsPagePath)) {
        warn(
          result,
          `${where} 的 authKind = browser-login 但没声明 settingsPagePath：受控窗口没有页面可加载，卡片上的「登录/设置」按钮会一直禁用`,
        );
      }
    } else if (authKind === "paste-token" || authKind === "import-file") {
      // 这两种形态下宿主会把用户的输入 POST 给插件的固定端点；不实现它，用户点「保存」/「选择文件」
      // 只会拿到 404。校验器无法看运行时代码，所以这里只能提示（info），不能判 error。
      hint(
        result,
        `${where} 的 authKind = ${authKind}：需要在你的 provider 里实现 POST /login/credential（宿主把用户输入交给它；用 sdk/runtime/qmai-provider.mjs 的 serveProvider({ onCredential }) 就自动有了）`,
      );
    } else if (authKind === "none" && isNonEmptyString(provider.settingsPagePath)) {
      // 没有任何登录入口会打开这个页面 → 它是死配置。宿主不会因此拒装，但作者会以为
      // "我配了设置页，用户应该能进去"，实际界面上没有任何按钮。
      warn(
        result,
        `${where} 的 authKind = none 却声明了 settingsPagePath：没有任何入口会打开这个页面（要么删掉，要么把 authKind 改成 browser-login）`,
      );
    }
    for (const domain of asArray(provider.authDomains)) {
      if (!isValidAuthDomain(domain)) {
        fail(result, `${where}.authDomains 里的 ${JSON.stringify(domain)} 不合法：必须是完整域名（不含 * / 协议 / 路径，不能是 IP 或 localhost）`);
      }
    }
    for (const capability of asArray(provider.capabilities)) {
      if (!KNOWN_PROVIDER_CAPABILITIES.includes(capability)) {
        fail(result, `${where}.capabilities 里的 ${JSON.stringify(capability)} 不存在（合法：${KNOWN_PROVIDER_CAPABILITIES.join(" / ")}）`);
      }
    }
    if (provider.settingsPagePath !== undefined && provider.settingsPagePath !== "" && !isValidSettingsPagePath(provider.settingsPagePath)) {
      fail(result, `${where}.settingsPagePath = ${JSON.stringify(provider.settingsPagePath)} 不合法：只接受站内绝对路径（以 / 开头、不含 ..）`);
    }
  });
}

/** 老清单（schema 1/2）声明 v3 字段：老宿主会静默丢掉，作者却以为生效了。 */
function checkV3Gate(schema, manifest, packs, actions, hooks, result) {
  const v3Declared =
    packs.length > 0 || actions.length > 0 || hooks.length > 0 || manifest.configSchema !== undefined;
  if (Number.isInteger(schema) && schema < V3_SCHEMA && v3Declared) {
    fail(
      result,
      `schema ${schema} 的清单声明了 v3 字段（contentPacks / actions / hooks / configSchema）：需要 "schema": 3，否则老宿主会静默丢掉它们`,
    );
  }
}

function checkContentPacks(dir, packs, actions, result) {
  const actionIds = new Set(
    actions.filter((action) => isPlainObject(action) && typeof action.id === "string").map((action) => action.id),
  );
  const seen = new Set();
  packs.forEach((pack, index) => {
    const where = `contributes.contentPacks[${index}]`;
    if (!isPlainObject(pack)) {
      fail(result, `${where} 必须是对象`);
      return;
    }
    checkKeys(pack, CONTENT_PACK_KEYS, where, result);
    if (!isValidContentPackId(pack.id)) {
      fail(result, `${where}.id = ${JSON.stringify(pack.id)} 不合法：^[a-z][a-z0-9-]{0,31}$（会当 DOM key / 按钮 id 用）`);
    } else if (seen.has(pack.id)) {
      fail(result, `${where}.id = "${pack.id}" 重复：前端按包 id 建索引，重复会让用户少一个包却查不出原因`);
    } else {
      seen.add(pack.id);
    }
    if (!isNonEmptyString(pack.title)) {
      fail(result, `${where}.title 不能为空（它显示在灵感库入口上）`);
    }
    // 插槽（设计 §4.1：决定这个包在界面哪里出现）。与上面 actions[].slot 同款白名单校验，
    // 但**空串不放行**：动作的空串等于「不挂插槽」（是个有语义的状态），而内容包没有那个状态 ——
    // 不写就默认落灵感库（宿主 `6734280b`：`ContentPackDecl.slot` 缺省回填 inspiration-browser），
    // 所以内容包的 slot: "" 只可能是笔误，按非法处理，别让它静默变成一个奇怪的空插槽。
    if (pack.slot !== undefined) {
      const slot = pack.slot;
      if (typeof slot !== "string") {
        fail(result, `${where}.slot 必须是字符串`);
      } else if (!SLOT_IDS.includes(slot)) {
        fail(
          result,
          `${where}.slot = ${JSON.stringify(slot)} 不存在（合法插槽：${SLOT_IDS.join(" / ")}；不写则默认挂到 inspiration-browser）`,
        );
      }
    } else {
      hint(result, `${where} 未声明 slot，将默认挂到 inspiration-browser`);
    }
    if (pack.maxItems !== undefined && (!Number.isInteger(pack.maxItems) || pack.maxItems < 0)) {
      fail(result, `${where}.maxItems 必须是非负整数`);
    }
    if (Number.isInteger(pack.maxItems) && pack.maxItems > DEFAULT_MAX_ITEMS) {
      warn(result, `${where}.maxItems = ${pack.maxItems} 超过硬顶 ${DEFAULT_MAX_ITEMS}：超出部分不生效（设计 D4）`);
    }
    if (pack.actions !== undefined) {
      if (!Array.isArray(pack.actions)) {
        fail(result, `${where}.actions 必须是数组`);
      } else {
        pack.actions.forEach((target, targetIndex) => {
          checkTarget(target, `${where}.actions[${targetIndex}]`, CONTENT_ITEM_TARGET_KINDS, result, actionIds);
        });
      }
    }

    const fileOk = isSafeContentFile(pack.file);
    if (!fileOk) {
      fail(
        result,
        `${where}.file = ${JSON.stringify(pack.file)} 不合法：必须是相对插件根的路径，只含字母数字与 - _ . /，不能有 .. 或反斜杠`,
      );
      return;
    }
    checkContentPackFile(dir, pack, where, resolveItemLimit(pack.maxItems), result);
  });
}

function checkContentPackFile(dir, pack, where, limit, result) {
  const path = join(dir, pack.file);
  if (!existsSync(path)) {
    fail(result, `${where}.file 指向的文件不存在：${pack.file}`);
    return;
  }
  const stat = statSync(path);
  if (!stat.isFile()) {
    fail(result, `${where}.file 不是文件：${pack.file}`);
    return;
  }
  if (stat.size > MAX_PACK_BYTES) {
    fail(result, `内容包 ${pack.file} 过大：${stat.size} 字节，上限 5MB`);
    return;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(result, `内容包 ${pack.file} 不是合法 JSON：${error.message}`);
    return;
  }
  if (!isPlainObject(data)) {
    fail(result, `内容包 ${pack.file} 顶层必须是对象（{\"version\":1,\"items\":[…]})`);
    return;
  }
  if (data.version !== 1) {
    fail(result, `内容包 ${pack.file} 的 version 必须是**数字** 1（收到：${JSON.stringify(data.version)}；字符串 "1" 也不收）`);
  }
  if (!Array.isArray(data.items)) {
    fail(result, `内容包 ${pack.file} 的 items 必须是数组`);
    return;
  }
  if (data.items.length > limit) {
    fail(result, `内容包 ${pack.file} 条目数 ${data.items.length} 超过上限 ${limit}`);
  }

  const problems = [];
  const seenIds = new Set();
  data.items.forEach((item, index) => {
    const position = `第 ${index + 1} 条`;
    if (!isPlainObject(item)) {
      problems.push(`${position}必须是对象`);
      return;
    }
    for (const field of ["id", "title", "body"]) {
      if (!isNonEmptyString(item[field])) problems.push(`${position}缺少有效的 ${field}`);
    }
    if (isNonEmptyString(item.id)) {
      const trimmed = item.id.trim();
      if (seenIds.has(trimmed)) problems.push(`${position}的 id 重复：${trimmed}`);
      else seenIds.add(trimmed);
    }
    if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string"))) {
      problems.push(`${position}的 tags 必须是字符串数组`);
    }
  });
  const shown = problems.slice(0, 8);
  for (const problem of shown) fail(result, `内容包 ${pack.file}：${problem}`);
  if (problems.length > shown.length) {
    fail(result, `内容包 ${pack.file}：还有 ${problems.length - shown.length} 条内容问题未列出（先修上面的）`);
  }
  if (problems.length === 0) {
    pass(result, `内容包 ${pack.file}：${data.items.length} 条`);
    if (typeof pack.id === "string") result.packCounts.set(pack.id, data.items.length);
  }
}

function checkActions(actions, manifest, permissions, result) {
  const seen = new Set();
  const configProperties = configPropertiesOf(manifest);

  actions.forEach((action, index) => {
    const where = `actions[${index}]`;
    if (!isPlainObject(action)) {
      fail(result, `${where} 必须是对象`);
      return;
    }
    checkKeys(action, ACTION_KEYS, where, result);

    if (!isValidContentPackId(action.id)) {
      fail(result, `${where}.id = ${JSON.stringify(action.id)} 不合法：^[a-z][a-z0-9-]{0,31}$（会当按钮 id / DOM key 用）`);
    } else if (seen.has(action.id)) {
      fail(result, `${where}.id = "${action.id}" 重复：动作 id 是「点了哪个按钮」的唯一标识，重复会让一个按钮永远点不到`);
    } else {
      seen.add(action.id);
    }
    if (!isNonEmptyString(action.title)) {
      // 宿主不校验 title（前端缺了用 id 兜底），但按钮上出现 id 很难看。
      warn(result, `${where}.title 为空：界面上会直接显示 id "${action.id}"`);
    }
    if (action.slot !== undefined) {
      const slot = action.slot;
      if (typeof slot !== "string") {
        fail(result, `${where}.slot 必须是字符串`);
      } else if (slot.trim() !== "" && !SLOT_IDS.includes(slot)) {
        fail(result, `${where}.slot = ${JSON.stringify(slot)} 不存在（合法：${SLOT_IDS.join(" / ")}；留空表示不挂插槽）`);
      }
    } else {
      hint(result, `${where} 没有声明 slot：这个 action 只能通过内容包的 run-action 或插件中心触发`);
    }

    // 表单：字段类型只做 warning（未知类型宿主降级为 text，不丢字段 —— 设计 §3.2）。
    const fieldKeys = new Set();
    if (action.form !== undefined) {
      if (!isPlainObject(action.form) || !Array.isArray(action.form.fields)) {
        fail(result, `${where}.form 必须是 {fields:[…]}`);
      } else {
        action.form.fields.forEach((field, fieldIndex) => {
          const fieldWhere = `${where}.form.fields[${fieldIndex}]`;
          if (!isPlainObject(field)) {
            warn(result, `${fieldWhere} 不是对象，会被前端丢弃`);
            return;
          }
          if (!isNonEmptyString(field.key)) {
            warn(result, `${fieldWhere} 缺少 key：这个字段拿不到值，提示词里也没法引用它`);
          } else {
            if (fieldKeys.has(field.key)) warn(result, `${fieldWhere}.key = "${field.key}" 重复：后一个会覆盖前一个的值`);
            fieldKeys.add(field.key);
          }
          if (field.type !== undefined && !FIELD_TYPES.includes(field.type)) {
            warn(result, `${fieldWhere}.type = ${JSON.stringify(field.type)} 不认识，宿主会按 text 渲染（本期支持：${FIELD_TYPES.join(" / ")}）`);
          }
    const hasDynamicOptions = field.optionsFrom && typeof field.optionsFrom === "object" && typeof field.optionsFrom.tool === "string";
    if ((field.type === "select" || field.type === "multiselect") && asArray(field.options).length === 0 && !hasDynamicOptions) {
            warn(result, `${fieldWhere} 是 ${field.type}，但没有 options：下拉里会一个选项都没有`);
          }
        });
      }
    }

    /*
     * `prepare` 产出的变量也是合法的提示词变量。
     *
     * `prepare` 是「调模型前先跑工具取素材」，它的结果按 `var` 名进模板作用域 ——
     * 所以 `{{material}}` 这类名字虽然没有对应的表单字段，却能真的取到值。
     * 不把这一步算进来，作者会被提示"这个变量无法解析"，而它明明能解析。
     */
    if (Array.isArray(action.prepare)) {
      action.prepare.forEach((step, stepIndex) => {
        if (!isPlainObject(step)) {
          warn(result, `${where}.prepare[${stepIndex}] 不是对象，会被忽略`);
          return;
        }
        if (!isNonEmptyString(step.tool)) {
          warn(result, `${where}.prepare[${stepIndex}] 没有 tool：这一步不会执行`);
        }
        if (isNonEmptyString(step.var)) fieldKeys.add(step.var);
      });
    }

    // 提示词：必填、非空，且变量必须都能解析出来。
    const prompt = action.prompt;
    if (!isPlainObject(prompt)) {
      fail(result, `${where}.prompt 必须提供 {system, user}`);
    } else {
      checkKeys(prompt, PROMPT_KEYS, `${where}.prompt`, result);
      let promptOk = true;
      for (const field of PROMPT_KEYS) {
        if (!isNonEmptyString(prompt[field])) {
          fail(result, `${where}.prompt.${field} 不能为空（提示词就是这个 action 的全部业务逻辑，空着模型不知道要干什么）`);
          promptOk = false;
        }
      }
      if (promptOk) {
        const template = [prompt.system, prompt.user].join("\n");
        for (const name of collectTemplateVariables(template)) {
          checkTemplateVariable(name, fieldKeys, configProperties, permissions, result, where);
        }
      }
    }

    checkActionOutput(action, index, result);
  });
}

/**
 * 单个变量的可用性（设计 §3.3）：引用了宿主数据就必须有 `fs:project-read`，
 * 引用了不存在的表单字段 / 配置键就是笔误 —— 两者都必须在本地报出来，
 * 因为运行时未知变量会被替换成**空串**（`interpolate.ts` 明确不抛错），
 * 提示词于是悄悄少了一整段，作者只会觉得"模型今天不太行"。
 */
function checkTemplateVariable(name, fieldKeys, configProperties, permissions, result, where) {
  if (name.startsWith("config.")) {
    const key = name.slice("config.".length);
    if (configProperties === undefined) {
      fail(result, `${where}.prompt 引用了 {{${name}}}，但清单没有 configSchema.properties`);
    } else if (!Object.prototype.hasOwnProperty.call(configProperties, key)) {
      fail(result, `${where}.prompt 引用了 {{${name}}}，但 configSchema.properties 里没有 "${key}"`);
    }
    return;
  }
  if (name === "selection" || name.startsWith("project.") || name.startsWith("chapter.")) {
    if (!permissions.includes("fs:project-read")) {
      fail(
        result,
        `${where}.prompt 引用了 {{${name}}}，但 permissions 没有 fs:project-read（引用了项目/章节/选区数据的 action 必须声明该权限）`,
      );
    }
    return;
  }
  if (!fieldKeys.has(name)) {
    fail(
      result,
      `${where}.prompt 引用了 {{${name}}}，但它既不是本 action 的表单字段，也不是 config.* / project.* / chapter.* / selection`,
    );
  }
}

function configPropertiesOf(manifest) {
  const schema = manifest.configSchema;
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return undefined;
  return schema.properties;
}

function checkActionOutput(action, index, result) {
  const where = `actions[${index}].output`;
  if (action.output === undefined) {
    fail(result, `${where} 必须声明（{mode, targets}）`);
    return;
  }
  if (!isPlainObject(action.output)) {
    fail(result, `${where} 必须是对象`);
    return;
  }
  const output = action.output;
  if (output.mode === undefined) {
    hint(result, `${where}.mode 缺省：宿主按 "text" 处理（不解析模型输出）`);
  } else if (!OUTPUT_MODES.includes(output.mode)) {
    warn(result, `${where}.mode = ${JSON.stringify(output.mode)} 不认识，宿主会降级为 "text"（合法：${OUTPUT_MODES.join(" / ")}）`);
  }
  if (output.presentation !== undefined && !PRESENTATIONS.includes(output.presentation)) {
    warn(result, `${where}.presentation = ${JSON.stringify(output.presentation)} 不认识（合法：${PRESENTATIONS.join(" / ")}）`);
  }
  if (output.targets === undefined) {
    warn(result, `${where}.targets 没有声明：生成结果既不能写入也不能插入/复制，用户只能自己手动复制`);
    return;
  }
  if (!Array.isArray(output.targets)) {
    fail(result, `${where}.targets 必须是数组`);
    return;
  }
  if (output.targets.length === 0) {
    warn(result, `${where}.targets 是空数组：生成结果没有可用的落地按钮`);
  }
  output.targets.forEach((target, targetIndex) => {
    // run-action 只允许出现在内容包条目上：action 的输出目标是「写点什么」，
    // 让它能再触发 action 会在同一份白名单里开出一条链式调用的旁路。
    checkTarget(target, `${where}.targets[${targetIndex}]`, OUTPUT_TARGET_KINDS, result, undefined);
  });
}

function checkTarget(target, where, allowedKinds, result, actionIds) {
  if (!isPlainObject(target)) {
    fail(result, `${where} 必须是对象（{kind, label}）`);
    return;
  }
  const kind = target.kind;
  if (typeof kind !== "string" || !allowedKinds.includes(kind)) {
    // 宿主侧对未知 kind 是「console.warn 后静默丢弃」：作者会以为按钮生效了。
    // 校验器把它升级成 error —— 这是 SDK 相对宿主刻意收紧的一条。
    fail(
      result,
      `${where}.kind = ${JSON.stringify(kind)} 不存在（合法：${allowedKinds.join(" / ")}）—— 宿主会静默丢弃这个按钮，作者看不出来`,
    );
    return;
  }
  if (target.label !== undefined && typeof target.label !== "string") {
    fail(result, `${where}.label 必须是字符串`);
  }
  if (kind === "project-field") {
    if (!isNonEmptyString(target.field)) {
      fail(result, `${where} 的 kind 是 project-field，必须给 field（写入哪个项目字段）`);
    } else if (!WRITABLE_PROJECT_FIELDS.includes(target.field)) {
      warn(
        result,
        `${where}.field = "${target.field}" 目前没有写通道：宿主当前只能写 ${WRITABLE_PROJECT_FIELDS.join(" / ")}，这个按钮到运行时会禁用`,
      );
    }
  }
  if (kind === "run-action") {
    if (!isNonEmptyString(target.actionId)) {
      fail(result, `${where} 的 kind 是 run-action，必须给 actionId（指向本插件内的另一个 action）`);
    } else if (actionIds && !actionIds.has(target.actionId)) {
      fail(
        result,
        `${where}.actionId = "${target.actionId}" 不在本插件的 actions 里：禁止跨插件 run-action（卸载一个就会让另一个静默失效）`,
      );
    }
  }
  if (kind === "chapter-note") {
    hint(result, `${where} 的 kind 是 chapter-note：宿主还没有章节备注的存储，这个按钮当前恒不可用`);
  }
}

function checkHooks(hooks, tools, result) {
  const toolNames = new Set(
    tools.filter((tool) => isPlainObject(tool) && typeof tool.name === "string").map((tool) => tool.name),
  );
  const seen = [];
  hooks.forEach((hook, index) => {
    const where = `contributes.hooks[${index}]`;
    if (!isPlainObject(hook)) {
      fail(result, `${where} 必须是对象`);
      return;
    }
    checkKeys(hook, HOOK_KEYS, where, result);

    if (!HOOK_EVENT_NAMES.includes(hook.on)) {
      fail(
        result,
        `${where}.on = ${JSON.stringify(hook.on)} 不是合法事件（合法：${HOOK_EVENT_NAMES.join(" / ")}）—— 写错一个字母就是「装得上、永远不触发」`,
      );
    }
    const impl = hook.impl;
    if (impl !== "prompt" && impl !== "process") {
      fail(result, `${where}.impl = ${JSON.stringify(impl)} 不合法（prompt = 宿主用模板再调一次模型；process = 调插件自己的工具）`);
    } else if (impl === "prompt") {
      if (!isNonEmptyString(hook.template)) {
        fail(result, `${where} 的 impl 是 prompt，必须提供非空 template（否则模型收到的是一句空提示）`);
      } else {
        for (const name of collectTemplateVariables(hook.template)) {
          if (name.startsWith("config.")) continue; // 钩子的 config 由宿主注入，键名不做静态校验
          if (name === "text" || name.startsWith("project.") || name.startsWith("chapter.") || name === "selection") continue;
          hint(result, `${where}.template 里的 {{${name}}} 不是钩子上下文的标准变量（{{text}} / {{config.*}} / {{project.*}} / {{chapter.*}} / {{selection}}）`);
        }
      }
    } else if (!isNonEmptyString(hook.tool)) {
      fail(result, `${where} 的 impl 是 process，必须提供非空 tool（宿主该去调哪个工具？）`);
    } else if (toolNames.size > 0 && !toolNames.has(hook.tool)) {
      warn(result, `${where}.tool = "${hook.tool}" 不在 contributes.tools 里：宿主只认运行期 tools/list 报过的工具，确认它在 tools/list 里`);
    }

    if (hook.timeoutMs !== undefined) {
      if (!Number.isInteger(hook.timeoutMs) || hook.timeoutMs <= 0 || hook.timeoutMs > MAX_HOOK_TIMEOUT_MS) {
        fail(result, `${where}.timeoutMs = ${JSON.stringify(hook.timeoutMs)} 超出范围（1..${MAX_HOOK_TIMEOUT_MS}）`);
      }
    }
    if (hook.gate !== undefined && typeof hook.gate !== "boolean") {
      fail(result, `${where}.gate 必须是布尔值`);
    }

    const priority = hook.priority === undefined ? 0 : hook.priority;
    if (hook.priority !== undefined && !Number.isInteger(hook.priority)) {
      fail(result, `${where}.priority 必须是整数（小的先跑）`);
    } else if (seen.some((item) => item.on === hook.on && item.priority === priority)) {
      fail(
        result,
        `${where} 与前面的钩子同事件同 priority（${hook.on} / ${priority}）：两者之间没有确定顺序，而钩子会改提示词/正文 —— 顺序不同结果不同，请给其中一个改 priority`,
      );
    }
    seen.push({ on: hook.on, priority });
  });
}

function checkSlots(manifest, result) {
  const slots = readStringArray(manifest.slots, "slots", result);
  for (const slot of slots) {
    if (!SLOT_IDS.includes(slot)) {
      fail(result, `slots 里的 ${JSON.stringify(slot)} 不存在（合法：${SLOT_IDS.join(" / ")}）`);
    }
  }
  if (manifest.requiresSlot === undefined) return;
  if (!isPlainObject(manifest.requiresSlot)) {
    fail(result, "requiresSlot 必须是对象（{\"chapter-toolbar\": 1}）");
    return;
  }
  for (const [slot, version] of Object.entries(manifest.requiresSlot)) {
    if (!SLOT_IDS.includes(slot)) {
      fail(result, `requiresSlot 里的 ${JSON.stringify(slot)} 不存在（合法：${SLOT_IDS.join(" / ")}）`);
      continue;
    }
    const current = SLOT_API_VERSIONS[slot];
    if (!Number.isInteger(version) || version < 1) {
      fail(result, `requiresSlot.${slot} 必须是 ≥1 的整数（当前宿主支持 ${current}）`);
    } else if (version > current) {
      fail(result, `requiresSlot.${slot} 需要插槽 API 版本 ${version}，宿主当前支持 ${current}`);
    }
  }
}

function checkConfigSchema(manifest, result) {
  const schema = manifest.configSchema;
  if (schema === undefined) return;
  if (!isPlainObject(schema)) {
    fail(result, "configSchema 必须是对象（JSON Schema 子集）");
    return;
  }
  if (schema.type !== undefined && schema.type !== "object") {
    warn(result, `configSchema.type = ${JSON.stringify(schema.type)}：宿主按对象渲染设置表单，这里应该是 "object"`);
  }
  if (schema.properties !== undefined && !isPlainObject(schema.properties)) {
    fail(result, "configSchema.properties 必须是对象（键名 → 字段 schema）");
  }
  if (schema.additionalProperties !== false) {
    hint(result, "configSchema 没写 \"additionalProperties\": false：用户/宿主多写的键不会被拒");
  }
}

/** `preview` 只用于安装前展示，真源是运行期；两者不一致只记 warning（设计 §8）。 */
function checkPreview(manifest, result, packs) {
  const preview = manifest.preview;
  if (preview === undefined) return;
  if (!isPlainObject(preview)) {
    fail(result, "preview 必须是对象（{\"actions\":[…],\"contentPacks\":[…]}）");
    return;
  }
  const actions = asArray(manifest.contributes?.actions);
  const actionIds = new Set(actions.filter(isPlainObject).map((action) => action.id));
  for (const entry of asArray(preview.actions)) {
    if (!isPlainObject(entry) || typeof entry.id !== "string") continue;
    if (!actionIds.has(entry.id)) {
      warn(result, `preview.actions 里的 "${entry.id}" 不在 contributes.actions 里：安装前会展示一个装完不存在的按钮`);
    }
  }
  const packIds = new Set(packs.filter(isPlainObject).map((pack) => pack.id));
  for (const entry of asArray(preview.contentPacks)) {
    if (!isPlainObject(entry) || typeof entry.id !== "string") continue;
    if (!packIds.has(entry.id)) {
      warn(result, `preview.contentPacks 里的 "${entry.id}" 不在 contributes.contentPacks 里`);
      continue;
    }
    const actual = result.packCounts.get(entry.id);
    if (Number.isInteger(entry.count) && Number.isInteger(actual) && entry.count !== actual) {
      warn(result, `preview.contentPacks 里 "${entry.id}" 写 count = ${entry.count}，实际有 ${actual} 条：描述必须如实`);
    }
  }
  for (const entry of asArray(preview.tools)) {
    if (!isPlainObject(entry) || typeof entry.name !== "string") continue;
    const toolNames = new Set(asArray(manifest.contributes?.tools).filter(isPlainObject).map((tool) => tool.name));
    if (toolNames.size > 0 && !toolNames.has(entry.name)) {
      warn(result, `preview.tools 里的 "${entry.name}" 不在 contributes.tools 里`);
    }
  }
}

// ── CLI ──────────────────────────────────────────────────────────────

const MARK = { pass: "✔", error: "✖", warn: "警告：", info: "提示：" };

export function formatReport(result) {
  const lines = [];
  for (const text of result.passes) lines.push(`${MARK.pass} ${text}`);
  for (const text of result.errors) lines.push(`${MARK.error} ${text}`);
  for (const text of result.warnings) lines.push(`${MARK.warn}${text}`);
  for (const text of result.infos) lines.push(`${MARK.info}${text}`);
  if (result.ok) {
    const tail = [];
    if (result.warnings.length > 0) tail.push(`${result.warnings.length} 条警告`);
    lines.push(`${MARK.pass} 校验通过${tail.length > 0 ? `（${tail.join("，")}，不影响安装）` : ""}`);
  } else {
    lines.push(`${MARK.error} ${result.errors.length} 个错误${result.warnings.length > 0 ? `，${result.warnings.length} 条警告` : ""}：修完再装`);
  }
  return lines.join("\n");
}

export function main(argv) {
  const targets = argv.filter((argument) => !argument.startsWith("-"));
  if (targets.length === 0) {
    process.stderr.write("用法：node sdk/validate.mjs <插件目录> [<插件目录> …]\n");
    return 2;
  }
  let failed = 0;
  targets.forEach((target, index) => {
    if (targets.length > 1) {
      process.stdout.write(`${index === 0 ? "" : "\n"}=== ${target} ===\n`);
    }
    const result = validateDirectory(target);
    process.stdout.write(`${formatReport(result)}\n`);
    if (!result.ok) failed += 1;
  });
  return failed === 0 ? 0 : 1;
}

// 只有被当脚本直接跑时才执行 CLI；被测试 import 时不要跑。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
