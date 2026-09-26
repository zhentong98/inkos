import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BookConfig } from "../models/book.js";
import type { PlanChapterOutput } from "../agents/planner.js";
import { savePersistedPlan } from "../pipeline/persisted-governed-plan.js";

import * as cache from "../pipeline/revision-plan-cache.js";
import { loadBuiltinAgentSkills } from "../skills/builtin-loader.js";
import { resolveProductionSkillActivations } from "../skills/production-bindings.js";
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


describe("revision planner skill guidance provenance", () => {
  async function activationFixture() {
    const baseDir = await mkdtemp(join(tmpdir(), "inkos-guidance-cache-"));
    dirs.push(baseDir);
    await put(baseDir, "SKILL.md", "Disk manifest is not the already activated body");
    await put(baseDir, "references/planning.md", "Keep continuity with preceding events.");
    return {
      skill: { id: "inkos-long-writing", name: "Long Writing", description: "Novel guidance", body: "Plan cohesive scenes.", source: "builtin" as const, baseDir },
      resources: [],
    };
  }

  it("reuses native built-in guidance with a stable static reference corpus", async () => {
    const activation = await activationFixture();
    const key = await cache.computeRevisionGuidanceFingerprint([activation]);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await cache.computeRevisionGuidanceFingerprint([activation])).toBe(key);
    expect(await cache.computeRevisionGuidanceFingerprint(undefined)).toBe(await cache.computeRevisionGuidanceFingerprint([]));
    const dir = await fixture();
    await persist(dir);
    const planKey = await cache.computeRevisionPlanFingerprint(book, dir, 3, 2, undefined, key!);
    await cache.saveRevisionPlanCache(dir, 3, planKey);
    expect((await cache.loadRevisionPlanCache(dir, 3, planKey))?.memo.goal).toBe("Recover the ledger");
  });

  it("supports the real native long-review default skill activations", async () => {
    const { skills } = await loadBuiltinAgentSkills();
    const activations = resolveProductionSkillActivations(skills, "longReview");
    expect(activations.map(({ skill }) => skill.id)).toEqual(["inkos-long-writing", "inkos-story-review"]);
    const key = await cache.computeRevisionGuidanceFingerprint(activations);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await cache.computeRevisionGuidanceFingerprint(activations)).toBe(key);
  });

  it("invalidates the plan when the supplied guidance fingerprint changes", async () => {
    const dir = await fixture();
    const first = await cache.computeRevisionPlanFingerprint(book, dir, 3, 2, undefined, "a".repeat(64));
    const second = await cache.computeRevisionPlanFingerprint(book, dir, 3, 2, undefined, "b".repeat(64));
    expect(first).not.toBe(second);
  });

  it("invalidates changed bodies, descriptions, names, skill IDs and activation membership", async () => {
    const activation = await activationFixture();
    const first = await cache.computeRevisionGuidanceFingerprint([activation]);
    for (const field of ["body", "name", "description", "id"] as const) {
      expect(await cache.computeRevisionGuidanceFingerprint([{ ...activation, skill: { ...activation.skill, [field]: "Changed guidance" } }])).not.toBe(first);
    }
    expect(await cache.computeRevisionGuidanceFingerprint([])).not.toBe(first);
    expect(await cache.computeRevisionGuidanceFingerprint([activation, { ...activation, skill: { ...activation.skill, id: "inkos-story-review" } }])).not.toBe(first);
  });

  it("invalidates changed, added and removed eligible references", async () => {
    const activation = await activationFixture();
    const key = await cache.computeRevisionGuidanceFingerprint([activation]);
    await put(activation.skill.baseDir, "references/planning.md", "Different scene guidance.");
    const changed = await cache.computeRevisionGuidanceFingerprint([activation]);
    expect(changed).not.toBe(key);
    await put(activation.skill.baseDir, "references/nested/review.TXT", "Review scene causality.");
    expect(await cache.computeRevisionGuidanceFingerprint([activation])).not.toBe(changed);
    await rm(join(activation.skill.baseDir, "references/planning.md"));
    await rm(join(activation.skill.baseDir, "references/nested/review.TXT"));
    expect(await cache.computeRevisionGuidanceFingerprint([activation])).not.toBe(key);
  });

  it("excludes manifest, non-text, oversized, binary and symlink references like the hydrator", async () => {
    const activation = await activationFixture();
    const key = await cache.computeRevisionGuidanceFingerprint([activation]);
    await put(activation.skill.baseDir, "SKILL.md", "Changed manifest does not replace supplied skill.body");
    await put(activation.skill.baseDir, "ignored.json", "A non-text resource");
    await put(activation.skill.baseDir, "oversized.md", "x".repeat(512 * 1024 + 1));
    await put(activation.skill.baseDir, "binary.md", "A binary\0resource");
    await symlink(join(activation.skill.baseDir, "references/planning.md"), join(activation.skill.baseDir, "linked.md"));
    expect(await cache.computeRevisionGuidanceFingerprint([activation])).toBe(key);
  });

  it("hashes supplied resources without consulting missing on-disk references", async () => {
    const activation = await activationFixture();
    const supplied = { ...activation, resources: [{ path: "reference.md", heading: "Scene", body: "Explicit guidance", charStart: 0, charEnd: 17 }] };
    const key = await cache.computeRevisionGuidanceFingerprint([supplied]);
    await rm(activation.skill.baseDir, { recursive: true });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await cache.computeRevisionGuidanceFingerprint([supplied])).toBe(key);
    expect(await cache.computeRevisionGuidanceFingerprint([{ ...supplied, resources: [{ ...supplied.resources[0]!, body: "Changed explicit guidance" }] }])).not.toBe(key);
    expect(await cache.computeRevisionGuidanceFingerprint([{ skill: { ...activation.skill, baseDir: undefined }, resources: [] }])).toMatch(/^[a-f0-9]{64}$/);
  });

  it("bypasses caching when an implicit reference root is missing or a symlink", async () => {
    const activation = await activationFixture();
    const alias = activation.skill.baseDir + "-alias";
    dirs.push(alias);
    await symlink(activation.skill.baseDir, alias);
    expect(await cache.computeRevisionGuidanceFingerprint([{ ...activation, skill: { ...activation.skill, baseDir: alias } }])).toBeNull();
    await rm(activation.skill.baseDir, { recursive: true });
    expect(await cache.computeRevisionGuidanceFingerprint([activation])).toBeNull();
  });

  it.skipIf(process.getuid?.() === 0)("bypasses caching on resource read errors instead of certifying an empty corpus", async () => {
    const activation = await activationFixture();
    const path = join(activation.skill.baseDir, "references/planning.md");
    await chmod(path, 0);
    try {
      expect(await cache.computeRevisionGuidanceFingerprint([activation])).toBeNull();
    } finally {
      await chmod(path, 0o600);
    }
  });
});
