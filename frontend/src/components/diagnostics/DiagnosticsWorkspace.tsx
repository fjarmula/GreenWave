"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { diagnosticStore } from "@/lib/diagnostics/store";
import { useSimulationState } from "@/components/simulation-provider";
import { routeForMode } from "@/lib/workspace-routes";
import { WorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation";
import { DataQualityPanel } from "@/components/hud/DataQualityPanel";
import { EndpointActivity } from "./EndpointActivity";
import { DataFlowView } from "./DataFlowView";
import { getFrontendConfig } from "@/lib/config";
export function DiagnosticsWorkspace() {
  const entries = useSyncExternalStore(
    diagnosticStore.subscribe,
    diagnosticStore.getSnapshot,
    diagnosticStore.getSnapshot,
  );
  const { startRequest } = useSimulationState();
  const config = getFrontendConfig();
  return (
    <main className="home-main mx-auto w-full max-w-5xl p-5 sm:p-10">
      <header className="flex items-center justify-between gap-3">
        <WorkspaceNavigation current="/diagnostics" />
        <ThemeToggle />
      </header>
      <p className="home-eyebrow mt-10">
        <span aria-hidden className="size-1.5 rounded-full bg-beacon" />
        Developer view
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
        Endpoint diagnostics
      </h1>
      <p className="mt-3 mb-8 text-muted-foreground">
        Simulation only. Activity is observed at the existing adapter and validation boundary.
      </p>
      {startRequest && (
        <Link
          className="home-return pressable mt-0 mb-8"
          href={routeForMode(startRequest.green_wave_mode)}
        >
          Return to simulation
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
      <DataFlowView entries={entries} />
      <EndpointActivity entries={entries} />
      <section className="mt-8">
        <DataQualityPanel mode={config.transport} apiBaseUrl={config.apiBaseUrl} />
      </section>
      <button className="workspace-button mt-6" onClick={() => diagnosticStore.clear()}>
        <Trash2 aria-hidden />
        Clear observed history
      </button>
      <p className="mt-4 text-sm text-muted-foreground">
        {entries.length} of at most 200 retained entries.
      </p>
    </main>
  );
}
