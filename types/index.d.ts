/**
 * The values JPE's interface module keeps in Claude Code's per-session state, declared the way the plugin interface
 * requires (`claude plugin validate` checks every key the module names against this file).
 *
 * They are typed loosely on purpose: a value can outlive a reload of the module, so the module re-validates each one
 * with its own parsers (`parseHud`, `parseMemory`) before using it.
 */
/** Marks this file as a module so the declaration below augments the engine's own `claude-code` types. */
export type JpeStateContract = "jpe";

declare module "claude-code" {
  interface PluginState {
    jpe: {
      /** The latest project facts read from `jpe center hud --json`, or null before the first read. */
      hud: Shaped<unknown>;
      /** What is typed in the palette box. */
      query: string;
      /** A command waiting for the person to confirm it, because it can change things. */
      pending: Shaped<{ commandId: string; args: string } | null>;
      /** The last thing the interface wants to tell the person (a result or a problem). */
      notice: string;
      /** Favourites and recent commands. */
      memory: Shaped<unknown>;
      /** Which screen the pane shows: "home" or "review". */
      view: string;
      /** The latest review of the uncommitted changes read from `jpe show review --json`, or null. */
      review: Shaped<unknown>;
      /** The note typed beside the review's approve and reject buttons. */
      reviewNote: string;
      /** The file whose diff is open in the review, or an empty string. */
      reviewFile: string;
    };
  }
}
