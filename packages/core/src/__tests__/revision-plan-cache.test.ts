import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BookConfig } from "../models/book.js";
import type { PlanChapterOutput } from "../agents/planner.js";
import { savePersistedPlan } from "../pipeline/persisted-governed-plan.js";

import * as cache from "../pipeline/revision-plan-cache.js";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const book: BookConfig = {
  id: "book-a", title: "Harbor", platform: "other", genre: "mystery", status: "active",
  targetChapters: 30, chapterWordCount: 3000, language: "en",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
async function put(dir: string, path: string, value: string) {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), value);
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "inkos-revision-cache-"));
  dirs.push(dir);
  await put(dir, "story/snapshots/2/current_state.md", "The protagonist waits at the harbor.");
  await put(dir, "story/snapshots/2/pending_hooks.md", "H1 remains planted.");
  await put(dir, "chapters/0002-harbor.md", "# Harbor\nShe found a clue.");
  return dir;
}
async function fingerprint(dir: string, config = book, external?: string) {
  return cache.computeRevisionPlanFingerprint(config, dir, 3, 2, external);
}
const memoBody = [
  "Current task", "Scene and length budget", "What the reader is waiting for right now",
  "To pay off / to keep buried", "What the slow / transitional beats carry",
  "Three-question check on the key choice", "Required end-of-chapter change",
  "Hook ledger for this chapter", "Do not",
].map((heading) => `## ${heading}\nThe protagonist must recover the harbor ledger without exposing her ally.`).join("\n\n");
async function persist(dir: string) {
  const plan: PlanChapterOutput = {
    intent: { chapter: 3, goal: "Recover the ledger", mustKeep: [], mustAvoid: [], styleEmphasis: [] },
    memo: { chapter: 3, goal: "Recover the ledger", isGoldenOpening: true, threadRefs: [], body: memoBody },
    intentMarkdown: "# Chapter Intent\n\n## Goal\nRecover the ledger\n",
    plannerInputs: ["story/snapshots/2/current_state.md"], runtimePath: "unused",
  };
  await put(dir, "story/runtime/chapter-0003.intent.md", plan.intentMarkdown);
  await savePersistedPlan(dir, plan);
  return plan;
}

