"use client";
import { Component, type ReactNode } from "react";

/** A crash below (WebGL context refused, chunk failed to load) shows `fallback`, not a blank page. */
export class ErrorBoundary extends Component<
  { onFail?: () => void; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail?.();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
