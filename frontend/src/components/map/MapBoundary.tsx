"use client";
import { useTranslation } from "@/components/language-provider";

import { MapPinOff } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";

export const MAP_UNAVAILABLE = "Map unavailable — WebGL may be disabled in this browser";

/** Contains a map crash to the map: the dispatch panels beside it keep working. */
export function MapBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      fallback={
        <div role="alert" className="flex h-full w-full items-center justify-center bg-muted p-6">
          <p className="hud-alert tone-caution">
            <MapPinOff aria-hidden />
            {t(MAP_UNAVAILABLE)}
          </p>
        </div>
      }
    >
      {t(children)}
    </ErrorBoundary>
  );
}
