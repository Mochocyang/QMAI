import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ReviewCenterView } from "./review-center-view"

const mocks = vi.hoisted(() => ({
  state: {
    selectedReviewDimension: "thrill" as string | null,
    novelMode: true,
  },
}))

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}))

vi.mock("./review-view", () => ({
  ReviewView: (props: { title?: string; dimensionKey?: string }) => (
    <div data-review-view="true" data-title={props.title || ""} data-dimension-key={props.dimensionKey || ""} />
  ),
}))

vi.mock("@/components/dashboard/dashboard-view", () => ({
  DashboardView: () => <div data-dashboard-view="true" />,
}))

describe("ReviewCenterView six-dimension routing", () => {
  beforeEach(() => {
    mocks.state.selectedReviewDimension = "thrill"
    mocks.state.novelMode = true
  })

  it("passes an independent dimension key when a six-dimension tab is selected", () => {
    const html = renderToStaticMarkup(<ReviewCenterView />)

    expect(html).toContain('data-review-view="true"')
    expect(html).toContain('data-dimension-key="thrill"')
    expect(html).toContain('data-title="reviewCenter.dimension.thrill"')
  })

  it("keeps AI review routed to the original review view without a dimension key", () => {
    mocks.state.selectedReviewDimension = "ai-review"
    const html = renderToStaticMarkup(<ReviewCenterView />)

    expect(html).toContain('data-review-view="true"')
    expect(html).toContain('data-dimension-key=""')
  })
})
