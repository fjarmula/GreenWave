"use client";
import { useTranslation } from "@/components/language-provider";
import { VEHICLE_TYPE_LABELS } from "@/lib/station-copy";
import type { VehicleType } from "@/types/telemetry";

const VEHICLE_TYPES: VehicleType[] = ["AMBULANCE", "FIRE_TRUCK", "POLICE_CAR"];

type VehicleTypeControlProps = {
  value: VehicleType;
  onChange: (vehicleType: VehicleType) => void;
};

/** Segmented control; the type picks the candidate stations and the vehicle icon only. */
export function VehicleTypeControl({ value, onChange }: VehicleTypeControlProps) {
  const { t } = useTranslation();
  return (
    <div>
      <p id="vehicle-type-label" className="dashboard-label">
        {t("Vehicle type")}
      </p>
      <div role="group" aria-labelledby="vehicle-type-label" className="hud-segmented mt-2">
        {VEHICLE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={value === type}
            onClick={() => onChange(type)}
            className="hud-segment"
          >
            {t(VEHICLE_TYPE_LABELS[type])}
          </button>
        ))}
      </div>
    </div>
  );
}
