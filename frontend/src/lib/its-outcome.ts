/**
 * The MIXED scenario's per-request outcome, a documented duplicate of the backend's
 * `mixed_outcome` (greenwave/its/controller.py): the top two bits of the FNV-1a 32-bit hash of
 * `"<seed>:<sorted target ids>"`, finalised with MurmurHash3's fmix32. Only the seed and the
 * request's stable target identity count, never time, so both transports replay exactly.
 */
export type MixedOutcome = "ACCEPT" | "ACCEPT_DELAYED" | "REJECT" | "NO_RESPONSE";

const OUTCOMES: readonly MixedOutcome[] = ["ACCEPT", "ACCEPT_DELAYED", "REJECT", "NO_RESPONSE"];

export function mixedOutcome(seed: number, intersectionIds: readonly string[]): MixedOutcome {
  let value = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`${seed}:${[...intersectionIds].sort().join(",")}`))
    value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return OUTCOMES[value >>> 30];
}
