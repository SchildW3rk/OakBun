-- Migration: 0002_add_comments
-- Adds the comments table used by commentsResource (defineResource example)

CREATE TABLE IF NOT EXISTS "comments" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "postId"    INTEGER NOT NULL,
  "authorId"  INTEGER NOT NULL,
  "body"      TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);
