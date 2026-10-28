"use client";
import { useTranslation } from "@/components/language-provider";

import { Settings2, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { itsScenarioLabel } from "@/lib/driver-presentation";
import { VEHICLE_NAMES } from "@/lib/station-copy";
import type { SimulationStartRequest } from "@/types/telemetry";

/** The active run's settings, read-only: a running run never starts another. */
export function DispatchSettingsChip({ request }: { request: SimulationStartRequest }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className="settings-chip-wrap"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="settings-chip surface-glass pressable"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Settings2 aria-hidden />
        {t("Dispatch settings")}
      </button>
      <section
        id={panelId}
        aria-label={t("Active run settings")}
        className="settings-popover surface-glass"
        hidden={!open}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("Dispatch settings")}</h2>
          <button
            type="button"
            className="settings-popover-close pressable"
            aria-label={t("Close dispatch settings")}
            onClick={close}
          >
            <X aria-hidden />
          </button>
        </div>
        <dl className="settings-popover-list">
          <div>
            <dt>{t("Vehicle")}</dt>
            <dd>{t(VEHICLE_NAMES[request.vehicle_type])}</dd>
          </div>
          <div>
            <dt>{t("Traffic density")}</dt>
            <dd className="hud-value">
              {t(request.traffic_density_multiplier)}
              {t("×")}
            </dd>
          </div>
          <div>
            <dt>{t("Cascade corridor mode")}</dt>
            <dd>{t(request.enable_cascade_mode ? "On" : "Off")}</dd>
          </div>
          <div>
            <dt>{t("Simulated ITS feedback")}</dt>
            <dd>
              {t(
                itsScenarioLabel(
                  request.green_wave_mode === "DISABLED" ? "NOMINAL" : request.its_scenario,
                ),
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Playback speed")}</dt>
            <dd className="hud-value">
              {t(request.playback_speed)}
              {t("×")}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("Settings are locked while the simulated run is active. Stop the run to change them.")}
        </p>
      </section>
    </div>
  );
}
