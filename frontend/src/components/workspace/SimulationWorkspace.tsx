import { Dashboard } from "@/components/dashboard";
import type { GreenWaveMode } from "@/types/telemetry";
export function SimulationWorkspace({ mode }: { mode: GreenWaveMode }) {
  return <Dashboard selectedMode={mode} />;
}
