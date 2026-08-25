import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ContextSizeSelector } from "./context-size-selector"

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe("ContextSizeSelector", () => {
  it("offers every supported context tier through the public selector", () => {
    const presets = [
      { value: 204_800, label: "200K" },
      { value: 262_144, label: "256K" },
      { value: 307_200, label: "300K" },
      { value: 409_600, label: "400K" },
      { value: 524_288, label: "512K" },
      { value: 1_000_000, label: "1M" },
    ]

    for (const [index, preset] of presets.entries()) {
      const html = renderToStaticMarkup(
        <ContextSizeSelector value={preset.value} onChange={vi.fn()} />,
      )
      expect(html).toContain(`value="${index}"`)
      expect(html).toContain(`>${preset.label}</button>`)
    }
  })
})
