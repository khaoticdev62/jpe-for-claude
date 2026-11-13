import path from "node:path";

export interface PathEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
}

function joiner(platform: NodeJS.Platform): (...parts: string[]) => string {
  return platform === "win32" ? path.win32.join : path.posix.join;
}

/** Per-OS user data directory (config, cache, backups). Honors CLAUDE_PLUGIN_DATA when set. */
export function dataDir(p: PathEnv): string {
  const pluginData = p.env["CLAUDE_PLUGIN_DATA"];
  if (pluginData) return pluginData;
  const join = joiner(p.platform);
  switch (p.platform) {
    case "win32":
      return join(p.env["APPDATA"] ?? join(p.homedir, "AppData", "Roaming"), "jpe");
    case "darwin":
      return join(p.homedir, "Library", "Application Support", "jpe");
    default:
      return join(p.env["XDG_DATA_HOME"] ?? join(p.homedir, ".local", "share"), "jpe");
  }
}

export function globalConfigPath(p: PathEnv): string {
  return joiner(p.platform)(dataDir(p), "config.json");
}

export function projectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".jpe", "config.json");
}
