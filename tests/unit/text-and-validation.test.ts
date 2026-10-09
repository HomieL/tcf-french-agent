import { describe, expect, it } from "vitest";

import type { ExerciseContent } from "@/lib/domain/exercise";
import {
  containsFragment,
  countWords,
  errorFingerprint,
  normalizeAnswer,
  replaceFragment,
  sentenceContaining,
} from "@/lib/domain/text";
import { matchAcceptedAnswer, validateResponse } from "@/lib/domain/validation";

describe("normalizeAnswer", () => {
  it("ignores case, curly apostrophes, spacing before punctuation and trailing punctuation", () => {
    expect(normalizeAnswer("  J’ai  travaillé ! ")).toBe("j'ai travaillé");
    expect(normalizeAnswer("Où est la gare ?")).toBe(normalizeAnswer("où est la gare?"));
    expect(normalizeAnswer("J' ai")).toBe("j'ai");
  });
  it("keeps accents, which are meaningful in French", () => {
    expect(normalizeAnswer("ou")).not.toBe(normalizeAnswer("où"));
  });
});

describe("countWords", () => {
  it("counts elided forms as two words", () => {
    expect(countWords("J'ai mangé une pomme.")).toBe(5);
    expect(countWords("   ")).toBe(0);
    expect(countWords("Bonjour — ça va ?")).toBe(3);
  });
});

describe("fragments", () => {
  it("finds fragments case- and apostrophe-insensitively", () => {
    expect(containsFragment("Hier, je suis travaillé.", "Je suis travaillé")).toBe(true);
    expect(containsFragment("J’ai faim", "j'ai")).toBe(true);
    expect(containsFragment("Bonjour", "")).toBe(false);
    expect(containsFragment("Bonjour", "au revoir")).toBe(false);
  });
  it("extracts the sentence containing a fragment and replaces it", () => {
    const text = "Samedi, je suis allé au parc. Je suis mangé une glace. C'était bien.";
    const sentence = sentenceContaining(text, "je suis mangé");
    expect(sentence).toBe("Je suis mangé une glace.");
    expect(replaceFragment(sentence, "je suis mangé", "j'ai mangé")).toBe("j'ai mangé une glace.");
  });
  it("fingerprints errors by concept and normalized fragments", () => {
    expect(errorFingerprint("pc_auxiliary", "Je suis travaillé", "J'ai travaillé")).toBe(
      errorFingerprint("pc_auxiliary", "je suis travaillé.", "j’ai travaillé"),
    );
    expect(errorFingerprint(null, "a", "b")).toMatch(/^other::/);
  });
});

const fill: ExerciseContent = {
  type: "fill_blank",
  instructions: "Complétez.",
  prompt: "Hier, nous ___ (aller) au cinéma.",
  acceptedAnswers: ["sommes allés", "sommes allées"],
};
const writing: ExerciseContent = {
  type: "short_writing",
  instructions: "Écrivez.",
  prompt: "Racontez.",
  minWords: 5,
  maxWords: 10,
  requiredElements: [],
};

describe("validateResponse", () => {
  it("blocks empty responses", () => {
    const v = validateResponse(fill, "   ");
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name === "non_empty")?.passed).toBe(false);
  });
  it("blocks writing below the minimum and only warns above the maximum", () => {
    expect(validateResponse(writing, "Trop court.").ok).toBe(false);
    const long = validateResponse(writing, "un deux trois quatre cinq six sept huit neuf dix onze douze");
    expect(long.ok).toBe(true);
    expect(long.checks.find((c) => c.name === "max_words")?.passed).toBe(false);
  });
  it("requires a valid option index for reading MCQs", () => {
    const mcq: ExerciseContent = { type: "reading_mcq", instructions: "", prompt: "Q?", passage: "P", options: ["a", "b"], correctOption: 1 };
    expect(validateResponse(mcq, "1").ok).toBe(true);
    expect(validateResponse(mcq, "2").ok).toBe(false);
    expect(validateResponse(mcq, "abc").ok).toBe(false);
  });
  it("requires a short sentence for reflections", () => {
    const r: ExerciseContent = { type: "reflection", instructions: "", prompt: "?" };
    expect(validateResponse(r, "ok").ok).toBe(false);
    expect(validateResponse(r, "J'ai appris beaucoup.").ok).toBe(true);
  });
});

describe("matchAcceptedAnswer", () => {
  it("matches the missing words or the full sentence", () => {
    expect(matchAcceptedAnswer(fill, "Sommes allées")).toBe("exact");
    expect(matchAcceptedAnswer(fill, "Hier, nous sommes allés (aller) au cinéma.")).toBe("exact");
  });
  it("distinguishes accent-only mistakes from wrong answers", () => {
    expect(matchAcceptedAnswer(fill, "sommes alles")).toBe("accent_only");
    expect(matchAcceptedAnswer(fill, "avons allé")).toBe("none");
  });
});
