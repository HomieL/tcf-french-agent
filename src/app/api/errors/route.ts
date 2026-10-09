import type { NextRequest } from "next/server";

import { handle } from "@/lib/api";
import { listErrors } from "@/lib/services/error-library";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const concept = req.nextUrl.searchParams.get("concept") ?? undefined;
  return handle(async ({ db, userId }) => ({ errors: await listErrors(db, userId, { status, concept }) }));
}
