import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { parseSettlerDeltaOutput } from "../agents/settler-delta-parser.js";
import { validateChapterTruthPersistence } from "../pipeline/chapter-truth-validation.js";
import { buildStateDegradedPersistenceOutput, retrySettlementAfterValidationFailure, settlementFormatValidation } from "../pipeline/chapter-state-recovery.js";
import type { BookConfig } from "../models/book.js";

const book: BookConfig = { id: "fixture", title: "Fixture", platform: "other", genre: "other", status: "active", targetChapters: 10, chapterWordCount: 2000, language: "en", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
const secret = "PRIVATE_RESPONSE_SENTINEL";
const cases = [
  ["missing_delta", "No machine-readable settlement."],
  ["invalid_json", `=== RUNTIME_STATE_DELTA ===\n{${secret}}`],
  ["invalid_schema", `=== RUNTIME_STATE_DELTA ===\n${JSON.stringify({ chapter: 2, hookOps: { upsert: [{ hookId: "H1", startChapter: 1, type: "mystery", status: secret, lastAdvancedChapter: 2 }] } })}`],
] as const;
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
function output(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return { chapterNumber: 2, title: "Arrival", content: "Ada reaches the harbor.", wordCount: 5, preWriteCheck: "", postSettlement: "", updatedState: "new state", updatedHooks: "new hooks", updatedLedger: "new ledger", chapterSummary: "| 2 | Arrival |", updatedSubplots: "", updatedEmotionalArcs: "", updatedCharacterMatrix: "", postWriteErrors: [], postWriteWarnings: [], ...overrides };
}
async function writerFixture() {
  const dir = await mkdtemp(join(tmpdir(), "inkos-settlement-format-")); dirs.push(dir);
  await mkdir(join(dir, "story"));
  await writeFile(join(dir, "story/current_state.md"), "Prior chapter state");
  await writeFile(join(dir, "story/pending_hooks.md"), "Prior hooks");
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
  const writer = new WriterAgent({ client: { provider: "openai", apiFormat: "chat", stream: false, defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0, extra: {} } }, model: "fixture", projectRoot: dir, logger: logger as never });
  return { dir, writer, logger };
}

