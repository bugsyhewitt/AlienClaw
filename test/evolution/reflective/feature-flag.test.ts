import { describe, it, expect } from "vitest";
import {
  getReflectiveMode,
  isReflectiveActive,
} from "../../../src/alienclaw/evolution/reflective/feature-flag.js";

describe("REFLECTIVE_EVOLUTION feature flag", () => {
  it("defaults to off when env not set", () => {
    const old = process.env["REFLECTIVE_EVOLUTION"];
    delete process.env["REFLECTIVE_EVOLUTION"];
    expect(getReflectiveMode()).toBe("off");
    if (old !== undefined) process.env["REFLECTIVE_EVOLUTION"] = old;
  });

  it("returns shadow when env=shadow", () => {
    process.env["REFLECTIVE_EVOLUTION"] = "shadow";
    expect(getReflectiveMode()).toBe("shadow");
    delete process.env["REFLECTIVE_EVOLUTION"];
  });

  it("returns on when env=on", () => {
    process.env["REFLECTIVE_EVOLUTION"] = "on";
    expect(getReflectiveMode()).toBe("on");
    delete process.env["REFLECTIVE_EVOLUTION"];
  });

  it("falls back to off for unrecognized values", () => {
    process.env["REFLECTIVE_EVOLUTION"] = "invalid";
    expect(getReflectiveMode()).toBe("off");
    delete process.env["REFLECTIVE_EVOLUTION"];
  });

  it("isReflectiveActive returns false when off", () => {
    const old = process.env["REFLECTIVE_EVOLUTION"];
    delete process.env["REFLECTIVE_EVOLUTION"];
    expect(isReflectiveActive()).toBe(false);
    if (old !== undefined) process.env["REFLECTIVE_EVOLUTION"] = old;
  });

  it("isReflectiveActive returns true when shadow", () => {
    process.env["REFLECTIVE_EVOLUTION"] = "shadow";
    expect(isReflectiveActive()).toBe(true);
    delete process.env["REFLECTIVE_EVOLUTION"];
  });
});
