import { Component, type ReactNode } from "react";

export interface RenderBoundaryProps {
  /** What shows instead of the children after one of them threw while rendering; `retry` draws them again. */
  readonly fallback: (error: unknown, retry: () => void) => ReactNode;
  readonly children?: ReactNode;
}

interface RenderBoundaryState {
  readonly failed: boolean;
  readonly error: unknown;
}

/**
 * Keeps a render error inside one part of the app. A fallback that throws itself goes to the next boundary up, so a
 * failing fallback never loops.
 */
export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  override state: RenderBoundaryState = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): RenderBoundaryState {
    return { failed: true, error };
  }

  readonly retry = (): void => this.setState({ failed: false, error: null });

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.state.error, this.retry) : this.props.children;
  }
}
