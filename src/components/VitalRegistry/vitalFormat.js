 // Formatting, name helpers and constants shared by all three registries.

export const FEE = 75;

export const STEPS = [
  { key: "select", label: "Select Record" },
  { key: "payment", label: "Review & Print" },
  { key: "releasing", label: "Releasing" },
];

export const OFFICE_CONFIG = {
  cityMunicipality: "this city/municipality",
  certifyingOfficer: { name: "EDDIE FLOR C. SILVA", title: "Acting City Gov't. Dept. Head I" },
  verifiedBy: { name: "FARRAH B. LARGO", title: "Administrative Assistant II" },
  amountPaid: "₱75.00",
};

export const formatDate = (d) => {
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
};

export const formatCertDate = (d) => {
  if (!d) return "";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit" });
};

export const formatTodayLong = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

export function toTitleCase(str) {
  if (!str) return "";
  return String(str).trim().replace(/\s+/g, " ").toLowerCase()
    .split(" ").filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function cleanNamePart(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function formatFullName(first, middle, last) {
  return [first, middle, last].map(cleanNamePart).filter(Boolean).map(toTitleCase).join(" ");
}

/** "First Middle Last" from parts, else the full name, else "". */
export function personName({ first, middle, last, full } = {}) {
  const fromParts = formatFullName(first, middle, last);
  if (fromParts) return fromParts;
  return full ? toTitleCase(full) : "";
}

export function normalizeDisplayName(filename) {
  return (filename || "").replace(/\.pdf$/i, "").replace(/[_]+/g, " ")
    .replace(/-+/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** Upper-case last name from a stored last-name field, else the last word of the full name. */
export function lastNameOf(last, full) {
  if (last) return cleanNamePart(last).toUpperCase();
  const parts = cleanNamePart(full).split(" ").filter(Boolean);
  return (parts[parts.length - 1] || "").toUpperCase();
}

/** Last name guessed from a file name ("Dela Cruz, Juan.pdf" or "juan_dela_cruz.pdf"). */
export function lastNameFromFileName(fileName) {
  const clean = (fileName || "").replace(/\.pdf$/i, "").trim();
  if (!clean) return "";
  if (clean.includes(",")) return clean.split(",")[0].trim().toUpperCase();
  const parts = clean.split(/[\s_]+/);
  return (parts[parts.length - 1] || "").toUpperCase();
}

export function firstNameOf(first, full) {
  const f = cleanNamePart(first);
  if (f) return f.toUpperCase();
  return (cleanNamePart(full).split(" ")[0] || "").toUpperCase();
}

/** First + middle name, used for the accuracy score. */
export function givenNamesOf(first, middle, full) {
  const f = cleanNamePart(first);
  const m = cleanNamePart(middle);
  if (f) return [f, m].filter(Boolean).join(" ");
  const parts = cleanNamePart(full).split(" ").filter(Boolean);
  if (parts.length > 1) return parts.slice(0, -1).join(" ");
  return parts[0] || "";
}

/** Every word in the query must equal a whole word in the haystack. */
export function matchesWords(haystack, query) {
  if (!query || !query.trim()) return true;
  const hay = String(haystack).toUpperCase().split(/\s+/).filter(Boolean);
  return query.trim().toUpperCase().split(/\s+/).filter(Boolean)
    .every((qw) => hay.includes(qw));
}

/** True when every query word matches a word in at least one of the names. */
export function matchesLastName(names, query) {
  const qWords = query.split(/\s+/).filter(Boolean);
  return names.some((n) => {
    const words = n.split(/\s+/).filter(Boolean);
    return qWords.every((qw) => words.includes(qw));
  });
}