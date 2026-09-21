#!/usr/bin/env node
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ACP_ALIASES = {
  auto: "default",
  "composer-2": "composer-2.5",
};
const EFFORTS = [
  "extra-high",
  "xhigh",
  "minimal",
  "medium",
  "high",
  "none",
  "low",
  "max",
];

function bakedAgent() {
  try {
    return JSON.parse(String.raw`__QMAI_BAKED_AGENT__`);
  } catch {
    return "";
  }
}

function normalizeEffort(raw) {
  const value = String(raw).trim().toLowerCase();
  if (value === "extra-high" || value === "max") return "xhigh";
  return value;
}

function toCursorAcpModelId(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed === "default") return "default";
  const parameterized = trimmed.includes("[")
    ? trimmed.replace(/\[.*$/, "").trim()
    : trimmed;
  let id = parameterized;
  if (id.toLowerCase().startsWith("cursor-")) id = id.slice("cursor-".length);
  if (/-fast$/i.test(id)) id = id.replace(/-fast$/i, "");
  for (const effort of EFFORTS) {
    const re = new RegExp(`[-_]${effort}$`, "i");
    if (re.test(id)) {
      id = id.replace(re, "");
      break;
    }
  }
  id = id.replace(/[-_]thinking$/i, "");
  return ACP_ALIASES[id.toLowerCase()] ?? ACP_ALIASES[trimmed.toLowerCase()] ?? id;
}

function inferFast(model) {
  if (/(?:^|[\[,])\s*fast\s*=\s*true(?:[,\]]|$)/i.test(model)) return true;
  if (/(?:^|[\[,])\s*fast\s*=\s*false(?:[,\]]|$)/i.test(model)) return false;
  return /-fast$/i.test(model.replace(/\[.*$/, ""));
}

function inferEffort(model) {
  const param = /(?:^|[\[,])\s*effort\s*=\s*([^,\]]+)/i.exec(model);
  if (param) return normalizeEffort(param[1]);
  const id = model.replace(/\[.*$/, "").replace(/-fast$/i, "");
  for (const effort of EFFORTS) {
    if (new RegExp(`[-_]${effort}$`, "i").test(id)) return normalizeEffort(effort);
  }
  return "";
}

function toCursorAcpModelValue(base, fast, effort) {
  const params = [];
  if (effort) params.push(`effort=${effort}`);
  if (fast === true) params.push("fast=true");
  else if (fast === false) params.push("fast=false");
  return params.length === 0 ? base : `${base}[${params.join(",")}]`;
}

function isDefaultModel(model) {
  const trimmed = String(model || "").trim();
  return !trimmed || trimmed === "default" || trimmed === "auto";
}

function asCliModel(model) {
  const trimmed = String(model || "").trim();
  if (isDefaultModel(trimmed) || trimmed.includes("[")) return "";
  return trimmed;
}

function cliModelToAcpValue(model) {
  const trimmed = String(model || "").trim();
  if (isDefaultModel(trimmed)) return "";
  const acp = toCursorAcpModelId(trimmed);
  if (!acp || acp === "default") return "";
  const baseId = trimmed.replace(/\[.*$/, "");
  const hasFastSuffix = /-fast$/i.test(baseId);
  const hasCursorPrefix = baseId.toLowerCase().startsWith("cursor-");
  const effort = inferEffort(trimmed);
  if (trimmed.includes("[")) {
    return toCursorAcpModelValue(acp, inferFast(trimmed), effort || undefined);
  }
  if (!hasFastSuffix && !hasCursorPrefix && !effort) return acp;
  return toCursorAcpModelValue(
    acp,
    hasFastSuffix ? true : hasCursorPrefix ? false : undefined,
    effort || undefined,
  );
}

function resolveAcpArgvModel(argvModel, pinned) {
  const passed = asCliModel(argvModel);
  if (passed) return passed;
  return asCliModel(pinned);
}

function readPinnedModel() {
  const files = [];
  if (process.env.CURSOR_CONFIG_DIR) {
    files.push(path.join(process.env.CURSOR_CONFIG_DIR, "qmai-acp-model"));
  }
  files.push(path.join(__dirname, "qmai-acp-model"));
  for (const file of files) {
    try {
      const pinned = fs.readFileSync(file, "utf8").trim();
      if (pinned && pinned !== "default" && pinned !== "auto") return pinned;
    } catch {
      /* ignore */
    }
  }
  return "";
}

function withModel(args, model) {
  const next = args.slice();
  const i = next.indexOf("--model");
  if (i >= 0) {
    if (i + 1 < next.length) next[i + 1] = model;
    else next.push(model);
    return next;
  }
  const acp = next.indexOf("acp");
  if (acp >= 0) {
    next.splice(acp + 1, 0, "--model", model);
  }
  return next;
}

function rewriteAcpArgs(args, pinned) {
  if (!args.includes("acp")) return args;
  const i = args.indexOf("--model");
  const argvModel = i >= 0 && i + 1 < args.length ? args[i + 1] : "";
  const next = resolveAcpArgvModel(argvModel, pinned);
  return next ? withModel(args, next) : args;
}

function run(argv) {
  const real = process.env.QMAI_CURSOR_AGENT_REAL || bakedAgent();
  if (!real) {
    console.error("QMAI cursor agent wrapper: no real agent path");
    process.exit(1);
  }
  const args = rewriteAcpArgs(argv, readPinnedModel());
  const child = spawn(real, args, { stdio: "inherit" });
  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

if (require.main === module) {
  run(process.argv.slice(2));
}

module.exports = {
  cliModelToAcpValue,
  resolveAcpArgvModel,
  rewriteAcpArgs,
};
