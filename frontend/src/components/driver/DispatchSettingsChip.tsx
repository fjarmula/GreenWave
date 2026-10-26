"use client";
import { LocateFixed, Settings2, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useFollowControl } from "@/components/map/follow-context";
import { itsScenarioLabel } from "@/lib/driver-presentation";
import { VEHICLE_NAMES } from "@/lib/station-copy";
import type { SimulationStartRequest } from "@/types/telemetry";

/** Camera follow for every live map of the workspace; off returns to the route overview. */
export function FollowSwitch({
  available,
  following,
  onChange,
}: {
  available: boolean;
  following: boolean;
  onChange: (following: boolean) => void;
}) {
  return (
    <div className="settings-follow">
      <LocateFixed aria-hidden />
      <span className="flex-1">Follow vehicle</span>
      <button
        type="button"
        role="switch"
        aria-checked={following}
        aria-label="Follow vehicle"
        disabled={!available}
        onClick={() => onChange(!following)}
        className="hud-switch tone-go"
      >
        <span />
      </button>
    </div>
  );
}

/** The active run's settings, read-only: a running run never starts another. */
export function DispatchSettingsChip({ request }: { request: SimulationStartRequest }) {
  const [open, setOpen] = useState(false);
  const follow = useFollowControl();
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
        Dispatch settings
      </button>
      <section
        id={panelId}
        aria-label="Active run settings"
        className="settings-popover surface-glass"
        hidden={!open}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Dispatch settings</h2>
          <button
            type="button"
            className="settings-popover-close pressable"
            aria-label="Close dispatch settings"
            onClick={close}
          >
            <X aria-hidden />
          </button>
        </div>
        <FollowSwitch
          available={follow.available}
          following={follow.following}
          onChange={follow.setFollowing}
        />
        <dl className="settings-popover-list">
          <div>
            <dt>Vehicle</dt>
            <dd>{VEHICLE_NAMES[request.vehicle_type]}</dd>
          </div>
          <div>
            <dt>Traffic density</dt>
            <dd className="hud-value">{request.traffic_density_multiplier}×</dd>
          </div>
          <div>
            <dt>Cascade corridor mode</dt>
            <dd>{request.enable_cascade_mode ? "On" : "Off"}</dd>
          </div>
          <div>
            <dt>Simulated ITS feedback</dt>
            <dd>
              {itsScenarioLabel(
                request.green_wave_mode === "DISABLED" ? "NOMINAL" : request.its_scenario,
              )}
            </dd>
          </div>
          <div>
            <dt>Playback speed</dt>
            <dd className="hud-value">{request.playback_speed}×</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Settings are locked while the simulated run is active. Stop the run to change them.
        </p>
      </section>
    </div>
  );
}
