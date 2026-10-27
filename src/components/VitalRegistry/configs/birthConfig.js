import {
  personName, lastNameOf, lastNameFromFileName, firstNameOf, givenNamesOf, normalizeDisplayName,
} from "../vitalFormat";
import { computeAccuracy } from "../../../utils/matchAccuracy";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const child = (r) => ({ first: r?.child_first_name, middle: r?.child_middle_name, last: r?.child_last_name, full: r?.child_full_name });
const father = (r) => ({ first: r?.father_first_name, middle: r?.father_middle_name, last: r?.father_last_name, full: r?.father_full_name });
const mother = (r) => ({ first: r?.mother_first_name, middle: r?.mother_middle_name, last: r?.mother_last_name, full: r?.mother_full_name });

const nameOf = (r) => personName(child(r)) || normalizeDisplayName(r?.file_name || "");
const parentsOf = (r) => [
  { text: personName(father(r)), tone: "father" },
  { text: personName(mother(r)), tone: "mother" },
];
const lastNamesOf = (r) => [
  lastNameOf(r?.child_last_name, r?.child_full_name) || lastNameFromFileName(r?.file_name),
];
const firstNamesOf = (r) => [firstNameOf(r?.child_first_name, r?.child_full_name)];
const searchPartsOf = (r) => [nameOf(r), ...parentsOf(r).map((p) => p.text || "")];

const accuracyOf = (r, search) => computeAccuracy(search, {
  lastName: lastNamesOf(r)[0],
  firstName: givenNamesOf(r?.child_first_name, r?.child_middle_name, r?.child_full_name),
});

const transactionNames = (r, first, last) => ({
  first_name: r?.child_first_name || first,
  middle_name: r?.child_middle_name || "",
  last_name: r?.child_last_name || last,
});

export const birthConfig = {
  entity: "birth",
  api: `${API_BASE}/api/birth`,
  liveTables: ["birth_records", "birth_payments"],

  copy: {
    registryTitle: "Birth Registry",
    searchTitle: "Search & Select Birth Record",
    archiveTitle: "Archived Birth Records",
    pdfBadge: "Live Birth Certificate",
    viewTitle: "View Live Birth PDF",
    reviewPositive: "Review the Live Birth Certificate below. Print the selected PDF before proceeding to release.",
    issuedPositive: "Certified True Copy of Birth Certificate (Actual)",
    issuedNegative: "Certificate of No Birth Record (Negative Certificate)",
    noParentInfo: "No parent info recorded",
    parentsHeader: "Father / Mother",
  },

  certificate: {
    title: "Certificate of No Birth Record",
    noun: "birth",
    Noun: "Birth",
    eventVerb: "born",
    datePlaceholder: "DATE OF BIRTH",
    parentsPhrase: " from parents, ",
    afterParents: " hence, ",
    certificateName: "a true copy of his/her Certificate of Live Birth",
    registerName: "Register of Births",
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