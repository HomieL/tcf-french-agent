import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";

/**
 * FSRS memory scheduling for review items. Kept separate from mastery: mastery says whether a
 * concept is understood; the card says when this specific correction is likely to be forgotten.
 */
const scheduler = fsrs({ enable_fuzz: false });

export type SerializedCard = Record<string, unknown>;

/**
 * First review the day after the mistake: re-testing a correction seconds after seeing it proves
 * little. Overridable with FIRST_REVIEW_DELAY_HOURS (e.g. 0 for end-to-end tests).
 */
export function firstReviewDelayMs(): number {
  const raw = process.env.FIRST_REVIEW_DELAY_HOURS;
  const hours = raw === undefined || raw === "" ? NaN : Number(raw);
  return (Number.isFinite(hours) && hours >= 0 ? hours : 20) * 60 * 60 * 1000;
}

export function newCard(now: Date, delayMs = firstReviewDelayMs()): { card: SerializedCard; due: Date } {
  const card = createEmptyCard(now);
  card.due = new Date(now.getTime() + delayMs);
  return { card: serialize(card), due: card.due };
}

export function gradeCard(
  serialized: SerializedCard,
  correct: boolean,
  now: Date,
): { card: SerializedCard; due: Date; rating: Grade; reps: number; lapses: number } {
  const rating: Grade = correct ? Rating.Good : Rating.Again;
  const { card } = scheduler.next(deserialize(serialized), now, rating);
  return { card: serialize(card), due: card.due, rating, reps: card.reps, lapses: card.lapses };
}

function serialize(card: Card): SerializedCard {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

function deserialize(s: SerializedCard): Card {
  return {
    ...(s as unknown as Card),
    due: new Date(s.due as string),
    last_review: s.last_review ? new Date(s.last_review as string) : undefined,
  };
}
