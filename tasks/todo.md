- [x] Verify reported issue exists in `js/calculator.js` (delegating stubs still present).
- [x] Refactor `js/calculator.js` to call imported normalize helpers directly in:
  - `handleBlur`
  - `normalizeInput`
  - `convertUnits` options object
- [x] Remove obsolete pass-through class methods:
  - `parseDigitsToPace`
  - `parseDigitsToTime`
  - `normalizeTime`
  - `normalizeDistance`
  - `normalizePace`
  - `normalizeVelocity`
- [x] Verify no references to removed wrappers remain.
- [x] Run syntax/quality checks relevant to changed files.
- [x] Commit and push changes.

## Review

- Verified issue existed: six wrapper methods were present and only delegated to imported `normalize.js` helpers.
- Refactor completed: call sites now use imported helper functions directly and wrapper methods were removed.
- Regression guard:
  - `rg` search confirms no remaining references/definitions for removed wrappers in `js/calculator.js`.
  - `node --check` passed for `js/calculator.js`, `js/convert.js`, and `js/normalize.js`.
- Changes committed and pushed on branch `codex/refactor` (commit: `c503818`).
