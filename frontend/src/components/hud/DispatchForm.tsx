"use client";

import { Radio } from "lucide-react";
import type { ReactNode } from "react";

import { DispatchSettingsFields } from "@/components/hud/dispatch/DispatchSettingsFields";
import { IncidentInput } from "@/components/hud/dispatch/IncidentInput";
import { VehicleTypeControl } from "@/components/hud/dispatch/VehicleTypeControl";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import type { PreviousRun } from "@/lib/previous-run";
import type { DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";

type DispatchFormProps = {
  /** Owned by the dashboard so the chosen settings outlive each run. */
  settings: DispatchSettings;
  intent?: "simulation" | "comparison";
  modeLocked?: boolean;
  onSettingsChange: (settings: DispatchSettings) => void;
  /** The last finished run of this page session, shown for comparison. */
  previousRun?: PreviousRun | null;
  /** Why the station list could not be loaded, if it could not. */
  stationsError?: string | null;
  dispatch: IncidentDispatch;
  capabilities: DispatchAdapter["capabilities"];
  geocode: DispatchAdapter["geocode"];
  onFocusMap: () => void;
  /** Extra HUD panels rendered at the end of the console (e.g. data quality). */
  children?: ReactNode;
};

export function DispatchForm({
  settings,
  intent = "simulation",
  modeLocked = false,
  onSettingsChange,
  previousRun = null,
  stationsError = null,
  dispatch,
  capabilities,
  geocode,
  onFocusMap,
  children,
}: DispatchFormProps) {
  const { incident } = dispatch;
  const incidentKey = incident
    ? `${incident.label}@${incident.position.lat},${incident.position.lng}`
    : "none";

  return (
    <aside className="p-5 sm:p-6 lg:h-full lg:overflow-y-auto">
      <div className="hud-head">
        <div>
          <p className="dashboard-eyebrow">Dispatch console / 01</p>
          <h2 className="hud-title text-lg">Incident dispatch</h2>
        </div>
        <span className="hud-icon tone-emergency">
          <Radio aria-hidden />
        </span>
      </div>

      <div className="mt-6 space-y-5">
        <VehicleTypeControl value={dispatch.vehicleType} onChange={dispatch.setVehicleType} />
        <IncidentInput
          key={incidentKey}
          incident={incident}
          geocodeEnabled={capabilities.geocode}
          geocode={geocode}
          onIncidentChange={dispatch.setIncident}
        />
      </div>

      <DispatchSettingsFields
        layout="panel"
        dispatch={dispatch}
        settings={settings}
        onSettingsChange={onSettingsChange}
        intent={intent}
        modeLocked={modeLocked}
        capabilities={capabilities}
        stationsError={stationsError}
        onFocusMap={onFocusMap}
        previousRun={previousRun}
      />

      {children && <div className="mt-6">{children}</div>}
    </aside>
  );
}
