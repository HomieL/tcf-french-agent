import { handle } from "@/lib/api";
import { listDueReviews } from "@/lib/services/reviews";

export async function GET() {
  return handle(({ db, userId }) => listDueReviews(db, userId));
}
