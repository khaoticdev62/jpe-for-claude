# Deliberately broken sample projects

Each folder is a small project with one known fault. The end-to-end tests copy a project to a temporary
folder, add a `package.json` that points at this repository's own TypeScript compiler, and check that JPE
detects the fault, explains it, repairs it safely (with a backup), and reports honest evidence.

| Project | Fault | Detected by |
|---|---|---|
| type-error | a `string` assigned to a `number` | typecheck (tsc) and the TypeScript language server |
| missing-import | imports a file that does not exist | typecheck (TS2307) |
| wrong-api | calls `z.string().minimumLength()`, which zod does not have (it is `min()`) | typecheck (TS2551, "did you mean") and version-aware research of the installed zod |
| runtime-failure | `add()` subtracts; its unit test fails at runtime | node's test runner |
| security | `eval` of request input, SQL built from strings, a hard-coded key, a swallowed error | `jpe audit` and `jpe scan` |
| regression | an "improvement" breaks a function that used to work, next to a test that was already failing | baseline comparison |

The credential in `security/src/server.js` is fake and exists only so the scanner has something to find.
