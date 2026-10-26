"use client";
import dynamic from "next/dynamic";
import { Component, useState, useSyncExternalStore, type ReactNode } from "react";
import { HomeStaticBackdrop } from "@/components/workspace/HomeStaticBackdrop";
import { backdropKind, hasWebGL } from "@/lib/home-backdrop";
import { useIsPhone } from "@/lib/useIsPhone";

// Its own chunk: phones and the server never request MapLibre for the home page.
const HomeLiveBackdrop = dynamic(() => import("@/components/workspace/HomeLiveBackdrop"), {
  ssr: false,
  loading: () => <HomeStaticBackdrop phone={false} />,
});
const noSubscribe = () => () => {};

/** A crash in the live map (WebGL context refused, chunk failed to load) falls back, not out. */
export class BackdropBoundary extends Component<
  { onFail: () => void; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The home background: the live corridor map on wide screens, the drawing everywhere else. */
export function HomeBackdrop() {
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const phone = useIsPhone();
  const [webgl] = useState(() => typeof window !== "undefined" && hasWebGL());
  const [failed, setFailed] = useState(false);
  const kind = backdropKind({ hydrated, phone, webgl, failed });
  return (
    <div className="home-backdrop" data-kind={kind}>
      {kind === "live" ? (
        <BackdropBoundary
          onFail={() => setFailed(true)}
          fallback={<HomeStaticBackdrop phone={false} />}
        >
          <HomeLiveBackdrop onFail={() => setFailed(true)} />
        </BackdropBoundary>
      ) : (
        <HomeStaticBackdrop phone={phone} />
      )}
    </div>
  );
}
