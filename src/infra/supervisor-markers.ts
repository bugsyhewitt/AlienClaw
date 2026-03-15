const LAUNCHD_SUPERVISOR_HINT_ENV_VARS = [
  "LAUNCH_JOB_LABEL",
  "LAUNCH_JOB_NAME",
  "ALIENCLAW_LAUNCHD_LABEL",
] as const;

const SYSTEMD_SUPERVISOR_HINT_ENV_VARS = [
  "ALIENCLAW_SYSTEMD_UNIT",
  "INVOCATION_ID",
  "SYSTEMD_EXEC_PID",
  "JOURNAL_STREAM",
] as const;

const WINDOWS_TASK_SUPERVISOR_HINT_ENV_VARS = ["ALIENCLAW_WINDOWS_TASK_NAME"] as const;

export const SUPERVISOR_HINT_ENV_VARS = [
  ...LAUNCHD_SUPERVISOR_HINT_ENV_VARS,
  ...SYSTEMD_SUPERVISOR_HINT_ENV_VARS,
  ...WINDOWS_TASK_SUPERVISOR_HINT_ENV_VARS,
  "ALIENCLAW_SERVICE_MARKER",
  "ALIENCLAW_SERVICE_KIND",
] as const;

export type RespawnSupervisor = "launchd" | "systemd" | "schtasks";

function hasAnyHint(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function detectRespawnSupervisor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): RespawnSupervisor | null {
  if (platform === "darwin") {
    return hasAnyHint(env, LAUNCHD_SUPERVISOR_HINT_ENV_VARS) ? "launchd" : null;
  }
  if (platform === "linux") {
    return hasAnyHint(env, SYSTEMD_SUPERVISOR_HINT_ENV_VARS) ? "systemd" : null;
  }
  if (platform === "win32") {
    if (hasAnyHint(env, WINDOWS_TASK_SUPERVISOR_HINT_ENV_VARS)) {
      return "schtasks";
    }
    const marker = env.ALIENCLAW_SERVICE_MARKER?.trim();
    const serviceKind = env.ALIENCLAW_SERVICE_KIND?.trim();
    return marker && serviceKind === "gateway" ? "schtasks" : null;
  }
  return null;
}
