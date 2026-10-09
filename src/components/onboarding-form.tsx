"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProfileInput } from "@/lib/services/profile";

const SKILLS = [
  { key: "listening", label: "Listening" },
  { key: "speaking", label: "Speaking" },
  { key: "reading", label: "Reading" },
  { key: "writing", label: "Writing" },
] as const;

function confidenceLabel(v: number) {
  if (v < 0.2) return "Beginner";
  if (v < 0.45) return "Getting there";
  if (v < 0.7) return "Comfortable";
  return "Strong";
}

export function OnboardingForm({ initial }: { initial: ProfileInput | null }) {
  const router = useRouter();
  const [form, setForm] = useState<ProfileInput>(
    initial ?? {
      displayName: "",
      examDate: null,
      weeklyHours: 5,
      preferredSessionMinutes: 30,
      nativeLanguages: [],
      frenchExperience: "",
      skillConfidence: { listening: 0.2, speaking: 0.15, reading: 0.3, writing: 0.2 },
    },
  );
  const [languages, setLanguages] = useState((initial?.nativeLanguages ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...form, nativeLanguages: languages.split(",").map((s) => s.trim()).filter(Boolean) };
    const res = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      router.push("/");
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    const fields = data.details?.fieldErrors ? Object.keys(data.details.fieldErrors).join(", ") : "";
    setError(`${data.error ?? "Could not save"}${fields ? `: check ${fields}` : ""}`);
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="card space-y-5">
      <div>
        <label className="label" htmlFor="name">
          Name
        </label>
        <input id="name" className="input" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} required maxLength={60} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="exam">
            TCF Canada exam date <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="exam" type="date" className="input" value={form.examDate ?? ""} onChange={(e) => set("examDate", e.target.value || null)} />
        </div>
        <div>
          <label className="label" htmlFor="hours">
            Study hours per week
          </label>
          <input
            id="hours"
            type="number"
            min={1}
            max={40}
            className="input"
            value={form.weeklyHours}
            onChange={(e) => set("weeklyHours", Number(e.target.value))}
          />
        </div>
      </div>

      <div>
        <span className="label">Preferred session length</span>
        <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Preferred session length">
          {([15, 30, 45] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={form.preferredSessionMinutes === m}
              onClick={() => set("preferredSessionMinutes", m)}
              className={`rounded-md px-3 py-1.5 text-sm ${form.preferredSessionMinutes === m ? "bg-accent-soft font-medium text-accent" : "text-muted"}`}
            >
              {m} min
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="langs">
          Native and working languages
        </label>
        <input id="langs" className="input" placeholder="e.g. Mandarin, English" value={languages} onChange={(e) => setLanguages(e.target.value)} required />
        <p className="mt-1 text-xs text-muted">Comma-separated. Used to anticipate typical transfer errors.</p>
      </div>

      <div>
        <label className="label" htmlFor="exp">
          French experience
        </label>
        <textarea
          id="exp"
          className="input"
          rows={2}
          maxLength={500}
          placeholder="e.g. One year of evening classes, some Duolingo"
          value={form.frenchExperience}
          onChange={(e) => set("frenchExperience", e.target.value)}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="label">How confident are you in each skill?</legend>
        {SKILLS.map((s) => (
          <div key={s.key} className="grid grid-cols-[6rem_1fr_7rem] items-center gap-3 text-sm">
            <label htmlFor={`conf-${s.key}`}>{s.label}</label>
            <input
              id={`conf-${s.key}`}
              type="range"
              min={0}
              max={100}
              value={Math.round(form.skillConfidence[s.key] * 100)}
              onChange={(e) => set("skillConfidence", { ...form.skillConfidence, [s.key]: Number(e.target.value) / 100 })}
              className="accent-[var(--accent)]"
            />
            <span className="text-muted">{confidenceLabel(form.skillConfidence[s.key])}</span>
          </div>
        ))}
      </fieldset>

      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Saving…" : initial ? "Save profile" : "Create my profile"}
      </button>
    </form>
  );
}
