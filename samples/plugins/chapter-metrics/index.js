// 章节体检 —— QMAI 工具插件样例（零依赖，只用 Node 内置模块）。
//
// 这个文件是「一个插件给 AI 加一个工具」的最小完整实现，给插件作者当参照。
// 结构对照 src-tauri/tests/fixtures/plugins/fake-provider/index.js：同样是按行读 stdin
// 的 JSON-RPC 服务端；区别是 v1 工具插件不需要 HTTP 那一端，所以要短得多。
//
// 改这个文件前先读 docs/plugins/authoring-guide.md 第 2 节。三条硬契约：
//
// 1) stdout 只写协议帧。宿主的 mcp_bridge 逐行 JSON.parse，混进一句
//    console.log("started") 就会让那一行被当成非 JSON 丢掉 —— 请求永远等不到响应，
//    而且宿主不会报错，只会超时。所以本文件的调试输出一律 process.stderr.write：
//    **stdout 被协议占用，stderr 才是日志**。
//
// 2) 工具级失败用 result.isError=true，而不是 JSON-RPC error。
//    宿主的 RpcMessage::into_tool_call 会把 isError 的 text 拼进错误文案交给模型，
//    模型因此能看到「为什么失败」并自己改正重试；JSON-RPC error 留给「请求本身不合法」。
//
// 3) stdin EOF = 宿主关掉管道（stop_plugin / App 退出）= 让我们退出。
//    不处理的话进程会变成孤儿，用户的任务管理器里会攒一串 node.exe。
//
// 本插件不需要任何权限：不读文件、不联网、不起子进程，只对传进来的字符串做统计。

// 关于模块格式：这个文件**不用 require / import**，只用 process 与 Buffer 这些全局对象。
// 原因是一个很容易踩的坑：Node 按最近的 package.json 决定 .js 是 CJS 还是 ESM。
// 插件装到用户机器上时目录里没有 package.json（我们故意不加），默认是 CJS；
// 但如果作者是在一个 `"type": "module"` 的仓库里直接 `node index.js`，同一份文件
// 会被当成 ESM，一句 require 就抛 ReferenceError。不用模块系统 = 两种环境都能跑。

"use strict";

// ── 统计口径 ───────────────────────────────────────────
//
// 字数 = 汉字数 + 英文词数，分开报：写手的「字数」习惯是汉字按字、英文按词，
// 合成一个数会让人不知道 10000 字里到底掺了多少英文。
// 标点不计入字数（句号、引号都不算）；阿拉伯数字按一个英文词计。

/** 超过这个大小就拒绝：一行 JSON 再跑一遍正则，200KB 已经够让一次调用明显变慢。 */
const MAX_TEXT_BYTES = 200 * 1024;

/** 汉字：按 Unicode 的 Han 脚本计（含扩展区），比手写区间稳。 */
const HAN_RE = /\p{Script=Han}/gu;

/**
 * 英文词：口径与需求一致，用 `\b\w+\b`。\w 在没有 u 标志时只含 ASCII 的
 * 字母/数字/下划线，所以汉字天然是词边界，不会把中文算成英文词。
 * 已知边界：don't 会被拆成 don + t 两词（撇号不是 \w），缩写多的文本会略偏高。
 */
const WORD_RE = /\b\w+\b/g;

/**
 * 断句：按句末标点（。！？!?…）断，并顺手吞掉紧跟的收引号，
 * 这样 “走吧。” 不会把右引号甩到下一句去，显示成 `”她没动。`。
 *
 * 末尾没有标点的残段也算一句（否则最后一段会凭空消失）；英文句号 `.` 故意不算，
 * 否则「3.5 年」「Mr. Smith」都会被切断。
 */
