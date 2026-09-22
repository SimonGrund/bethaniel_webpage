# Paid-ad conversion tracking — progress

Plan: docs/superpowers/plans/2026-09-22-paid-ad-conversion-tracking.md
Branch: ad-conversion-tracking (from main @ 9e1b199)

## Decisions taken during execution
- Pre-flight: plan mandated the attribution snippet in 7 places (inline ×6 +
  a reference file). User chose to consolidate into js/track.js alone.
  Plan amended before Task 1. Reviewers should flag any inlined copy.
- Work happens on a feature branch, not main.

## Minor findings for the final review to triage
- T2 attribution.js: `click_platform` is the one field not passed through
  truncate(). Values come from the hardcoded CLICK_IDS map (max 9 chars), so
  harmless today; inconsistent with "truncate every string field".
- T2 attribution.js: `landing_path` falls back to "/" for any non-string,
  masking a caller bug rather than surfacing it. Callers are internal.

- T3 validate.js: coarsePlatform uses substring matching, so "Windows Phone"
  buckets as windows. Cosmetic mislabel; bucket set stays closed, no leak.
- T3 validate.js: attr[key] reads through the prototype chain rather than
  Object.hasOwn. Reviewer probed it: not exploitable, because every real
  caller's attr comes from JSON.parse (where __proto__ is an inert own key)
  or from decodeAttribution (which rebuilds into a fresh object).

## Task ledger
Task 1: complete (commits 277bedc..689cc5a, review clean — spec exact match, no Critical/Important)
Task 2: complete (commits 689cc5a..dd68a43, review clean after 1 Important fix — decodeAttribution now whitelists keys + truncates; verified the new test fails against pre-fix code)
Task 3: complete (commits dd68a43..57e97d7, review clean — spec exact match, 0 Critical/Important, 2 Minor logged)
Task 4: complete (commits 57e97d7..22a19e0, review clean — schema privacy verified column by column, insert column/value alignment verified 14:14)
