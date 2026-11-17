// Builds the release package: a ready-to-install local marketplace, the installer scripts, checksums and a
// reproducible zip. Run `npm run build` first (the `package` npm script does both).
//
//   node scripts/package.mjs [--out <folder>]
//
// Output: <out>/jpe-<version>/ , <out>/jpe-<version>.zip , <out>/jpe-<version>.zip.sha256
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outIndex = process.argv.indexOf("--out");
const outRoot = path.resolve(outIndex !== -1 ? (process.argv[outIndex + 1] ?? "release") : path.join(root, "release"));

const PLUGIN_ENTRIES = [".claude-plugin/plugin.json", ".claude-plugin/icon.png", "skills", "agents", "hooks", "types", "README.md", "LICENSE", "CHANGELOG.md"];
const BUNDLES = ["cli.js", "hook.js", "mcp.js", "package.json"];

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// --- minimal, reproducible ZIP writer (deflate, fixed timestamps, unix modes) ---------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(files) {
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data, mode } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4); // made by: unix
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// --- main -----------------------------------------------------------------------------------------------------
const pkg = await readJson("package.json");
const plugin = await readJson(".claude-plugin/plugin.json");
const market = await readJson(".claude-plugin/marketplace.json");
const version = pkg.version;

const versions = { "package.json": pkg.version, ".claude-plugin/plugin.json": plugin.version, ".claude-plugin/marketplace.json": market.plugins?.[0]?.version };
const mismatched = Object.entries(versions).filter(([, v]) => v !== version);
if (mismatched.length > 0) {
  console.error(`Version mismatch (package.json says ${version}): ${mismatched.map(([f, v]) => `${f}=${v}`).join(", ")}`);
  process.exit(1);
}
for (const b of BUNDLES) {
  try {
    await stat(path.join(root, "dist", b));
  } catch {
    console.error(`dist/${b} is missing. Run \`npm run build\` first.`);
    process.exit(1);
  }
}

const name = `jpe-${version}`;
const releaseDir = path.join(outRoot, name);
await rm(releaseDir, { recursive: true, force: true });
const pluginDir = path.join(releaseDir, "jpe-marketplace", "plugins", "jpe");
await mkdir(pluginDir, { recursive: true });

for (const entry of PLUGIN_ENTRIES) {
  await mkdir(path.dirname(path.join(pluginDir, entry)), { recursive: true });
  await cp(path.join(root, entry), path.join(pluginDir, entry), { recursive: true });
}
await mkdir(path.join(pluginDir, "dist"));
for (const b of BUNDLES) await cp(path.join(root, "dist", b), path.join(pluginDir, "dist", b));

const releaseMarket = { ...market, plugins: market.plugins.map((p) => ({ ...p, source: "./plugins/jpe" })) };
await mkdir(path.join(releaseDir, "jpe-marketplace", ".claude-plugin"), { recursive: true });
await writeFile(path.join(releaseDir, "jpe-marketplace", ".claude-plugin", "marketplace.json"), `${JSON.stringify(releaseMarket, null, 2)}\n`);

await cp(path.join(root, "installer"), path.join(releaseDir, "installer"), { recursive: true });
for (const doc of ["README.md", "LICENSE", "CHANGELOG.md"]) await cp(path.join(root, doc), path.join(releaseDir, doc));
await cp(path.join(root, "docs", "INSTALL.md"), path.join(releaseDir, "INSTALL.md"));

// Checksums for every file in the package (the installer verifies these before it changes anything).
const relFiles = await walk(releaseDir);
const sums = [];
for (const rel of relFiles) sums.push(`${sha256(await readFile(path.join(releaseDir, rel)))}  ${rel}`);
await writeFile(path.join(releaseDir, "SHA256SUMS"), `${sums.join("\n")}\n`);

const allFiles = await walk(releaseDir);
const zipFiles = [];
for (const rel of allFiles) zipFiles.push({ name: `${name}/${rel}`, data: await readFile(path.join(releaseDir, rel)), mode: rel.endsWith(".sh") ? 0o755 : 0o644 });
const zip = buildZip(zipFiles);
const zipPath = path.join(outRoot, `${name}.zip`);
await writeFile(zipPath, zip);
await writeFile(`${zipPath}.sha256`, `${sha256(zip)}  ${name}.zip\n`);

console.log(`Packaged ${name}: ${allFiles.length} files, zip sha256 ${sha256(zip)}`);
