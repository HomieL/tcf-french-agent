import { redirect } from "next/navigation";
import { connection } from "next/server";

import { RangeBar } from "@/components/range-bar";
import { USER_ID } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getProfile } from "@/lib/services/profile";
import { getProgress } from "@/lib/services/progress";

const SKILL_LABEL = { listening: "Listening", speaking: "Speaking", reading: "Reading", writing: "Writing" } as const;
const PURPOSE_LABEL: Record<string, string> = {
  generate_exercises: "Exercise generation",
  analyze_response: "Response analysis",
  analyze_review: "Review analysis",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

const ms = (v: number | null) => (v === null ? "—" : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);

export default async function ProgressPage() {
  await connection();
  const db = await getDb();
  const profile = await getProfile(db, USER_ID);
  if (!profile) redirect("/onboarding");
  const p = await getProgress(db, USER_ID);
  const accuracy = p.activity.attempts ? `${Math.round((p.activity.correct / p.activity.attempts) * 100)}%` : "—";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Study days" value={p.activity.studyDays} />
        <Stat label="Sessions completed" value={p.activity.sessionsCompleted} />
        <Stat label="Graded attempts" value={p.activity.attempts} />
        <Stat label="Accuracy" value={accuracy} />
        <Stat label="Active errors" value={p.errors.active} />
        <Stat label="Recurring (2+)" value={p.errors.recurring} />
        <Stat label="Mastered errors" value={p.errors.mastered} />
        <Stat label="Reviews due" value={p.reviews.due} />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Skills</h2>
        {p.skills.map((s) => (
          <div key={s.skill} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 text-sm">
            <span>{SKILL_LABEL[s.skill]}</span>
            {s.measured && s.estimate ? (
              <RangeBar {...s.estimate} />
            ) : (
              <span className="text-xs text-muted">Not measured yet · self-rated {Math.round(profile.skillConfidence[s.skill] * 100)}%</span>
            )}
          </div>
        ))}
        <p className="text-xs text-muted">Mean with a 90% interval from a Beta-Bernoulli model per concept. These are practice estimates, not NCLC scores.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Concepts</h2>
        <div className="space-y-2">
          {p.concepts.map((c) => (
            <div key={c.key} className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-3" data-testid="concept-row">
              <span>
                {c.title} <span className="text-xs text-muted">{c.cefrLevel} · {c.evidence} obs.</span>
              </span>
              <RangeBar {...c.estimate} />
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">AI usage (last 30 days)</h2>
        {p.telemetry.length === 0 ? (
          <p className="text-sm text-muted">No model calls yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-normal">Step</th>
                  <th className="font-normal">Calls</th>
                  <th className="font-normal">Failed</th>
                  <th className="font-normal">p50</th>
                  <th className="font-normal">p95</th>
                  <th className="font-normal">Tokens in / out</th>
                  <th className="font-normal">Cost</th>
                  <th className="font-normal" title="Model claims discarded because they did not quote the learner's text">
                    Dropped claims
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {p.telemetry.map((t) => (
                  <tr key={t.purpose} className="border-t border-line" data-testid="telemetry-row">
                    <td className="py-1.5">
                      {PURPOSE_LABEL[t.purpose] ?? t.purpose}
                      <div className="text-xs text-muted">{t.providers.join(", ")}</div>
                    </td>
                    <td>{t.runs}</td>
                    <td>{t.failures}</td>
                    <td>{ms(t.p50LatencyMs)}</td>
                    <td>{ms(t.p95LatencyMs)}</td>
                    <td>
                      {t.inputTokens.toLocaleString()} / {t.outputTokens.toLocaleString()}
                    </td>
                    <td>${t.costUsd.toFixed(4)}</td>
                    <td>{t.unsupportedClaims}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
