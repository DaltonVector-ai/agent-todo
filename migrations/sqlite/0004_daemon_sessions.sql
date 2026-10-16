CREATE TABLE daemon_sessions (
  pk            TEXT PRIMARY KEY,
  user_pk       TEXT NOT NULL REFERENCES daemon_users(pk) ON DELETE CASCADE,
  session_hash  TEXT NOT NULL UNIQUE,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX daemon_sessions_user_pk ON daemon_sessions(user_pk);
CREATE INDEX daemon_sessions_expires_at ON daemon_sessions(expires_at);
