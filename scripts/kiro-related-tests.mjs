// Run by the Kiro hook in .kiro/hooks/test-on-save.json after Kiro saves a file.
// Kiro passes the event as JSON on stdin ({ session_id, hook_event_name, cwd,
// file_path }). If the saved file is a source file under lib/ or components/,
// this runs only the tests that import it (`vitest related`). Anything else is
// ignored. Load limits follow .kiro/steering/testing-and-commands.md: two
// workers, no watch mode, low priority.

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const SOURCE = /^(lib|components)\/.+\.tsx?$/;

/** Returns the repo-relative path of a lib/ or components/ source file, or null. */
export function sourceFromEvent(raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof event?.file_path !== "string" || event.file_path === "") return null;
  const root = typeof event.cwd === "string" && event.cwd !== "" ? event.cwd : process.cwd();
  const relative = path.relative(root, path.resolve(root, event.file_path)).split(path.sep).join("/");
  if (relative.startsWith("..") || !SOURCE.test(relative)) return null;
  return /\.(test|spec)\.tsx?$/.test(relative) ? null : relative;
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

async function main() {
  const file = sourceFromEvent(await readStdin());
  if (file === null) return 0;
  const args = ["--no-install", "vitest", "related", file, "--run", "--passWithNoTests", "--maxWorkers=2"];
  const [command, commandArgs] =
    process.platform === "win32" ? ["npx", args] : ["nice", ["-n", "15", "npx", ...args]];
  console.log(`related tests for ${file}`);
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  process.exit(await main());
}
