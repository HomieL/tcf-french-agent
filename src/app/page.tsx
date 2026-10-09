import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { RangeBar } from "@/components/range-bar";
import { StartSession } from "@/components/start-session";
import { USER_ID } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { listErrors } from "@/lib/services/error-library";
import { getProfile } from "@/lib/services/profile";
import { getProgress } from "@/lib/services/progress";
import { listDueReviews } from "@/lib/services/reviews";
import { getActiveSession, getSessionView, localDate } from "@/lib/services/sessions";

const SKILL_LABEL = { listening: "Listening", speaking: "Speaking", reading: "Reading", writing: "Writing" } as const;

export default async function Home() {
  await connection();
  const db = await getDb();
  const profile = await getProfile(db, USER_ID);
  if (!profile) redirect("/onboarding");

  const now = new Date();
  const active = await getActiveSession(db, USER_ID, now);
  const activeView = active ? await getSessionView(db, USER_ID, active.id) : null;
  const due = await listDueReviews(db, USER_ID, now, 1);
  const progress = await getProgress(db, USER_ID, now);
  const recurring = (await listErrors(db, USER_ID, { status: "active" })).slice(0, 3);

  const daysToExam = profile.examDate
    ? Math.round((new Date(`${profile.examDate}T00:00:00`).getTime() - new Date(`${localDate(now)}T00:00:00`).getTime()) / 86_400_000)
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bonjour, {profile.displayName}</h1>
        <p className="text-sm text-muted">
          Goal: NCLC {profile.targetNclc} in all four skills
          {daysToExam !== null && daysToExam >= 0 ? ` · TCF Canada in ${daysToExam} days` : ""} ·{" "}
          <Link href="/onboarding" className="underline">
            edit profile
          </Link>
        </p>
      </div>

      <section className="card space-y-4" data-testid="today">
        <h2 className="font-semibold">Today&apos;s session</h2>
        {activeView ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {activeView.plannedMinutes}-minute session in progress · {activeView.progress.done}/{activeView.progress.total} done
            </p>
            <Link href={`/session/${activeView.id}`} className="btn-primary">
              Resume session
            </Link>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Change length or start over</summary>
              <div className="mt-3">
                <StartSession defaultMinutes={activeView.plannedMinutes} replace compact />
              </div>
            </details>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">
              Built from your due reviews, recurring errors, and weakest concepts.
              {progress.activity.sessionsCompleted > 0 ? ` ${progress.activity.sessionsCompleted} session(s) completed so far.` : ""}
            </p>
            <StartSession defaultMinutes={profile.preferredSessionMinutes} />
          </>
        )}
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="font-semibold">Reviews due</h2>
          <p className="text-3xl font-semibold tabular-nums" data-testid="due-count">
            {due.totalDue}
          </p>
          <p className="text-sm text-muted">
            {due.totalDue > 0 ? "Past corrections ready for spaced review." : "Nothing due. Corrections come back the day after a mistake."}
          </p>
          {due.totalDue > 0 && (
            <Link href="/reviews" className="btn-ghost">
              Review now
            </Link>
          )}
        </section>

        <section className="card space-y-2">
          <h2 className="font-semibold">Most frequent errors</h2>
          {recurring.length === 0 ? (
            <p className="text-sm text-muted">No errors recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recurring.map((e) => (
                <li key={e.id}>
                  <span className="text-bad line-through">{e.original}</span> → <span className="text-good">{e.correction}</span>
                  <span className="ml-1 text-xs text-muted">×{e.failureCount}</span>
                  {e.context && e.context !== e.original && <p className="truncate text-xs text-muted">{e.context}</p>}
                </li>
              ))}
            </ul>
          )}
          <Link href="/errors" className="text-sm text-accent underline">
            Open error library
          </Link>
        </section>
      </div>

      <section className="card space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Skill estimates</h2>
          <Link href="/progress" className="text-sm text-accent underline">
            Details
          </Link>
        </div>
        {progress.skills.map((s) => (
          <div key={s.skill} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 text-sm">
            <span>{SKILL_LABEL[s.skill]}</span>
            {s.measured && s.estimate ? (
              <RangeBar {...s.estimate} label={SKILL_LABEL[s.skill]} />
            ) : (
              <span className="text-xs text-muted">
                Not measured yet (audio practice comes later) · self-rated {Math.round(profile.skillConfidence[s.skill] * 100)}%
              </span>
            )}
          </div>
        ))}
        <p className="text-xs text-muted">Ranges narrow as you practice. Estimates are not NCLC scores.</p>
      </section>
    </div>
  );
}
