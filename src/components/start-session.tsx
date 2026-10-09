"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const LENGTHS = [15, 30, 45] as const;

export function StartSession({ defaultMinutes, replace = false, compact = false }: { defaultMinutes: number; replace?: boolean; compact?: boolean }) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes, replace }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not plan a session");
      router.push(`/session/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "text-sm" : ""}`}>
        <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Session length">
          {LENGTHS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={minutes === m}
              onClick={() => setMinutes(m)}
              className={`rounded-md px-3 py-1.5 text-sm ${minutes === m ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-text"}`}
            >
              {m} min
            </button>
          ))}
        </div>
        <button className={compact ? "btn-ghost" : "btn-primary"} onClick={() => void start()} disabled={busy}>
          {busy ? "Planning your session…" : replace ? "Plan a new session" : "Start today's session"}
        </button>
      </div>
      {busy && <p className="text-xs text-muted">Choosing exercises from your mistakes and weakest concepts…</p>}
      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
