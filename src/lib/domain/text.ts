/** Normalize a French answer for comparison. Accents are kept: they are meaningful in French. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[’‘`´]/g, "'")
    .replace(/[  ]/g, " ")
    .replace(/[«»“”]/g, '"')
    .toLowerCase()
    .replace(/\s+([?!:;,.])/g, "$1")
    .replace(/\s*'\s*/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").normalize("NFC");
}

/** French-aware word count: elided forms (j'ai, l'eau) count as two words, as in exam conventions. */
export function countWords(s: string): number {
  return s
    .replace(/[’']/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Case/apostrophe/whitespace-insensitive substring test used to verify the model quotes the learner. */
export function containsFragment(haystack: string, fragment: string): boolean {
  const norm = (x: string) =>
    x.normalize("NFC").replace(/[’‘]/g, "'").replace(/[  \s]+/g, " ").toLowerCase().trim();
  const f = norm(fragment);
  return f.length > 0 && norm(haystack).includes(f);
}

/** Return the sentence of `text` that contains `fragment`, or the fragment itself if not found. */
export function sentenceContaining(text: string, fragment: string): string {
  const sentences = text.match(/[^.!?\n]+[.!?]*/g) ?? [text];
  const hit = sentences.find((s) => containsFragment(s, fragment));
  return (hit ?? fragment).trim();
}

/** Replace the first case-insensitive occurrence of `fragment` in `text`. */
export function replaceFragment(text: string, fragment: string, replacement: string): string {
  const unify = (x: string) => x.replace(/[’‘]/g, "'");
  const idx = unify(text).toLowerCase().indexOf(unify(fragment).toLowerCase().trim());
  if (idx < 0) return replacement;
  return text.slice(0, idx) + replacement + text.slice(idx + fragment.trim().length);
}

export function errorFingerprint(conceptKey: string | null, original: string, correction: string): string {
  return `${conceptKey ?? "other"}::${normalizeAnswer(original)}=>${normalizeAnswer(correction)}`;
}
