import { afterEach, describe, expect, it, vi } from "vitest";

import { parseFrontendConfig } from "@/lib/config";
import { selectSimulationAdapter } from "@/lib/simulation-adapter";
import type { SimulationStartRequest } from "@/types/telemetry";

const request: SimulationStartRequest = {
  simulation_id: "select-test",
  origin: { lat: 50.06, lng: 19.95 },
  destination: { lat: 50.07, lng: 19.96 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
  playback_speed: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe("selectSimulationAdapter", () => {
  it("uses the offline mock by default (no network)", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = selectSimulationAdapter(parseFrontendConfig({}, () => undefined));
    await expect(adapter.start(request)).resolves.toMatchObject({ simulation_id: "select-test" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the backend at the configured URL when transport is backend", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const config = parseFrontendConfig(
      { transport: "backend", apiBaseUrl: "http://10.0.0.5:9000/" },
      () => undefined,
    );
    await expect(selectSimulationAdapter(config).start(request)).rejects.toMatchObject({
      kind: "network",
      message: "Simulation backend unreachable at http://10.0.0.5:9000",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://10.0.0.5:9000/api/v1/simulation/start");
  });
});
