"use client";
import { useTranslation } from "@/components/language-provider";
type CascadeToggleProps = {
  enabled: boolean;
  onToggle: () => void;
  /** Cascade is part of ER Green Wave; it has no effect while Green Wave is disabled. */
  disabled?: boolean;
};

export function CascadeToggle({ enabled, onToggle, disabled = false }: CascadeToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-6 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">{t("Cascade corridor mode")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            disabled
              ? "Only applies when ER Green Wave is enabled"
              : "Group nearby signals within 250 m",
          )}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("Cascade corridor mode")}
        disabled={disabled}
        onClick={onToggle}
        className="hud-switch tone-cascade"
      >
        <span />
      </button>
    </div>
  );
}
