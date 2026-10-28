"use client";
import { useTranslation } from "@/components/language-provider";
import { addressFromResult, provenanceBadge } from "@/lib/address-provenance";
import type { IncidentAddress } from "@/lib/useIncidentDispatch";
import type { GeocodeResult } from "@/types/telemetry";

/** Where an address coordinate comes from: EMUiA (verified, delta, only) or OSM fallback. */
function ProvenanceBadge({ address }: { address: IncidentAddress }) {
  const { t } = useTranslation();
  const { text, tone } = provenanceBadge(address);
  return (
    <span className={`hud-chip shrink-0 text-2xs whitespace-nowrap tone-${tone}`}>{t(text)}</span>
  );
}

/** One suggestion row: the label (truncated first) and its provenance badge. */
export function SuggestionContent({ result }: { result: GeocodeResult }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate">{t(result.label)}</span>
      <ProvenanceBadge address={addressFromResult(result)} />
    </span>
  );
}
