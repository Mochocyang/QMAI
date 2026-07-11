import { Component, type ReactNode } from "react"
import { isTauri } from "@/lib/platform"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, componentStack: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
    if (isTauri()) {
      try {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("log_error", {
            message: error.message,
            stack: error.stack ?? "",
            componentStack: info.componentStack ?? "",
          }).catch(() => {})
        }).catch(() => {})
      } catch {
      }
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground overflow-auto">
          <p className="text-destructive font-medium">应用运行出错</p>
          <p className="text-xs max-w-md text-center">{this.state.error?.message}</p>
          {this.state.componentStack && (
            <details className="w-full max-w-md text-left">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                错误详情
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
                {this.state.componentStack}
              </pre>
            </details>
          )}
          {this.state.error?.stack && (
            <details className="w-full max-w-md text-left">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                调用栈
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <button
            className="rounded border px-3 py-1 text-xs hover:bg-muted"
            onClick={() => this.setState({ hasError: false, error: null, componentStack: null })}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
