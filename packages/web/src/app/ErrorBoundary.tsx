/**
 * Top level error boundary. A render failure anywhere below it degrades into
 * the same paper-and-hairline error page instead of a blank screen.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '@/ui'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Rendered instead of the default screen when provided. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[rhine] view crashed', error, info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <div className="rh-error" role="alert">
        <span className="rh-caption rh-error__caption">RENDER FAILURE</span>
        <h2 className="rh-error__title">页面渲染失败</h2>
        <p className="rh-boot__hint">
          这个视图遇到了意外错误。可以重试，或者重新载入整个界面。
        </p>
        <pre className="rh-error__detail">{error.stack ?? error.message}</pre>
        <div className="rh-error__actions">
          <Button variant="ghost" size="sm" onClick={this.reset}>
            重试
          </Button>
          <Button variant="primary" size="sm" onClick={() => location.reload()}>
            重新载入
          </Button>
        </div>
      </div>
    )
  }
}
