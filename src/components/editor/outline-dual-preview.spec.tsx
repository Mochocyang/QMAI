// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OutlineDualPreview } from "./outline-dual-preview"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

function findButton(host: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(host.querySelectorAll("button")) as HTMLButtonElement[]
  const button = buttons.find(
    (item) => item.textContent?.replace(/\s+/g, " ").trim() === text,
  )
  if (!button) throw new Error(`未找到按钮：${text}`)
  return button
}

/** 同上，但找不到时返回 null —— 用于断言「本来就不该有」。 */
function queryButton(host: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = Array.from(host.querySelectorAll("button")) as HTMLButtonElement[]
  return buttons.find((item) => item.textContent?.replace(/\s+/g, " ").trim() === text) ?? null
}

describe("OutlineDualPreview", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete document.documentElement.dataset.uiTestSkin
  })

  const render = async (htmlContent: string, mdEditor: React.ReactNode, label?: string) => {
    await act(async () => {
      root.render(
        <OutlineDualPreview htmlContent={htmlContent} mdEditor={mdEditor} label={label} />,
      )
    })
  }

  it("默认以 HTML 模式渲染（iframe srcDoc）", async () => {
    const html = "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>"
    await render(html, <div data-testid="md-editor">MD 编辑器</div>)

    const iframe = host.querySelector("iframe") as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    expect(iframe.title).toBe("双格式 HTML 预览")
    expect(iframe.srcdoc).toContain("折叠树")
    expect(host.textContent).not.toContain("MD 编辑器")
  })

  it("支持自定义顶栏标签与 iframe 标题", async () => {
    const html = "<!DOCTYPE html><html><body><h1>卡片流</h1></body></html>"
    await render(html, <div data-testid="md-editor">MD 编辑器</div>, "人物小传双格式")

    const iframe = host.querySelector("iframe") as HTMLIFrameElement
    expect(iframe.title).toBe("人物小传双格式 HTML 预览")
    expect(host.textContent).toContain("人物小传双格式")
  })

  it("点击 MD 切换到编辑模式，再切回 HTML", async () => {
    const html = "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>"
    await render(html, <div data-testid="md-editor">MD 编辑器</div>)

    await act(async () => {
      findButton(host, "MD").click()
    })
    expect(host.querySelector('[data-testid="md-editor"]')).not.toBeNull()
    expect(host.textContent).toContain("MD 编辑器")

    await act(async () => {
      findButton(host, "HTML").click()
    })
    const iframe = host.querySelector("iframe") as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    expect(iframe.srcdoc).toContain("折叠树")
  })

  it("附加操作渲染在 HTML / MD 标识旁，且两种模式下都在", async () => {
    const html = "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>"
    await act(async () => {
      root.render(
        <OutlineDualPreview
          htmlContent={html}
          mdEditor={<div data-testid="md-editor">MD 编辑器</div>}
          actions={<button type="button" aria-label="提取记忆">提取</button>}
        />,
      )
    })

    // 默认 HTML 模式：iframe 在，操作区也在（这正是改造前缺的那一半）
    expect(host.querySelector("iframe")).not.toBeNull()
    const bar = host.querySelector("[data-outline-dual-actions]")
    expect(bar, "HTML / MD 标识旁应有操作区").not.toBeNull()
    expect(bar!.querySelector('[aria-label="提取记忆"]')).not.toBeNull()

    // 切到 MD：操作区不随模式消失
    await act(async () => {
      findButton(host, "MD").click()
    })
    expect(host.querySelector('[data-testid="md-editor"]')).not.toBeNull()
    expect(host.querySelector("[data-outline-dual-actions]")?.querySelector('[aria-label="提取记忆"]')).not.toBeNull()
  })

  it("没有附加操作时不渲染空的操作区", async () => {
    await render("<!DOCTYPE html><html><body></body></html>", <div data-testid="md-editor">MD</div>)
    expect(host.querySelector("[data-outline-dual-actions]")).toBeNull()
  })

  describe("HTML 就地编辑", () => {
    const doc = [
      "<!DOCTYPE html>",
      '<html data-qmai-layout="editorial-v2"><head><title>人物卡</title></head><body>',
      "<h1>失明之夜关键人物卡与阵营关系</h1>",
      "<table><tbody><tr><td>沈砚</td><td>北衙</td></tr></tbody></table>",
      "</body></html>",
    ].join("")

    /** 模拟用户在 iframe 里改字：把渲染出来的 srcdoc 解析成文档、改一处文字，
     *  再挂到 iframe 上（jsdom 不会自己解析 srcdoc，见下方注释）。 */
    function attachEditedFrame(frame: HTMLIFrameElement, mutate: (doc: Document) => void): void {
      // jsdom 给得出 contentDocument 但不解析 srcdoc（body 恒为空），
      // 所以这里手动造一份文档盖在实例上，专测「读回来 + 清洗 + 回传」这一段。
      const edited = new DOMParser().parseFromString(frame.srcdoc, "text/html")
      mutate(edited)
      Object.defineProperty(frame, "contentDocument", { value: edited, configurable: true })
    }

    const renderWithSave = async (onSaveHtml: (html: string) => Promise<boolean | void>) => {
      await act(async () => {
        root.render(
          <OutlineDualPreview
            htmlContent={doc}
            mdEditor={<div data-testid="md-editor">MD 编辑器</div>}
            onSaveHtml={onSaveHtml}
          />,
        )
      })
    }

    it("没给 onSaveHtml 时不出现编辑入口（只读预览保持原样）", async () => {
      await render(doc, <div data-testid="md-editor">MD 编辑器</div>)
      expect(queryButton(host, "编辑")).toBeNull()
    })

    it("点「编辑」后预览换成可编辑副本，模式切换被锁住，出现保存 / 取消", async () => {
      await renderWithSave(async () => undefined)
      await act(async () => findButton(host, "编辑").click())

      const iframe = host.querySelector("iframe") as HTMLIFrameElement
      expect(iframe.srcdoc).toContain('contenteditable="plaintext-only"')
      expect(iframe.srcdoc).toContain("data-qm-editable")
      expect(iframe.srcdoc).toContain("失明之夜关键人物卡与阵营关系")
      expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin")
      expect(findButton(host, "保存")).not.toBeNull()
      expect(findButton(host, "取消")).not.toBeNull()
      expect(findButton(host, "MD").disabled).toBe(true)
      expect(findButton(host, "HTML").disabled).toBe(true)
    })

    it("保存把改过的内容回传，并抹掉可编辑痕迹与预览皮肤", async () => {
      const saved: string[] = []
      await renderWithSave(async (html) => { saved.push(html) })
      await act(async () => findButton(host, "编辑").click())

      const iframe = host.querySelector("iframe") as HTMLIFrameElement
      attachEditedFrame(iframe, (edited) => {
        edited.querySelectorAll("td")[1]!.textContent = "南衙"
      })
      await act(async () => {
        findButton(host, "保存").click()
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      expect(saved).toHaveLength(1)
      expect(saved[0]).toContain("南衙")
      expect(saved[0]).not.toContain("北衙")
      expect(saved[0]).not.toContain("contenteditable")
      expect(saved[0]).not.toContain("data-qm-editable")
      expect(saved[0]).not.toContain("qmai-document-appearance")
      // 保存成功后退出编辑态
      expect(host.querySelector("[data-outline-html-edit-bar]")).toBeNull()
      expect((host.querySelector("iframe") as HTMLIFrameElement).srcdoc).not.toContain("contenteditable")
    })

    it("取消丢弃修改，不调用保存", async () => {
      let calls = 0
      await renderWithSave(async () => { calls += 1 })
      await act(async () => findButton(host, "编辑").click())
      await act(async () => findButton(host, "取消").click())

      expect(calls).toBe(0)
      expect(host.querySelector("[data-outline-html-edit-bar]")).toBeNull()
      expect((host.querySelector("iframe") as HTMLIFrameElement).srcdoc).not.toContain("contenteditable")
      expect(findButton(host, "HTML").disabled).toBe(false)
    })

    it("保存失败时留在编辑态并给出提示，用户仍可重试", async () => {
      let attempt = 0
      await renderWithSave(async () => {
        attempt += 1
        return false
      })
      await act(async () => findButton(host, "编辑").click())
      const iframe = host.querySelector("iframe") as HTMLIFrameElement
      attachEditedFrame(iframe, (edited) => {
        edited.querySelector("h1")!.textContent = "改过的标题"
      })
      await act(async () => {
        findButton(host, "保存").click()
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      expect(attempt).toBe(1)
      expect(host.textContent).toContain("保存失败")
      expect(findButton(host, "保存")).not.toBeNull()
    })

    it("换文档时退出编辑态，避免把上一份的内容存到新文件的同名 .html", async () => {
      const renderDoc = async (key: string) => {
        await act(async () => {
          root.render(
            <OutlineDualPreview
              htmlContent={doc}
              mdEditor={<div data-testid="md-editor">MD 编辑器</div>}
              onSaveHtml={async () => undefined}
              documentKey={key}
            />,
          )
        })
      }
      await renderDoc("C:/小说/wiki/outlines/卷纲/第一卷.md")
      await act(async () => findButton(host, "编辑").click())
      expect(host.querySelector("[data-outline-html-edit-bar]")).not.toBeNull()

      await renderDoc("C:/小说/wiki/outlines/卷纲/第二卷.md")
      expect(host.querySelector("[data-outline-html-edit-bar]")).toBeNull()
      expect((host.querySelector("iframe") as HTMLIFrameElement).srcdoc).not.toContain("contenteditable")
    })
  })

  it("预览跟随当前外观，切换皮肤后换成对应配色", async () => {
    document.documentElement.dataset.uiTestSkin = "xing"
    const html = "<!DOCTYPE html><html><head></head><body><h1>折叠树</h1></body></html>"
    await render(html, <div data-testid="md-editor">MD 编辑器</div>)

    const iframe = () => host.querySelector("iframe") as HTMLIFrameElement
    expect(iframe().srcdoc).toContain("折叠树")
    expect(iframe().srcdoc).toContain("#222f2a")
    expect(iframe().srcdoc).toContain("#e6eee7")
    expect(iframe().srcdoc).toContain("#b0c9ae")
    expect(iframe().className).toContain("bg-transparent")

    await act(async () => {
      window.dispatchEvent(new CustomEvent("qmai-ui-test-skin-change", { detail: "zhi" }))
    })

    expect(iframe().srcdoc).toContain("折叠树")
    expect(iframe().srcdoc).toContain("#fffcf7")
    expect(iframe().srcdoc).toContain("#423d31")
    expect(iframe().srcdoc).toContain("#655a42")
    expect(iframe().srcdoc).not.toContain("#222f2a")
    expect((iframe().srcdoc.match(/id="qmai-document-appearance"/g) ?? []).length).toBe(1)
  })
})
