import { handle, readJson } from "@/lib/api";
import { planSession } from "@/lib/services/sessions";

export async function POST(req: Request) {
  const body = await readJson(req).catch(() => undefined);
  return handle(({ db, provider, userId }) => planSession(db, provider, userId, body));
}
