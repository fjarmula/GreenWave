"use client";
import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HomeStaticBackdrop } from "@/components/workspace/HomeStaticBackdrop";
import { backdropKind, hasWebGL } from "@/lib/home-backdrop";
import { useIsPhone } from "@/lib/useIsPhone";

// Its own chunk: phones and the server never request MapLibre for the home page.
const HomeLiveBackdrop = dynamic(() => import("@/components/workspace/HomeLiveBackdrop"), {
  ssr: false,
  loading: () => <HomeStaticBackdrop phone={false} />,
});
const noSubscribe = () => () => {};

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
        <ErrorBoundary
          onFail={() => setFailed(true)}
          fallback={<HomeStaticBackdrop phone={false} />}
        >
          <HomeLiveBackdrop onFail={() => setFailed(true)} />
        </ErrorBoundary>
      ) : (
        <HomeStaticBackdrop phone={phone} />
      )}
    </div>
  );
}
