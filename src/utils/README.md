# Utils

Pure helpers. No React, no network calls.

- `pdfUtils.js`: the only place PDF decoding, validation, blob URLs, and printing live. Replaces the old copies in the verifier pages and offline modules.
- `fetchJsonWithRetry.js`: JSON fetch with a short retry. Lives in `src/utils/`, not in a page.
- `matchAccuracy.js`: name-match scoring (`computeAccuracy`, `computeMarriageAccuracy`).
- `bulkDelete.js`: batch delete with per-record results.
- `demographics.js`, `displayPrefs.js`: formatting and user display preferences.

## Rule
- Add a unit test in `src/utils/<name>.test.js` for every new util.
