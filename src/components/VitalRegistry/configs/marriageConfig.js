import {
  personName, lastNameOf, lastNameFromFileName, firstNameOf, normalizeDisplayName, cleanNamePart,
} from "../vitalFormat";
import { computeMarriageAccuracy } from "../../../utils/matchAccuracy";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const groom = (r) => ({
  first: r?.groom_first_name, middle: r?.groom_middle_name,
  last: r?.groom_last_name, full: r?.groom_full_name,
});
const bride = (r) => ({
  first: r?.bride_first_name, middle: r?.bride_middle_name,
  last: r?.bride_last_name, full: r?.bride_full_name,
});

const nameOf = (r) => {
  const g = personName(groom(r));
  const b = personName(bride(r));
  if (g && b) return `${g} & ${b}`;
  return g || b || normalizeDisplayName(r?.file_name || r?.original_file_name || "");
};

const parentsOf = (r) => [
  { text: personName(groom(r)), tone: "father" },   // groom shown in the first chip
  { text: personName(bride(r)), tone: "mother" },   // bride shown in the second chip
];

const lastNamesOf = (r) => {
  const stored = [r?.groom_last_name, r?.bride_last_name]
    .map(cleanNamePart).filter(Boolean).map((s) => s.toUpperCase());
  if (stored.length) return stored;
  const fromFull = [r?.groom_full_name, r?.bride_full_name]
    .map((full) => lastNameOf(null, full)).filter(Boolean);
  if (fromFull.length) return fromFull;
  const fromFile = lastNameFromFileName(r?.file_name);
  return fromFile ? [fromFile] : [];
};

const firstNamesOf = (r) => [
  firstNameOf(r?.groom_first_name, r?.groom_full_name),
  firstNameOf(r?.bride_first_name, r?.bride_full_name),
].filter(Boolean);

const searchPartsOf = (r) => [nameOf(r), ...parentsOf(r).map((p) => p.text || "")];

// First/last parts of one spouse, for the accuracy score.
function spouseParts(r, prefix) {
  const first = cleanNamePart(r?.[`${prefix}_first_name`]);
  const middle = cleanNamePart(r?.[`${prefix}_middle_name`]);
  const last = cleanNamePart(r?.[`${prefix}_last_name`]);
  if (first || last) {
    return { firstName: [first, middle].filter(Boolean).join(" "), lastName: last };
  }
  const parts = cleanNamePart(r?.[`${prefix}_full_name`]).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

const accuracyOf = (r, search) =>
  computeMarriageAccuracy(search, spouseParts(r, "groom"), spouseParts(r, "bride"));

// The spouse whose last name matched the search is the one shown on selection.
const subjectFor = (r, searchLast) => {
  const sLast = cleanNamePart(searchLast).toUpperCase();
  if (!sLast) return nameOf(r);
  const gl = cleanNamePart(r?.groom_last_name).toUpperCase();
  const bl = cleanNamePart(r?.bride_last_name).toUpperCase();
  if (gl && gl.split(/\s+/).includes(sLast)) return personName(groom(r)) || nameOf(r);
  if (bl && bl.split(/\s+/).includes(sLast)) return personName(bride(r)) || nameOf(r);
  return nameOf(r);
};

const transactionNames = (r) => ({
  groom_first_name: r?.groom_first_name || "",
  groom_middle_name: r?.groom_middle_name || "",
  groom_last_name: r?.groom_last_name || "",
  bride_first_name: r?.bride_first_name || "",
  bride_middle_name: r?.bride_middle_name || "",
  bride_last_name: r?.bride_last_name || "",
});

export const marriageConfig = {
  entity: "marriage",
  api: `${API_BASE}/api/marriage`,
  liveTables: ["marriage_records", "marriage_transactions"],

  copy: {
    registryTitle: "Marriage Registry",
    searchTitle: "Search & Select Marriage Record",
    archiveTitle: "Archived Marriage Records",
    pdfBadge: "Marriage Certificate",
    viewTitle: "View Marriage Certificate PDF",
    reviewPositive: "Review the Marriage Certificate below. Print the selected PDF before proceeding to release.",
    issuedPositive: "Certified True Copy of Marriage Certificate (Actual)",
    issuedNegative: "Certificate of No Marriage Record (Negative Certificate)",
    noParentInfo: "No groom/bride info recorded",
    parentsHeader: "Groom / Bride",
  },

  certificate: {
    title: "Certificate of No Marriage Record",
    noun: "marriage",
    Noun: "Marriage",
    eventVerb: "married",
    datePlaceholder: "DATE OF MARRIAGE",
    parentsPhrase: " from parents, ",
    afterParents: " hence, ",
    certificateName: "a true copy of his/her Certificate of Marriage",
    registerName: "Register of Marriages",
  },

  nameOf,
  parentsOf,
  searchPartsOf,
  lastNamesOf,
  firstNamesOf,
  accuracyOf,
  subjectFor,
  transactionNames,
};