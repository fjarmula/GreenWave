"use client";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { useSimulationState } from "@/components/simulation-provider";
import { FALLBACK_DETAIL, fallbackNotices } from "@/lib/priority-fallback";

/**
 * Non-terminal warning while a run continues after failed priority requests. `compact` is the
 * one-line form for the collapsed phone and driver cards.
 */
export function PriorityFallbackNotice({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { itsRequests, routeData, simulationState } = useSimulationState();
  if (simulationState !== "RUNNING" || routeData?.green_wave_mode !== "ENABLED") return null;
  const notices = fallbackNotices(itsRequests, routeData);
  if (!notices.length) return null;
  if (compact) {
    const junctions = new Set(notices.flatMap((notice) => notice.targetIds)).size;
    return (
      <p role="status" className="hud-chip tone-caution mt-2" data-testid="priority-fallback">
        <TriangleAlert className="size-3.5" aria-hidden />
        {t(
          junctions === 1
            ? "Priority fallback · 1 junction"
            : `Priority fallback · ${junctions} junctions`,
        )}
      </p>
    );
  }
  return (
    <section
      role="status"
      aria-live="polite"
      className="hud-panel tone-caution"
      data-testid="priority-fallback"
    >
      <div className="flex items-start gap-3">
        <span className="hud-icon">
          <TriangleAlert aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="hud-title">{t("Priority unavailable · run continues")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(FALLBACK_DETAIL)}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {notices.map((notice) => (
              <li key={notice.messageId} className="break-words">
                <span className="font-semibold">{t(notice.title)}</span>
                {t(" · ")}
                {t(notice.targets)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
