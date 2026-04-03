CREATE TABLE IF NOT EXISTS "users" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"      TEXT NOT NULL,
  "email"     TEXT NOT NULL UNIQUE,
  "role"      TEXT NOT NULL DEFAULT 'user',
  "createdAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "posts" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"     TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "authorId"  INTEGER NOT NULL,
  "published" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "tableName"  TEXT NOT NULL,
  "operation"  TEXT NOT NULL,
  "actor"      TEXT,
  "before"     TEXT,
  "after"      TEXT,
  "changedAt"  TEXT NOT NULL,
  "requestId"  TEXT
);
