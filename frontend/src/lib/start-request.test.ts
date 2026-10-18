import { expect, it } from "vitest";
import { DESTINATION_ENDPOINTS, ORIGIN_ENDPOINTS } from "@/components/map/dispatch-endpoints";
import { buildStartRequest } from "@/lib/start-request";

it("test_build_start_request_uses_lng_lat_of_endpoints", () => {
  const request = buildStartRequest(
    ORIGIN_ENDPOINTS[1],
    DESTINATION_ENDPOINTS[2],
    { trafficDensity: 2.3, cascadeEnabled: false, playbackSpeed: 5 },
    "SIM-1",
  );

  expect(request).toEqual({
    simulation_id: "SIM-1",
    origin: { lng: 20.011, lat: 50.005 },
    destination: { lng: 20.037, lat: 50.073 },
    traffic_density_multiplier: 2.3,
    enable_cascade_mode: false,
    playback_speed: 5,
  });
});
