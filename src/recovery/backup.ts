import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { JpeError } from "../core/errors.js";
import { resolveInsideReal } from "../security/paths.js";
import { isSensitiveFileName } from "../security/scan.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

const fileRecordSchema = z.strictObject({
  path: z.string().min(1),
  existed: z.boolean(),
  size: z.number().int().min(0),
  sha256: z.string().optional(),
  /** Hash after the change (null = the file was absent). Present once the backup is sealed. */
  afterSha256: z.string().nullable().optional(),
});

const manifestSchema = z.strictObject({
  id: z.string().regex(ID_PATTERN),
  createdAt: z.iso.datetime(),
  projectRoot: z.string().min(1),
  label: z.string(),
  sealed: z.boolean(),
  files: z.array(fileRecordSchema),
});

export type BackupManifest = z.infer<typeof manifestSchema>;
type FileRecord = z.infer<typeof fileRecordSchema>;

export interface RollbackResult {
  restored: string[];
  removed: string[];
  /** Files changed by someone else after the backup was sealed; left alone unless forced. */
  conflicts: string[];
  problems: string[];
  /** A safety backup of the state that rollback replaced, so rollback itself is undoable. */
  safetyBackupId?: string;
}

export interface BackupDeps {
  /** Folder that holds all backups (inside the plugin data directory). */
  dir: string;
  now: () => Date;
  newId: () => string;
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

async function readIfExists(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeAtomic(file: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.jpe-tmp-${process.pid}`;
  await writeFile(temp, data);
  await rename(temp, file);
}

function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new JpeError("INVALID_INPUT", "That is not a valid backup id.");
}

/**
 * File-level backups taken before JPE edits anything, with rollback that refuses to clobber
 * work done after the change. It never runs git commands, so uncommitted work is never at risk.
 */
export class BackupStore {
  constructor(private readonly deps: BackupDeps) {}

  private backupDir(id: string): string {
    assertId(id);
    return path.join(this.deps.dir, id);
  }

  private async readManifest(id: string): Promise<BackupManifest> {
    const text = await readIfExists(path.join(this.backupDir(id), "manifest.json"));
    if (!text) throw new JpeError("INVALID_INPUT", `No backup named "${id}" was found.`);
    let raw: unknown;
    try {
      raw = JSON.parse(text.toString("utf8"));
    } catch (cause) {
      throw new JpeError("INVALID_INPUT", `Backup "${id}" has a damaged manifest.`, { cause });
    }
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== id) throw new JpeError("INVALID_INPUT", `Backup "${id}" has an invalid manifest.`);
    return parsed.data;
  }

  private async writeManifest(manifest: BackupManifest): Promise<void> {
    await writeAtomic(path.join(this.backupDir(manifest.id), "manifest.json"), Buffer.from(JSON.stringify(manifest, null, 2)));
  }

  /** Copies the listed project files (as they are right now) into a new backup. */
  async create(projectRoot: string, relativePaths: readonly string[], label: string): Promise<BackupManifest> {
    const id = this.deps.newId();
    const dir = this.backupDir(id);
    const files: FileRecord[] = [];
    const seen = new Set<string>();

    for (const rel of relativePaths) {
      const abs = await resolveInsideReal(projectRoot, rel);
      const key = path.relative(projectRoot, abs).split(path.sep).join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      if (isSensitiveFileName(abs)) {
        throw new JpeError("NOT_PERMITTED", `"${key}" looks like a credentials file, so JPE will not copy it into a backup.`);
      }
      let info;
      try {
        info = await stat(abs);
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") {
          files.push({ path: key, existed: false, size: 0 });
          continue;
        }
        throw error;
      }
      if (!info.isFile()) throw new JpeError("INVALID_INPUT", `"${key}" is not a regular file.`);
      if (info.size > MAX_FILE_BYTES) throw new JpeError("INVALID_INPUT", `"${key}" is too large to back up.`);
      const data = await readFile(abs);
      await writeAtomic(path.join(dir, "files", String(files.length)), data);
      files.push({ path: key, existed: true, size: data.length, sha256: sha256(data) });
    }

    const manifest: BackupManifest = { id, createdAt: this.deps.now().toISOString(), projectRoot: path.resolve(projectRoot), label, sealed: false, files };
    await this.writeManifest(manifest);
    return manifest;
  }

  /** Records the post-change state so rollback can detect edits made by anyone else afterwards. */
  async seal(id: string): Promise<BackupManifest> {
    const manifest = await this.readManifest(id);
    const files: FileRecord[] = [];
    for (const rec of manifest.files) {
      const abs = await resolveInsideReal(manifest.projectRoot, rec.path);
      const current = await readIfExists(abs);
      files.push({ ...rec, afterSha256: current ? sha256(current) : null });
    }
    const sealed: BackupManifest = { ...manifest, sealed: true, files };
    await this.writeManifest(sealed);
    return sealed;
  }

  /** Checks that every stored copy still matches the hash recorded when it was taken. */
  async verify(id: string): Promise<{ ok: boolean; problems: string[] }> {
    const manifest = await this.readManifest(id);
    const problems: string[] = [];
    for (const [index, rec] of manifest.files.entries()) {
      if (!rec.existed) continue;
      const data = await readIfExists(path.join(this.backupDir(id), "files", String(index)));
      if (!data) problems.push(`${rec.path}: stored copy is missing.`);
      else if (sha256(data) !== rec.sha256) problems.push(`${rec.path}: stored copy was altered.`);
    }
    return { ok: problems.length === 0, problems };
  }

  /**
   * Restores the backed-up state. Files changed by someone else after sealing are reported as
   * conflicts and skipped unless `force` is set. Whatever rollback replaces is itself backed up first.
   */
  async rollback(id: string, options: { force?: boolean } = {}): Promise<RollbackResult> {
    const manifest = await this.readManifest(id);
    const result: RollbackResult = { restored: [], removed: [], conflicts: [], problems: [] };
    const actions: Array<{ rec: FileRecord; index: number; abs: string }> = [];

    for (const [index, rec] of manifest.files.entries()) {
      const abs = await resolveInsideReal(manifest.projectRoot, rec.path);
      const current = await readIfExists(abs);
      const currentHash = current ? sha256(current) : null;
      if (manifest.sealed && !options.force && currentHash !== (rec.afterSha256 ?? null)) {
        result.conflicts.push(rec.path);
        continue;
      }
      if (rec.existed && currentHash === rec.sha256) continue; // already in the backed-up state
      if (!rec.existed && currentHash === null) continue; // already absent
      actions.push({ rec, index, abs });
    }

    if (actions.length > 0) {
      const safety = await this.create(manifest.projectRoot, actions.map((a) => a.rec.path), `safety copy before rollback of ${id}`);
      result.safetyBackupId = safety.id;
    }

    for (const { rec, index, abs } of actions) {
      if (!rec.existed) {
        await unlink(abs);
        result.removed.push(rec.path);
        continue;
      }
      const data = await readIfExists(path.join(this.backupDir(id), "files", String(index)));
      if (!data || sha256(data) !== rec.sha256) {
        result.problems.push(`${rec.path}: the stored copy is missing or damaged, so it was not restored.`);
        continue;
      }
      await writeAtomic(abs, data);
      result.restored.push(rec.path);
    }
    return result;
  }

  /** Newest first. Unreadable backup folders are skipped rather than failing the listing. */
  async list(): Promise<BackupManifest[]> {
    let names: string[];
    try {
      names = await readdir(this.deps.dir);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }
    const manifests: BackupManifest[] = [];
    for (const name of names) {
      if (!ID_PATTERN.test(name)) continue;
      try {
        manifests.push(await this.readManifest(name));
      } catch (error) {
        if (!(error instanceof JpeError)) throw error;
      }
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Deletes the oldest JPE backups beyond `keep`. Only folders this store created are touched. */
  async prune(keep: number): Promise<string[]> {
    const all = await this.list();
    const doomed = all.slice(Math.max(0, keep));
    for (const m of doomed) await rm(this.backupDir(m.id), { recursive: true, force: true });
    return doomed.map((m) => m.id);
  }
}
