"use client";
import { useSyncExternalStore } from "react";
import { DESKTOP_MIN_WIDTH } from "@/lib/workspace-layout";

const PHONE_QUERY = `(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`;
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** Phone layout by viewport width; the server renders the desktop layout. */
export function useIsPhone() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
