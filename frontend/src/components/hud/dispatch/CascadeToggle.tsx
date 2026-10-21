type CascadeToggleProps = {
  enabled: boolean;
  onToggle: () => void;
  /** Cascade is part of ER Green Wave; it has no effect while Green Wave is disabled. */
  disabled?: boolean;
};

export function CascadeToggle({ enabled, onToggle, disabled = false }: CascadeToggleProps) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">Cascade corridor mode</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {disabled
            ? "Only applies when ER Green Wave is enabled"
            : "Group nearby signals within 250 m"}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Cascade corridor mode"
        disabled={disabled}
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/70 disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? "bg-violet-500" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
