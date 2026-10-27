// Normalize: lowercase, strip accents/punctuation, collapse spaces
const normalize = (s = "") =>
  s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();


const wordSimilarity = (a, b) => {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
};


const fieldSimilarity = (searched, recordValue) => {
  const q = normalize(searched).split(" ").filter(Boolean);
  const r = normalize(recordValue).split(" ").filter(Boolean);
  if (!q.length || !r.length) return 0;

  // Each searched word is matched to its best record word
  const avg =
    q.reduce(
      (sum, w) => sum + Math.max(...r.map((rw) => wordSimilarity(w, rw))),
      0
    ) / q.length;

  // Small penalty for record words the user didn't search (e.g. extra middle name)
  const extra = Math.max(0, r.length - q.length);
  const penalty = Math.min(0.15, extra * 0.05);

  return Math.max(0, avg - penalty);
};

/**
 * Returns an accuracy percentage (0-100).
 * Empty search fields are ignored, so searching by last name only still works.
 */
export const computeAccuracy = (search, record) => {
  const parts = [];
  if (search.lastName?.trim())
    parts.push({ w: 0.5, s: fieldSimilarity(search.lastName, record.lastName) });
  if (search.firstName?.trim())
    parts.push({ w: 0.5, s: fieldSimilarity(search.firstName, record.firstName) });
  if (!parts.length) return 0;

  const totalW = parts.reduce((a, p) => a + p.w, 0);
  return Math.round((parts.reduce((a, p) => a + p.w * p.s, 0) / totalW) * 100);
};

// Marriage: a record has a groom and a bride. Score the better-matching party.
export const computeMarriageAccuracy = (search, groom, bride) =>
  Math.max(computeAccuracy(search, groom), computeAccuracy(search, bride));