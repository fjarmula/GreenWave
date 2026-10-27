"use client";

import { useEffect } from "react";

import { rankTimeModeFor } from "@/lib/station-choice";
import type { GreenWaveMode } from "@/types/telemetry";

/**
 * Tells the shared dispatch which estimate this page's area rule compares (ADR 0014). A child
 * component, so the forms that render it stay hook-free (their tests call them as functions).
 */
export function RankTimeModeSync({
  greenWaveMode,
  intent,
  setRankTimeMode,
}: {
  greenWaveMode: GreenWaveMode;
  intent: "simulation" | "comparison";
  setRankTimeMode: (mode: GreenWaveMode) => void;
}) {
  useEffect(
    () => setRankTimeMode(rankTimeModeFor(greenWaveMode, intent)),
    [setRankTimeMode, greenWaveMode, intent],
  );
  return null;
}