const SENTENCE_RE = /[^。！？!?…]+(?:[。！？!?…]+[”’"』」]?)?/g;

/** 对话：中文弯引号 “” 与英文直双引号 ""。单引号不算 —— 中文里它更多是强调/书名。 */
const DIALOGUE_PATTERNS = [/“([^”]*)”/g, /"([^"]*)"/g];

/**
 * 去掉 Markdown 标记，保留汉字标点（标点要留着，否则断句和引号识别都会坏掉）。
 *
 * 只删「标记字符」不删内容：`**重点**` → `重点`，列表项保留文字，代码块里的
 * 正文也仍然算字数（作者可能真把诗或信贴在代码块里）。
 */
function stripMarkdown(raw) {
  let text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  // 围栏代码块只去掉 ``` 那一行标记，块里的字留着。
  text = text.replace(/^[ \t]*```.*$/gm, "");

  // 图片 ![alt](url) → alt；链接 [text](url) → text。
  // 必须在删其它标记之前做：否则 url 里的英文会被 \b\w+\b 当成正文词数。
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // 分隔线（--- / *** / ___ 整行）先去掉：留着会被并进下一句，显示成「------他说。」。
  text = text
    .replace(/^[ \t]*(?:-[ \t]*){3,}$/gm, "")
    .replace(/^[ \t]*(?:\*[ \t]*){3,}$/gm, "")
    .replace(/^[ \t]*(?:_[ \t]*){3,}$/gm, "");

  // 行首标记：标题 #、引用 >、无序列表 - * +、有序列表 1. / 1)。
  text = text
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "");

  // 行内强调/代码/删除线的标记本身去掉，内容保留。注意两点：
  // - 不能动汉字标点（断句与引号识别都依赖它）；
  // - 下划线 `_` 故意不删：它常是英文单词的一部分（\w 含下划线），删了会改变词数。
  text = text.replace(/[*`~]/g, "");

  return text;
}

/** 按同一个口径数字数：汉字按字，英文按词。 */
function measure(text) {
  const han = (text.match(HAN_RE) || []).length;
  const en = (text.match(WORD_RE) || []).length;
  return { han, en, total: han + en };
}

/** 取出所有引号内的文字（两套引号分别匹配后再拼起来统计）。 */
function dialogueOnly(text) {
  const parts = [];
  let rest = text;
  for (const pattern of DIALOGUE_PATTERNS) {
    // 带 g 的正则有 lastIndex 状态：每次用新对象，避免上一次调用的残留影响结果。
    const re = new RegExp(pattern.source, pattern.flags);
    // 先把这一套引号整段挖掉（换成等长空格），再匹配下一套。
    // 否则 `“他说"好"。”` 里的英文引号会被两套规则各数一次，对话字数翻倍。
    rest = rest.replace(re, (whole, inner) => {
      parts.push(inner);
      return " ".repeat(whole.length);
    });
  }
  return parts.join("\n");
}

