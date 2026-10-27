import {
  personName, toTitleCase, lastNameOf, lastNameFromFileName, firstNameOf, givenNamesOf,
  normalizeDisplayName,
} from "../vitalFormat";
import { computeAccuracy } from "../../../utils/matchAccuracy";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const deceased = (r) => ({
  first: r?.deceased_first_name, middle: r?.deceased_middle_name,
  last: r?.deceased_last_name, full: r?.deceased_full_name,
});

const nameOf = (r) => personName(deceased(r)) || normalizeDisplayName(r?.file_name || "");

// Death records store parents as single strings, not split name parts.
const parentsOf = (r) => [
  { text: toTitleCase(r?.father_name), tone: "father" },
  { text: toTitleCase(r?.mother_name), tone: "mother" },
];
const lastNamesOf = (r) => [
  lastNameOf(r?.deceased_last_name, r?.deceased_full_name) || lastNameFromFileName(r?.file_name),
];
const firstNamesOf = (r) => [firstNameOf(r?.deceased_first_name, r?.deceased_full_name)];
const searchPartsOf = (r) => [nameOf(r), ...parentsOf(r).map((p) => p.text || "")];

const accuracyOf = (r, search) => computeAccuracy(search, {
  lastName: lastNamesOf(r)[0],
  firstName: givenNamesOf(r?.deceased_first_name, r?.deceased_middle_name, r?.deceased_full_name),
});

const transactionNames = (r, first, last) => ({
  first_name: r?.deceased_first_name || first,
  middle_name: r?.deceased_middle_name || "",
  last_name: r?.deceased_last_name || last,
});

export const deathConfig = {
  entity: "death",
  api: `${API_BASE}/api/death`,
  liveTables: ["death_records", "death_transactions"],

  copy: {
    registryTitle: "Death Registry",
    searchTitle: "Search & Select Death Record",
    archiveTitle: "Archived Death Records",
    pdfBadge: "Death Certificate",
    viewTitle: "View Death PDF",
    reviewPositive: "Review the Death Certificate below. Print the selected PDF before proceeding to release.",
    issuedPositive: "Certified True Copy of Death Certificate (Actual)",
    issuedNegative: "Certificate of No Death Record (Negative Certificate)",
    noParentInfo: "No parent info recorded",
    parentsHeader: "Father / Mother",
  },

  certificate: {
    title: "Certificate of No Death Record",
    noun: "death",
    Noun: "Death",
    eventVerb: "died",
    datePlaceholder: "DATE OF DEATH",
    parentsPhrase: ", child of ",
    afterParents: ", hence, ",
    certificateName: "a true copy of his/her Certificate of Death",
    registerName: "Register of Deaths",
  },

  nameOf,
  parentsOf,
  searchPartsOf,
  lastNamesOf,
  firstNamesOf,
  accuracyOf,
  subjectFor: (r) => nameOf(r),
  transactionNames,
};