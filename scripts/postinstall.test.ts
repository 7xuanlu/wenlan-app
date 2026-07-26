import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PostinstallModule = {
  postinstallPlan(platform: string): {
    chmodHooks: boolean;
    gitArgs: string[];
  };
};

describe("cross-platform postinstall", () => {
  it("configures hooks everywhere and skips POSIX chmod on Windows", async () => {
    const loaded = await import("./postinstall.mjs").catch(() => null);
    expect(loaded, "scripts/postinstall.mjs must exist").not.toBeNull();

    const { postinstallPlan } = loaded as PostinstallModule;
    expect(postinstallPlan("win32")).toEqual({
      chmodHooks: false,
      gitArgs: ["config", "core.hooksPath", ".githooks"],
    });
    expect(postinstallPlan("darwin").chmodHooks).toBe(true);
  });

  it("uses the Node postinstall without shell-only operators", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.scripts.postinstall).toBe("node scripts/postinstall.mjs");
  });
});
