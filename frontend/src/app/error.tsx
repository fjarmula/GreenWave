"use client";
import { RotateCcw, TriangleAlert } from "lucide-react";

/** Route-level fallback: an unexpected crash offers a retry instead of a blank page. */
export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div role="alert" className="max-w-md space-y-4 text-center">
        <TriangleAlert className="mx-auto size-8 text-emergency" aria-hidden />
        <h1 className="hud-title text-lg">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          This page hit an unexpected error. The simulation backend is unaffected.
        </p>
        <button type="button" onClick={reset} className="hud-secondary tone-beacon pressable">
          <RotateCcw aria-hidden />
          Try again
        </button>
      </div>
    </main>
  );
}
