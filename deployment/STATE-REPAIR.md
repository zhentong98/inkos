# Hook state repair — 2026-09-25

The reducer previously retained longer obsolete notes instead of shorter new
facts, ignored optional metadata updates, and kept activated chapter-zero seeds
at zero. Dependency diagnostics then reported resolved legacy seeds as blocking.
The semantic validator also lacked the host's opaque hook-ID contract.

The repair applies current nonempty text updates, preserves omitted metadata,
accepts explicit empty dependencies and false flags, and keeps established
planting history while allowing unadvanced seeds to activate. Older advancement
records cannot replace newer records. Resolved upstream hooks clear dependency
gates only when their recorded chapters are not in the future. Missing and
unresolved dependencies remain blocking. Host IDs are not renamed; the validator
is instructed to accept numbered and descriptive IDs while continuing substantive
continuity checks. No manuscript or persisted story state is edited by this patch.

## Verification

- Six regression assertions failed on the original code while 24 passed.
- Focused tests passed after the fix (41 tests across five files).
- Full monorepo test command passed: core 1,870; Studio 583; CLI 233.
- Independent review identified an early-activation edge case for future planned
  seeds. An additional failing regression reproduced it; the corrected core suite
  passed all 1,871 tests across 195 files. Review recheck found no further issues.
- Full application build passed; core build passed again after the adjustment.
- Existing SQLite experimental and frontend chunk-size warnings remain.

## Deployment and acceptance

Before updating, confirm no active generation requests, back up data and existing
image selection, and retain the old image. Recreate only the Inkos app and reload
its dedicated Nginx origin if needed. Verify persisted file hashes and run the
offline regression against installed modules. Do not change model credentials,
global model configuration, audit thresholds, or other shared services.

Offline tests establish code behavior, not live model compliance or novel quality.
Inkos must still perform story settlement/revision and audit before continuation.
No unreviewed chapter is automatically published by this change.
