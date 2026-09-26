# Settlement format failure recovery

## Problem and scope

A structured settlement parse failure previously fell through unconditionally to the legacy parser. Without usable legacy state and hook blocks, the parser supplied `(状态卡未更新)` and `(伏笔池未更新)` instead of carrying the format failure into recovery. A subsequent semantic validator received incomplete truth rather than the actual failure reason; unchanged truth could also short-circuit validation.

Offline synthetic fixtures reproduce missing-block, malformed-JSON and schema-invalid variants. The exact rejected native model response was not retained, so this change does not establish which variant caused that live rejection. The chapter text, book files, configuration and deployed service were not changed by this implementation.

## Design

- `SettlerDeltaParseError` exposes only one finite code: `missing_delta`, `invalid_json` or `invalid_schema`. No original parser/Zod message, cause, response payload or model-generated key is retained in the error.
- A usable legacy response still works when the structured block is absent or invalid. Both core legacy state and hook payloads must exist and be nonempty and nonsentinel. Explicit `none`, `No pending hooks.` and an empty hook table remain valid; a missing summary is not newly made a format error.
- If neither format is usable, the writer returns the unchanged chapter body and prior state/hooks with `settlementFormatFailure`. Unusable partial summary, optional truth and settlement prose are discarded. No additional call or retry occurs in the writer.
- `settlementFormatValidation` maps that marker to a fixed, localized failed validation result. It runs before model-based validation for regular truth persistence, manual revision, state repair, resync and the existing settlement retry. The existing `validationFeedback` carries the finite reason and correction instruction to the same one recovery attempt.
- A second format failure becomes the existing degraded outcome immediately. It cannot be accepted by an LLM validator, and there is no recursive retry. Valid recovered output still passes normal semantic validation.
- When automatic revision changes the body, `buildPersistenceOutput` validates the analyzer replacement with the same core state/hooks usability predicate. Unusable replacement truth preserves the prior failure code or receives `missing_delta`, even if the original writer output was unmarked. A usable, unmarked new analysis may replace the old failed settlement and still undergo normal semantic validation.
- `saveChapter` rejects marked output before directory creation or file writes. This also protects the direct `writeDraft` path, which has no existing validation/recovery stage; no paid recovery stage is added to drafts.
- Only explicit prior-truth restoration in `buildStateDegradedPersistenceOutput` clears an unresolved marker. For marked failures it also removes any partial optional truth/summary so these cannot be written alongside restored core truth. A newly generated valid settlement is a separate unmarked output.

Existing baseline snapshot requirements, hook policy, semantic/audit gates, length gates, historical structured-state persistence requirements and atomic persistence remain in force. In particular, accepting legacy settlement parsing does not relax the existing requirement for complete structured state when saving a historical revision.

## Verification

Runtime: Node 22.22.0, pnpm 10.34.5, restored checkout based on `09fadfbc`.

Environment initialization:

```sh
source /Users/chentong/.nvm/nvm.sh
nvm use 22
```

Red, before implementation:

```sh
node /Users/chentong/.cache/node/corepack/v1/pnpm/10.34.5/bin/pnpm.cjs --filter @actalk/inkos-core test src/__tests__/settlement-format-recovery.test.ts
```

Result: 10 expected failures. Evidence: `/private/tmp/inkos-settlement-red.log`.

Focused verification after implementation and caller regressions:

```sh
node /Users/chentong/.cache/node/corepack/v1/pnpm/10.34.5/bin/pnpm.cjs --filter @actalk/inkos-core test src/__tests__/settlement-format-recovery.test.ts src/__tests__/pipeline-runner.test.ts src/__tests__/writer.test.ts src/__tests__/settler-delta-parser.test.ts src/__tests__/chapter-state-recovery.test.ts src/__tests__/chapter-truth-validation.test.ts
node /Users/chentong/.cache/node/corepack/v1/pnpm/10.34.5/bin/pnpm.cjs --filter @actalk/inkos-core typecheck
```

Results: 130 tests passed across 6 files; typecheck passed. Logs: `/private/tmp/inkos-settlement-focused.log`, `/private/tmp/inkos-settlement-typecheck.log`. Node printed its existing experimental SQLite warning.

