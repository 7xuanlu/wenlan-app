import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("runtime product identity", () => {
  it("uses Wenlan app product identity", () => {
    const tauri = JSON.parse(
      readFileSync(resolve(root, "app/tauri.conf.json"), "utf8"),
    );

    expect(tauri.productName).toBe("Wenlan");
    expect(tauri.identifier).toBe("com.wenlan.desktop");
    expect(tauri.app.windows[0].title).toBe("Wenlan");
  });

  it("uses Wenlan release artifact names", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    );

    expect(pkg.name).toBe("wenlan-app");
    expect(pkg.repository.url).toBe("https://github.com/7xuanlu/wenlan-app");
    expect(pkg.scripts["release:dmg"]).toContain("Wenlan_");
    expect(pkg.scripts["release:dmg"]).toContain("-volname Wenlan");
    expect(pkg.scripts["clean:release"]).toContain("Wenlan_*.dmg");
    expect(pkg.scripts["clean:release"]).toContain("Origin_*.dmg");
  });

  it("uses Wenlan Rust package and executable identity", () => {
    const cargo = readFileSync(resolve(root, "app/Cargo.toml"), "utf8");

    expect(cargo).toContain('name = "wenlan-app"');
    expect(cargo).toContain('default-run = "wenlan-app"');
    expect(cargo).toContain('name = "wenlan_lib"');
  });

  it("uses Wenlan updater endpoint", () => {
    const tauri = JSON.parse(
      readFileSync(resolve(root, "app/tauri.conf.json"), "utf8"),
    );

    expect(tauri.plugins.updater.endpoints[0]).toBe(
      "https://github.com/7xuanlu/wenlan-app/releases/latest/download/latest.json",
    );
  });

  it("uses Wenlan web shell and capability identity", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    const capability = JSON.parse(
      readFileSync(resolve(root, "app/capabilities/default.json"), "utf8"),
    );

    expect(html).toContain("<title>Wenlan</title>");
    expect(html).not.toContain("<title>Origin</title>");
    expect(capability.description).toBe("Default capability for Wenlan");
  });

  it("keeps product-owned visible copy on Wenlan", () => {
    const productOwnedFiles = [
      "src/components/memory/SettingsPage.tsx",
      "src/components/memory/ProfilePage.tsx",
      "src/components/memory/ConnectionsList.tsx",
      "src/components/memory/sources/AddSourceDialog.tsx",
      "src/components/memory/sources/SourcesSection.tsx",
      "src/components/memory/PageDetail.tsx",
      "src/components/memory/ImportView.tsx",
      "src/components/memory/SpaceDetail.tsx",
      "src/components/memory/WorthAGlanceScroll.tsx",
      "src/components/memory/settings/SettingsSidebar.tsx",
      "src/components/ChatImport/ImportFlow.tsx",
    ];

    for (const file of productOwnedFiles) {
      const content = readFileSync(resolve(root, file), "utf8");
      expect(content, file).not.toMatch(/\bOrigin\b/);
    }
  });
});
