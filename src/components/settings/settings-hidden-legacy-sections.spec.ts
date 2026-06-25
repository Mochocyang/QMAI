import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")

describe("settings hidden legacy import sections", () => {
  it("does not expose source watch or scheduled import categories in settings", () => {
    expect(settingsViewSource).not.toContain('"source-watch"')
    expect(settingsViewSource).not.toContain('"scheduled-import"')
    expect(settingsViewSource).not.toContain("settings.categories.sourceWatch")
    expect(settingsViewSource).not.toContain("settings.categories.scheduledImport")
    expect(settingsViewSource).not.toContain("SourceWatchSection")
    expect(settingsViewSource).not.toContain("ScheduledImportSection")
  })
})
