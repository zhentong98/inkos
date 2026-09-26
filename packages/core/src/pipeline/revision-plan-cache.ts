import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import type { PlanChapterOutput } from "../agents/planner.js";
import { resolveStoryContextDir } from "../utils/story-context.js";
import { loadPersistedPlan } from "./persisted-governed-plan.js";

// Bump when planner input semantics change. This is a cache, never authority.
const CACHE_VERSION = 1;
const SNAPSHOT_INPUTS = [
  "current_state.md", "pending_hooks.md", "current_focus.md", "chapter_summaries.md",
  "character_matrix.md", "subplot_board.md", "emotional_arcs.md", "volume_summaries.md",
  "state/current_state.json", "state/hooks.json", "state/chapter_summaries.json",
] as const;
const FOUNDATION_INPUTS = [
  "author_intent.md", "brief.md", "book_rules.md", "outline/story_frame.md",
  "outline/volume_map.md", "story_bible.md", "volume_outline.md",
] as const;

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

async function optionalBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function optionalEntries(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Hash only historical truth plus author-controlled foundation inputs.
 * Live truth, memory.db, target/future chapter bodies and runtime outputs are
 * deliberately excluded. Missing optional files are distinct from empty files.
 * Required snapshot files must exist; callers must not fall back to live truth.
 */
export async function computeRevisionPlanFingerprint(
  book: BookConfig,
  bookDir: string,
  chapterNumber: number,
  baselineChapter: number,
  externalContext?: string,
): Promise<string> {
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1 || baselineChapter !== chapterNumber - 1) {
    throw new Error("Revision plan cache requires the immediately preceding chapter snapshot");
  }
  const snapshotDir = await resolveStoryContextDir(bookDir, baselineChapter);
  const storyDir = join(bookDir, "story");
  const inputs: Record<string, string | null> = {};
  async function record(key: string, path: string) {
    const bytes = await optionalBytes(path);
    inputs[key] = bytes === null ? null : digest(bytes);
  }
  await Promise.all([
    ...SNAPSHOT_INPUTS.map((file) => record(`snapshot/${file}`, join(snapshotDir, file))),
    ...FOUNDATION_INPUTS.map((file) => record(`foundation/${file}`, join(storyDir, file))),
  ]);
  // Do not convert a deletion between snapshot resolution and reads into a
  // reusable cache key for an incomplete historical baseline.
  if (inputs["snapshot/current_state.md"] === null || inputs["snapshot/pending_hooks.md"] === null) {
    throw new Error(`Cannot fingerprint revision context: baseline snapshot ${baselineChapter} is unavailable`);
  }
  for (const tier of ["主要角色", "次要角色", "major", "minor"]) {
    const dir = join(storyDir, "roles", tier);
    for (const file of await optionalEntries(dir)) {
      if (file.endsWith(".md")) await record(`roles/${tier}/${file}`, join(dir, file));
    }
  }
  // The planner reads the preceding chapter ending directly from chapter
  // bodies. Include every matching candidate, so renames/ambiguous files also
  // invalidate instead of relying on filesystem enumeration order.
  if (baselineChapter > 0) {
    const prefix = String(baselineChapter).padStart(4, "0");
    const dir = join(bookDir, "chapters");
    for (const file of await optionalEntries(dir)) {
      if (file.startsWith(prefix) && file.endsWith(".md")) {
        await record(`previousChapter/${file}`, join(dir, file));
      }
    }
  }
  const { status: _status, createdAt: _createdAt, updatedAt: _updatedAt, ...settings } = book;
  return digest(JSON.stringify(canonical({
    version: CACHE_VERSION, chapterNumber, baselineChapter, settings,
    externalContext: externalContext ?? null, inputs,
  })));
}

function paths(bookDir: string, chapterNumber: number) {
  const prefix = join(bookDir, "story", "runtime", `chapter-${String(chapterNumber).padStart(4, "0")}`);
  return { plan: `${prefix}.plan.md`, intent: `${prefix}.intent.md`, metadata: `${prefix}.plan-cache.json` };
}

async function artifactHashes(bookDir: string, chapterNumber: number) {
  const path = paths(bookDir, chapterNumber);
  const [plan, intent] = await Promise.all([readFile(path.plan), readFile(path.intent)]);
  return { planHash: digest(plan), intentHash: digest(intent) };
}

function sameArtifacts(left: { planHash: string; intentHash: string }, right: { planHash: string; intentHash: string }) {
  return left.planHash === right.planHash && left.intentHash === right.intentHash;
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** Call only for a newly generated, persisted plan after verifying its input
 * fingerprint is unchanged across planning. Existing legacy plans cannot
 * establish that provenance merely by being parseable.
 */
export async function saveRevisionPlanCache(
  bookDir: string,
  chapterNumber: number,
  fingerprint: string,
): Promise<void> {
  if (!validHash(fingerprint)) throw new Error("Invalid revision plan fingerprint");
  const before = await artifactHashes(bookDir, chapterNumber);
  if (!await loadPersistedPlan(bookDir, chapterNumber)) {
    throw new Error("Cannot cache an invalid revision plan");
  }
  const after = await artifactHashes(bookDir, chapterNumber);
  if (!sameArtifacts(before, after)) throw new Error("Revision plan changed while saving cache metadata");
  const path = paths(bookDir, chapterNumber);
  const temp = `${path.metadata}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ version: CACHE_VERSION, chapterNumber, fingerprint, ...after }) + "\n", { flag: "wx" });
    await rename(temp, path.metadata);
  } finally {
    await rm(temp, { force: true });
  }
}

/** Missing, stale, torn, legacy, malformed or replaced artifacts all miss.
 * Require both files before invoking the permissive legacy-capable loader.
 * Recheck their bytes afterwards so an ordinary concurrent replacement cannot
 * return a parsed plan different from the pair the metadata validated.
 */
export async function loadRevisionPlanCache(
  bookDir: string,
  chapterNumber: number,
  fingerprint: string,
): Promise<PlanChapterOutput | null> {
  try {
    if (!validHash(fingerprint)) return null;
    const raw = await readFile(paths(bookDir, chapterNumber).metadata, "utf-8");
    const metadata: unknown = JSON.parse(raw);
    if (!metadata || typeof metadata !== "object") return null;
    const entry = metadata as Record<string, unknown>;
    if (entry.version !== CACHE_VERSION || entry.chapterNumber !== chapterNumber
      || entry.fingerprint !== fingerprint || !validHash(entry.planHash) || !validHash(entry.intentHash)) return null;
    const before = await artifactHashes(bookDir, chapterNumber);
    if (before.planHash !== entry.planHash || before.intentHash !== entry.intentHash) return null;
    const plan = await loadPersistedPlan(bookDir, chapterNumber);
    if (!plan || !sameArtifacts(before, await artifactHashes(bookDir, chapterNumber))) return null;
    return plan;
  } catch {
    return null;
  }
}
