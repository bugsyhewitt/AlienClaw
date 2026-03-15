import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#alienclaw",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#alienclaw",
      rawTarget: "#alienclaw",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "alienclaw-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "alienclaw-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "alienclaw-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "alienclaw-bot",
      rawTarget: "alienclaw-bot",
    });
  });
});
