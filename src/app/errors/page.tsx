import Link from "next/link";
import { connection } from "next/server";

import { USER_ID } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { listErrors } from "@/lib/services/error-library";

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "mastered", label: "Mastered" },
  { key: "all", label: "All" },
];

function when(d: Date | null) {
  if (!d) return "—";
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "due now";
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

export default async function ErrorsPage({ searchParams }: PageProps<"/errors">) {
  await connection();
  const sp = await searchParams;
  const filter = typeof sp.status === "string" && ["active", "mastered", "all"].includes(sp.status) ? sp.status : "active";
  const errors = await listErrors(await getDb(), USER_ID, filter === "all" ? {} : { status: filter });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Error library</h1>
        <p className="text-sm text-muted">Every mistake is linked to the attempt where it happened and scheduled for review. Three correct reviews in a row mark it mastered.</p>
      </div>
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/errors?status=${f.key}`} className={`chip px-3 py-1 text-sm ${filter === f.key ? "border-accent bg-accent-soft text-accent" : ""}`}>
            {f.label}
          </Link>
        ))}
      </div>
      {errors.length === 0 ? (
        <p className="card text-sm text-muted">No errors here yet.</p>
      ) : (
        <ul className="space-y-3">
          {errors.map((e) => (
            <li key={e.id} className="card space-y-2" data-testid="error-row">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="chip">{e.conceptTitle ?? "Other"}</span>
                <span className="chip">{e.category}</span>
                {e.status === "mastered" && <span className="chip border-good text-good">mastered</span>}
                <span className="ml-auto text-muted">
                  seen {e.failureCount}× · streak {e.successStreak} · next review {e.status === "mastered" ? "—" : when(e.nextReviewAt)}
                </span>
              </div>
              <p className="text-lg">
                <span className="text-bad line-through decoration-1">{e.original}</span> <span className="text-muted">→</span>{" "}
                <span className="font-medium text-good">{e.correction}</span>
              </p>
              {e.context && e.context !== e.original && (
                <p className="text-sm">
                  <span className="text-muted">In: </span>
                  {e.context}
                </p>
              )}
              <p className="text-sm text-muted">{e.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
