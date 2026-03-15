import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          ALIENCLAW_STATE_DIR: "/tmp/alienclaw-state",
          ALIENCLAW_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "alienclaw-gateway",
        windowsTaskName: "AlienClaw Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/alienclaw-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/alienclaw-state/logs/gateway.err.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        systemdServiceName: "alienclaw-gateway",
        windowsTaskName: "AlienClaw Gateway",
      }),
    ).toEqual(["Logs: journalctl --user -u alienclaw-gateway.service -n 200 --no-pager"]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        systemdServiceName: "alienclaw-gateway",
        windowsTaskName: "AlienClaw Gateway",
      }),
    ).toEqual(['Logs: schtasks /Query /TN "AlienClaw Gateway" /V /FO LIST']);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "alienclaw gateway install",
        startCommand: "alienclaw gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.alienclaw.gateway.plist",
        systemdServiceName: "alienclaw-gateway",
        windowsTaskName: "AlienClaw Gateway",
      }),
    ).toEqual([
      "alienclaw gateway install",
      "alienclaw gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.alienclaw.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "alienclaw gateway install",
        startCommand: "alienclaw gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.alienclaw.gateway.plist",
        systemdServiceName: "alienclaw-gateway",
        windowsTaskName: "AlienClaw Gateway",
      }),
    ).toEqual([
      "alienclaw gateway install",
      "alienclaw gateway",
      "systemctl --user start alienclaw-gateway.service",
    ]);
  });
});
