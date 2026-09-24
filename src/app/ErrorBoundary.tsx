import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from './errorReporting'

interface Props {
  children: ReactNode
  /**
   * Shown instead of the children after an error. Default: the full-page ErrorPage. `null` renders
   * nothing, for optional parts (the debug HUD) whose failure must not take the page down.
   */
  fallback?: ReactNode
  /** Names the boundary in the error log. */
  context?: string
}

interface State {
  failed: boolean
}

/**
 * Catches errors thrown while rendering (and in effects) below it, logs them with the build info,
 * and shows a fallback — instead of React unmounting the whole tree to a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(this.props.context ?? 'render', error, { componentStack: info.componentStack })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return this.props.fallback !== undefined ? this.props.fallback : <ErrorPage />
  }
}

/** The app could not go on: say so plainly, and offer the one thing that helps. */
export function ErrorPage() {
  return (
    <main className="error-page" role="alert">
      <h1 className="error-page__title">Đã xảy ra lỗi</h1>
      <p className="error-page__text">
        Ứng dụng gặp sự cố ngoài ý muốn. Hãy tải lại trang để tiếp tục; chữ đang viết dở sẽ không được giữ lại.
      </p>
      <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
        Tải lại
      </button>
    </main>
  )
}
