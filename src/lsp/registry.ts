import path from "node:path";

export type LanguageId =
  | "typescript" | "javascript" | "python" | "go" | "rust" | "c" | "cpp"
  | "csharp" | "java" | "kotlin" | "php" | "ruby" | "lua" | "swift";

export interface InstallOption {
  /** Program that must already exist for this option to be usable (npm, go, rustup...). */
  requires: string;
  file: string;
  args: readonly string[];
  platforms?: readonly NodeJS.Platform[];
}

export interface ServerSpec {
  /** Executable that speaks the Language Server Protocol over stdio. */
  binary: string;
  args: readonly string[];
  /** Arguments that print a version and exit; absent when the server has no such flag. */
  versionArgs?: readonly string[];
  /** Official Claude Code code-intelligence plugin for this server (documented at code.claude.com). */
  nativePlugin?: string;
  install: readonly InstallOption[];
  /** Shown when no scripted install exists or in addition to it. */
  manualInstall?: string;
  /** docs = taken from Claude Code's documentation; advisory = from the server's own project, confirm before relying on it. */
  installConfidence: "docs" | "advisory";
}

export interface LanguageSpec {
  id: LanguageId;
  name: string;
  /** Extension (with dot) -> LSP languageId sent in didOpen. */
  extensions: Readonly<Record<string, string>>;
  server: ServerSpec;
  /** Command that reports compile errors without a language server, with the parser to read it. */
  fallback?: { file: string; args: readonly string[]; requires: string; note?: string };
}

const tsServer: ServerSpec = {
  binary: "typescript-language-server",
  args: ["--stdio"],
  versionArgs: ["--version"],
  nativePlugin: "typescript-lsp",
  install: [{ requires: "npm", file: "npm", args: ["install", "-g", "typescript-language-server", "typescript"] }],
  installConfidence: "docs",
};

