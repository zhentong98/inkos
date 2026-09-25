import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Resolve dynamic truth as of a chapter boundary. Never fall forward to live
 * truth when a revision snapshot or an optional historical file is missing. */
export async function resolveStoryContextDir(bookDir: string, baselineChapter?: number): Promise<string> {
  const storyDir = join(bookDir, "story");
  if (baselineChapter === undefined) return storyDir;
  if (!Number.isInteger(baselineChapter) || baselineChapter < 0) {
    throw new Error(`Invalid story baseline chapter: ${baselineChapter}`);
  }
  const snapshotDir = join(storyDir, "snapshots", String(baselineChapter));
  try {
    await Promise.all([
      readFile(join(snapshotDir, "current_state.md"), "utf-8"),
      readFile(join(snapshotDir, "pending_hooks.md"), "utf-8"),
    ]);
  } catch (error) {
    throw new Error(`Cannot load revision context: baseline snapshot ${baselineChapter} is unavailable (${String(error)})`);
  }
  return snapshotDir;
}
