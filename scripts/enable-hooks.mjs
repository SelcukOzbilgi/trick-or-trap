// Opt-in: run by hand with `npm run hooks:enable`, never by `npm install`.
// Points git at .githooks, where the pre-commit secret scan lives. Turn it off
// again with `git config --unset core.hooksPath`. Safe to run again and again: it
// only sets one config value. It does nothing in CI, and nothing in a copy of the
// code that isn't a git checkout.
// It never fails the install: if git is missing or the config can't be written,
// it prints a note and exits 0.

import { execFileSync } from "node:child_process";
import process from "node:process";

if (process.env.CI) {
  process.exit(0);
}

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
} catch {
  process.exit(0);
}

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
} catch {
  console.warn("enable-hooks: could not set core.hooksPath; the pre-commit secret scan is off.");
}
