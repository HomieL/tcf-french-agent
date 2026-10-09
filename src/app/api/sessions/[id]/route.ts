import { handle } from "@/lib/api";
import { getSessionView } from "@/lib/services/sessions";

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  return handle(({ db, userId }) => getSessionView(db, userId, id));
}
