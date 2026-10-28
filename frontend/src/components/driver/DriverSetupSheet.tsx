"use client";
import { useTranslation } from "@/components/language-provider";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { DispatchSettingsFields } from "@/components/hud/dispatch/DispatchSettingsFields";
import { IncidentInput } from "@/components/hud/dispatch/IncidentInput";
import { VehicleTypeControl } from "@/components/hud/dispatch/VehicleTypeControl";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { settingsSummary } from "@/lib/driver-presentation";
import type { DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";

/** Driver setup, always visible: where, which vehicle and a settings summary (the start is the
 * workspace's persistent action). */
export function DriverSetupCard({
  dispatch,
  capabilities,
  geocode,
  settings,
  detailsOpen,
  onToggleDetails,
  notices,
  intent = "simulation",
}: {
  dispatch: IncidentDispatch;
  capabilities: DispatchAdapter["capabilities"];
  geocode: DispatchAdapter["geocode"];
  settings: DispatchSettings;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** Ownership and replacement notices, shown under the summary. */
  notices?: ReactNode;
  intent?: "simulation" | "comparison";
}) {
  const { t } = useTranslation();
  const { incident } = dispatch;
  const incidentKey = incident
    ? `${incident.label}@${incident.position.lat},${incident.position.lng}`
    : "none";
  return (
    <section aria-labelledby="driver-setup-title" className="driver-setup">
      <h2 id="driver-setup-title" className="driver-setup-title" data-sheet-peek>
        {t("Where’s the incident?")}
        {incident && (
          // Shown only on the minimized sheet, where the input below is out of view.
          <span className="driver-setup-peek-incident">
            {t(" · ")}
            {t(incident.label)}
          </span>
        )}
      </h2>
      <div className="mt-3 space-y-4">
        <IncidentInput
          key={incidentKey}
          incident={incident}
          geocodeEnabled={capabilities.geocode}
          geocode={geocode}
          onIncidentChange={dispatch.setIncident}
        />
        <VehicleTypeControl value={dispatch.vehicleType} onChange={dispatch.setVehicleType} />
      </div>
      <button
        type="button"
        className="settings-summary pressable"
        aria-expanded={detailsOpen}
        onClick={onToggleDetails}
      >
        <span className="min-w-0 py-2 text-left">
          {t(
            settingsSummary(
              intent === "comparison" ? { ...settings, greenWaveMode: "ENABLED" } : settings,
            ),
          )}
        </span>
        <ChevronRight aria-hidden data-open={detailsOpen} />
      </button>
      {t(notices)}
    </section>
  );
}

/** The full dispatch settings, one drag (or tap on the summary) away. The page fixes the mode. */
export function DriverSetupDetails(
  props: Omit<Parameters<typeof DispatchSettingsFields>[0], "layout" | "modeLocked">,
) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("Dispatch settings")} className="driver-setup-details">
      <DispatchSettingsFields {...props} layout="sheet" modeLocked />
    </section>
  );
}
