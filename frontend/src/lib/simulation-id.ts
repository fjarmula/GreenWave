/**
 * A client-chosen simulation id. `crypto.randomUUID` exists only in secure contexts
 * (HTTPS, localhost); over plain HTTP on a LAN address the fallback uses
 * `getRandomValues`, which is available everywhere. Both match the contract pattern
 * `^[A-Za-z0-9_-]{1,64}$`.
 */
export function createSimulationId(source: Crypto = globalThis.crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
