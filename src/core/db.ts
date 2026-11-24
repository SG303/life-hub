import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.js';
import { log } from './log.js';

export type Db = DatabaseSync;

export const DB_FILE = 'life-hub.db';

/** Opens the database in `dataDir`, applies pragmas and pending migrations. */
export function openDatabase(dataDir: string, options: { backupKeep?: number } = {}): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, DB_FILE);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db, dataDir, options.backupKeep ?? 7);
  return db;
}

/** Opens a throwaway in-memory database with the full schema, for tests. */
export function openMemoryDatabase(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, undefined, 0);
  return db;
}

function migrate(db: Db, dataDir: string | undefined, backupKeep: number): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return;
  if (current > 0 && dataDir) {
    const file = backupDatabase(db, dataDir, 'pre-migration', backupKeep);
    log.info('pre-migration backup written', { file: path.basename(file) });
  }
  for (const migration of pending) {
    transaction(db, () => {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
    log.info('migration applied', { version: migration.version });
  }
}

/** Runs `fn` inside an immediate transaction. Keep network I/O outside. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Writes an online backup with `VACUUM INTO` to `<dataDir>/backups` and keeps the
 * newest `keep` files with the same prefix.
 */
export function backupDatabase(db: Db, dataDir: string, prefix: string, keep: number): string {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let file = path.join(dir, `${prefix}-${stamp}.db`);
  for (let n = 1; fs.existsSync(file); n++) file = path.join(dir, `${prefix}-${stamp}-${n}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  const old = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.db'))
    .sort()
    .reverse()
    .slice(keep);
  for (const name of old) fs.rmSync(path.join(dir, name));
  return file;
}

/**
 * Restores a backup file into `dataDir`. The database must be closed. Removes
 * stale `-wal` and `-shm` files so SQLite does not replay them onto the backup.
 */
export function restoreDatabase(dataDir: string, backupFile: string): void {
  const file = path.join(dataDir, DB_FILE);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  fs.copyFileSync(backupFile, file);
}
