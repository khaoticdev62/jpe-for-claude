// Copies the version from package.json (the single source of truth) into the plugin manifest and the marketplace entry.
// The MCP server reads package.json directly at build time. Run by `npm version <bump>` and usable on its own.
import { readFile, writeFile } from "node:fs/promises";

const readJson = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), "utf8"));
const writeJson = (file, value) => writeFile(new URL(`../${file}`, import.meta.url), `${JSON.stringify(value, null, 2)}\n`);

const { version } = await readJson("package.json");
if (typeof version !== "string" || version === "") throw new Error("package.json has no version.");

const plugin = await readJson(".claude-plugin/plugin.json");
plugin.version = version;
await writeJson(".claude-plugin/plugin.json", plugin);

const marketplace = await readJson(".claude-plugin/marketplace.json");
for (const entry of marketplace.plugins) entry.version = version;
await writeJson(".claude-plugin/marketplace.json", marketplace);

console.log(`Synced plugin.json and marketplace.json to ${version}.`);
