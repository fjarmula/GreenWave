"use client";
import { useCallback, useSyncExternalStore } from "react";
import { sectionFromHash, type DocsSectionId } from "@/lib/docs/tabs";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

/** The active docs tab, kept in the URL hash: linkable, survives a language switch, follows back/forward. */
export function useDocsSection(): [DocsSectionId, (id: DocsSectionId) => void] {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  const select = useCallback((id: DocsSectionId) => {
    // Assigning the hash pushes a history entry and fires hashchange.
    window.location.hash = id;
  }, []);
  return [sectionFromHash(hash), select];
}
