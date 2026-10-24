import { nextSignalCopy, type NextSignal } from "@/lib/driver-presentation";

/** The next unpassed route signal; the parent renders nothing without fresh telemetry. */
export function NextSignalCard({ signal }: { signal: NextSignal }) {
  return (
    <section aria-label="Next signal" className="next-signal surface-glass">
      <span aria-hidden className="next-signal-lamp" data-state={signal.state} />
      <div className="min-w-0">
        <p className="next-signal-copy">{nextSignalCopy(signal)}</p>
        <p className="next-signal-name">
          {signal.name && <span className="truncate">{signal.name}</span>}
          <span className="next-signal-id">{signal.intersectionId}</span>
        </p>
      </div>
    </section>
  );
}
