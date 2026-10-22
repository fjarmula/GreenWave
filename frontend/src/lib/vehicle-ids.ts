import type { VehicleType } from "@/types/telemetry";

/** Simulated vehicle ids, the same ones the backend engine reports in `ambulance.id`. */
const SIMULATED_VEHICLE_IDS: Record<VehicleType, string> = {
  AMBULANCE: "AMB-KRA-01",
  FIRE_TRUCK: "FIRE-KRA-01",
  POLICE_CAR: "POL-KRA-01",
};

export function simulatedVehicleId(vehicleType: VehicleType): string {
  return SIMULATED_VEHICLE_IDS[vehicleType];
}
