import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export type SessionRecord = {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
};

export type DocumentRecord = {
  id: string;
  path: string;
  filename: string;
  size: number;
  addedAt: number;
  pageCount?: number | null;
  preprocessed?: boolean;
  preprocessingProgress?: number;
  preprocessingError?: string | null;
};

let db: Database.Database | null = null;

export function initDb(dbPath: string) {
  if (db) return db;

  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      page_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      document_id TEXT,
      page_number INTEGER,
      event_type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN page_count INTEGER`);
  } catch {
    // Column already exists.
  }
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN preprocessed INTEGER DEFAULT 0`);
  } catch {
    // Column already exists.
  }
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN preprocessing_progress INTEGER DEFAULT 0`);
  } catch {
    // Column already exists.
  }
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN preprocessing_error TEXT`);
  } catch {
    // Column already exists.
  }
  return db;
}

export function upsertSession(record: SessionRecord) {
  if (!db) throw new Error("DB not initialized");
  db.prepare(
    `INSERT INTO sessions (session_id, created_at, expires_at)
     VALUES (@sessionId, @createdAt, @expiresAt)
     ON CONFLICT(session_id) DO UPDATE SET expires_at = excluded.expires_at`
  ).run(record);
}

export function getSession(sessionId: string) {
  if (!db) throw new Error("DB not initialized");
  return db
    .prepare(`SELECT session_id AS sessionId, created_at AS createdAt, expires_at AS expiresAt FROM sessions WHERE session_id = ?`)
    .get(sessionId) as SessionRecord | undefined;
}

export function insertDocument(record: DocumentRecord) {
  if (!db) throw new Error("DB not initialized");
  db.prepare(
    `INSERT INTO documents (id, path, filename, size, added_at, page_count)
     VALUES (@id, @path, @filename, @size, @addedAt, @pageCount)`
  ).run(record);
}

export function listDocuments() {
  if (!db) throw new Error("DB not initialized");
  const rows = db
    .prepare(
      `SELECT id, path, filename, size, added_at AS addedAt, page_count AS pageCount,
       preprocessed, preprocessing_progress AS preprocessingProgress,
       preprocessing_error AS preprocessingError
       FROM documents ORDER BY added_at DESC`
    )
    .all() as Array<DocumentRecord & { preprocessed: number }>;
  return rows.map(r => ({ ...r, preprocessed: !!r.preprocessed }));
}

export function getDocument(id: string) {
  if (!db) throw new Error("DB not initialized");
  const row = db
    .prepare(
      `SELECT id, path, filename, size, added_at AS addedAt, page_count AS pageCount,
       preprocessed, preprocessing_progress AS preprocessingProgress,
       preprocessing_error AS preprocessingError
       FROM documents WHERE id = ?`
    )
    .get(id) as (DocumentRecord & { preprocessed: number }) | undefined;
  if (!row) return undefined;
  return { ...row, preprocessed: !!row.preprocessed };
}

export function updateDocumentPreprocessing(
  id: string,
  updates: {
    preprocessed?: boolean;
    preprocessingProgress?: number;
    preprocessingError?: string | null;
    pageCount?: number;
  }
) {
  if (!db) throw new Error("DB not initialized");
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  if (updates.preprocessed !== undefined) {
    sets.push("preprocessed = @preprocessed");
    params.preprocessed = updates.preprocessed ? 1 : 0;
  }
  if (updates.preprocessingProgress !== undefined) {
    sets.push("preprocessing_progress = @preprocessingProgress");
    params.preprocessingProgress = updates.preprocessingProgress;
  }
  if (updates.preprocessingError !== undefined) {
    sets.push("preprocessing_error = @preprocessingError");
    params.preprocessingError = updates.preprocessingError;
  }
  if (updates.pageCount !== undefined) {
    sets.push("page_count = @pageCount");
    params.pageCount = updates.pageCount;
  }

  if (sets.length === 0) return;
  db.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

export function insertEvent(params: {
  sessionId: string;
  documentId?: string;
  pageNumber?: number;
  eventType: string;
  createdAt: number;
}) {
  if (!db) throw new Error("DB not initialized");
  db.prepare(
    `INSERT INTO events (session_id, document_id, page_number, event_type, created_at)
     VALUES (@sessionId, @documentId, @pageNumber, @eventType, @createdAt)`
  ).run(params);
}

export function purgeExpiredSessions(now: number) {
  if (!db) throw new Error("DB not initialized");
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now);
}
