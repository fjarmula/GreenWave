"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { diagnosticStore } from "@/lib/diagnostics/store";
import { useSimulationState } from "@/components/simulation-provider";
import { routeForMode } from "@/lib/workspace-routes";
import { ResponsiveNavigation } from "@/components/workspace/ResponsiveNavigation";
import { useIsPhone } from "@/lib/useIsPhone";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { DataQualityPanel } from "@/components/hud/DataQualityPanel";
import { EndpointActivity } from "./EndpointActivity";
import { DataFlowView } from "./DataFlowView";
import { getFrontendConfig } from "@/lib/config";
export function DiagnosticsWorkspace() {
  const phone = useIsPhone();
  const entries = useSyncExternalStore(
    diagnosticStore.subscribe,
    diagnosticStore.getSnapshot,
    diagnosticStore.getSnapshot,
  );
  const { startRequest } = useSimulationState();
  const config = getFrontendConfig();
  return (
    <main className="home-main content-page pt-32 pb-10 sm:pt-36">
      <WorkspaceHeader
        variant="page"
        compact={phone}
        actions={
          <>
            {!phone && <ThemeToggle />}
            {startRequest && (
              <Link className="workspace-button" href={routeForMode(startRequest.green_wave_mode)}>
                <ArrowRight aria-hidden />
                <span className="workspace-button-label">Return to simulation</span>
              </Link>
            )}
            <button className="workspace-button" onClick={() => diagnosticStore.clear()}>
              <Trash2 aria-hidden />
              <span className="workspace-button-label">Clear observed history</span>
            </button>
          </>
        }
      >
        <ResponsiveNavigation current="/diagnostics" title="Diagnostics" heading={false} />
      </WorkspaceHeader>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Endpoint diagnostics</h1>
      <p className="mt-3 mb-8 text-muted-foreground">
        Simulation only. Activity is observed at the existing adapter and validation boundary.
      </p>
      <DataFlowView entries={entries} />
      <EndpointActivity entries={entries} />
      <section className="mt-8">
        <DataQualityPanel mode={config.transport} apiBaseUrl={config.apiBaseUrl} />
      </section>
      <p className="mt-6 text-sm text-muted-foreground">
        {entries.length} of at most 200 retained entries.
      </p>
    </main>
  );
}
