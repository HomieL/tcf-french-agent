import { notFound } from "next/navigation";
import { connection } from "next/server";

import { SessionRunner } from "@/components/session-runner";
import { USER_ID } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { getSessionView } from "@/lib/services/sessions";

export default async function SessionPage({ params }: PageProps<"/session/[id]">) {
  await connection();
  const { id } = await params;
  const db = await getDb();
  const view = await getSessionView(db, USER_ID, id).catch((err) => {
    if (err instanceof NotFoundError) return null;
    throw err;
  });
  if (!view) notFound();
  return <SessionRunner initial={view} />;
}
