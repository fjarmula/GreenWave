"use client";
import { useTranslation } from "@/components/language-provider";
import { nextSignalCopy, type NextSignal } from "@/lib/driver-presentation";

/** The next unpassed route signal; the parent renders nothing without fresh telemetry. */
export function NextSignalCard({ signal }: { signal: NextSignal }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("Next signal")} className="next-signal surface-glass">
      <span aria-hidden className="next-signal-lamp" data-state={signal.state} />
      <div className="min-w-0">
        <p className="next-signal-copy">{t(nextSignalCopy(signal))}</p>
        <p className="next-signal-name">
          {signal.name && <span className="truncate">{t(signal.name)}</span>}
          <span className="next-signal-id">{t(signal.intersectionId)}</span>
        </p>
      </div>
    </section>
  );
}
