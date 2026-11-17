import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.js";
import { parseHud, type HudData } from "../../src/center/hud-data.js";
import { actionBody, actionHead, homeActions, statusLineText } from "../../src/center/home.js";
import { EMPTY_MEMORY } from "../../src/center/memory.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { lineText, span } from "../../src/ui/doc.js";
import { paintLine, resolveSpanStyle } from "../../src/ui/paint.js";
import { DEFAULT_UI_SETTINGS, resolveProfile } from "../../src/ui/profile.js";
import { ROLES, THEME_NAMES } from "../../src/ui/tokens.js";

const ESC = "\u001b";
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): Promise<string> => readFile(path.join(ROOT, rel), "utf8");

describe("the built interface module (hooks/center.js)", () => {
  it("is registered in hooks.json beside the command hooks, and the file exists", async () => {
    const hooks = JSON.parse(await read("hooks/hooks.json")) as { hooks: Record<string, unknown>; modules: string[] };
    expect(hooks.modules).toEqual(["./center.js"]);
    expect(Object.keys(hooks.hooks)).toEqual(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"]);
    expect((await stat(path.join(ROOT, "hooks", "center.js"))).isFile()).toBe(true);
  });

  it("runs in the engine's sandbox: it imports only the engine's own module, and uses no Node feature", async () => {
    const bundle = await read("hooks/center.js");
    const imports = [...bundle.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(new Set(imports)).toEqual(new Set(["claude-code"]));
    for (const forbidden of [/\bnode:/, /\brequire\(/, /\bimport\(/, /\bprocess\.(?:env|cwd|exit|argv|platform)\b/, /\b__dirname\b/, /\bBuffer\b/, /\beval\(/, /new Function\(/, /\bfetch\(/, /XMLHttpRequest/]) {
      expect(bundle, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("exports register as a function declaration (what the engine's validator requires) and nothing else", async () => {
    const bundle = await read("hooks/center.js");
    expect(bundle).toMatch(/^function register\(on\) \{/m);
    expect(bundle).toMatch(/export \{\s*register\s*\};?\s*$/);
  });

  it("is a reasonable size", async () => {
    expect((await stat(path.join(ROOT, "hooks", "center.js"))).size).toBeLessThan(200_000);
  });

  it("starts nothing but the JPE command line: one argv, never a shell string", async () => {
    const source = await read("src/mod/center.tsx");
    const runs = [...source.matchAll(/\$\.process\.run\(([^)]*)\)/g)];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.[1]).toContain('["node", `${$.plugin.root}/dist/cli.js`, "center", "hud", "--json"]');
    expect(source).not.toMatch(/\$\.process\.spawn|\$\.fs\.|\$\.net|fetch\(/);
  });

  it("hooks only the events it is meant to", async () => {
    const source = await read("src/mod/center.tsx");
    expect([...source.matchAll(/\bon\("([a-z.]+)"/g)].map((m) => m[1])).toEqual(["session.start", "turn.complete", "command.run", "ui.render"]);
  });

  it("keeps every state value it uses declared in the types contract, and declares none it does not use", async () => {
    const source = await read("src/mod/center.tsx");
    const contract = await read("types/index.d.ts");
    const used = [...source.matchAll(/\{ plugin: "jpe", key: "([a-z]+)" \}/g)].map((m) => m[1]).sort();
    const declared = [...contract.matchAll(/^\s{6}([a-z]+): /gm)].map((m) => m[1]).sort();
    expect(used).toEqual(["hud", "memory", "notice", "pending", "query"]);
    expect(declared).toEqual(used);
  });

  it("has a self-contained contract file that the manifest points at", async () => {
    const manifest = JSON.parse(await read(".claude-plugin/plugin.json")) as { types?: string };
    expect(manifest.types).toBe("./types/index.d.ts");
    const contract = await read("types/index.d.ts");
    expect(contract).not.toMatch(/^\s*import\b/m);
    expect(contract).not.toMatch(/\brequire\(|\/\/\/\s*<reference/);
  });

  it("is the only thing that fails open, by design: its comment says why there is no .catch", async () => {
    const source = await read("src/mod/center.tsx");
    expect(source).toMatch(/fail\s+open/);
  });
});

describe("shared pieces the module relies on", () => {
  it("the module's default display settings equal the configuration's own defaults, so there is one truth", () => {
    expect(DEFAULT_UI_SETTINGS).toEqual(defaultConfig().ui);
  });

  it("a pane style and a command-line style agree for every role in every theme (same colour, same emphasis)", () => {
    for (const theme of THEME_NAMES) {
      const caps = detectCapabilities({ env: { COLORTERM: "truecolor" }, platform: "linux", isTTY: true, columns: 80, rows: 40 });
      for (const surface of ["terminal", "own"] as const) {
        const profile = resolveProfile(caps, { ...DEFAULT_UI_SETTINGS, theme }, { surface });
        for (const role of ROLES) {
          for (const bold of [false, true]) {
            const part = span("x", { role, bold });
            const style = resolveSpanStyle(profile, part);
            const ansi = paintLine([part], profile);
            const sgr = new RegExp(`${ESC}\\[([0-9;]*)m`).exec(ansi)?.[1] ?? "";
            const rgb = /38;2;(\d+);(\d+);(\d+)/.exec(sgr);
            // Emphasis codes are read with the colour part removed, because the colour code itself contains a 2.
            const attributes = sgr.replace(/38;2;\d+;\d+;\d+/, "").split(";");
            expect(attributes.includes("1"), `${theme}/${surface}/${role} bold`).toBe(style.bold);
            expect(attributes.includes("2"), `${theme}/${surface}/${role} dim`).toBe(style.dim);
            if (style.color === undefined) expect(rgb, `${theme}/${surface}/${role} colour`).toBeNull();
            else {
              const hex = `#${[1, 2, 3].map((i) => Number(rgb?.[i]).toString(16).padStart(2, "0")).join("")}`;
              expect(hex.toLowerCase(), `${theme}/${surface}/${role} colour`).toBe(style.color.toLowerCase());
            }
          }
        }
      }
    }
  });

  it("styles nothing when colour is off", () => {
    const caps = detectCapabilities({ env: { NO_COLOR: "1" }, platform: "linux", isTTY: true, columns: 80, rows: 40 });
    const profile = resolveProfile(caps, DEFAULT_UI_SETTINGS, { surface: "own" });
    expect(resolveSpanStyle(profile, span("x", { role: "error" })).color).toBeUndefined();
  });
});

const hud = (over: Partial<HudData> = {}): HudData => ({
  hudVersion: 1,
  generatedAt: "2026-03-04T12:00:00.000Z",
  project: { name: "demo", ecosystems: ["node"], packageManager: "npm" },
  git: { state: "dirty", branch: "main", changedFiles: 3 },
  verification: { status: "FAILED", at: "2026-03-04T11:55:00.000Z", reasons: ["x."], checksAvailable: ["unit-test"] },
  languageServersMissing: [],
  runtime: { offline: false, approval: "risk-based" },
  ...over,
});

describe("parseHud: only a HUD this version understands is accepted", () => {
  it("accepts a valid HUD, with and without the optional fields, for every git state", () => {
    expect(parseHud(hud())).toEqual(hud());
    expect(parseHud(JSON.parse(JSON.stringify(hud())))).toEqual(hud());
    for (const git of [{ state: "unavailable" }, { state: "not-repo" }, { state: "clean", branch: "main" }] as const) expect(parseHud(hud({ git }))).toBeDefined();
    const { at: _at, ...noAt } = hud().verification;
    expect(parseHud(hud({ verification: noAt }))).toBeDefined();
    expect(parseHud(hud({ verification: { ...hud().verification, problem: "damaged" } }))).toBeDefined();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "text"],
    ["an array", []],
    ["a number", 7],
    ["another HUD version", { ...hud(), hudVersion: 2 }],
    ["no version", (() => { const { hudVersion: _v, ...rest } = hud(); return rest; })()],
    ["a missing project", { ...hud(), project: undefined }],
    ["a project name that is not text", { ...hud(), project: { name: 5, ecosystems: [] } }],
    ["ecosystems that are not text", { ...hud(), project: { name: "x", ecosystems: [1] } }],
    ["an unknown git state", { ...hud(), git: { state: "weird" } }],
    ["a clean git state with no branch", { ...hud(), git: { state: "clean" } }],
    ["a dirty git state with no count", { ...hud(), git: { state: "dirty", branch: "m" } }],
    ["an unknown verification status", { ...hud(), verification: { ...hud().verification, status: "GREAT" } }],
    ["reasons that are not a list of text", { ...hud(), verification: { ...hud().verification, reasons: "x" } }],
    ["an 'at' that is not text", { ...hud(), verification: { ...hud().verification, at: 5 } }],
    ["language servers that are not text", { ...hud(), languageServersMissing: [1] }],
    ["a runtime with the wrong types", { ...hud(), runtime: { offline: "no", approval: "risk-based" } }],
    ["an unknown approval mode", { ...hud(), runtime: { offline: false, approval: "yolo" } }],
  ])("rejects %s", (_name, value) => {
    expect(parseHud(value)).toBeUndefined();
  });
});

describe("statusLineText", () => {
  it("leads with the verification status word and adds only what needs attention", () => {
    expect(statusLineText(hud())).toBe("JPE: FAILED · main +3 changed");
    expect(statusLineText(hud({ git: { state: "clean", branch: "main" }, verification: { ...hud().verification, status: "VERIFIED" } }))).toBe("JPE: VERIFIED · main");
    expect(statusLineText(hud({ git: { state: "not-repo" }, languageServersMissing: ["Go (gopls)"], runtime: { offline: true, approval: "risk-based" } }))).toBe("JPE: FAILED · 1 language server missing · offline");
    expect(statusLineText(hud({ git: { state: "unavailable" }, languageServersMissing: ["a", "b"] }))).toBe("JPE: FAILED · 2 language servers missing");
  });
  it("stays short enough for a status bar", () => {
    expect(statusLineText(hud({ git: { state: "dirty", branch: "feature/some-long-branch-name", changedFiles: 120 }, languageServersMissing: ["a", "b", "c"], runtime: { offline: true, approval: "always" } })).length).toBeLessThan(100);
  });
});

describe("actionHead and actionBody (what the pane draws)", () => {
  it("split the same text that the text screen prints, so the two cannot drift", () => {
    const caps = detectCapabilities({ env: {}, platform: "linux", isTTY: false, columns: 80, rows: 40 });
    const profile = resolveProfile(caps, DEFAULT_UI_SETTINGS);
    const [first] = homeActions(hud(), EMPTY_MEMORY);
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(lineText(actionHead(first))).toBe("1. /jpe:fix");
    expect(actionBody(first, profile).map(lineText).join("\n")).toContain("asks first · next step");
    expect(actionBody(first, profile).map(lineText).join("\n")).toContain("(confirmed)");
  });
});
