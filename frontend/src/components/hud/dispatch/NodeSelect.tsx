import { MapPin } from "lucide-react";

type NodeSelectProps<T extends string> = {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
};

export function NodeSelect<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: NodeSelectProps<T>) {
  return (
    <div>
      <label htmlFor={id} className="dashboard-label">
        {label}
      </label>
      <div className="relative mt-2">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-3 pr-10 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
        >
          {options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <MapPin
          className="pointer-events-none absolute top-3 right-3 size-4 text-cyan-600 dark:text-cyan-300"
          aria-hidden
        />
      </div>
    </div>
  );
}
