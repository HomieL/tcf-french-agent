const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Mastery estimate drawn as an interval with a point marker, so uncertainty is always visible. */
export function RangeBar({ mean, low, high, label }: { mean: number; low: number; high: number; label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-label={label ? `${label}: ${pct(mean)} (range ${pct(low)} to ${pct(high)})` : undefined}>
      <div className="relative h-2 flex-1 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 rounded-full bg-accent-soft" style={{ left: pct(low), width: pct(Math.max(0.01, high - low)) }} />
        <div className="absolute -top-0.5 h-3 w-1 -translate-x-1/2 rounded-full bg-accent" style={{ left: pct(mean) }} />
      </div>
      <span className="w-28 shrink-0 text-right text-xs tabular-nums text-muted">
        <span className="font-medium text-text">{pct(mean)}</span> ({pct(low)}–{pct(high)})
      </span>
    </div>
  );
}
