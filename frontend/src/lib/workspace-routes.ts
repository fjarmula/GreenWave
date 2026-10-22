import type { GreenWaveMode } from "@/types/telemetry";
import type { SimulationState } from "@/lib/simulation-state";
export const destinations = [
  { href: "/", label: "Home" },
  { href: "/simulation/green-wave", label: "Green Wave" },
  { href: "/simulation/standard", label: "Standard traffic" },
  { href: "/compare", label: "Comparison" },
  { href: "/diagnostics", label: "Diagnostics" },
  { href: "/driver", label: "Driver" },
] as const;
export function routeForMode(mode: GreenWaveMode) {
  return mode === "ENABLED" ? "/simulation/green-wave" : "/simulation/standard";
}
export function modeForDestination(href: string): GreenWaveMode | null {
  return href === "/driver" || href === "/simulation/green-wave"
    ? "ENABLED"
    : href === "/simulation/standard"
      ? "DISABLED"
      : null;
}
export function viewRunPolicy(
  mode: GreenWaveMode,
  activeMode: GreenWaveMode | null,
  state: SimulationState["simulationState"],
) {
  const active = state === "RUNNING" || state === "STARTING";
  return {
    showRun: mode === activeMode && state !== "STARTING" && state !== "SETUP",
    requiresReplacement: active && mode !== activeMode,
  };
}
