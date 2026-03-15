import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function withTempConfig(params: {
  cfg: unknown;
  run: () => Promise<void>;
  prefix?: string;
}): Promise<void> {
  const prevConfigPath = process.env.ALIENCLAW_CONFIG_PATH;
  const prevDisableCache = process.env.ALIENCLAW_DISABLE_CONFIG_CACHE;

  const dir = await mkdtemp(path.join(os.tmpdir(), params.prefix ?? "alienclaw-test-config-"));
  const configPath = path.join(dir, "alienclaw.json");

  process.env.ALIENCLAW_CONFIG_PATH = configPath;
  process.env.ALIENCLAW_DISABLE_CONFIG_CACHE = "1";

  try {
    await writeFile(configPath, JSON.stringify(params.cfg, null, 2), "utf-8");
    await params.run();
  } finally {
    if (prevConfigPath === undefined) {
      delete process.env.ALIENCLAW_CONFIG_PATH;
    } else {
      process.env.ALIENCLAW_CONFIG_PATH = prevConfigPath;
    }
    if (prevDisableCache === undefined) {
      delete process.env.ALIENCLAW_DISABLE_CONFIG_CACHE;
    } else {
      process.env.ALIENCLAW_DISABLE_CONFIG_CACHE = prevDisableCache;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
