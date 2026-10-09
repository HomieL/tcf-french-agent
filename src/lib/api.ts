import { getDb, type Db } from "@/lib/db/client";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { getProvider, type LlmProvider } from "@/lib/llm";

/** Single-learner MVP: every request acts as this user. All queries are still scoped by user id. */
export const USER_ID = process.env.LOCAL_USER_ID || "local-user";

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("Request body must be valid JSON");
  }
}

/** Run a handler with the db and provider, mapping domain errors to HTTP status codes. */
export async function handle(fn: (ctx: { db: Db; provider: LlmProvider; userId: string }) => Promise<unknown>, status = 200) {
  try {
    const db = await getDb();
    return Response.json(await fn({ db, provider: getProvider(), userId: USER_ID }), { status });
  } catch (err) {
    if (err instanceof BadRequestError) return Response.json({ error: err.message, details: err.details ?? null }, { status: 400 });
    if (err instanceof NotFoundError || err instanceof ConflictError) return Response.json({ error: err.message }, { status: err.status });
    console.error(err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
