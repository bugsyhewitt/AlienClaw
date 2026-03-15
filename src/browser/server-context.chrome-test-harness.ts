import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/alienclaw" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchAlienClawChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveAlienClawUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopAlienClawChrome: vi.fn(async () => {}),
}));
