import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("alienclaw", 16)).toBe("alienclaw");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("alienclaw-status-output", 10)).toBe("alienclaw-…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});