/** 千分位：1,842。不用 toLocaleString —— 它跟随系统区域，输出会抖。 */
function formatInt(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 按「字」截断（用 Array.from 按码点切，避免把 emoji 的代理对劈成半个）。 */
function truncate(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

/** 显示用的单行化：句子里的换行/多余空白在报告里会撑乱格式。 */
function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 生成给模型读的纯文本报告（不是 JSON：模型读带小标题的纯文本更稳，也更省 token）。
 */
function analyze(rawText) {
  const text = stripMarkdown(rawText);
  const totals = measure(text);

  // 空文本（或只有标点/Markdown 标记）：给可读提示，绝不拿 0 去做分母。
  if (totals.total === 0) {
    return [
      "## 章节体检",
      "",
      "这段文本里没有可统计的字数（空文本，或只有标点 / Markdown 标记）。",
      "",
      "把章节正文整段传进来再试一次；本工具只接收文本，不接收文件路径。",
    ].join("\n");
  }

  const dialogue = measure(dialogueOnly(text));
  const dialoguePercent = ((dialogue.total / totals.total) * 100).toFixed(1);

  // 先断句再测每句字数；纯标点碎片（size 为 0）不算一句，否则平均句长会被 0 拉低。
  const sentences = (text.match(SENTENCE_RE) || [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .map((sentence) => ({ text: sentence, size: measure(sentence).total }))
    .filter((sentence) => sentence.size > 0);

  const lines = ["## 章节体检", ""];
  lines.push(
    `- 总字数：${formatInt(totals.total)}（中文 ${formatInt(totals.han)} 字 / 英文 ${formatInt(totals.en)} 词）`,
  );
  lines.push(
    `- 对话占比：${dialoguePercent}%（${formatInt(dialogue.total)} 字在引号内）`,
  );

  if (sentences.length === 0) {
    // 兜底分支（正常文本走不到这里）：没有句子时如实说不可用，不要伪造一个 0 平均句长。
    lines.push("- 句数：0（这段文本里切不出句子，句长统计不可用）");
  } else {
    const totalSize = sentences.reduce((sum, sentence) => sum + sentence.size, 0);
    const average = totalSize / sentences.length;
    const longest = sentences.reduce((a, b) => (b.size > a.size ? b : a));
    const short = sentences.filter((sentence) => sentence.size <= 10).length;
    const shortPercent = ((short / sentences.length) * 100).toFixed(1);

    lines.push(`- 句数：${sentences.length}，平均句长 ${average.toFixed(1)} 字`);
    lines.push(
      `- 短句占比（≤10 字）：${shortPercent}%（${short}/${sentences.length} 句）`,
    );
    lines.push(
      `- 最长句（截断）：「${truncate(oneLine(longest.text), 40)}」（${longest.size} 字）`,
    );
  }

  // 重复句：归一只去空白（不去标点 —— 「他说。」和「他说？」不该算同一句）。
  const counts = new Map();
  for (const sentence of sentences) {
    if (sentence.size < 2) continue; // 一两个字的碎片（如「是。」）重复意义不大，还容易刷屏
    const key = oneLine(sentence.text).replace(/\s+/g, "");
    const hit = counts.get(key);
    if (hit) hit.count += 1;
    else counts.set(key, { count: 1, sample: sentence.text });
  }
  const repeated = [...counts.values()]
    .filter((item) => item.count >= 2)
    // Array.prototype.sort 在 V8 里是稳定排序：次数相同时保持「首次出现」的顺序。
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  lines.push("", "### 重复句（出现 ≥2 次，前 5）");
  if (repeated.length === 0) {
    lines.push("", "未发现出现 2 次及以上的句子。");
  } else {
    repeated.forEach((item, index) => {
      lines.push(
        `${index + 1}. ×${item.count} 「${truncate(oneLine(item.sample), 40)}」`,
      );
    });
  }

  // 口径写进结果里：模型转述给作者时不会把「英文词」说成「英文单词字数」。
  lines.push(
    "",
    '> 口径：字数 = 汉字数 + 英文词数（标点不计）；对话只算 “” 与 "" 内的内容；句长用同一字数口径。',
  );

  return lines.join("\n");
}

// ── MCP stdio：stdin 一行一条 JSON-RPC ──────────────────
//
// 不用 readline：见文件开头「关于模块格式」。自己按 \n 切行即可，协议就是这么简单
// （NDJSON）。setEncoding 会处理跨 chunk 的半个 UTF-8 字符，不会把汉字劈坏。
//
// 下面的工具声明必须与 plugin.json 的 contributes.tools 一致。注意真正的真源是
// **运行期的 tools/list**（宿主以它为准，清单那份只用于安装前预览/管理页展示），
// 两份写岔了，用户会看到「装了但工具参数不对」，所以改一处就要同步另一处。

const TOOL = {
  name: "analyze_chapter_text",
  description:
    "分析一段章节正文：字数、对话占比、句长分布、重复句。传整段文本进来，不要传文件路径。",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "章节正文全文（Markdown 也可以，会去掉标记）",
      },
    },
    required: ["text"],
  },
};

/** 唯一的 stdout 写入口：一帧一行，绝不多打别的东西。 */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * 工具级失败：JSON-RPC 成功 + result.isError=true。
 * 宿主的 into_tool_call 会识别 isError 并把 text 作为错误文案交给模型，
 * 模型因此能自己纠正（比如补上参数、拆短文本）。
 */
function toolError(id, message) {
  reply(id, { content: [{ type: "text", text: message }], isError: true });
}

function handleToolCall(req) {
  const params = req.params || {};

  // 调用不存在/未声明的工具属于「请求不合法」，用 JSON-RPC error；
  // 宿主只会调用 tools/list 报过的工具，走到这里说明调用方写错了工具名。
  if (params.name !== TOOL.name) {
    replyError(
      req.id,
      -32602,
      `未知工具：${String(params.name)}（本插件只提供 ${TOOL.name}）`,
    );
    return;
  }

  const args = params.arguments || {};
  const text = args.text;
  if (typeof text !== "string") {
    const received =
      text === undefined ? "缺失" : Array.isArray(text) ? "数组" : typeof text;
    // 用 isError 而不是 JSON-RPC error：这句文案要送到模型眼前，它才知道该怎么补参数。
    toolError(
      req.id,
      `text 参数缺失或类型不对（收到：${received}）：请把章节正文作为字符串放进 text。本工具只接收文本，不接收文件路径。`,
    );
    return;
  }

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_TEXT_BYTES) {
    // 明确拒绝并给出可执行的下一步，而不是默默截断（截断后统计数字会错得没有提示）。
    toolError(
      req.id,
      `文本太大：${bytes} 字节，超过 ${MAX_TEXT_BYTES} 字节上限（约 6.8 万汉字）。请只传单章正文，或拆成几段分次调用。`,
    );
    return;
  }

  try {
    reply(req.id, { content: [{ type: "text", text: analyze(text) }] });
  } catch (error) {
    // 统计抛异常时仍要回可读的 isError：进程崩了宿主只会报「调用超时」，更难查。
    process.stderr.write(
      `[chapter-metrics] 统计失败：${error && error.stack ? error.stack : error}\n`,
    );
    toolError(
      req.id,
      `统计失败（插件内部错误）：${error && error.message ? error.message : String(error)}`,
    );
  }
}

