import http from "node:http"

const HOST = "127.0.0.1"
const PORT = 18080

const payload = JSON.stringify({
  chapterOutlines: [
    "## 第一卷章节细纲",
    "- 第1章：主角在青石镇觉醒异常感知，埋下第一条失踪案伏笔。",
    "- 第2章：主角与巡检司冲突后达成合作，确立短期目标。",
    "- 第3章：第一名关键配角登场，并暴露与旧案相关的隐秘身份。",
  ].join("\n"),
  characterBriefs: [
    "## 主要人物",
    "- 林砚：外冷内执，核心动机是查清父亲失踪真相。",
    "- 沈知微：巡检司文书，擅长情报归纳，立场在制度与真相之间摇摆。",
  ].join("\n"),
  organizationsOutline: [
    "## 组织与势力",
    "- 巡检司：维护城镇秩序，但内部派系分裂明显。",
    "- 夜潮会：黑市网络，掌握失踪案的关键流向信息。",
  ].join("\n"),
  powerSystem: [
    "## 能力体系",
    "- 感知系：可读取残留情绪，代价是短时记忆紊乱。",
    "- 约束规则：每次能力使用后需通过静息法恢复，否则出现误判。",
  ].join("\n"),
  foreshadowingPlan: [
    "## 伏笔计划",
    "- 伏笔A：失踪名单里重复出现同一姓氏，第三卷回收其家族线。",
    "- 伏笔B：夜潮会账本缺页，第二卷末揭示被巡检司高层调包。",
  ].join("\n"),
  locationsOutline: [
    "## 地点设定",
    "- 青石镇旧码头：夜间交易核心区域，线索密集但风险高。",
    "- 北岭废驿站：旧案现场之一，关联主角童年记忆。",
  ].join("\n"),
})

function writeSseChunk(res, text) {
  const body = JSON.stringify({
    id: "mock-chatcmpl-1",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-refine-model",
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })
  res.write(`data: ${body}\n\n`)
}

function streamPayload(res, text) {
  const chunkSize = 60
  for (let i = 0; i < text.length; i += chunkSize) {
    writeSseChunk(res, text.slice(i, i + chunkSize))
  }
  res.write("data: [DONE]\n\n")
  res.end()
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/chat/completions") {
    res.statusCode = 404
    res.setHeader("content-type", "application/json; charset=utf-8")
    res.end(JSON.stringify({ error: "not found" }))
    return
  }

  const chunks = []
  req.on("data", (chunk) => chunks.push(chunk))
  req.on("end", () => {
    res.statusCode = 200
    res.setHeader("content-type", "text/event-stream; charset=utf-8")
    res.setHeader("cache-control", "no-cache")
    res.setHeader("connection", "keep-alive")
    streamPayload(res, payload)
  })
})

server.listen(PORT, HOST, () => {
  console.log(`mock refine llm server listening on http://${HOST}:${PORT}`)
})

process.on("SIGINT", () => {
  server.close(() => process.exit(0))
})

