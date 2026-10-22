"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
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
    <main className="mx-auto w-full max-w-5xl p-5 sm:p-10">
      <WorkspaceNavigation current="/diagnostics" />
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Endpoint diagnostics</h1>
      <p className="mt-3 mb-8 text-muted-foreground">
        Simulation only. Activity is observed at the existing adapter and validation boundary.
      </p>
      {startRequest && (
        <Link
          className="mb-6 inline-block underline"
          href={routeForMode(startRequest.green_wave_mode)}
        >
          Return to simulation
        </Link>
      )}
      <DataFlowView entries={entries} />
      <EndpointActivity entries={entries} />
      <section className="mt-8">
        <DataQualityPanel mode={config.transport} apiBaseUrl={config.apiBaseUrl} />
      </section>
      <button className="workspace-button mt-6" onClick={() => diagnosticStore.clear()}>
        Clear observed history
      </button>
      <p className="mt-4 text-sm text-muted-foreground">
        {entries.length} of at most 200 retained entries.
      </p>
    </main>
  );
}
