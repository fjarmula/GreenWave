"use client";
import { useTranslation } from "@/components/language-provider";
import { TriangleAlert } from "lucide-react";

import { provenanceStrip } from "@/lib/address-provenance";
import type { IncidentAddress } from "@/lib/useIncidentDispatch";

/**
 * The selected address's coordinate source under the incident input. A disagreement is a
 * status, not an alert: the user chose the address and nothing failed.
 */
export function AddressProvenanceStrip({ address }: { address: IncidentAddress }) {
  const { t } = useTranslation();
  const { lines, warning } = provenanceStrip(address);
  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-2xs text-muted-foreground">{t(lines.join(" · "))}</p>
      {warning && (
        <p role="status" className="hud-alert tone-caution">
          <TriangleAlert aria-hidden />
          {t(warning)}
        </p>
      )}
    </div>
  );
}
