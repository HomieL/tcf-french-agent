import { ReviewQueue } from "@/components/review-queue";

export default function ReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted">Each card is a sentence you got wrong before. Correct answers push the next review further out.</p>
      </div>
      <ReviewQueue />
    </div>
  );
}
