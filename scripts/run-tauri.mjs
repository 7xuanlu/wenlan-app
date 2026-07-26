import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export function createTauriInvocation(args, repoRoot = REPO_ROOT) {
  return {
    appPath: resolve(repoRoot, "app"),
    args: [...args],
  };
}

function whereExecutables(name) {
  try {
    return execFileSync("where.exe", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function defaultGitBashDirectories(environment) {
  const gitRoots = whereExecutables("git.exe")
    .map((git) => dirname(git))
    .map((directory) => (
      ["bin", "cmd"].includes(basename(directory).toLowerCase())
        ? resolve(directory, "..")
        : directory
    ));
  for (const programFiles of [
    environment.ProgramFiles,
    environment["ProgramFiles(x86)"],
  ]) {
    if (programFiles) gitRoots.push(resolve(programFiles, "Git"));
  }

  const candidates = gitRoots.map((root) => resolve(root, "bin"));
  for (const bash of whereExecutables("bash.exe")) {
    if (
      !/[\\/]Windows[\\/]System32[\\/]bash\.exe$/i.test(bash)
      && !/[\\/]Microsoft[\\/]WindowsApps[\\/]bash\.exe$/i.test(bash)
    ) {
      candidates.push(dirname(bash));
    }
  }
  return [...new Set(candidates)];
}

export function createTauriEnvironment(
  environment = process.env,
  options = {},
) {
  const platform = options.platform ?? process.platform;
  const normalized = {};
  let inheritedPath = "";
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (platform === "win32" && key.toLowerCase() === "path") {
      inheritedPath = value;
    } else {
      normalized[key] = value;
    }
  }
  if (platform !== "win32") return normalized;

  const pathExists = options.pathExists ?? existsSync;
  const directories = options.gitBashDirectories
    ?? defaultGitBashDirectories(environment);
  const gitBashDirectory = directories.find(
    (directory) => pathExists(resolve(directory, "bash.exe")),
  );
  if (!gitBashDirectory) {
    throw new Error(
      "Git for Windows Bash was not found; WSL bash.exe cannot run native Tauri build hooks",
    );
  }

  const pathSegments = [
    gitBashDirectory,
    resolve(gitBashDirectory, "..", "usr", "bin"),
    ...inheritedPath.split(";").filter(Boolean),
  ];
  const seen = new Set();
  normalized.PATH = pathSegments.filter((segment) => {
    const key = segment.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(";");
  return normalized;
}

async function main() {
  const invocation = createTauriInvocation(process.argv.slice(2));
  const environment = createTauriEnvironment();
  if (process.platform === "win32") {
    for (const key of Object.keys(process.env)) {
      if (key.toLowerCase() === "path") delete process.env[key];
    }
  }
  Object.assign(process.env, environment);
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
