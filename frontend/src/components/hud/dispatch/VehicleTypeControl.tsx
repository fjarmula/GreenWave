import { VEHICLE_TYPE_LABELS } from "@/lib/station-copy";
import type { VehicleType } from "@/types/telemetry";

const VEHICLE_TYPES: VehicleType[] = ["AMBULANCE", "FIRE_TRUCK", "POLICE_CAR"];

type VehicleTypeControlProps = {
  value: VehicleType;
  onChange: (vehicleType: VehicleType) => void;
};

/** Segmented control; the type picks the candidate stations and the vehicle icon only. */
export function VehicleTypeControl({ value, onChange }: VehicleTypeControlProps) {
  return (
    <div>
      <p id="vehicle-type-label" className="dashboard-label">
        Vehicle type
      </p>
      <div
        role="group"
        aria-labelledby="vehicle-type-label"
        className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-1"
      >
        {VEHICLE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={value === type}
            onClick={() => onChange(type)}
            className="flex min-h-9 items-center justify-center gap-1.5 rounded-md text-xs font-semibold text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 aria-pressed:bg-cyan-500/15 aria-pressed:text-cyan-700 dark:aria-pressed:text-cyan-300"
          >
            {VEHICLE_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  );
}
