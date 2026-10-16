CREATE TABLE daemon_users (
  pk             TEXT PRIMARY KEY,
  username       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('superuser', 'member')),
  token_hash     TEXT NOT NULL UNIQUE,
  mcp_token      TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