describe("revision plan cache", () => {
  it("reuses a complete plan only when its historical inputs and both persisted artifacts match", async () => {
    const dir = await fixture();
    await persist(dir);
    const key = await fingerprint(dir);
    expect(await cache.loadRevisionPlanCache(dir, 3, key)).toBeNull();
    await cache.saveRevisionPlanCache(dir, 3, key);
    const restored = await cache.loadRevisionPlanCache(dir, 3, key);
    expect(restored?.memo.goal).toBe("Recover the ledger");
    expect(restored?.intentMarkdown).toContain("Recover the ledger");
    expect(await cache.loadRevisionPlanCache(dir, 3, "0".repeat(64))).toBeNull();
    const metadata = await readFile(join(dir, "story/runtime/chapter-0003.plan-cache.json"), "utf-8");
    expect(metadata).not.toContain("ledger");
    expect(metadata).not.toContain("harbor");
  });

  it.each([
    "story/snapshots/2/current_state.md", "story/snapshots/2/pending_hooks.md",
    "story/snapshots/2/current_focus.md", "story/snapshots/2/chapter_summaries.md",
    "story/snapshots/2/character_matrix.md", "story/snapshots/2/subplot_board.md",
    "story/snapshots/2/emotional_arcs.md", "story/snapshots/2/volume_summaries.md",
    "story/snapshots/2/state/current_state.json", "story/snapshots/2/state/hooks.json",
    "story/snapshots/2/state/chapter_summaries.json", "story/author_intent.md",
    "story/brief.md", "story/book_rules.md", "story/outline/story_frame.md",
    "story/outline/volume_map.md", "story/story_bible.md", "story/volume_outline.md",
    "story/roles/major/Ada.md", "story/roles/次要角色/Bo.md", "chapters/0002-harbor.md",
  ])("invalidates when relevant authority changes: %s", async (path) => {
    const dir = await fixture();
    await persist(dir);
    await cache.saveRevisionPlanCache(dir, 3, await fingerprint(dir));
    await put(dir, path, "A changed historical input");
    expect(await cache.loadRevisionPlanCache(dir, 3, await fingerprint(dir))).toBeNull();
  });

  it("ignores live truth, future chapters, target chapter text and lifecycle timestamps", async () => {
    const dir = await fixture();
    const key = await fingerprint(dir);
    await put(dir, "story/current_state.md", "Future secret");
    await put(dir, "story/state/hooks.json", "Future hooks");
    await put(dir, "story/current_focus.md", "Future focus");
    await put(dir, "story/snapshots/4/current_state.md", "Future state");
    await put(dir, "chapters/0003-target.md", "The text being revised");
    await put(dir, "chapters/0004-future.md", "Future body");
    expect(await fingerprint(dir, { ...book, status: "paused", updatedAt: "2026-09-01T00:00:00.000Z" })).toBe(key);
  });

  it("invalidates book settings and explicit external context", async () => {
    const dir = await fixture();
    const key = await fingerprint(dir);
    expect(await fingerprint(dir, { ...book, chapterWordCount: 2000 })).not.toBe(key);
    expect(await fingerprint(dir, { ...book, language: "zh" })).not.toBe(key);
    expect(await fingerprint(dir, book, "Use a different goal")).not.toBe(key);
    expect(await fingerprint(dir, { ...book, writing: { revisionGate: "always" } })).not.toBe(key);
  });

  it("uses deterministic role ordering and config key ordering", async () => {
    const dir = await fixture();
    await put(dir, "story/roles/major/A.md", "A role");
    await put(dir, "story/roles/minor/B.md", "B role");
    const key = await fingerprint(dir);
    const reordered = Object.fromEntries(Object.entries(book).reverse()) as BookConfig;
    expect(await fingerprint(dir, reordered)).toBe(key);
    expect(await fingerprint(dir)).toBe(key);
  });

  it("requires the exact immediately preceding snapshot even when live state is available", async () => {
    const dir = await fixture();
    await expect(cache.computeRevisionPlanFingerprint(book, dir, 3, 1)).rejects.toThrow();
    await rm(join(dir, "story/snapshots/2/pending_hooks.md"));
    await put(dir, "story/pending_hooks.md", "Live hooks exist");
    await expect(fingerprint(dir)).rejects.toThrow(/snapshot/);
  });

  it.each(["plan.md", "intent.md", "plan-cache.json"])("rejects replaced, corrupt or missing %s", async (suffix) => {
    const dir = await fixture();
    await persist(dir);
    const key = await fingerprint(dir);
    await cache.saveRevisionPlanCache(dir, 3, key);
    const path = join(dir, `story/runtime/chapter-0003.${suffix}`);
    await writeFile(path, "replacement");
    expect(await cache.loadRevisionPlanCache(dir, 3, key)).toBeNull();
    await rm(path);
    expect(await cache.loadRevisionPlanCache(dir, 3, key)).toBeNull();
  });

  it("does not cache legacy intent-only plans or parse-invalid paired artifacts", async () => {
    const dir = await fixture();
    await put(dir, "story/runtime/chapter-0003.intent.md", "## Goal\nA valid legacy goal\n");
    const key = await fingerprint(dir);
    expect(await cache.loadRevisionPlanCache(dir, 3, key)).toBeNull();
    await expect(cache.saveRevisionPlanCache(dir, 3, key)).rejects.toThrow();
    await put(dir, "story/runtime/chapter-0003.plan.md", "Invalid memo");
    await expect(cache.saveRevisionPlanCache(dir, 3, key)).rejects.toThrow();
    expect(await cache.loadRevisionPlanCache(dir, 3, key)).toBeNull();
  });
});
