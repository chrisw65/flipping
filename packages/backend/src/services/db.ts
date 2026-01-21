import Database from "better-sqlite3";

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
};

let db: Database.Database | null = null;

export function initDb(path: string) {
  if (db) return db;
  db = new Database(path);
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
      added_at INTEGER NOT NULL
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
    `INSERT INTO documents (id, path, filename, size, added_at)
     VALUES (@id, @path, @filename, @size, @addedAt)`
  ).run(record);
}

export function listDocuments() {
  if (!db) throw new Error("DB not initialized");
  return db
    .prepare(`SELECT id, path, filename, size, added_at AS addedAt FROM documents ORDER BY added_at DESC`)
    .all() as DocumentRecord[];
}

export function getDocument(id: string) {
  if (!db) throw new Error("DB not initialized");
  return db
    .prepare(`SELECT id, path, filename, size, added_at AS addedAt FROM documents WHERE id = ?`)
    .get(id) as DocumentRecord | undefined;
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
