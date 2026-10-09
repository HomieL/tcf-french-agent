import { handle, readJson } from "@/lib/api";
import { submitExerciseAttempt } from "@/lib/services/attempts";

export async function POST(req: Request) {
  const body = await readJson(req).catch(() => undefined);
  return handle(({ db, provider, userId }) => submitExerciseAttempt(db, provider, userId, body));
}
