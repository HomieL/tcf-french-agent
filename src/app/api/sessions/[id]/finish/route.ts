import { handle } from "@/lib/api";
import { finishSession } from "@/lib/services/sessions";

export async function POST(_req: Request, ctx: RouteContext<"/api/sessions/[id]/finish">) {
  const { id } = await ctx.params;
  return handle(({ db, userId }) => finishSession(db, userId, id));
}
