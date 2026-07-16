import { describe, it, expect } from "vitest";
import { getEvolveTopologyMode, isEvolveTopologyActive } from "../../../src/alienclaw/evolution/graph/feature-flag.js";

describe("EVOLVE_TOPOLOGY feature flag", () => {
  it("defaults to off when env not set", () => {
    const old = process.env["EVOLVE_TOPOLOGY"];
    delete process.env["EVOLVE_TOPOLOGY"];
    expect(getEvolveTopologyMode()).toBe("off");
    if (old !== undefined) process.env["EVOLVE_TOPOLOGY"] = old;
  });

  it("returns shadow when env=shadow", () => {
    process.env["EVOLVE_TOPOLOGY"] = "shadow";
    expect(getEvolveTopologyMode()).toBe("shadow");
    delete process.env["EVOLVE_TOPOLOGY"];
  });

  it("returns on when env=on", () => {
    process.env["EVOLVE_TOPOLOGY"] = "on";
    expect(getEvolveTopologyMode()).toBe("on");
    delete process.env["EVOLVE_TOPOLOGY"];
  });

  it("falls back to off for unrecognized values", () => {
    process.env["EVOLVE_TOPOLOGY"] = "invalid";
    expect(getEvolveTopologyMode()).toBe("off");
    delete process.env["EVOLVE_TOPOLOGY"];
  });

  it("isEvolveTopologyActive returns false when off", () => {
    const old = process.env["EVOLVE_TOPOLOGY"];
    delete process.env["EVOLVE_TOPOLOGY"];
    expect(isEvolveTopologyActive()).toBe(false);
    if (old !== undefined) process.env["EVOLVE_TOPOLOGY"] = old;
  });

  it("isEvolveTopologyActive returns true when shadow", () => {
    process.env["EVOLVE_TOPOLOGY"] = "shadow";
    expect(isEvolveTopologyActive()).toBe(true);
    delete process.env["EVOLVE_TOPOLOGY"];
  });
});
