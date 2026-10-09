import { handle } from "@/lib/api";
import { getActiveSession, getSessionView } from "@/lib/services/sessions";

export async function GET() {
  return handle(async ({ db, userId }) => {
    const active = await getActiveSession(db, userId, new Date());
    return { session: active ? await getSessionView(db, userId, active.id) : null };
  });
}
