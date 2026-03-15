import * as compatSdk from "alienclaw/plugin-sdk/compat";
import * as discordSdk from "alienclaw/plugin-sdk/discord";
import * as imessageSdk from "alienclaw/plugin-sdk/imessage";
import * as lineSdk from "alienclaw/plugin-sdk/line";
import * as msteamsSdk from "alienclaw/plugin-sdk/msteams";
import * as signalSdk from "alienclaw/plugin-sdk/signal";
import * as slackSdk from "alienclaw/plugin-sdk/slack";
import * as telegramSdk from "alienclaw/plugin-sdk/telegram";
import * as whatsappSdk from "alienclaw/plugin-sdk/whatsapp";
import { describe, expect, it } from "vitest";

const bundledExtensionSubpathLoaders = [
  { id: "acpx", load: () => import("alienclaw/plugin-sdk/acpx") },
  { id: "bluebubbles", load: () => import("alienclaw/plugin-sdk/bluebubbles") },
  { id: "copilot-proxy", load: () => import("alienclaw/plugin-sdk/copilot-proxy") },
  { id: "device-pair", load: () => import("alienclaw/plugin-sdk/device-pair") },
  { id: "diagnostics-otel", load: () => import("alienclaw/plugin-sdk/diagnostics-otel") },
  { id: "diffs", load: () => import("alienclaw/plugin-sdk/diffs") },
  { id: "feishu", load: () => import("alienclaw/plugin-sdk/feishu") },
  {
    id: "google-gemini-cli-auth",
    load: () => import("alienclaw/plugin-sdk/google-gemini-cli-auth"),
  },
  { id: "googlechat", load: () => import("alienclaw/plugin-sdk/googlechat") },
  { id: "irc", load: () => import("alienclaw/plugin-sdk/irc") },
  { id: "llm-task", load: () => import("alienclaw/plugin-sdk/llm-task") },
  { id: "lobster", load: () => import("alienclaw/plugin-sdk/lobster") },
  { id: "matrix", load: () => import("alienclaw/plugin-sdk/matrix") },
  { id: "mattermost", load: () => import("alienclaw/plugin-sdk/mattermost") },
  { id: "memory-core", load: () => import("alienclaw/plugin-sdk/memory-core") },
  { id: "memory-lancedb", load: () => import("alienclaw/plugin-sdk/memory-lancedb") },
  {
    id: "minimax-portal-auth",
    load: () => import("alienclaw/plugin-sdk/minimax-portal-auth"),
  },
  { id: "nextcloud-talk", load: () => import("alienclaw/plugin-sdk/nextcloud-talk") },
  { id: "nostr", load: () => import("alienclaw/plugin-sdk/nostr") },
  { id: "open-prose", load: () => import("alienclaw/plugin-sdk/open-prose") },
  { id: "phone-control", load: () => import("alienclaw/plugin-sdk/phone-control") },
  { id: "qwen-portal-auth", load: () => import("alienclaw/plugin-sdk/qwen-portal-auth") },
  { id: "synology-chat", load: () => import("alienclaw/plugin-sdk/synology-chat") },
  { id: "talk-voice", load: () => import("alienclaw/plugin-sdk/talk-voice") },
  { id: "test-utils", load: () => import("alienclaw/plugin-sdk/test-utils") },
  { id: "thread-ownership", load: () => import("alienclaw/plugin-sdk/thread-ownership") },
  { id: "tlon", load: () => import("alienclaw/plugin-sdk/tlon") },
  { id: "twitch", load: () => import("alienclaw/plugin-sdk/twitch") },
  { id: "voice-call", load: () => import("alienclaw/plugin-sdk/voice-call") },
  { id: "zalo", load: () => import("alienclaw/plugin-sdk/zalo") },
  { id: "zalouser", load: () => import("alienclaw/plugin-sdk/zalouser") },
] as const;

describe("plugin-sdk subpath exports", () => {
  it("exports compat helpers", () => {
    expect(typeof compatSdk.emptyPluginConfigSchema).toBe("function");
    expect(typeof compatSdk.resolveControlCommandGate).toBe("function");
  });

  it("exports Discord helpers", () => {
    expect(typeof discordSdk.resolveDiscordAccount).toBe("function");
    expect(typeof discordSdk.inspectDiscordAccount).toBe("function");
    expect(typeof discordSdk.discordOnboardingAdapter).toBe("object");
  });

  it("exports Slack helpers", () => {
    expect(typeof slackSdk.resolveSlackAccount).toBe("function");
    expect(typeof slackSdk.inspectSlackAccount).toBe("function");
    expect(typeof slackSdk.handleSlackMessageAction).toBe("function");
  });

  it("exports Telegram helpers", () => {
    expect(typeof telegramSdk.resolveTelegramAccount).toBe("function");
    expect(typeof telegramSdk.inspectTelegramAccount).toBe("function");
    expect(typeof telegramSdk.telegramOnboardingAdapter).toBe("object");
  });

  it("exports Signal helpers", () => {
    expect(typeof signalSdk.resolveSignalAccount).toBe("function");
    expect(typeof signalSdk.signalOnboardingAdapter).toBe("object");
  });

  it("exports iMessage helpers", () => {
    expect(typeof imessageSdk.resolveIMessageAccount).toBe("function");
    expect(typeof imessageSdk.imessageOnboardingAdapter).toBe("object");
  });

  it("exports WhatsApp helpers", () => {
    expect(typeof whatsappSdk.resolveWhatsAppAccount).toBe("function");
    expect(typeof whatsappSdk.whatsappOnboardingAdapter).toBe("object");
  });

  it("exports LINE helpers", () => {
    expect(typeof lineSdk.processLineMessage).toBe("function");
    expect(typeof lineSdk.createInfoCard).toBe("function");
  });

  it("exports Microsoft Teams helpers", () => {
    expect(typeof msteamsSdk.resolveControlCommandGate).toBe("function");
    expect(typeof msteamsSdk.loadOutboundMediaFromUrl).toBe("function");
  });

  it("resolves bundled extension subpaths", async () => {
    for (const { id, load } of bundledExtensionSubpathLoaders) {
      const mod = await load();
      expect(typeof mod).toBe("object");
      expect(mod, `subpath ${id} should resolve`).toBeTruthy();
    }
  });
});