describe("settlement format failures", () => {
  it.each(cases)("exposes only the finite %s parse diagnostic", (code, content) => {
    let caught: unknown;
    try { parseSettlerDeltaOutput(content); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code });
    expect(String(caught)).not.toContain(secret);
    expect(JSON.stringify(caught)).not.toContain(secret);
  });

  it.each(cases)("carries %s through public settlement without another model attempt", async (code, content) => {
    const { dir, writer, logger } = await writerFixture();
    const chat = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({ content: "Facts from chapter.", usage })
      .mockResolvedValueOnce({ content, usage });
    const result = await writer.settleChapterState({ book, bookDir: dir, chapterNumber: 2, title: "Arrival", content: "Ada reaches the harbor." });
    expect(result.settlementFormatFailure).toBe(code);
    expect(result.updatedState).toBe("Prior chapter state");
    expect(result.updatedHooks).toBe("Prior hooks");
    expect(result.runtimeStateDelta).toBeUndefined();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secret);
  });

  it("rejects sentinel-only legacy blocks despite their explicit markers", async () => {
    const { dir, writer } = await writerFixture();
    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({ content: "Facts", usage })
      .mockResolvedValueOnce({ content: "=== UPDATED_STATE ===\n(状态卡未更新)\n=== UPDATED_HOOKS ===\n(伏笔池未更新)", usage });
    const result = await writer.settleChapterState({ book, bookDir: dir, chapterNumber: 2, title: "Arrival", content: "Ada reaches the harbor." });
    expect(result.settlementFormatFailure).toBe("missing_delta");
  });

  it.each(["No pending hooks.", "none", "| hook_id | status |\n| --- | --- |"])("preserves valid legacy empty-hook output: %s", async (hooks) => {
    const { dir, writer } = await writerFixture();
    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({ content: "Facts", usage })
      .mockResolvedValueOnce({ content: `=== RUNTIME_STATE_DELTA ===\n{broken}\n=== UPDATED_STATE ===\nAda reached the harbor.\n=== UPDATED_HOOKS ===\n${hooks}\n=== CHAPTER_SUMMARY ===\n| 2 | Arrival |`, usage });
    const result = await writer.settleChapterState({ book, bookDir: dir, chapterNumber: 2, title: "Arrival", content: "Ada reaches the harbor." });
    expect(result.settlementFormatFailure).toBeUndefined();
    expect(result.updatedState).toBe("Ada reached the harbor.");
    expect(result.updatedHooks).toBe(hooks);
    expect(result.chapterSummary).toBe("| 2 | Arrival |");
  });

  it("recovers format failure through exactly the existing one settlement attempt", async () => {
    const writer = { settleChapterState: vi.fn().mockResolvedValue(output()) };
    const validator = { validate: vi.fn().mockResolvedValue({ passed: true, warnings: [] }) };
    const result = await validateChapterTruthPersistence({ writer, validator, book, bookDir: "/tmp/fixture", chapterNumber: 2, title: "Arrival", content: "Ada reaches the harbor.", persistenceOutput: output({ settlementFormatFailure: "invalid_schema" }), auditResult: { passed: true, issues: [], summary: "clean", tokenUsage: usage }, previousTruth: { oldState: "prior", oldHooks: "prior hooks", oldLedger: "prior ledger" }, language: "en", logWarn: vi.fn() });
    expect(writer.settleChapterState).toHaveBeenCalledTimes(1);
    expect(writer.settleChapterState).toHaveBeenCalledWith(expect.objectContaining({ validationFeedback: expect.stringContaining("invalid_schema") }));
    expect(validator.validate).toHaveBeenCalledTimes(1);
    expect(result.chapterStatus).toBeNull();
    expect(result.persistenceOutput.settlementFormatFailure).toBeUndefined();
  });

  it("degrades a second parse failure without any validator call or extra retry", async () => {
    const writer = { settleChapterState: vi.fn().mockResolvedValue(output({ settlementFormatFailure: "invalid_json" })) };
    const validator = { validate: vi.fn().mockResolvedValue({ passed: true, warnings: [] }) };
    const result = await retrySettlementAfterValidationFailure({ writer, validator, book, bookDir: "/tmp/fixture", chapterNumber: 2, baselineChapter: 1, allowNewHooks: false, title: "Arrival", content: "Ada reaches the harbor.", oldState: "prior", oldHooks: "prior hooks", originalValidation: { passed: false, warnings: [{ category: "settlement_format", description: "Invalid structured settlement." }] }, language: "en" });
    expect(result.kind).toBe("degraded");
    expect(writer.settleChapterState).toHaveBeenCalledTimes(1);
    expect(writer.settleChapterState).toHaveBeenCalledWith(expect.objectContaining({ baselineChapter: 1, allowNewHooks: false }));
    expect(validator.validate).not.toHaveBeenCalled();
    if (result.kind === "degraded") expect(result.issues[0]?.description).toContain("invalid_json");
  });

  it("guards direct saves before any files change and allows only explicit restored-truth degradation", async () => {
    const { dir, writer } = await writerFixture();
    const failed = output({ settlementFormatFailure: "invalid_json", updatedSubplots: "untrusted partial", chapterSummary: "untrusted summary" });
    await expect(writer.saveChapter(dir, failed, false, "en")).rejects.toThrow(/settlement/i);
    expect(await readFile(join(dir, "story/current_state.md"), "utf8")).toBe("Prior chapter state");
    expect(await readdir(dir)).toEqual(["story"]);
    const restored = buildStateDegradedPersistenceOutput({ output: failed, oldState: "Prior chapter state", oldHooks: "Prior hooks", oldLedger: "Prior ledger" });
    expect(restored.settlementFormatFailure).toBeUndefined();
    expect(restored.chapterSummary).toBe("");
    expect(restored.updatedSubplots).toBe("");
    await writer.saveChapter(dir, restored, false, "en");
    expect(await readFile(join(dir, "story/current_state.md"), "utf8")).toBe("Prior chapter state");
    expect(await readdir(join(dir, "chapters"))).toEqual(["0002_Arrival.md"]);
  });
});


