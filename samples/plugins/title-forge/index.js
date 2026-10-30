/**
 * 「书名生成」插件
 *
 * 干什么：读取用户书架上的书（书名 / 简介 / 章节数 / 少量正文采样），
 * 按三种网文风格生成书名候选，交给宿主弹窗让用户挑。
 *
 * ── 为什么需要 `fs:shelf-read` 权限 ──────────────────────────
 * 书名是"从多部作品的题材、气质、金手指里提炼出来的"，只看当前这一本
 * 生成不出跨书的味道。但插件进程默认看不见书架，所以要声明这个权限，
 * 由用户在启用时明确同意。
 *
 * 宿主只给**概要**（见 `shelf.rs` 的 MAX_* 上限）：书名 + 简介 + 章节数 +
 * 每本最多一两千字的采样。插件拿不到全书，这是有意的边界。
 *
 * ── 为什么用工具而不是声明式 action ──────────────────────────
 * 声明式 action 的上下文只有"当前项目"，读不到书架。所以这里走 Tier 2：
 * 用 MCP 工具去问宿主（`/host/shelf/*`），把结果整理成提示词素材。
 * 真正的「弹窗让用户挑」由宿主的声明式 action 负责 —— 分工是：
 * 工具负责"取数据 + 拼风格指令"，action 负责"表单 + 模型 + 弹窗"。
 */
import { definePlugin } from "./qmai-plugin.mjs";

const HOST_URL = (process.env.QMAI_HOST_URL || "").replace(/\/+$/, "");
const HOST_TOKEN = process.env.QMAI_HOST_TOKEN || "";

/**
 * 三种书名风格。
 *
 * 风格写成数据而不是散落在提示词里，是为了让 `list_styles` 工具能把它们
 * 原样报给模型、也能被用户在表单里选 —— 三处永远一致。
 */
const STYLES = {
  "literary": {
    id: "literary",
    name: "四字格 · 玄奇",
    example: "《诸神鱼戏》",
    brief: "四到六字，意象奇诡，有画面但不点破",
    instruction: [
      "字数 4–6 字，不允许出现标点。",
      "用动宾或主谓结构，让意象自己说话（如「诸神鱼戏」「镜中取火」）。",
      "优先取：神魔、星斗、鱼龙、镜花、山海、浮屠 这类古典而奇诡的意象。",
      "严禁使用：系统、开局、重生、签到、无敌、最强、巅峰、满级 等网文直白词。",
      "读起来要像一本书的名字，而不是一句广告语。",
    ].join("\n"),
  },
  "xuanhuan": {
    id: "xuanhuan",
    name: "玄幻爽文长标题",
    example: "《中午横推诸天》《从满级悟性开始》《洪荒阐教首徒》",
    brief: "七到十二字，把主角的优势或出身直接写进标题",
    instruction: [
      "字数 7–12 字，可以不含标点。",
      "必须让读者一眼看出**爽点**：主角的金手指、身份、起点或目标。",
      "常用结构：「从X开始」「开局X」「成为X」「X之X」「我在X当X」。",
      "把具体的修炼体系/世界观名词写进去（如悟性、灵根、阐教、诸天、洪荒）。",
      "语气要笃定、有压迫感，不要文艺化。",
    ].join("\n"),
  },
  "fanqie": {
    id: "fanqie",
    name: "番茄式 · 事件反转长标题",
    example: "《开局跳楼，沙瑞金被撤，空降汉东》",
    brief: "十二到二十二字，逗号分句，前半句极端情境、后半句抛身份或反转",
    instruction: [
      "字数 12–22 字，**必须用逗号分句**（2–3 个短句）。",
      "第一句制造极端或荒诞的情境（开局跳楼 / 当众撕了 / 刚进门就）。",
      "后续短句抛身份、职位、反转或结果，形成强烈落差。",
      "用具体的人名、职位、机构名制造真实感（如「汉东」「长公主」「市委」）。",
      "节奏要短促，像短视频标题；不要解释、不要铺垫。",
    ].join("\n"),
  },
};

