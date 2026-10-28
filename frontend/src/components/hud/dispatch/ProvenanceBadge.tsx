import { addressFromResult, provenanceBadge } from "@/lib/address-provenance";
import type { IncidentAddress } from "@/lib/useIncidentDispatch";
import type { GeocodeResult } from "@/types/telemetry";

/** Where an address coordinate comes from: EMUiA (verified, delta, only) or OSM fallback. */
function ProvenanceBadge({ address }: { address: IncidentAddress }) {
  const { text, tone } = provenanceBadge(address);
  return (
    <span className={`hud-chip shrink-0 text-2xs whitespace-nowrap tone-${tone}`}>{text}</span>
  );
}

/** One suggestion row: the label (truncated first) and its provenance badge. */
export function SuggestionContent({ result }: { result: GeocodeResult }) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate">{result.label}</span>
      <ProvenanceBadge address={addressFromResult(result)} />
    </span>
  );
}
