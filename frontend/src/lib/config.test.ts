import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_API_BASE_URL, parseFrontendConfig } from "@/lib/config";

function parse(env: { transport?: string; apiBaseUrl?: string }) {
  const warnings: string[] = [];
  const config = parseFrontendConfig(env, (message) => warnings.push(message));
  return { config, warnings };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("parseFrontendConfig", () => {
  it("defaults to the mock transport and the local backend URL without warnings", () => {
    const { config, warnings } = parse({});
    expect(config.transport).toBe("mock");
    expect(config.apiBaseUrl).toBe("http://127.0.0.1:8000");
    expect(DEFAULT_API_BASE_URL).toBe("http://127.0.0.1:8000");
    expect(config.staleAfterSeconds).toBe(3);
    expect(config.startTimeoutMilliseconds).toBe(10_000);
    expect(config.reconnectAttemptLimit).toBe(5);
    expect(warnings).toEqual([]);
  });

  it("treats empty values as unset", () => {
    expect(parse({ transport: "", apiBaseUrl: "" })).toMatchObject({
      config: { transport: "mock", apiBaseUrl: DEFAULT_API_BASE_URL },
      warnings: [],
    });
  });

  it("accepts the backend transport", () => {
    expect(parse({ transport: "backend" }).config.transport).toBe("backend");
  });

  it.each(["prod", "Backend!", "true", "BACKEND2"])(
    "falls back to mock (never backend) for an invalid transport %j and warns",
    (transport) => {
      const { config, warnings } = parse({ transport });
      expect(config.transport).toBe("mock");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("NEXT_PUBLIC_SIMULATION_TRANSPORT");
    },
  );

  it("strips trailing slashes and keeps a path prefix", () => {
    expect(parse({ apiBaseUrl: "http://localhost:8000/" }).config.apiBaseUrl).toBe(
      "http://localhost:8000",
    );
    expect(parse({ apiBaseUrl: "https://demo.example/greenwave//" }).config.apiBaseUrl).toBe(
      "https://demo.example/greenwave",
    );
  });

  it.each(["not a url", "ftp://127.0.0.1:8000", "127.0.0.1:8000"])(
    "falls back to the default URL for %j and warns",
    (apiBaseUrl) => {
      const { config, warnings } = parse({ apiBaseUrl });
      expect(config.apiBaseUrl).toBe(DEFAULT_API_BASE_URL);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("NEXT_PUBLIC_API_BASE_URL");
    },
  );
});

describe("getFrontendConfig", () => {
  it("reads NEXT_PUBLIC_* once and warns only once for invalid values", async () => {
    vi.stubEnv("NEXT_PUBLIC_SIMULATION_TRANSPORT", "prod");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://10.0.0.5:9000/");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getFrontendConfig } = await import("@/lib/config");
    const first = getFrontendConfig();
    const second = getFrontendConfig();
    expect(first).toBe(second);
    expect(first).toMatchObject({ transport: "mock", apiBaseUrl: "http://10.0.0.5:9000" });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
