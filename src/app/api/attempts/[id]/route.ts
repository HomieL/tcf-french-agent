import type { NextRequest } from "next/server";

import { handle } from "@/lib/api";
import { getAttemptFeedback } from "@/lib/services/attempts";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/attempts/[id]">) {
  const { id } = await ctx.params;
  const reveal = req.nextUrl.searchParams.get("reveal") === "1";
  return handle(({ db, userId }) => getAttemptFeedback(db, userId, id, reveal));
}
