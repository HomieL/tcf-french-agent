import { handle, readJson } from "@/lib/api";
import { completeReview } from "@/lib/services/reviews";

export async function POST(req: Request, ctx: RouteContext<"/api/reviews/[id]/complete">) {
  const { id } = await ctx.params;
  const body = await readJson(req).catch(() => undefined);
  return handle(({ db, provider, userId }) => completeReview(db, provider, userId, id, body));
}
