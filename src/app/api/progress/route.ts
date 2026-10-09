import { handle } from "@/lib/api";
import { getProgress } from "@/lib/services/progress";

export async function GET() {
  return handle(({ db, userId }) => getProgress(db, userId));
}
