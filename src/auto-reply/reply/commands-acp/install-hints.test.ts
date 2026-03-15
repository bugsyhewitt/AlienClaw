import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AlienClawConfig } from "../../../config/config.js";
import { resolveAcpInstallCommandHint, resolveConfiguredAcpBackendId } from "./install-hints.js";

const originalCwd = process.cwd();
const tempDirs: string[] = [];

function withAcpConfig(acp: AlienClawConfig["acp"]): AlienClawConfig {
  return { acp } as AlienClawConfig;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ACP install hints", () => {
  it("prefers explicit runtime install command", () => {
    const cfg = withAcpConfig({
      runtime: { installCommand: "pnpm alienclaw plugins install acpx" },
    });
    expect(resolveAcpInstallCommandHint(cfg)).toBe("pnpm alienclaw plugins install acpx");
  });

  it("uses local acpx extension path when present", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acp-install-hint-"));
    tempDirs.push(tempRoot);
    fs.mkdirSync(path.join(tempRoot, "extensions", "acpx"), { recursive: true });
    process.chdir(tempRoot);

    const cfg = withAcpConfig({ backend: "acpx" });
    const hint = resolveAcpInstallCommandHint(cfg);
    expect(hint).toContain("alienclaw plugins install ");
    expect(hint).toContain(path.join("extensions", "acpx"));
  });

  it("falls back to npm install hint for acpx when local extension is absent", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acp-install-hint-"));
    tempDirs.push(tempRoot);
    process.chdir(tempRoot);

    const cfg = withAcpConfig({ backend: "acpx" });
    expect(resolveAcpInstallCommandHint(cfg)).toBe("alienclaw plugins install acpx");
  });

  it("returns generic plugin hint for non-acpx backend", () => {
    const cfg = withAcpConfig({ backend: "custom-backend" });
    expect(resolveConfiguredAcpBackendId(cfg)).toBe("custom-backend");
    expect(resolveAcpInstallCommandHint(cfg)).toContain('ACP backend "custom-backend"');
  });
});
