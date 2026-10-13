import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Script } from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as lucide from "lucide-react"

const directory = path.dirname(fileURLToPath(import.meta.url))
const names = [
  "BookOpen", "Books", "ChevronDown", "ChevronRight", "ArrowLeft", "ArrowRight",
  "Plus", "Search", "Upload", "X", "Check", "CircleCheck", "UserRound", "GitBranch",
  "Feather", "Quote", "Download", "RefreshCw", "Clock3", "Pause", "Play", "Settings2",
  "ListFilter", "FileText", "Bookmark", "History", "ArrowUpRight", "MoreHorizontal",
  "SlidersHorizontal", "Library", "List", "LayoutGrid", "PencilLine", "Sparkles",
  "PanelTop", "Circle", "ShieldCheck", "Send", "Undo2", "CheckCheck",
].filter(name => lucide[name])
const icons = Object.fromEntries(names.map(name => [name, renderToStaticMarkup(
  React.createElement(lucide[name], { width: 18, height: 18, strokeWidth: 1.8, "aria-hidden": true }),
)]))
const logo = (await fs.readFile(path.resolve(directory, "../../src/assets/QM-LOGO.png"))).toString("base64")
const source = await fs.readFile(path.join(directory, "prototype.html"), "utf8")
const output = source.replace("/* ICON_DATA */", () => `const ICONS = ${JSON.stringify(icons)};`)
  .replaceAll("__LOGO__", `data:image/png;base64,${logo}`)
new Script(output.split("<script>")[1].split("</script>")[0])
await fs.writeFile(path.join(directory, "index.html"), output)
console.log(`已生成：${path.join(directory, "index.html")}`)
