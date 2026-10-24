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
        className="hud-switch tone-cascade"
      >
        <span />
      </button>
    </div>
  );
}
