import { chmodSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export function postinstallPlan(platform = process.platform) {
  return {
    gitArgs: ["config", "core.hooksPath", ".githooks"],
    chmodHooks: platform !== "win32",
  };
}

function main() {
  const plan = postinstallPlan();
  spawnSync("git", plan.gitArgs, {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });

  if (!plan.chmodHooks) return;
  const hooksDir = resolve(REPO_ROOT, ".githooks");
  for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      chmodSync(resolve(hooksDir, entry.name), 0o755);
    }
  }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    // Hook configuration is developer convenience and must not block install.
  }
}
