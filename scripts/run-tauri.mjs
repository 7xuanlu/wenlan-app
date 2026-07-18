import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export function createTauriInvocation(args, repoRoot = REPO_ROOT) {
  return {
    appPath: resolve(repoRoot, "app"),
    args: [...args],
  };
}

async function main() {
  const invocation = createTauriInvocation(process.argv.slice(2));
  process.env.TAURI_APP_PATH = invocation.appPath;
  const cli = await import("@tauri-apps/cli");
  await cli.run(invocation.args, "pnpm tauri");
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    const cli = await import("@tauri-apps/cli").catch(() => null);
    if (cli && typeof cli.logError === "function" && error instanceof Error) {
      cli.logError(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
