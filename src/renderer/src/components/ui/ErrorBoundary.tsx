import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义兜底渲染；默认显示简短错误信息与「重试」。 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 日志定位用，会打印到控制台。 */
  label?: string;
}

interface ErrorBoundaryState {
  error?: Error;
}

/**
 * 渲染错误隔离。
 *
 * 没有边界时，任一子组件抛错会让整个 React 树卸载（表现为整页白屏，
 * 例如 selector 不稳定导致的无限更新循环）。有了边界，故障被限制在局部，
 * 其余界面仍可用，并且用户能看到可读的错误信息。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label ?? "ui"}] 渲染失败`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: undefined });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="m-2 flex flex-col gap-2 rounded-panel border border-danger bg-danger-soft p-3 text-sm text-danger">
        <div className="font-medium">该区域渲染失败</div>
        <div className="break-words text-xs">{error.message}</div>
        <div>
          <button
            type="button"
            className="rounded-control border border-danger px-2 py-1 text-xs hover:bg-danger hover:text-on-solid"
            onClick={this.reset}
          >
            重试
          </button>
        </div>
      </div>
    );
  }
}
