#!/usr/bin/env node
// End-to-end HTTP smoke test of the learning loop. Usage: node scripts/smoke-api.mjs [baseUrl]
// Run against a server using a throwaway PGLITE_DIR: it creates a profile and practice data.
const BASE = process.argv[2] ?? "http://localhost:3100";
let failures = 0;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  if (!cond) failures++;
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start");
}

await waitForServer();
const health = await call("GET", "/api/health");
check("health", health.status === 200 && health.json.ok, health.json);
console.log(`      provider: ${health.json.provider} (${health.json.model})`);

check("plan requires onboarding", (await call("POST", "/api/sessions/plan", { minutes: 15 })).status === 400);
check("dashboard redirects to onboarding", (await fetch(`${BASE}/`, { redirect: "manual" })).status === 307);

const bad = await call("PUT", "/api/profile", { displayName: "" });
check("invalid profile rejected with field errors", bad.status === 400 && bad.json.details?.fieldErrors, bad.json);
const badJson = await fetch(`${BASE}/api/profile`, { method: "PUT", body: "{not json" });
check("malformed JSON rejected", badJson.status === 400);

const profile = await call("PUT", "/api/profile", {
  displayName: "Smoke",
  examDate: "2026-12-15",
  weeklyHours: 5,
  preferredSessionMinutes: 30,
  nativeLanguages: ["Mandarin", "English"],
  frenchExperience: "Evening classes",
  skillConfidence: { listening: 0.2, speaking: 0.1, reading: 0.4, writing: 0.3 },
});
check("profile created", profile.status === 200 && profile.json.profile.displayName === "Smoke", profile.json);

check("invalid session length rejected", (await call("POST", "/api/sessions/plan", { minutes: 20 })).status === 400);
const plan = await call("POST", "/api/sessions/plan", { minutes: 30 });
check("30-min session planned", plan.status === 200 && plan.json.blocks?.length >= 3, plan.json);
const session = plan.json;
check("no answers leaked to the client", !/acceptedAnswers|correctOption/.test(JSON.stringify(session)));
check("blocks sum to 30 minutes", session.blocks.reduce((a, b) => a + b.minutes, 0) === 30);

const today = await call("GET", "/api/sessions/today");
check("today returns the same session", today.json.session?.id === session.id);
const again = await call("POST", "/api/sessions/plan", { minutes: 45 });
check("re-planning resumes instead of duplicating", again.json.id === session.id);

const items = session.blocks.flatMap((b) => b.items).filter((i) => i.kind === "exercise");
const byType = (t) => items.find((i) => i.type === t);

// Empty answer → rejected, exercise stays open.
const first = items[0];
const empty = await call("POST", "/api/attempts", { exerciseId: first.id, response: " " });
check("empty answer rejected", empty.status === 200 && empty.json.status === "rejected", empty.json);

// Wrong answer on a drill item → error recorded.
const wrong = await call("POST", "/api/attempts", { exerciseId: first.id, response: "réponse fausse", latencyMs: 5000 });
check("wrong answer applied with feedback", wrong.json.status === "applied" && wrong.json.isCorrect === false, wrong.json);
check("expected answer revealed", Array.isArray(wrong.json.expectedAnswers) && wrong.json.expectedAnswers.length > 0, wrong.json);
const dup = await call("POST", "/api/attempts", { exerciseId: first.id, response: "x" });
check("resubmitting a completed exercise is a 409", dup.status === 409, dup.json);

const errs = await call("GET", "/api/errors");
check("error library has the mistake", errs.json.errors?.length === 1 && errs.json.errors[0].occurrences === 1, errs.json);

// Reading MCQ.
const mcq = byType("reading_mcq");
if (mcq) {
  const r = await call("POST", "/api/attempts", { exerciseId: mcq.id, response: "0" });
  check("reading MCQ graded deterministically", r.json.status === "applied" && r.json.evaluationSource === "deterministic", r.json);
}

// Writing with a known error pattern → self-correction flow.
const writing = byType("short_writing");
if (writing) {
  const min = writing.content.minWords;
  const shortResp = await call("POST", "/api/attempts", { exerciseId: writing.id, response: "Trop court." });
  check("too-short writing rejected", shortResp.json.status === "rejected" && shortResp.json.failedChecks[0]?.name === "min_words", shortResp.json);
  const filler = Array.from({ length: min }, () => "beaucoup").join(" ");
  const text = `Samedi, je suis travaillé au bureau. ${filler}.`;
  const w1 = await call("POST", "/api/attempts", { exerciseId: writing.id, response: text });
  check("writing: corrections withheld for self-correction", w1.json.canRevise === true && w1.json.errors[0]?.correction === null, w1.json);
  const w2 = await call("POST", "/api/attempts", { exerciseId: writing.id, response: text.replace("je suis travaillé", "j'ai travaillé"), parentAttemptId: w1.json.attemptId });
  check("writing: revision accepted and revealed", w2.json.isRevision === true && w2.json.revealed === true && w2.json.errors.length === 0, w2.json);
  const rev = await call("GET", `/api/attempts/${w1.json.attemptId}?reveal=1`);
  check("writing: original attempt corrections can be revealed", rev.json.errors[0]?.correction === "j'ai travaillé", rev.json);
}

// Reflection.
const refl = byType("reflection");
if (refl) {
  const r = await call("POST", "/api/attempts", { exerciseId: refl.id, response: "J'ai appris le passé composé." });
  check("reflection recorded", r.json.status === "recorded", r.json);
}

// Remaining exercises: answer correctly? We don't know answers client-side, so answer anything.
for (const it of items) {
  const s = await call("GET", `/api/sessions/${session.id}`);
  const cur = s.json.blocks.flatMap((b) => b.items).find((x) => x.id === it.id);
  if (cur.status === "completed") continue;
  const resp = cur.type === "reading_mcq" ? "1" : "Je ne sais pas.";
  const r = await call("POST", "/api/attempts", { exerciseId: it.id, response: resp });
  if (!["applied", "recorded"].includes(r.json.status)) check(`answer ${cur.type}`, false, r.json);
}
const done = await call("GET", `/api/sessions/${session.id}`);
check("session auto-completes when all items are done", done.json.status === "completed" && done.json.progress.done === done.json.progress.total, done.json.progress);

const due = await call("GET", "/api/reviews/due");
check("reviews not due yet (scheduled for tomorrow)", due.json.totalDue === 0, due.json);

const progress = await call("GET", "/api/progress");
check("progress: attempts counted", progress.json.activity.attempts > 0, progress.json.activity);
check("progress: writing skill measured with a range", progress.json.skills.find((s) => s.skill === "writing").estimate.low >= 0);
check("progress: speaking not measured", progress.json.skills.find((s) => s.skill === "speaking").measured === false);
check("progress: telemetry recorded", progress.json.telemetry.some((t) => t.purpose === "analyze_response" && t.runs > 0), progress.json.telemetry);

check("unknown session → 404", (await call("GET", `/api/sessions/${crypto.randomUUID()}`)).status === 404);
check("unknown review → 404", (await call("POST", `/api/reviews/${crypto.randomUUID()}/complete`, { response: "x" })).status === 404);

for (const page of ["/", "/onboarding", "/errors", "/errors?status=all", "/progress", "/reviews", `/session/${session.id}`]) {
  const r = await fetch(BASE + page);
  check(`page ${page} renders`, r.status === 200);
}
check("unknown session page → 404", (await fetch(`${BASE}/session/${crypto.randomUUID()}`)).status === 404);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
