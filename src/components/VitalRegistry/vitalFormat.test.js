import { describe, it, expect } from "vitest";
import {
  toTitleCase,
  personName,
  lastNameFromFileName,
  matchesWords,
  matchesLastName,
} from "./vitalFormat";

describe("name helpers", () => {
  it("title-cases and collapses whitespace", () => {
    expect(toTitleCase("  maria   santos ")).toBe("Maria Santos");
  });

  it("builds a person name from parts", () => {
    expect(personName({ first: "juan", last: "cruz" })).toBe("Juan Cruz");
  });

  it("reads the last name from a comma-style file name", () => {
    expect(lastNameFromFileName("Dela Cruz, Juan.pdf")).toBe("DELA CRUZ");
  });

  it("reads the last name from an underscore-style file name", () => {
    expect(lastNameFromFileName("juan_dela_cruz.pdf")).toBe("CRUZ");
  });
});

describe("search matching", () => {
  it("requires every query word to match a whole word", () => {
    expect(matchesWords("JUAN DELA CRUZ", "cruz juan")).toBe(true);
    expect(matchesWords("JUAN DELA CRUZ", "cruz pedro")).toBe(false);
  });

  it("matches a last-name query against any name", () => {
    expect(matchesLastName(["DELA CRUZ", "SANTOS"], "CRUZ")).toBe(true);
    expect(matchesLastName(["SANTOS"], "CRUZ")).toBe(false);
  });
});
