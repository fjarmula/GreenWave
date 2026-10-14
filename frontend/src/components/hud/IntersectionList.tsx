import { Signal } from "lucide-react";

const intersections = [
  {
    id: "INT-302",
    street: "Aleje / Czarnowiejska",
    state: "CLEARING",
    ttiSeconds: 28,
    detail: "FORCE GREEN · 35s HOLD",
    accent: "emerald",
  },
  {
    id: "INT-303",
    street: "Aleje / Reymonta",
    state: "CLEARING",
    ttiSeconds: 38,
    detail: "CASCADE GROUP · 180 m",
    accent: "violet",
  },
] as const;

export function IntersectionList() {
  return (
    <section className="rounded-xl border border-border/80 bg-card/92 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="dashboard-eyebrow">Corridor monitoring</p>
          <h2 className="mt-1 text-sm font-semibold">
            Active corridor signals <span className="font-normal text-muted-foreground">(TTI)</span>
          </h2>
        </div>
        <Signal className="size-5 text-cyan-600 dark:text-cyan-300" aria-hidden />
      </div>

      <div className="mt-3 space-y-3">
        {intersections.map((intersection) => (
          <IntersectionCard key={intersection.id} {...intersection} />
        ))}
      </div>
    </section>
  );
}

type IntersectionCardProps = (typeof intersections)[number];

function IntersectionCard({
  id,
  street,
  state,
  ttiSeconds,
  detail,
  accent,
}: IntersectionCardProps) {
  const isCascade = accent === "violet";

  return (
    <article className="rounded-lg border border-border/70 bg-background/65 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <strong className="block font-mono text-xs">{id}</strong>
          <span className="mt-1 block text-[10px] text-muted-foreground">{street}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-[9px] font-bold ${
            isCascade
              ? "text-violet-600 dark:text-violet-300"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          <i className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
          {state}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono">
        <strong className="text-[11px] text-muted-foreground">
          TTI: <span className="text-foreground">{ttiSeconds}s</span>
        </strong>
        <span className="text-[9px] text-muted-foreground">{detail}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full rounded-full shadow-[0_0_8px_currentColor] ${
            isCascade ? "bg-violet-500 text-violet-500" : "bg-emerald-500 text-emerald-500"
          }`}
          style={{ width: `${Math.max(10, ttiSeconds * 2.5)}%` }}
        />
      </div>
    </article>
  );
}
