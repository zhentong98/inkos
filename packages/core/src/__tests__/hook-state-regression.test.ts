import { describe, expect, it } from "vitest";
import { RuntimeStateDeltaSchema, type HookRecord } from "../models/runtime-state.js";
import { applyRuntimeStateDelta } from "../state/state-reducer.js";
import { computeHookDiagnostics, renderHookDiagnosticMarker } from "../utils/hook-stale-detection.js";

const original: HookRecord = {
  hookId: "H003", startChapter: 0, type: "mystery", status: "progressing",
  lastAdvancedChapter: 1, expectedPayoff: "Identify the source of the blue paint.",
  notes: "The source remains unknown; the paint has not yet been traced to any location.",
  dependsOn: ["H001"], coreHook: true, halfLifeChapters: 20,
};

function update(incoming: Partial<HookRecord>, existing: HookRecord = original) {
  return applyRuntimeStateDelta({
    snapshot: {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 1, projectionVersion: 1, migrationWarnings: [] },
      currentState: { chapter: 1, facts: [] },
      hooks: { hooks: [existing] }, chapterSummaries: { rows: [] },
    },
    delta: RuntimeStateDeltaSchema.parse({ chapter: 2, hookOps: {
      upsert: [{ hookId: "H003", startChapter: 0, type: "mystery", status: "progressing",
        lastAdvancedChapter: 2, ...incoming }],
    } }),
  }).hooks.hooks[0]!;
}

describe("hook state settlement regressions", () => {
  it("retains shorter new facts instead of longer obsolete notes", () => {
    const result = update({ notes: "Paint came from the lighthouse rail.", expectedPayoff: "Source identified.", status: "resolved" });
    expect(result.notes).toBe("Paint came from the lighthouse rail.");
    expect(result.expectedPayoff).toBe("Source identified.");
    expect(result.status).toBe("resolved");
    expect(original.notes).toContain("remains unknown");
  });

  it("applies explicit dependency clearing and false optional metadata", () => {
    const result = update({ dependsOn: [], coreHook: false, halfLifeChapters: 8 });
    expect(result.dependsOn).toEqual([]);
    expect(result.coreHook).toBe(false);
    expect(result.halfLifeChapters).toBe(8);
  });

  it("preserves omitted metadata and schema-defaulted empty text", () => {
    const result = update({});
    expect(result.dependsOn).toEqual(["H001"]);
    expect(result.coreHook).toBe(true);
    expect(result.halfLifeChapters).toBe(20);
    expect(result.notes).toBe(original.notes);
    expect(result.expectedPayoff).toBe(original.expectedPayoff);
  });

  it("activates a chapter-zero seed when its planting chapter is supplied", () => {
    expect(update({ startChapter: 2 }).startChapter).toBe(2);
  });

  it("replaces a future seed's planned chapter with its actual earlier planting", () => {
    const result = update({ startChapter: 2, lastAdvancedChapter: 2, status: "resolved" },
      { ...original, startChapter: 30, lastAdvancedChapter: 0 });
    expect(result.startChapter).toBe(2);
    const downstream = { ...original, hookId: "H009", startChapter: 2, dependsOn: ["H003"] };
    expect(computeHookDiagnostics({ hooks: [result, downstream], currentChapter: 2 }).get("H009")!.blocked).toBe(false);
  });

  it.each([0, 2])("preserves an established planting chapter when incoming is %i", (startChapter) => {
    expect(update({ startChapter }, { ...original, startChapter: 1 }).startChapter).toBe(1);
  });

  it("accepts a shorter correction within the same advancement chapter", () => {
    expect(update({ lastAdvancedChapter: 1, notes: "Source confirmed." }).notes).toBe("Source confirmed.");
  });

  it("does not replace current facts with an older advancement record", () => {
    expect(update({ lastAdvancedChapter: 0, notes: "Older fact." }).notes).toBe(original.notes);
  });

  it("clears dependency markers for a resolved legacy chapter-zero seed", () => {
    const upstream = { ...original, status: "resolved" as const, lastAdvancedChapter: 2 };
    const downstream = { ...original, hookId: "H009", startChapter: 2, dependsOn: ["H003"] };
    const diag = computeHookDiagnostics({ hooks: [upstream, downstream], currentChapter: 2 }).get("H009")!;
    expect(diag.blocked).toBe(false);
    expect(diag.missingUpstream).toEqual([]);
    expect(diag.blockedDistance).toBe(0);
    expect(renderHookDiagnosticMarker(diag, "zh")).toBe("");
  });

  it.each([
    { status: "open" as const, startChapter: 0, lastAdvancedChapter: 1 },
    { status: "resolved" as const, startChapter: 3, lastAdvancedChapter: 3 },
    { status: "resolved" as const, startChapter: 0, lastAdvancedChapter: 3 },
  ])("retains a dependency gate for unresolved or future state: %j", (fields) => {
    const upstream = { ...original, ...fields };
    const downstream = { ...original, hookId: "H009", startChapter: 2, dependsOn: ["H003"] };
    const diag = computeHookDiagnostics({ hooks: [upstream, downstream], currentChapter: 2 }).get("H009")!;
    expect(diag.blocked).toBe(true);
    expect(diag.missingUpstream).toEqual(["H003"]);
  });
});