Coverage includes finite diagnostics without a synthetic private-response sentinel, public writer settlement without extra model attempts, sentinel-only legacy rejection, legitimate empty hook pools, preserved pre-existing valid legacy fallback, exactly one recovery, no semantic validator calls on known format failures, a prewrite persistence guard, safe degraded restoration, and native revision/resync/repair preserving chapter/truth/index/version state after a second failure. Model boundaries are stubbed; parser, writer, recovery, native orchestration and filesystem persistence are real.

## Risks and limits

- Finite codes deliberately sacrifice raw schema-error detail to avoid exposing response values. Recovery receives the existing schema prompt plus a safe format instruction; model compliance is not guaranteed.
- Direct draft save now fails closed on unusable settlement instead of risking placeholder truth. It adds no draft recovery calls.
- A partial legacy projection missing either core truth payload is no longer treated as usable. Explicit empty-hook representations remain accepted.
- This is an offline fix and focused verification, not evidence that the previously rejected native chapter now succeeds or has zero warnings. Independent review, broad verification, deployment and authorized live acceptance belong to the parent task.
- No provider retry policy or model-call limits were changed; the existing observer/settler recovery pair remains the only recovery attempt. Provider-level transport retry behavior is unchanged.


## Independent-review correction: replacement analysis

The initial review identified a marker-loss path when automatic revision changes the chapter body: the final analyzer output replaces the original writer output. The analyzer's legacy parser can return sentinel truth without a failure marker. Checking only the original settlement and recovery caller was therefore insufficient.

The correction checks replacement state/hooks before constructing final persistence output. It does not add analysis calls, validator calls or retries. Tests exercise changed body with (1) a marked original and malformed replacement, (2) an unmarked original and malformed replacement, and (3) a marked original and usable replacement. The semantic validator is deliberately permissive in all three cases. The malformed cases must enter exactly one existing recovery and persist recovered truth; the usable case must not trigger unnecessary recovery.

TDD evidence: `/private/tmp/inkos-settlement-replacement-red.log` records both malformed cases failing because recovery was incorrectly skipped; the valid replacement control passed. After the correction, `/private/tmp/inkos-settlement-replacement-green.log` records 133 tests passing across the same 6 focused files. `/private/tmp/inkos-settlement-replacement-typecheck.log` records a passing core typecheck. The original 130-test verification above predates this review correction.

## Schema-aware recovery follow-up

The live native revision on 2026-09-26 (request `a397d83f-7401-482d-b82a-d02f87fe732d`) ended without applying prose: both the normal path and bounded settlement recovery did not produce accepted state; final diagnostics report `invalid_schema`. Original chapters were preserved. Exact offending fields from that attempt were not retained; this is not evidence of a specific bad enum or field type.

The settlement prompt previously provided one example but not a complete input contract. The recovery message retained only a finite category, so it could not identify which field failed. The follow-up derives a JSON Schema directly from the existing Zod runtime-state schema and includes it as input guidance. `zod-to-json-schema` 3.25.2 was already in the dependency lockfile and is now an explicit core dependency. The acceptance schema itself is unchanged.

Schema failures now carry deduplicated diagnostics of the form `hookOps.upsert.*.status: invalid_enum_value`. Only paths derived from static schema properties and array items, plus fixed error codes, may leave parsing. Array positions become `*`; arbitrary record keys, raw error messages, received values and causes are excluded. Feedback revalidates these tokens and caps the result at 12. Diagnostics follow the existing format marker into the single settlement retry and are cleared on explicit restoration or valid replacement analysis. No retry or model-call budget is increased, and no provider configuration, authored content, story facts or acceptance threshold is modified.

Three regressions failed before this implementation: absent full contract, missing parser/writer/recovery field feedback, and absent bounded diagnostic sanitization. Focused verification passed 138 tests across seven files and core typecheck. Evidence is in `/private/tmp/inkos-schema-feedback-red.log`, `inkos-schema-feedback-focused.log`, and `inkos-schema-feedback-typecheck.log`. Full-suite/review/deployment evidence and native success remain separate acceptance steps; schema guidance cannot guarantee provider compliance.

Follow-up validation completed: root `pnpm test` passed 1,954 core tests (198 files), 590 Studio tests (59 files), and 233 CLI tests (42 files). Fresh independent review found no required corrections. Its optional coverage suggestion was applied: the cap fixture now creates more than 12 distinct allowed field failures and verifies truncation to 12; all 15 format-recovery tests passed again. Logs: `/private/tmp/inkos-schema-feedback-full.log`, `/private/tmp/inkos-schema-cap-check.log`. The post-review change affected that test fixture and this evidence note only.
