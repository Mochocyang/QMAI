import fs from "node:fs/promises";
import path from "node:path";

const projectPath = process.argv[2];
const shouldDeleteFragments = process.argv.includes("--delete-fragments");

if (!projectPath) {
  console.error("用法：node scripts/rebuild-novel-memory.mjs <小说目录> [--delete-fragments]");
  process.exit(1);
}

const UNSTABLE_TAGS = new Set([
  "chapter",
  "event",
  "secret",
  "foreshadowing",
  "conflict",
  "timeline-point",
  "canon-rule",
]);

const UNCERTAIN_RE = /(可能|也许|似乎|疑似|或许|大概|推测|猜测|尚不确定|未证实)/u;
const SENTENCE_PUNCTUATION_RE = /[，。；：？！“”‘’（）《》【】<>]/;
const GENERIC_SUBJECT_RE = /^(?:\d+号.+|短发女人|长发女人|老太太|老头|老人|守卫|村民|灰白制服(?:人员|男人|女人)|两名灰白制服人员)$/u;
const SNAPSHOT_FILE_RE = /^(\d+)\.snapshot\.json$/i;
const OUTPUT_PREFIX_RE = /^(\d+)\./i;

function pageHeader(memoryType, title) {
  return [
    "---",
    "type: structured-memory",
    `memory_type: ${memoryType}`,
    `title: "${title}"`,
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function chapterLabel(chapterNumber) {
  return `第${chapterNumber}章`;
}

function joinChapterList(chapters) {
  const ordered = [...new Set(chapters)].sort((a, b) => a - b);
  return ordered.length > 0 ? ordered.map(chapterLabel).join("、") : "无";
}

function parseInlineTags(content) {
  const match = content.match(/^---\n[\s\S]*?^tags:\s*\[([^\]]*)\]/m);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseInlineSources(content) {
  const match = content.match(/^---\n[\s\S]*?^sources:\s*\[([^\]]*)\]/m);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function hasOnlyValidSnapshotSources(content, validSnapshotNumbers) {
  const sources = parseInlineSources(content);
  if (sources.length === 0) return true;
  for (const source of sources) {
    const match = source.match(SNAPSHOT_FILE_RE);
    if (match?.[1] && !validSnapshotNumbers.has(Number(match[1]))) {
      return false;
    }
  }
  return true;
}

function shouldDeleteEntityFile(fileName, content, validSnapshotNumbers) {
  const baseName = fileName.replace(/\.md$/i, "");
  const tags = parseInlineTags(content);
  if (tags.some((tag) => UNSTABLE_TAGS.has(tag))) {
    return true;
  }
  if (!hasOnlyValidSnapshotSources(content, validSnapshotNumbers)) {
    return true;
  }
  if (/[“”"']/u.test(baseName) || /（.+）/u.test(baseName)) {
    return true;
  }
  return baseName.length > 12 && SENTENCE_PUNCTUATION_RE.test(baseName);
}

function parseChangeParts(text) {
  const normalized = text.replace(/[：:]/, ":");
  const index = normalized.indexOf(":");
  if (index <= 0) return null;
  return {
    subject: normalized.slice(0, index).trim(),
    detail: normalized.slice(index + 1).trim(),
  };
}

function ensureMapEntry(map, key, createValue) {
  if (!map.has(key)) {
    map.set(key, createValue());
  }
  return map.get(key);
}

function addAll(targetSet, items) {
  for (const item of items) {
    if (item) targetSet.add(item);
  }
}

function appendCandidateSection(lines, candidates) {
  lines.push("## 候选区", "");
  if (candidates.length === 0) {
    lines.push("暂无候选内容。", "");
    return;
  }
  for (const item of candidates) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

function isImportantSubject(subject) {
  const trimmed = subject.trim();
  if (!trimmed) return false;
  if (SENTENCE_PUNCTUATION_RE.test(trimmed)) return false;
  if (GENERIC_SUBJECT_RE.test(trimmed)) return false;
  if (/^(读者|角色|旁白)$/u.test(trimmed)) return false;
  if (/(通过|补充|借助|利用|经由)/u.test(trimmed)) return false;
  if (/^\d+号/u.test(trimmed)) return false;
  return trimmed.length <= 12;
}

function pickStableSubject(text, snapshot) {
  const parsed = parseChangeParts(text);
  if (parsed?.subject) {
    return isImportantSubject(parsed.subject) ? parsed.subject : null;
  }
  return snapshot.characters?.find((name) => text.includes(name) && isImportantSubject(name)) ?? null;
}

function normalizeForeshadowing(rawText) {
  const text = rawText
    .trim()
    .replace(/^(新增伏笔|推进伏笔|回收伏笔|新增|推进|回收)[：:\s-]*/u, "")
    .trim();

  function compactName(name) {
    let next = name.trim();
    if (next.length > 18 && next.includes("与")) {
      next = next.split("与")[0].trim();
    }
    if (next.length > 18 && next.includes("、")) {
      next = next.split("、")[0].trim();
    }
    return next.slice(0, 18).trim();
  }

  const quoted = text.match(/[“"']([^“”"']{1,24})[”"']/u);
  if (quoted?.[1]) {
    const name = compactName(quoted[1]);
    const description = text.replace(quoted[0], "").replace(/^[，。；：:、\-\s]+/u, "").trim() || rawText.trim();
    return { name, description };
  }

  const splitByDash = text.split(/\s*[-—]\s*/u).map((item) => item.trim()).filter(Boolean);
  if (splitByDash.length >= 2) {
    return {
      name: compactName(splitByDash[0]),
      description: splitByDash.slice(1).join(" - ").trim(),
    };
  }

  const keywordSplit = text.split(/为何|并非|不仅是|存在|成为|将成|将|会|正在|开始|继续|揭示|预示|说明|意味着|指向|却能|不承认/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (keywordSplit.length >= 2) {
    return {
      name: compactName(keywordSplit[0]),
      description: text.trim(),
    };
  }

  const splitByPunctuation = text.split(/[，。；：:？！]/u).map((item) => item.trim()).filter(Boolean);
  if (splitByPunctuation.length >= 2) {
    return {
      name: compactName(splitByPunctuation[0]),
      description: text.trim(),
    };
  }

  return {
    name: compactName(text),
    description: text.trim(),
  };
}

function buildChapterSnapshotsPage(snapshots) {
  const sections = snapshots.map((snapshot) => [
    `## ${chapterLabel(snapshot.chapterNumber)}`,
    "",
    "### 摘要",
    snapshot.summary || "无",
    "",
    "### 人物状态变化",
    ...(snapshot.characterStateChanges.length > 0 ? snapshot.characterStateChanges.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "### 角色认知变化",
    ...(snapshot.knowledgeChanges.length > 0 ? snapshot.knowledgeChanges.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "### 伏笔变化",
    ...(snapshot.foreshadowingChanges.length > 0 ? snapshot.foreshadowingChanges.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "### 时间线事件",
    ...(snapshot.timelineEvents.length > 0 ? snapshot.timelineEvents.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "### 正式设定",
    ...(snapshot.newCanonFacts.length > 0 ? snapshot.newCanonFacts.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "### 当前冲突",
    ...(snapshot.conflicts.length > 0 ? snapshot.conflicts.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "### 结尾钩子",
    snapshot.endingHook || "无",
    "",
  ].join("\n"));

  return `${pageHeader("chapter-snapshots", "章节快照记忆")}${sections.join("\n")}\n`;
}

function buildCharacterCognitionPage(snapshots) {
  const characters = new Map();
  const readerKnown = new Map();
  const candidates = [];

  for (const snapshot of snapshots) {
    for (const rawChange of snapshot.knowledgeChanges ?? []) {
      const change = rawChange.trim();
      if (!change) continue;
      if (UNCERTAIN_RE.test(change)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${change}`);
        continue;
      }

      const readerMatch = change.match(/^读者知道[了]?(.+)$/u);
      if (readerMatch?.[1]) {
        const detail = readerMatch[1].trim();
        const entry = ensureMapEntry(readerKnown, detail, () => ({ detail, chapters: new Set() }));
        entry.chapters.add(snapshot.chapterNumber);
        continue;
      }

      const doesNotKnowMatch = change.match(/^(.+?)不知道(.+)$/u);
      if (doesNotKnowMatch?.[1] && doesNotKnowMatch?.[2]) {
        const characterName = doesNotKnowMatch[1].trim();
        if (!isImportantSubject(characterName)) continue;
        const detail = doesNotKnowMatch[2].trim();
        const entry = ensureMapEntry(characters, characterName, () => ({
          knows: new Map(),
          doesNotKnow: new Map(),
          lastUpdatedChapter: snapshot.chapterNumber,
        }));
        const info = ensureMapEntry(entry.doesNotKnow, detail, () => ({ detail, chapters: new Set() }));
        info.chapters.add(snapshot.chapterNumber);
        entry.lastUpdatedChapter = Math.max(entry.lastUpdatedChapter, snapshot.chapterNumber);
        continue;
      }

      const knowMatch = change.match(/^(.+?)(知道|得知|察觉到|意识到)(.+)$/u);
      if (knowMatch?.[1] && knowMatch?.[3]) {
        const characterName = knowMatch[1].trim();
        if (!isImportantSubject(characterName)) continue;
        const detail = knowMatch[3].trim();
        const entry = ensureMapEntry(characters, characterName, () => ({
          knows: new Map(),
          doesNotKnow: new Map(),
          lastUpdatedChapter: snapshot.chapterNumber,
        }));
        const info = ensureMapEntry(entry.knows, detail, () => ({ detail, chapters: new Set() }));
        info.chapters.add(snapshot.chapterNumber);
        entry.doesNotKnow.delete(detail);
        entry.lastUpdatedChapter = Math.max(entry.lastUpdatedChapter, snapshot.chapterNumber);
      }
    }
  }

  const lines = [pageHeader("character-cognition", "角色认知记忆"), "## 当前正式认知", ""];
  const sortedCharacters = [...characters.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));

  if (sortedCharacters.length === 0) {
    lines.push("暂无正式认知记录。", "");
  } else {
    for (const [characterName, entry] of sortedCharacters) {
      lines.push(`### ${characterName}`);
      const knows = [...entry.knows.values()].sort((a, b) => [...a.chapters][0] - [...b.chapters][0]);
      const doesNotKnow = [...entry.doesNotKnow.values()].sort((a, b) => [...a.chapters][0] - [...b.chapters][0]);

      if (knows.length > 0) {
        lines.push("- 已知：");
        for (const item of knows) {
          lines.push(`  - ${item.detail}（来源：${joinChapterList(item.chapters)}）`);
        }
      }
      if (doesNotKnow.length > 0) {
        lines.push("- 未知：");
        for (const item of doesNotKnow) {
          lines.push(`  - ${item.detail}（来源：${joinChapterList(item.chapters)}）`);
        }
      }
      lines.push(`- 最近更新：${chapterLabel(entry.lastUpdatedChapter)}`, "");
    }
  }

  lines.push("## 读者已知", "");
  if (readerKnown.size === 0) {
    lines.push("暂无单独记录。", "");
  } else {
    for (const item of [...readerKnown.values()].sort((a, b) => [...a.chapters][0] - [...b.chapters][0])) {
      lines.push(`- ${item.detail}（来源：${joinChapterList(item.chapters)}）`);
    }
    lines.push("");
  }

  appendCandidateSection(lines, candidates);
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildCharacterStatesPage(snapshots) {
  const states = new Map();
  const candidates = [];

  for (const snapshot of snapshots) {
    for (const change of snapshot.characterStateChanges ?? []) {
      const text = change.trim();
      if (!text) continue;
      if (UNCERTAIN_RE.test(text)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${text}`);
        continue;
      }
      const parsed = parseChangeParts(text);
      const characterName = pickStableSubject(text, snapshot);
      if (!characterName) continue;
      const detail = parsed?.detail || text;
      states.set(characterName, {
        detail,
        lastUpdatedChapter: snapshot.chapterNumber,
      });
    }
  }

  const lines = [pageHeader("character-states", "人物状态记忆"), "## 当前正式状态", ""];
  const sorted = [...states.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));

  if (sorted.length === 0) {
    lines.push("暂无正式状态记录。", "");
  } else {
    for (const [characterName, state] of sorted) {
      lines.push(`### ${characterName}`);
      lines.push(`- 当前状态：${state.detail}`);
      lines.push(`- 最近更新：${chapterLabel(state.lastUpdatedChapter)}`);
      lines.push("");
    }
  }

  appendCandidateSection(lines, candidates);
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildForeshadowingPage(snapshots) {
  const tracker = new Map();
  const candidates = [];

  for (const snapshot of snapshots) {
    for (const rawChange of snapshot.foreshadowingChanges ?? []) {
      const change = rawChange.trim();
      if (!change) continue;
      if (UNCERTAIN_RE.test(change)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${change}`);
        continue;
      }
      const normalized = normalizeForeshadowing(change);
      if (!normalized.name) continue;

      const entry = ensureMapEntry(tracker, normalized.name, () => ({
        name: normalized.name,
        description: normalized.description,
        status: "planted",
        plantedChapter: snapshot.chapterNumber,
        advancedChapters: new Set(),
        resolvedChapter: null,
        sources: new Set(),
      }));

      if (normalized.description && entry.description.length < normalized.description.length) {
        entry.description = normalized.description;
      }
      entry.sources.add(snapshot.chapterNumber);

      if (/^(回收伏笔|回收)/u.test(change)) {
        entry.status = "resolved";
        entry.resolvedChapter = snapshot.chapterNumber;
      } else if (/^(推进伏笔|推进)/u.test(change)) {
        if (entry.status !== "resolved") {
          entry.status = "advanced";
        }
        entry.advancedChapters.add(snapshot.chapterNumber);
      } else {
        entry.plantedChapter = Math.min(entry.plantedChapter, snapshot.chapterNumber);
      }
    }
  }

  const planted = [];
  const advanced = [];
  const resolved = [];

  for (const entry of tracker.values()) {
    if (entry.status === "resolved") {
      resolved.push(entry);
    } else if (entry.status === "advanced") {
      advanced.push(entry);
    } else {
      planted.push(entry);
    }
  }

  const sortEntries = (items) => items.sort((a, b) => a.plantedChapter - b.plantedChapter || a.name.localeCompare(b.name, "zh-CN"));
  sortEntries(planted);
  sortEntries(advanced);
  sortEntries(resolved);

  const lines = [pageHeader("foreshadowing-tracker", "伏笔追踪记忆")];
  const sections = [
    ["进行中", [...planted, ...advanced]],
    ["已回收", resolved],
  ];

  for (const [title, entries] of sections) {
    lines.push(`## ${title}`, "");
    if (entries.length === 0) {
      lines.push("暂无记录。", "");
      continue;
    }
    for (const entry of entries) {
      lines.push(`### ${entry.name}`);
      lines.push(`- 状态：${entry.status === "resolved" ? "已回收" : entry.status === "advanced" ? "推进中" : "待推进"}`);
      if (entry.description) {
        lines.push(`- 说明：${entry.description}`);
      }
      lines.push(`- 初次出现：${chapterLabel(entry.plantedChapter)}`);
      if (entry.advancedChapters.size > 0) {
        lines.push(`- 推进章节：${joinChapterList(entry.advancedChapters)}`);
      }
      if (entry.resolvedChapter) {
        lines.push(`- 回收章节：${chapterLabel(entry.resolvedChapter)}`);
      }
      lines.push(`- 来源回查：${joinChapterList(entry.sources)}`);
      lines.push("");
    }
  }

  appendCandidateSection(lines, candidates);
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildTimelinePage(snapshots) {
  const seen = new Set();
  const lines = [pageHeader("timeline", "时间线记忆"), "## 已发生事件", ""];
  let count = 0;
  const candidates = [];

  for (const snapshot of snapshots) {
    for (const event of snapshot.timelineEvents ?? []) {
      const text = event.trim();
      if (!text) continue;
      if (UNCERTAIN_RE.test(text)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${text}`);
        continue;
      }
      const key = `${snapshot.chapterNumber}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- ${chapterLabel(snapshot.chapterNumber)}：${text}`);
      count += 1;
    }
  }

  if (count === 0) {
    lines.push("暂无正式时间线记录。", "");
  } else {
    lines.push("");
  }

  appendCandidateSection(lines, candidates);
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildFactListPage(memoryType, title, sectionTitle, snapshots, getItems) {
  const facts = new Map();
  const candidates = [];

  for (const snapshot of snapshots) {
    for (const item of getItems(snapshot) ?? []) {
      const text = item.trim();
      if (!text) continue;
      if (UNCERTAIN_RE.test(text)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${text}`);
        continue;
      }
      const entry = ensureMapEntry(facts, text, () => ({ text, chapters: new Set() }));
      entry.chapters.add(snapshot.chapterNumber);
    }
  }

  const lines = [pageHeader(memoryType, title), `## ${sectionTitle}`, ""];
  const sorted = [...facts.values()].sort((a, b) => [...a.chapters][0] - [...b.chapters][0]);

  if (sorted.length === 0) {
    lines.push("暂无记录。", "");
  } else {
    for (const entry of sorted) {
      lines.push(`- ${entry.text}（来源：${joinChapterList(entry.chapters)}）`);
    }
    lines.push("");
  }

  appendCandidateSection(lines, candidates);
  return `${lines.join("\n").trimEnd()}\n`;
}

async function loadSnapshots(snapshotsDir) {
  const dirEntries = await fs.readdir(snapshotsDir, { withFileTypes: true });
  const snapshotFiles = dirEntries
    .filter((entry) => entry.isFile() && SNAPSHOT_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.match(SNAPSHOT_FILE_RE)[1]) - Number(b.match(SNAPSHOT_FILE_RE)[1]));

  const snapshots = [];
  for (const fileName of snapshotFiles) {
    const filePath = path.join(snapshotsDir, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    snapshots.push(JSON.parse(raw));
  }
  return snapshots;
}

async function readActualChapterNumbers(chaptersDir) {
  try {
    const dirEntries = await fs.readdir(chaptersDir, { withFileTypes: true });
    const numbers = [];
    for (const entry of dirEntries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const filePath = path.join(chaptersDir, entry.name);
      const raw = await fs.readFile(filePath, "utf8");
      const match = raw.match(/^chapter_number:\s*['"]?(\d+)['"]?\s*$/m);
      if (match?.[1]) {
        numbers.push(Number(match[1]));
      }
    }
    return numbers.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function buildSnapshotValidity(snapshot, actualChapterNumbers) {
  if (!snapshot || !Number.isFinite(snapshot.chapterNumber)) {
    return { valid: false, reason: "invalid-number" };
  }
  if (snapshot.chapterNumber <= 0) {
    return { valid: false, reason: "non-positive" };
  }

  if (actualChapterNumbers.length === 0) {
    return { valid: true, reason: "accepted" };
  }

  const maxActual = Math.max(...actualChapterNumbers);
  if (snapshot.chapterNumber > maxActual + 5) {
    return { valid: false, reason: "far-beyond-current-project" };
  }

  return { valid: true, reason: "accepted" };
}

async function cleanupInvalidSnapshotArtifacts(snapshotsDir, ingestOutputDir, invalidChapterNumbers) {
  const deleted = [];
  const invalidSet = new Set(invalidChapterNumbers);

  try {
    const snapshotEntries = await fs.readdir(snapshotsDir, { withFileTypes: true });
    for (const entry of snapshotEntries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(SNAPSHOT_FILE_RE);
      if (!match?.[1]) continue;
      const chapterNumber = Number(match[1]);
      if (!invalidSet.has(chapterNumber)) continue;
      await fs.unlink(path.join(snapshotsDir, entry.name));
      deleted.push(path.join(".novel", "snapshots", entry.name));
    }
  } catch {}

  try {
    const outputEntries = await fs.readdir(ingestOutputDir, { withFileTypes: true });
    for (const entry of outputEntries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(OUTPUT_PREFIX_RE);
      if (!match?.[1]) continue;
      const chapterNumber = Number(match[1]);
      if (!invalidSet.has(chapterNumber)) continue;
      await fs.unlink(path.join(ingestOutputDir, entry.name));
      deleted.push(path.join(".novel", "chapter-ingest-output", entry.name));
    }
  } catch {}

  return deleted;
}

async function cleanupEntityFragments(entitiesDir, validSnapshotNumbers) {
  const dirEntries = await fs.readdir(entitiesDir, { withFileTypes: true });
  const deleted = [];

  for (const entry of dirEntries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const filePath = path.join(entitiesDir, entry.name);
    const content = await fs.readFile(filePath, "utf8");
    if (!shouldDeleteEntityFile(entry.name, content, validSnapshotNumbers)) continue;
    await fs.unlink(filePath);
    deleted.push(entry.name);
  }

  return deleted;
}

async function writeMemoryPages(memoryDir, pages) {
  await fs.mkdir(memoryDir, { recursive: true });
  for (const [fileName, content] of Object.entries(pages)) {
    await fs.writeFile(path.join(memoryDir, fileName), content, "utf8");
  }
}

async function main() {
  const resolvedProjectPath = path.resolve(projectPath);
  const entitiesDir = path.join(resolvedProjectPath, "wiki", "entities");
  const memoryDir = path.join(resolvedProjectPath, "wiki", "memory");
  const snapshotsDir = path.join(resolvedProjectPath, ".novel", "snapshots");
  const ingestOutputDir = path.join(resolvedProjectPath, ".novel", "chapter-ingest-output");
  const chaptersDir = path.join(resolvedProjectPath, "wiki", "chapters");

  const actualChapterNumbers = await readActualChapterNumbers(chaptersDir);
  const allSnapshots = await loadSnapshots(snapshotsDir);
  const validSnapshots = [];
  const invalidChapterNumbers = new Set();

  for (const snapshot of allSnapshots) {
    const validity = buildSnapshotValidity(snapshot, actualChapterNumbers);
    if (validity.valid) {
      validSnapshots.push(snapshot);
    } else {
      invalidChapterNumbers.add(snapshot.chapterNumber);
    }
  }

  if (shouldDeleteFragments && invalidChapterNumbers.size > 0) {
    await cleanupInvalidSnapshotArtifacts(
      snapshotsDir,
      ingestOutputDir,
      [...invalidChapterNumbers],
    );
  }

  const snapshots = validSnapshots;
  if (snapshots.length === 0) {
    throw new Error(`没有找到可用快照：${snapshotsDir}`);
  }

  let deleted = [];
  if (shouldDeleteFragments) {
    const validSnapshotNumbers = new Set(snapshots.map((snapshot) => snapshot.chapterNumber));
    deleted = await cleanupEntityFragments(entitiesDir, validSnapshotNumbers);
  }

  await writeMemoryPages(memoryDir, {
    "chapter-snapshots.md": buildChapterSnapshotsPage(snapshots),
    "character-cognition.md": buildCharacterCognitionPage(snapshots),
    "character-states.md": buildCharacterStatesPage(snapshots),
    "foreshadowing-tracker.md": buildForeshadowingPage(snapshots),
    "timeline.md": buildTimelinePage(snapshots),
    "canon-facts.md": buildFactListPage("canon-facts", "正式设定记忆", "正式事实", snapshots, (snapshot) => snapshot.newCanonFacts),
    "conflicts.md": buildFactListPage("conflicts", "冲突追踪记忆", "当前冲突", snapshots, (snapshot) => snapshot.conflicts),
  });

  const remainingEntities = (await fs.readdir(entitiesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .length;

  console.log(`已整理项目：${resolvedProjectPath}`);
  console.log(`有效快照：${snapshots.length}`);
  console.log(`排除异常快照：${invalidChapterNumbers.size}`);
  console.log(`实体剩余：${remainingEntities}`);
  console.log(`删除碎片实体：${deleted.length}`);
  if (deleted.length > 0) {
    console.log("已删除示例：");
    for (const name of deleted.slice(0, 20)) {
      console.log(`- ${name}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
