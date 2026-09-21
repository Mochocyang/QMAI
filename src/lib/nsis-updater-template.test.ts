import { readFileSync } from "fs"
import { resolve } from "path"
import { describe, expect, it } from "vitest"

const templatePath = resolve(process.cwd(), "src-tauri/windows/_tauri-installer-template.nsi")
const template = readFileSync(templatePath, "utf8")

describe("Windows NSIS updater template", () => {
  it("waits for the current app executable to be released before copying the update", () => {
    const appRunningCheck = '!insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"'
    const waitForRelease = "Call WaitForMainBinaryRelease"
    const copyExecutable = 'File "${MAINBINARYSRCPATH}"'

    expect(template).toContain("Function WaitForMainBinaryRelease")
    expect(template).toContain(waitForRelease)
    expect(template).toContain('Delete "$INSTDIR\\${MAINBINARYNAME}.exe"')

    const appRunningCheckIndex = template.indexOf(appRunningCheck)
    const waitForReleaseIndex = template.indexOf(waitForRelease)
    const copyExecutableIndex = template.indexOf(copyExecutable)

    expect(waitForReleaseIndex).toBeGreaterThan(appRunningCheckIndex)
    expect(waitForReleaseIndex).toBeLessThan(copyExecutableIndex)
  })
})
