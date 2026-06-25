import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")
const sectionSourcePath = resolve(__dirname, "sections", "contact-support-section.tsx")

describe("settings contact support section", () => {
  it("adds a contact and support category to the settings sidebar", () => {
    expect(settingsViewSource).toContain('"contact-support"')
    expect(settingsViewSource).toContain("settings.categories.contactSupport")
    expect(settingsViewSource).toContain("<ContactSupportSection")
  })

  it("shows WeChat contact, WeChat pay, and Alipay pay images", () => {
    const sectionSource = readFileSync(sectionSourcePath, "utf8")

    expect(sectionSource).toContain("wechat-contact.jpg")
    expect(sectionSource).toContain("wechat-pay.jpg")
    expect(sectionSource).toContain("alipay-pay.jpg")
    expect(sectionSource).toContain("settings.sections.contactSupport.contact.title")
    expect(sectionSource).toContain("settings.sections.contactSupport.donation.title")
  })
})
