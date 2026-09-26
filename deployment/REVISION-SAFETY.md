# Historical revision plan and length guards

Manual revisions previously generated a new chapter plan on every attempt and
could replace a saved chapter with an out-of-budget candidate despite an improved
audit. Repeated revisions could therefore chase a moving plan and lose length.

Historical plan reuse now requires provenance from a newly generated plan, with
matching preceding snapshot, canonical foundations/roles, preceding chapter body,
stable book settings and external instructions. A sidecar pairs the input hash
with both plan and intent artifact hashes. Missing, legacy, corrupt or mismatched
metadata causes a fresh plan. Operation-scoped skills bypass reuse and provenance
creation because they may hydrate additional references during the model call.
Later truth and later chapter bodies are excluded. Prior temporal guards remain.

All manual revision modes retain the original body when the candidate falls
outside the existing hard length budget. A length-only repair may pass the strict
gate only when it brings the body into budget without worsening any audit count.
Existing state validation and audit standards remain; warnings are not suppressed.

Regression tests cover retained body/index/state/history on length rejection,
strict length-only repair, repeated historical revisions, changed baselines and
instructions, temporary skills, and missing/torn/malformed cache artifacts. Test
fixtures use in-budget bodies for successful persistence cases. No real manuscript
or story state is edited by this patch.

Before rollout, verify no active requests, take the existing encrypted backup,
retain the prior image selection, hash book/config/cover files, and recreate only
the Inkos app. Verify unchanged protected files, installed revision and health.
Offline verification is not proof that a live model will produce a zero-warning
chapter. Continue only through Inkos native revision and audit, inspect actual
saved results, and do not loop paid retries without evidence of progress.
