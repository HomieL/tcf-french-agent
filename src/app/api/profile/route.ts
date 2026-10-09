import { handle, readJson } from "@/lib/api";
import { getProfile, upsertProfile } from "@/lib/services/profile";

export async function GET() {
  return handle(async ({ db, userId }) => ({ profile: await getProfile(db, userId) }));
}

export async function PUT(req: Request) {
  const body = await readJson(req).catch(() => undefined);
  return handle(async ({ db, userId }) => ({ profile: await upsertProfile(db, userId, body) }));
}
