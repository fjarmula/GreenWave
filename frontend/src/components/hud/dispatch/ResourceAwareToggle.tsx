"use client";
import { useTranslation } from "@/components/language-provider";
type ResourceAwareToggleProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

/** Team-aware ambulance dispatch (ADR 0014) on, or the nearest PRM base with no team checks. */
export function ResourceAwareToggle({ enabled, onChange }: ResourceAwareToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">{t("Team-aware dispatch")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            enabled
              ? "PRM shifts, simulated status and operating areas"
              : "Nearest PRM base · no shift or status checks",
          )}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("Team-aware dispatch")}
        onClick={() => onChange(!enabled)}
        className="hud-switch tone-go"
      >
        <span />
      </button>
    </div>
  );
}