/** 向宿主发请求。宿主接口都要求 Bearer token。 */
async function hostFetch(path, body) {
  if (!HOST_URL) {
    throw new Error("宿主地址缺失（QMAI_HOST_URL 未注入），插件无法访问书架");
  }
  const response = await fetch(`${HOST_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${HOST_TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // 把状态码带出来：403 是"没授权"，插件要能区分它和"书架是空的"。
    throw new Error(`宿主接口 ${path} 返回 ${response.status}：${text.slice(0, 200)}`);
  }
  return response.json();
}

/** 裁到 n 个字符（中文按字算，不能按字节）。 */
function clip(text, n) {
  const value = typeof text === "string" ? text.trim() : "";
  if (value.length <= n) return value;
  return `${value.slice(0, n)}…`;
}

/**
 * 取当前打开的书（书名）。读不到就返回空串。
 *
 * 走 `/host/project/info`（需要 `fs:project-read`）：它永不失败，读不到字段就降级为空，
 * 所以这里不做异常分支 —— 拿不到书名本身不是错误，只是退回"让用户自己填"。
 */
async function getCurrentBook() {
  try {
    const info = await hostFetch("/host/project/info");
    return typeof info.bookTitle === "string" ? info.bookTitle.trim() : "";
  } catch {
    return "";
  }
}

/**
 * 决定「分析哪些书」。
 *
 * 三种范围（设计约定，写在这里是为了让调用方和作者都看得见）：
 *   1. 留空      → **只分析当前打开的书**。这是默认，也是最符合直觉的一条：
 *                  用户在写《黑雨之下》，起名当然该基于《黑雨之下》，
 *                  而不是把书架上另外三本也一起喂给模型。
 *   2. 填书名    → 只分析这几本（逗号分隔）。
 *   3. 填「全部」→ 分析书架上的全部书。用于"我想要跨作品的调性"这种情形。
 *
 * 为什么默认不是「全部」：早先就是这么实现的，结果用户点生成，输出里混进了
 * 他根本没在写的书 —— 界面上看不出任何提示，属于"安静地做错事"。
 */
function resolveScope(args) {
  const raw = typeof args.onlyBooks === "string" ? args.onlyBooks.trim() : "";
  const explicitIds = Array.isArray(args.ids)
    ? args.ids.filter((id) => typeof id === "string" && id.trim())
    : [];

  if (explicitIds.length > 0) {
    return { kind: "ids", ids: explicitIds, names: [], needsResolve: false, label: `${explicitIds.length} 本（指定 id）` };
  }

  if (!raw) {
    return {
      kind: "current",
      ids: [],
      names: [],
      needsResolve: false,
      currentTitle: args.currentTitle ?? "",
      label: "当前打开的书",
    };
  }

  if (raw === "全部" || raw === "*" || raw === "all") {
    return { kind: "all", ids: [], names: [], needsResolve: false, label: "书架全部" };
  }

  const names = raw
    .split(/[,，、\s]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  return { kind: "names", ids: [], names, needsResolve: true, label: names.join("、") };
}
definePlugin({
  info: {
    id: "title-forge",
    name: "书名生成",
    version: "0.1.0",
  },

  tools: {
    /**
     * 列出书架上可分析的书。
     *
     * 为什么单独一个工具：用户在表单里要先勾选"分析哪几本"，
     * 而表单需要数据。让模型先调这个工具拿到清单，再拼提示词。
     */
    list_shelf_books: {
      description:
        "列出用户书架上的书（书名、简介、章节数）。用于书名生成前让用户勾选要参考哪几本。",
      inputSchema: {
        type: "object",
        properties: {
          maxBooks: {
            type: "integer",
            description: "最多返回几本（宿主上限 30）",
            minimum: 1,
            maximum: 30,
          },
        },
        additionalProperties: false,
      },
      handler: async (args, ctx) => {
        const payload = await hostFetch("/host/shelf/list");
        const books = Array.isArray(payload.books) ? payload.books : [];
        const limit = Number.isInteger(args.maxBooks) ? args.maxBooks : books.length;
        const picked = books.slice(0, limit);

        ctx.log(`书架返回 ${books.length} 本，取 ${picked.length} 本`);

        if (picked.length === 0) {
          return "书架上是空的。可以先建一本，或直接在「小说内容摘录」里写下题材与金手指。";
        }

        /*
         * 返回**人能直接读的清单**，而不是 JSON。
         *
         * 因为它会被 prepare 填进表单的「书架上的书」文本框里 —— 那个框是给用户看的，
         * 塞一段 JSON 进去等于让用户去解析转义符。列表形式可以直接照抄书名到
         * 「只分析这几本」里。
         */
        const lines = picked.map((book, index) => {
          const count = book.chapterCount ?? book.chapter_count ?? 0;
          const desc = clip(book.description, 40);
          return `${index + 1}. 《${book.title}》${count ? ` · ${count} 章` : ""}${desc ? ` · ${desc}` : ""}`;
        });
        return `共 ${picked.length} 本：\n${lines.join("\n")}`;
      },
    },

    /**
     * 取若干本书的正文采样，拼成提示词素材。
     *
     * 这是插件的核心：把"跨书的气息"变成模型能读的一段素材。
     * 采样长度由宿主夹住，本工具不做二次放大 —— 上下文是稀缺资源。
     */
    collect_writing_material: {
      description:
        "取指定书籍的简介与正文采样，拼成用于生成书名的素材。调用前应先用 list_shelf_books 拿到 id。",
      inputSchema: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "要分析的书籍 id 列表；留空表示分析全部（受宿主上限约束）",
          },
          maxCharsPerBook: {
            type: "integer",
            description: "每本最多取多少字正文（宿主上限 1200）",
            minimum: 100,
            maximum: 1200,
          },
          onlyBooks: {
            type: "string",
            description: "只看这几本：书名用逗号分隔。留空表示全部。",
          },
        },
        additionalProperties: false,
      },
      handler: async (args, ctx) => {
        /*
         * 选书有两条路：
         *   · `ids`：id 列表（宿主表单能直接给 id 时用）；
         *   · `onlyBooks`：书名文本，逗号分隔。这条是给"用户手填书名"准备的 ——
         *     宿主的动态选项在部分环境里取不到，手填是唯一总是可用的办法。
         * 两者都空 = 分析全部（受宿主上限约束）。
         */
        const perBook = Number.isInteger(args.maxCharsPerBook) ? args.maxCharsPerBook : 800;
        // 打开期间切了书，缓存反而会给出过期的书名。
        const currentTitle = await getCurrentBook();
        const scope = resolveScope({ ...args, currentTitle });
        ctx.log(`分析范围：${scope.label}`);

        let ids = scope.ids;
        if (scope.needsResolve) {
          // 按书名筛选：先拿书架清单把书名翻译成 id（宿主只认 id）。
          const shelf = await hostFetch("/host/shelf/list");
          const all = Array.isArray(shelf.books) ? shelf.books : [];
          ids = all
            .filter((book) => scope.names.some((name) => String(book.title ?? "").includes(name)))
            .map((book) => book.id);
          if (ids.length === 0) {
            return JSON.stringify({
              status: "empty",
              material: "",
              message: `没有找到匹配的书：${scope.names.join("、")}。书架上有：${all
                .map((book) => book.title)
                .join("、")}`,
            });
          }
        }

        if (scope.kind === "current") {
          /*
           * 只分析当前打开的书。
           *
           * 先按书名在书架上找 id（宿主只认 id）。找不到有两种可能：这本书还没进
           * 书架索引，或当前没打开任何项目。两种都**不**退回"全部书" —— 那正是
           * 这次要修掉的错误行为（用户在写 A，输出里混进了 B、C、D）。
           */
          const shelf = await hostFetch("/host/shelf/list");
          const all = Array.isArray(shelf.books) ? shelf.books : [];
          const hit = all.find((book) => String(book.title ?? "") === currentTitle);
          if (hit) {
            ids = [hit.id];
          } else {
            return JSON.stringify({
              status: "empty",
              material: "",
              message: currentTitle
                ? `没能在书架上找到当前这本书（《${currentTitle}》）。如果它刚新建，可以在「只分析这几本」里填书名，或填「全部」。`
                : "现在没有打开任何一本书。请先打开一本，或在「只分析这几本」里填书名，或填「全部」。",
            });
          }
        }

        const payload = await hostFetch("/host/shelf/sample", { ids, maxCharsPerBook: perBook });
        const books = Array.isArray(payload.books) ? payload.books : [];
        if (books.length === 0) {
          return JSON.stringify({
            status: "empty",
            material: "",
            message: "没有取到任何书籍内容。请确认已勾选书籍，且书架上有书。",
          });
        }

        // 拼素材时给每本书一个小标题，让模型能分清"这是哪一本"。
        const material = books
          .map((book, index) => {
            const parts = [`【第 ${index + 1} 本】《${book.title}》`];
            if (book.description) parts.push(`简介：${book.description}`);
            if (book.chapterCount) parts.push(`章节数：${book.chapterCount}`);
            if (book.sample) parts.push(`正文片段：\n${book.sample}`);
            return parts.join("\n");
          })
          .join("\n\n---\n\n");

        ctx.log(`素材：${books.length} 本，正文采样共 ${payload.totalSampleChars ?? 0} 字`);

        return JSON.stringify({
          status: "ok",
          bookCount: books.length,
          totalSampleChars: payload.totalSampleChars ?? 0,
          material,
        });
      },
    },

    /** 把三种风格的写作要求交给模型 —— 集中一处，避免提示词里再抄一遍。 */
    list_name_styles: {
      description: "列出三种可用的书名风格及其写作要求。生成书名前先调用它，按返回的 instruction 约束输出。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        return JSON.stringify({
          status: "ok",
          styles: Object.values(STYLES).map((style) => ({
            id: style.id,
            name: style.name,
            example: style.example,
            brief: style.brief,
            instruction: style.instruction,
          })),
        });
      },
    },
  },
});
