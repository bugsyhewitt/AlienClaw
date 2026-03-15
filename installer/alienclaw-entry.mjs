#!/usr/bin/env node
// AlienClaw entry point — first-run setup gate + CLI launcher.
// If ~/.alienclaw/preferences.json lacks setupComplete:true, the setup wizard
// runs instead of the normal CLI. After setup completes, users can run again.

import module from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Node version gate (same as upstream alienclaw.mjs) ───────────────────────
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 12;
const MIN_NODE_VERSION = `${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`;

const parseNodeVersion = (rawVersion) => {
  const [majorRaw = "0", minorRaw = "0"] = rawVersion.split(".");
  return { major: Number(majorRaw), minor: Number(minorRaw) };
};

const isSupportedNodeVersion = (v) =>
  v.major > MIN_NODE_MAJOR || (v.major === MIN_NODE_MAJOR && v.minor >= MIN_NODE_MINOR);

if (!isSupportedNodeVersion(parseNodeVersion(process.versions.node))) {
  process.stderr.write(
    `alienclaw: Node.js v${MIN_NODE_VERSION}+ is required (current: v${process.versions.node}).\n` +
    "If you use nvm, run:\n" +
    `  nvm install ${MIN_NODE_MAJOR}\n` +
    `  nvm use ${MIN_NODE_MAJOR}\n` +
    `  nvm alias default ${MIN_NODE_MAJOR}\n`,
  );
  process.exit(1);
}

// ── Module compile cache ─────────────────────────────────────────────────────
if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try { module.enableCompileCache(); } catch { /* ignore */ }
}

// ── First-run check ──────────────────────────────────────────────────────────
const ALIENCLAW_HOME = process.env.ALIENCLAW_HOME ?? path.join(os.homedir(), ".alienclaw");
const PREFS_FILE = path.join(ALIENCLAW_HOME, "preferences.json");

let setupComplete = false;
try {
  const prefs = JSON.parse(fs.readFileSync(PREFS_FILE, "utf-8"));
  setupComplete = prefs.setupComplete === true;
} catch {
  // File missing or invalid — treat as first run
}

if (!setupComplete) {
  // Wizard lives at installer/setup/first-run.mjs relative to this file
  const wizardPath = path.join(__dirname, "setup", "first-run.mjs");
  if (!fs.existsSync(wizardPath)) {
    process.stderr.write(
      `alienclaw: setup wizard not found at ${wizardPath}\n` +
      "Run: node build/installer/setup/first-run.mjs\n",
    );
    process.exit(1);
  }
  const { runFirstRun } = await import(wizardPath);
  await runFirstRun();
  process.exit(0);
}

// ── Normal startup ───────────────────────────────────────────────────────────
const isModuleNotFoundError = (err) =>
  err && typeof err === "object" && "code" in err && err.code === "ERR_MODULE_NOT_FOUND";

const installProcessWarningFilter = async () => {
  for (const specifier of ["./dist/warning-filter.js", "./dist/warning-filter.mjs"]) {
    try {
      const mod = await import(specifier);
      if (typeof mod.installProcessWarningFilter === "function") {
        mod.installProcessWarningFilter();
        return;
      }
    } catch (err) {
      if (isModuleNotFoundError(err)) continue;
      throw err;
    }
  }
};

await installProcessWarningFilter();

const tryImport = async (specifier) => {
  try {
    await import(specifier);
    return true;
  } catch (err) {
    if (isModuleNotFoundError(err)) return false;
    throw err;
  }
};

if (await tryImport("./dist/entry.js")) {
  // OK
} else if (await tryImport("./dist/entry.mjs")) {
  // OK
} else {
  throw new Error("alienclaw: missing dist/entry.(m)js (build output).");
}
