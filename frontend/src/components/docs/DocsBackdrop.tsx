import { crossStreets } from "@/lib/docs/backdrop";
import { corridor } from "@/lib/home-corridor";

const STREETS = crossStreets(corridor);

/** The home corridor in road ink: quiet texture behind the docs, never the signal colours. */
export function DocsBackdrop() {
  return (
    <div className="docs-backdrop" aria-hidden="true">
      <svg viewBox="860 140 400 740" preserveAspectRatio="xMaxYMin meet">
        <path className="docs-backdrop-street" d={STREETS} />
        <path className="docs-backdrop-route" d={corridor.route.path} />
        {corridor.signals.map((signal) => (
          <circle key={signal.id} cx={signal.x} cy={signal.y} r={3.4} />
        ))}
      </svg>
    </div>
  );
}
