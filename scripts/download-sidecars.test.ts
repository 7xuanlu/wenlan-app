import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  archiveExtractionCommand,
  installStagedFile,
} from "./download-sidecars.mjs";

describe("archive extraction command", () => {
  it("uses a PowerShell file with named argv for Windows ZIP paths", () => {
    const archive = String.raw`C:\actions\O'Brien\wenlan-windows-x64.zip`;
    const destination = String.raw`C:\actions\temp\O'Brien\backend`;

    expect(
      archiveExtractionCommand("zip", archive, destination, "win32"),
    ).toEqual({
      commandName: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(process.cwd(), "scripts", "extract-zip.ps1"),
        "-ArchivePath",
        archive,
        "-DestinationPath",
        destination,
      ],
    });
  });

  it("keeps archive paths out of PowerShell source text", () => {
    const script = readFileSync(
      resolve(process.cwd(), "scripts", "extract-zip.ps1"),
      "utf8",
    );

    expect(script).toContain("[ValidateNotNullOrEmpty()]");
    expect(script).toContain("Expand-Archive");
    expect(script).toContain("-LiteralPath $ArchivePath");
    expect(script).toContain("-DestinationPath $DestinationPath");
  });

  it.runIf(process.platform === "win32")(
    "extracts a real ZIP through Windows PowerShell",
    () => {
      const root = mkdtempSync(resolve(tmpdir(), "wenlan-zip-extraction-"));
      try {
        const source = resolve(root, "source");
        const destination = resolve(root, "destination");
        mkdirSync(source);
        writeFileSync(resolve(source, "payload.txt"), "windows-native\n");

        const archiveName = "fixture.zip";
        const create = spawnSync(
          "tar.exe",
          ["-a", "-c", "-f", archiveName, "-C", "source", "payload.txt"],
          { cwd: root, encoding: "utf8" },
        );
        expect(
          create.status,
          String(create.stderr || create.stdout),
        ).toBe(0);

        const extraction = archiveExtractionCommand(
          "zip",
          resolve(root, archiveName),
          destination,
          "win32",
        );
        const extract = spawnSync(extraction.commandName, extraction.args, {
          encoding: "utf8",
        });
        expect(
          extract.status,
          String(extract.stderr || extract.stdout),
        ).toBe(0);
        expect(readFileSync(resolve(destination, "payload.txt"), "utf8")).toBe(
          "windows-native\n",
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    15_000,
  );

  it("keeps tar extraction for non-Windows archives", () => {
    expect(
      archiveExtractionCommand(
        "tar",
        "/tmp/wenlan-darwin-arm64.tar.gz",
        "/tmp/extracted",
        "darwin",
      ),
    ).toEqual({
      commandName: "tar",
      args: [
        "-xf",
        "/tmp/wenlan-darwin-arm64.tar.gz",
        "-C",
        "/tmp/extracted",
      ],
    });
  });
});

describe("staged sidecar installation", () => {
  it("falls back to an atomic destination-volume transfer on EXDEV", () => {
    const staged = String.raw`C:\Temp\wenlan-server.exe`;
    const destination = String.raw`D:\checkout\app\binaries\wenlan-server.exe`;
    const transfer = `${destination}.install-${process.pid}`;
    const calls: string[] = [];
    let firstRename = true;

    installStagedFile(staged, destination, {
      rmSync(path: string) {
        calls.push(`rm:${path}`);
      },
      renameSync(from: string, to: string) {
        calls.push(`rename:${from}->${to}`);
        if (firstRename) {
          firstRename = false;
          throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
        }
      },
      copyFileSync(from: string, to: string) {
        calls.push(`copy:${from}->${to}`);
      },
      chmodSync(path: string, mode: number) {
        calls.push(`chmod:${path}:${mode.toString(8)}`);
      },
    });

    expect(calls).toEqual([
      `rename:${staged}->${destination}`,
      `rm:${transfer}`,
      `copy:${staged}->${transfer}`,
      `chmod:${transfer}:755`,
      `rename:${transfer}->${destination}`,
      `rm:${staged}`,
      `rm:${transfer}`,
    ]);
  });

  it("preserves the old destination and cleans transfer state when fallback copy fails", () => {
    const staged = "staged";
    const destination = "destination";
    const transfer = `${destination}.install-${process.pid}`;
    const copyError = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    const removed: string[] = [];

    expect(() =>
      installStagedFile(staged, destination, {
        rmSync(path: string) {
          removed.push(path);
        },
        renameSync() {
          throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
        },
        copyFileSync() {
          throw copyError;
        },
        chmodSync() {
          throw new Error("chmod must not run");
        },
      }),
    ).toThrow(copyError);
    expect(removed).toEqual([transfer, transfer]);
    expect(removed).not.toContain(destination);
    expect(removed).not.toContain(staged);
  });

  it("does not hide non-cross-device rename failures", () => {
    const error = Object.assign(new Error("access denied"), { code: "EACCES" });

    expect(() =>
      installStagedFile("staged", "destination", {
        rmSync() {},
        renameSync() {
          throw error;
        },
        copyFileSync() {
          throw new Error("copy must not run");
        },
        chmodSync() {
          throw new Error("chmod must not run");
        },
      }),
    ).toThrow(error);
  });
});
