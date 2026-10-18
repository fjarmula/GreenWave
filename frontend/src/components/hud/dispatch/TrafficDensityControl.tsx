type TrafficDensityControlProps = {
  value: number;
  onChange: (value: number) => void;
};

export function TrafficDensityControl({ value, onChange }: TrafficDensityControlProps) {
  return (
    <>
      <div className="mt-5 flex items-center justify-between gap-3">
        <label htmlFor="traffic-density" className="dashboard-label">
          Traffic density multiplier
        </label>
        <output
          htmlFor="traffic-density"
          className="font-mono text-base font-bold text-cyan-600 dark:text-cyan-300"
        >
          {value.toFixed(1)}x
        </output>
      </div>
      <input
        id="traffic-density"
        type="range"
        min="1"
        max="3"
        step="0.1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 w-full accent-cyan-500"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>1.0x normal</span>
        <span>3.0x peak</span>
      </div>
    </>
  );
}
