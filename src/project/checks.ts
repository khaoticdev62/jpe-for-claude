import type { CheckName } from "../core/evidence.js";
import type { ProjectInfo } from "./detect.js";
import { inRoot, type ProjectFs } from "./fs.js";

export interface DiscoveredCheck {
  check: CheckName;
  /** Program to run (never a shell line). */
  file: string;
  args: string[];
  /** script = defined by the project; convention = standard tool for the ecosystem; inferred = guessed from dependencies. */
  source: "script" | "convention" | "inferred";
  display: string;
}

const SAFE_SCRIPT_NAME = /^[A-Za-z0-9:_-]+$/;
const PLACEHOLDER_TEST = /no test specified/i;

const SCRIPT_CANDIDATES: ReadonlyArray<readonly [CheckName, readonly string[]]> = [
  ["typecheck", ["typecheck", "type-check", "check-types", "tsc"]],
  ["lint", ["lint"]],
  ["format", ["format:check", "format-check", "check-format", "prettier:check"]],
  ["unit-test", ["test", "test:unit"]],
  ["integration-test", ["test:integration"]],
  ["e2e-test", ["test:e2e", "e2e"]],
  ["build", ["build"]],
];

function make(check: CheckName, file: string, args: string[], source: DiscoveredCheck["source"]): DiscoveredCheck {
  return { check, file, args, source, display: [file, ...args].join(" ") };
}

function nodeChecks(info: ProjectInfo): DiscoveredCheck[] {
  const manager = info.packageManager ?? "npm";
  const found: DiscoveredCheck[] = [];
  for (const [check, names] of SCRIPT_CANDIDATES) {
    const name = names.find((n) => {
      const body = info.scripts[n];
      return body !== undefined && SAFE_SCRIPT_NAME.test(n) && !(check === "unit-test" && PLACEHOLDER_TEST.test(body));
    });
    if (name) found.push(make(check, manager, ["run", name], "script"));
  }
  const hasTypecheck = found.some((c) => c.check === "typecheck");
  const usesTypescript = info.dependencies.some((d) => d.name === "typescript");
  if (!hasTypecheck && usesTypescript) found.push(make("typecheck", "npx", ["--no-install", "tsc", "--noEmit"], "inferred"));
  if (info.hasLockfile) {
    found.push(make("dependency-audit", manager, manager === "npm" ? ["audit", "--audit-level=high"] : ["audit"], "convention"));
  }
  return found;
}

async function pythonChecks(info: ProjectInfo, fs: ProjectFs): Promise<DiscoveredCheck[]> {
  const pyproject = (await fs.readText(inRoot(info.root, "pyproject.toml"))) ?? "";
  const found: DiscoveredCheck[] = [];
  if (pyproject.includes("[tool.pytest") || (await fs.exists(inRoot(info.root, "pytest.ini")))) {
    found.push(make("unit-test", "python", ["-m", "pytest"], "convention"));
  }
  if (pyproject.includes("[tool.ruff") || (await fs.exists(inRoot(info.root, "ruff.toml")))) {
    found.push(make("lint", "ruff", ["check", "."], "convention"));
  }
  if (pyproject.includes("[tool.mypy") || (await fs.exists(inRoot(info.root, "mypy.ini")))) {
    found.push(make("typecheck", "mypy", ["."], "convention"));
  }
  return found;
}

/**
 * Lists the verification commands this project actually has. Nothing is installed or invented
 * beyond standard tools of the detected ecosystem, so JPE never adds a framework just to have tests.
 */
export async function discoverChecks(info: ProjectInfo, fs: ProjectFs): Promise<DiscoveredCheck[]> {
  const found: DiscoveredCheck[] = [];
  if (info.ecosystems.includes("node")) found.push(...nodeChecks(info));
  if (info.ecosystems.includes("python")) found.push(...(await pythonChecks(info, fs)));
  if (info.ecosystems.includes("go")) {
    found.push(make("build", "go", ["build", "./..."], "convention"));
    found.push(make("unit-test", "go", ["test", "./..."], "convention"));
    found.push(make("static-analysis", "go", ["vet", "./..."], "convention"));
  }
  if (info.ecosystems.includes("rust")) {
    found.push(make("typecheck", "cargo", ["check"], "convention"));
    found.push(make("unit-test", "cargo", ["test"], "convention"));
    found.push(make("build", "cargo", ["build"], "convention"));
    found.push(make("lint", "cargo", ["clippy"], "convention"));
  }
  return found;
}
