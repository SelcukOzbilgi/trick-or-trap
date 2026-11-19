// Run by the Kiro hook in .kiro/hooks/test-on-save.json after Kiro saves a file.
// Kiro passes the event as JSON on stdin ({ session_id, hook_event_name, cwd,
// file_path }). If the saved file is a source file under lib/ or components/,
// this runs only the tests that import it (`vitest related`). Anything else is
// ignored. A save in a module that many tests import would run most of the
// suite, so if more than MAX_TEST_FILES files are affected the run is skipped
// with a one-line message. Load limits follow
// .kiro/steering/testing-and-commands.md: two workers, no watch mode, low
// priority.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SOURCE = /^(lib|components)\/.+\.tsx?$/;
const MAX_TEST_FILES = 8;
const RUN_TIMEOUT_MS = 115_000;

/** Returns the repo-relative path of a lib/ or components/ source file, or null. */
export function sourceFromEvent(raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof event?.file_path !== "string" || event.file_path === "") return null;
  try {
    // Real paths on both sides, so a symlinked folder cannot hide a file from
    // the containment check below, or smuggle one in.
    const root = realpathSync(typeof event.cwd === "string" && event.cwd !== "" ? event.cwd : process.cwd());
    const file = realpathSync(path.resolve(root, event.file_path));
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative) || !SOURCE.test(relative)) return null;
    return /\.(test|spec)\.tsx?$/.test(relative) ? null : relative;
  } catch {
    return null;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

/** How many test files `vitest related <file>` would run, using Vitest's own module graph. */
async function countRelatedTests(file) {
  const { createVitest } = await import(import.meta.resolve("vitest/node"));
  const vitest = await createVitest("test", { watch: false, run: true, related: [path.resolve(file)], reporters: [] });
  try {
    return (await vitest.getRelevantTestSpecifications([])).length;
  } finally {
    await vitest.close();
  }
}

async function main() {
  const file = sourceFromEvent(await readStdin());
  if (file === null) return 0;
  try {
    os.setPriority(0, 15); // low priority; child processes inherit it
  } catch {
    // not fatal
  }
  let count;
  try {
    count = await countRelatedTests(file);
  } catch (error) {
    console.log(`skipped related tests for ${file}: could not count them (${error instanceof Error ? error.message : error})`);
    return 0;
  }
  if (count > MAX_TEST_FILES) {
    console.log(`skipped related tests for ${file}: ${count} test files import it (limit ${MAX_TEST_FILES}). Run them by hand if needed.`);
    return 0;
  }
  console.log(`related tests for ${file}: ${count} file(s)`);
  const vitestBin = path.resolve("node_modules/vitest/vitest.mjs");
  const result = spawnSync(
    process.execPath,
    [vitestBin, "related", file, "--run", "--passWithNoTests", "--maxWorkers=2"],
    { stdio: "inherit", timeout: RUN_TIMEOUT_MS },
  );
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(await main());
}
