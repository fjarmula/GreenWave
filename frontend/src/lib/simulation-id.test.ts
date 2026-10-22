import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createSimulationId } from "@/lib/simulation-id";

const CONTRACT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** What an insecure context (plain HTTP on a LAN address) offers: no `randomUUID`. */
const insecure = {
  getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array),
} as unknown as Crypto;

describe("createSimulationId", () => {
  it("uses randomUUID where the context provides it", () => {
    const secure = {
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    } as unknown as Crypto;
    expect(createSimulationId(secure)).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("falls back to 32 lowercase hex characters without randomUUID", () => {
    expect(createSimulationId(insecure)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives unique fallback ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createSimulationId(insecure)));
    expect(ids.size).toBe(1000);
  });

  it("always matches the contract id pattern", () => {
    expect(createSimulationId()).toMatch(CONTRACT_PATTERN);
    expect(createSimulationId(insecure)).toMatch(CONTRACT_PATTERN);
  });
});