describe("safe settlement schema feedback", () => {
  it("carries actual schema field failures from parser through writer into recovery feedback", async () => {
    const { dir, writer } = await writerFixture();
    const payload = { chapter: 2, hookOps: { upsert: [{ hookId: "H1", startChapter: 1, type: "mystery", status: secret, lastAdvancedChapter: "two" }] }, notes: { [secret]: "private" } };
    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({ content: "Facts", usage })
      .mockResolvedValueOnce({ content: `=== RUNTIME_STATE_DELTA ===\n${JSON.stringify(payload)}`, usage });
    const failed = await writer.settleChapterState({ book, bookDir: dir, chapterNumber: 2, title: "Arrival", content: "Ada reaches the harbor." });
    const validation = settlementFormatValidation(failed, "en")!;
    expect(validation.warnings[0]?.description).toContain("hookOps.upsert.*.status: invalid_enum_value");
    expect(validation.warnings[0]?.description).toContain("hookOps.upsert.*.lastAdvancedChapter: invalid_type");
    expect(validation.warnings[0]?.description).toContain("notes: invalid_type");
    expect(JSON.stringify(failed)).not.toContain(secret);
    const recoveryWriter = { settleChapterState: vi.fn().mockResolvedValue(output()) };
    await retrySettlementAfterValidationFailure({ writer: recoveryWriter, validator: { validate: vi.fn().mockResolvedValue({ passed: true, warnings: [] }) }, book, bookDir: dir, chapterNumber: 2, title: "Arrival", content: "Ada reaches the harbor.", oldState: "prior", oldHooks: "prior", originalValidation: validation, language: "en" });
    expect(recoveryWriter.settleChapterState).toHaveBeenCalledTimes(1);
    expect(recoveryWriter.settleChapterState).toHaveBeenCalledWith(expect.objectContaining({ validationFeedback: expect.stringContaining("hookOps.upsert.*.status: invalid_enum_value") }));
  });

  it("drops forged diagnostic strings and bounds repeated schema diagnostics", () => {
    const malformed = {
      chapter: 0,
      currentStatePatch: { currentLocation: [], protagonistState: [], currentGoal: [], currentConstraint: [], currentAlliances: [], currentConflict: [] },
      hookOps: { upsert: Array.from({ length: 50 }, () => ({ status: secret })), mention: [null], resolve: [null], defer: [null] },
      notes: [null],
    };
    let caught: any;
    try { parseSettlerDeltaOutput(`=== RUNTIME_STATE_DELTA ===\n${JSON.stringify(malformed)}`); } catch (error) { caught = error; }
    expect(caught.schemaIssues.length).toBeGreaterThan(0);
    expect(caught.schemaIssues).toHaveLength(12);
    expect(new Set(caught.schemaIssues).size).toBe(caught.schemaIssues.length);
    const forged = output({ settlementFormatFailure: "invalid_schema", settlementSchemaIssues: [secret, `notes.${secret}: invalid_type`, "chapter: invalid_type"] } as Partial<WriteChapterOutput>);
    const serialized = JSON.stringify(settlementFormatValidation(forged, "en"));
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("chapter: invalid_type");
    const restored = buildStateDegradedPersistenceOutput({ output: forged, oldState: "old", oldHooks: "old", oldLedger: "" });
    expect(restored.settlementSchemaIssues).toBeUndefined();
  });
});
