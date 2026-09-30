CREATE TABLE groups (
  pk             TEXT PRIMARY KEY,
  key            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  default_model  TEXT,
  default_skills TEXT NOT NULL DEFAULT '[]',
  default_mcps   TEXT NOT NULL DEFAULT '[]',
  task_seq       INTEGER NOT NULL DEFAULT 0,
  terminal_status TEXT NOT NULL DEFAULT 'deployed' CHECK (terminal_status IN ('verified','deployed')),
  archived       INTEGER NOT NULL DEFAULT 0,
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE context_sections (
  pk             TEXT PRIMARY KEY,
  group_pk       TEXT NOT NULL REFERENCES groups(pk) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL,
  tokens         INTEGER NOT NULL DEFAULT 0,
  always_include INTEGER NOT NULL DEFAULT 0,
  applies_to     TEXT NOT NULL DEFAULT '[]',
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL,
  UNIQUE (group_pk, slug)
);

CREATE TABLE tasks (
  pk              TEXT PRIMARY KEY,
  id              TEXT NOT NULL UNIQUE,
  group_pk        TEXT NOT NULL REFERENCES groups(pk),
  parent_pk       TEXT REFERENCES tasks(pk),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'todo' CHECK (status IN
                  ('todo','open','inprogress','reopen','verifying','verified','deploying','deployed')),
  priority        INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  preferred_model TEXT,
  skills          TEXT NOT NULL DEFAULT '[]',
  mcps            TEXT NOT NULL DEFAULT '[]',
  tags            TEXT NOT NULL DEFAULT '[]',
  acceptance      TEXT NOT NULL DEFAULT '[]',
  assignee        TEXT,
  claim_owner     TEXT,
  claim_expires   TEXT,
  desc_tokens     INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX tasks_group_status ON tasks(group_pk, status, priority);
CREATE INDEX tasks_claim ON tasks(claim_owner, claim_expires);

CREATE TABLE task_deps (
  task_pk       TEXT NOT NULL REFERENCES tasks(pk) ON DELETE CASCADE,
  depends_on_pk TEXT NOT NULL REFERENCES tasks(pk) ON DELETE CASCADE,
  PRIMARY KEY (task_pk, depends_on_pk)
);

CREATE TABLE comments (
  pk             TEXT PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  task_pk        TEXT NOT NULL REFERENCES tasks(pk) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  author         TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'note',
  body           TEXT NOT NULL,
  summary        TEXT NOT NULL,
  tokens         INTEGER NOT NULL DEFAULT 0,
  pinned         INTEGER NOT NULL DEFAULT 0,
  reply_to_pk    TEXT REFERENCES comments(pk),
  compacted_into TEXT REFERENCES comments(pk),
  created_at     TEXT NOT NULL
);
CREATE INDEX comments_task ON comments(task_pk, seq);

CREATE TABLE events (
  rev        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  group_key  TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  diff       TEXT NOT NULL,
  at         TEXT NOT NULL
);
CREATE INDEX events_group_rev ON events(group_key, rev);

CREATE VIRTUAL TABLE tasks_fts USING fts5(title, description, content='tasks', content_rowid='rowid');
CREATE VIRTUAL TABLE comments_fts USING fts5(body, content='comments', content_rowid='rowid');

CREATE TRIGGER tasks_fts_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER tasks_fts_delete AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
END;

CREATE TRIGGER tasks_fts_update AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER comments_fts_insert AFTER INSERT ON comments BEGIN
  INSERT INTO comments_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER comments_fts_delete AFTER DELETE ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER comments_fts_update AFTER UPDATE ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO comments_fts(rowid, body) VALUES (new.rowid, new.body);
END;
