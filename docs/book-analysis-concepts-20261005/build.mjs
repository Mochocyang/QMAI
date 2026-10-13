import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Script } from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as lucide from "lucide-react"

const directory = path.dirname(fileURLToPath(import.meta.url))
const icons = Object.fromEntries([
  "BookOpen", "ChevronDown", "ChevronRight", "ArrowLeft", "ArrowRight", "Plus", "Search",
  "SlidersHorizontal", "MoreHorizontal", "Upload", "X", "Check", "CircleCheck",
  "UserRound", "GitBranch", "Feather", "Quote", "Download", "RefreshCw",
  "Clock3", "Pause", "Play", "Settings2", "ListFilter", "FileText", "CheckCheck",
  "PanelTop", "Layers", "Bookmark", "ArrowUpRight", "History", "Info", "Circle", "ShieldCheck",
].map(name => [name, renderToStaticMarkup(React.createElement(lucide[name], {
  width: 18, height: 18, strokeWidth: 1.65, "aria-hidden": true,
}))]))
const logo = (await fs.readFile(path.resolve(directory, "../../src/assets/QM-LOGO.png"))).toString("base64")
const source = await fs.readFile(path.join(directory, "prototype.html"), "utf8")
const output = source.replace("/* ICON_DATA */", `const ICONS = ${JSON.stringify(icons)};`)
  .replaceAll("__APP_LOGO__", `data:image/png;base64,${logo}`)
new Script(output.split("<script>")[1].split("</script>")[0])
await fs.writeFile(path.join(directory, "index.html"), output)
console.log(`已生成独立预览：${path.join(directory, "index.html")}（无需联网）`)
