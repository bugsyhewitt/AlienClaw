import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "alienclaw",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "alienclaw", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "alienclaw", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "alienclaw", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "alienclaw", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "alienclaw", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "alienclaw", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "alienclaw", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "alienclaw", "--profile", "work", "--dev", "status"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".alienclaw-dev");
    expect(env.ALIENCLAW_PROFILE).toBe("dev");
    expect(env.ALIENCLAW_STATE_DIR).toBe(expectedStateDir);
    expect(env.ALIENCLAW_CONFIG_PATH).toBe(path.join(expectedStateDir, "alienclaw.json"));
    expect(env.ALIENCLAW_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      ALIENCLAW_STATE_DIR: "/custom",
      ALIENCLAW_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.ALIENCLAW_STATE_DIR).toBe("/custom");
    expect(env.ALIENCLAW_GATEWAY_PORT).toBe("19099");
    expect(env.ALIENCLAW_CONFIG_PATH).toBe(path.join("/custom", "alienclaw.json"));
  });

  it("uses ALIENCLAW_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      ALIENCLAW_HOME: "/srv/alienclaw-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/alienclaw-home");
    expect(env.ALIENCLAW_STATE_DIR).toBe(path.join(resolvedHome, ".alienclaw-work"));
    expect(env.ALIENCLAW_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".alienclaw-work", "alienclaw.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "alienclaw doctor --fix",
      env: {},
      expected: "alienclaw doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "alienclaw doctor --fix",
      env: { ALIENCLAW_PROFILE: "default" },
      expected: "alienclaw doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "alienclaw doctor --fix",
      env: { ALIENCLAW_PROFILE: "Default" },
      expected: "alienclaw doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "alienclaw doctor --fix",
      env: { ALIENCLAW_PROFILE: "bad profile" },
      expected: "alienclaw doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "alienclaw --profile work doctor --fix",
      env: { ALIENCLAW_PROFILE: "work" },
      expected: "alienclaw --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "alienclaw --dev doctor",
      env: { ALIENCLAW_PROFILE: "dev" },
      expected: "alienclaw --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("alienclaw doctor --fix", { ALIENCLAW_PROFILE: "work" })).toBe(
      "alienclaw --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("alienclaw doctor --fix", { ALIENCLAW_PROFILE: "  jbalienclaw  " })).toBe(
      "alienclaw --profile jbalienclaw doctor --fix",
    );
  });

  it("handles command with no args after alienclaw", () => {
    expect(formatCliCommand("alienclaw", { ALIENCLAW_PROFILE: "test" })).toBe(
      "alienclaw --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm alienclaw doctor", { ALIENCLAW_PROFILE: "work" })).toBe(
      "pnpm alienclaw --profile work doctor",
    );
  });
});