export const LANGUAGES: readonly LanguageSpec[] = [
  {
    id: "typescript",
    name: "TypeScript",
    extensions: { ".ts": "typescript", ".tsx": "typescriptreact", ".mts": "typescript", ".cts": "typescript" },
    server: tsServer,
    fallback: { file: "npx", args: ["--no-install", "tsc", "--noEmit"], requires: "npx", note: "needs a tsconfig.json" },
  },
  {
    id: "javascript",
    name: "JavaScript",
    extensions: { ".js": "javascript", ".jsx": "javascriptreact", ".mjs": "javascript", ".cjs": "javascript" },
    server: tsServer,
  },
  {
    id: "python",
    name: "Python",
    extensions: { ".py": "python", ".pyi": "python" },
    server: {
      binary: "pyright-langserver",
      args: ["--stdio"],
      nativePlugin: "pyright-lsp",
      install: [{ requires: "npm", file: "npm", args: ["install", "-g", "pyright"] }, { requires: "pip", file: "pip", args: ["install", "pyright"] }],
      installConfidence: "advisory",
    },
  },
  {
    id: "go",
    name: "Go",
    extensions: { ".go": "go" },
    server: {
      binary: "gopls",
      args: ["serve"],
      versionArgs: ["version"],
      nativePlugin: "gopls-lsp",
      install: [{ requires: "go", file: "go", args: ["install", "golang.org/x/tools/gopls@latest"] }],
      installConfidence: "advisory",
    },
    fallback: { file: "go", args: ["vet", "./..."], requires: "go" },
  },
  {
    id: "rust",
    name: "Rust",
    extensions: { ".rs": "rust" },
    server: {
      binary: "rust-analyzer",
      args: [],
      versionArgs: ["--version"],
      nativePlugin: "rust-analyzer-lsp",
      install: [{ requires: "rustup", file: "rustup", args: ["component", "add", "rust-analyzer"] }],
      installConfidence: "advisory",
    },
    fallback: { file: "cargo", args: ["check", "--color", "never"], requires: "cargo" },
  },
  clangLanguage("c", "C", { ".c": "c", ".h": "c" }),
  clangLanguage("cpp", "C++", { ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp" }),
  {
    id: "csharp",
    name: "C#",
    extensions: { ".cs": "csharp" },
    server: {
      binary: "csharp-ls",
      args: [],
      versionArgs: ["--version"],
      nativePlugin: "csharp-lsp",
      install: [{ requires: "dotnet", file: "dotnet", args: ["tool", "install", "--global", "csharp-ls"] }],
      installConfidence: "advisory",
    },
    fallback: { file: "dotnet", args: ["build", "--nologo", "-v", "q"], requires: "dotnet" },
  },
  {
    id: "java",
    name: "Java",
    extensions: { ".java": "java" },
    server: {
      binary: "jdtls",
      args: [],
      nativePlugin: "jdtls-lsp",
      install: [{ requires: "brew", file: "brew", args: ["install", "jdtls"], platforms: ["darwin", "linux"] }],
      manualInstall: "Download the Eclipse JDT Language Server from the Eclipse JDT LS project and put a `jdtls` launcher on your PATH.",
      installConfidence: "advisory",
    },
  },
  {
    id: "kotlin",
    name: "Kotlin",
    extensions: { ".kt": "kotlin", ".kts": "kotlin" },
    server: {
      binary: "kotlin-lsp",
      args: [],
      nativePlugin: "kotlin-lsp",
      install: [],
      manualInstall: "Install the Kotlin language server and make a `kotlin-lsp` executable available on your PATH (see the kotlin-lsp plugin README).",
      installConfidence: "advisory",
    },
  },
  {
    id: "php",
    name: "PHP",
    extensions: { ".php": "php" },
    server: {
      binary: "intelephense",
      args: ["--stdio"],
      nativePlugin: "php-lsp",
      install: [{ requires: "npm", file: "npm", args: ["install", "-g", "intelephense"] }],
      installConfidence: "advisory",
    },
  },
  {
    id: "ruby",
    name: "Ruby",
    extensions: { ".rb": "ruby", ".rake": "ruby" },
    server: {
      binary: "ruby-lsp",
      args: [],
      versionArgs: ["--version"],
      nativePlugin: "ruby-lsp",
      install: [{ requires: "gem", file: "gem", args: ["install", "ruby-lsp"] }],
      installConfidence: "advisory",
    },
  },
  {
    id: "lua",
    name: "Lua",
    extensions: { ".lua": "lua" },
    server: {
      binary: "lua-language-server",
      args: [],
      versionArgs: ["--version"],
      nativePlugin: "lua-lsp",
      install: [{ requires: "brew", file: "brew", args: ["install", "lua-language-server"], platforms: ["darwin", "linux"] }],
      manualInstall: "On Windows, download a release of LuaLS (lua-language-server) and add its bin folder to your PATH.",
      installConfidence: "advisory",
    },
  },
  {
    id: "swift",
    name: "Swift",
    extensions: { ".swift": "swift" },
    server: {
      binary: "sourcekit-lsp",
      args: [],
      nativePlugin: "swift-lsp",
      install: [],
      manualInstall: "sourcekit-lsp ships with the Swift toolchain (Xcode on macOS, or the toolchain from swift.org).",
      installConfidence: "advisory",
    },
  },
];

function clangLanguage(id: "c" | "cpp", name: string, extensions: Record<string, string>): LanguageSpec {
  return {
    id,
    name,
    extensions,
    server: {
      binary: "clangd",
      args: [],
      versionArgs: ["--version"],
      nativePlugin: "clangd-lsp",
      install: [
        { requires: "brew", file: "brew", args: ["install", "llvm"], platforms: ["darwin"] },
        { requires: "apt-get", file: "apt-get", args: ["install", "-y", "clangd"], platforms: ["linux"] },
        { requires: "winget", file: "winget", args: ["install", "LLVM.LLVM"], platforms: ["win32"] },
      ],
      installConfidence: "advisory",
    },
  };
}

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l] as const));
const BY_EXTENSION = new Map(LANGUAGES.flatMap((l) => Object.keys(l.extensions).map((ext) => [ext, l] as const)));

export function getLanguage(id: LanguageId): LanguageSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`Unknown language: ${id}`);
  return spec;
}

/** Language of a file by extension (case-insensitive), or undefined for unsupported files. */
export function languageForFile(file: string): { language: LanguageSpec; languageId: string } | undefined {
  const ext = path.extname(file).toLowerCase();
  const language = BY_EXTENSION.get(ext);
  const languageId = language?.extensions[ext];
  return language && languageId ? { language, languageId } : undefined;
}

export interface InstallPlan {
  language: LanguageId;
  binary: string;
  nativePlugin?: string;
  /** Options whose prerequisite tool is present: can be offered to the user for approval. */
  available: InstallOption[];
  /** Options that need a tool the machine does not have yet. */
  blocked: Array<{ option: InstallOption; missing: string }>;
  manual?: string;
  confidence: ServerSpec["installConfidence"];
}

/**
 * Builds the install choices for a language on this platform. Nothing is run here: the caller must
 * show the exact command and get the user's approval first.
 */
export function planInstall(language: LanguageSpec, platform: NodeJS.Platform, hasTool: (name: string) => boolean): InstallPlan {
  const { server } = language;
  const applicable = server.install.filter((o) => !o.platforms || o.platforms.includes(platform));
  return {
    language: language.id,
    binary: server.binary,
    ...(server.nativePlugin ? { nativePlugin: server.nativePlugin } : {}),
    available: applicable.filter((o) => hasTool(o.requires)),
    blocked: applicable.filter((o) => !hasTool(o.requires)).map((option) => ({ option, missing: option.requires })),
    ...(server.manualInstall ? { manual: server.manualInstall } : {}),
    confidence: server.installConfidence,
  };
}