/** 处理一行（已去掉行尾 \n）。所有回复都从这里出去。 */
function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    // 和宿主对称：非 JSON 行直接忽略，绝不能让整个进程崩掉。
    process.stderr.write("[chapter-metrics] 忽略一行非 JSON 输入\n");
    return;
  }
  // JSON 合法但不是对象（null / 数字 / 数组）：同样忽略，读 req.id 会直接抛异常。
  if (!req || typeof req !== "object") return;

  // 通知（没有 id）不回复：回了会成为宿主眼里的噪声。
  if (req.id === undefined || req.id === null) return;

  switch (req.method) {
    case "initialize":
      // 注意：不要打印 req.params —— initialize 的 params._qmai.hostToken 是宿主能力面凭据，
      // 落进日志等于把凭据交给日志读者。这也是「stdout 只写协议帧」之外的第二条安全习惯。
      reply(req.id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "chapter-metrics", version: "1.0.0" },
        capabilities: { tools: {} },
      });
      break;
    case "tools/list":
      // 只报一个工具；宿主会把它注册进 ToolRegistry 并加 `<pluginId>__` 前缀。
      reply(req.id, { tools: [TOOL] });
      break;
    case "tools/call":
      handleToolCall(req);
      break;
    default:
      // 未知方法必须回错误，不能静默不回 —— 静默会让宿主一直等到超时。
      replyError(req.id, -32601, `未知方法：${req.method}`);
      break;
  }
}

// 自己攒行：数据可能半个 JSON 就到了（一个 chunk 里也可能有好几帧）。
// setEncoding("utf8") 让 Node 用 StringDecoder 处理跨 chunk 的多字节字符，
// 否则一个汉字被切成两半时会拼出乱码，字数统计跟着错。
let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  let newline = pending.indexOf("\n");
  while (newline >= 0) {
    handleLine(pending.slice(0, newline));
    pending = pending.slice(newline + 1);
    newline = pending.indexOf("\n");
  }
});

// stdin EOF = 宿主关管道（stop_plugin / App 退出）= 让我们退出。
// 退出前把最后一行（可能没有换行符）处理掉，免得丢掉宿主关管道前发的最后一帧。
process.stdin.on("end", () => {
  if (pending.trim()) handleLine(pending);
  process.exit(0);
});
