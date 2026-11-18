import { describe, expect, it } from "vitest";
import { flagBool, parseArgs } from "../../src/cli/args.js";

/**
 * A yes/no flag must never swallow the word after it. `--confirm remove cache` once parsed "remove" as the flag's value,
 * which silently changed what the command did.
 */
describe("yes/no flags do not swallow the next word", () => {
  it.each([
    ["--apply", ["settings", "preset", "--apply", "high-contrast"], ["settings", "preset", "high-contrast"]],
    ["--confirm", ["data", "--confirm", "remove", "cache"], ["data", "remove", "cache"]],
    ["--check", ["about", "--check", "extra"], ["about", "extra"]],
  ])("%s", (flag, argv, positionals) => {
    const parsed = parseArgs(argv);
    expect(flagBool(parsed, flag.slice(2))).toBe(true);
    expect(parsed.positionals).toEqual(positionals);
  });

  it("a flag that takes a value still takes it", () => {
    const parsed = parseArgs(["log", "--level", "error", "--limit", "5"]);
    expect(parsed.flags.get("level")).toBe("error");
    expect(parsed.flags.get("limit")).toBe("5");
    expect(parsed.positionals).toEqual(["log"]);
  });
});
