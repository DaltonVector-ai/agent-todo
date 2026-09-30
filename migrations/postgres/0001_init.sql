CREATE TABLE orgs (
  pk         TEXT PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE projects (
  pk         TEXT PRIMARY KEY,
  org_pk     TEXT NOT NULL REFERENCES orgs(pk),
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  rev        BIGINT NOT NULL DEFAULT 0,
  settings   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (org_pk, slug)
);

CREATE TABLE members (
  org_pk  TEXT NOT NULL REFERENCES orgs(pk),
  user_id TEXT NOT NULL,
  role    TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  PRIMARY KEY (org_pk, user_id)
);

CREATE TABLE api_tokens (
  pk              TEXT PRIMARY KEY,
  project_pk      TEXT NOT NULL REFERENCES projects(pk),
  name            TEXT NOT NULL,
  hash            TEXT NOT NULL,
  toolset_ceiling TEXT NOT NULL CHECK (toolset_ceiling IN ('core','plan','admin')),
  groups          TEXT[],
  expires_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX api_tokens_hash ON api_tokens(hash);

CREATE TABLE groups (
  pk              TEXT NOT NULL,
  project_pk      TEXT NOT NULL REFERENCES projects(pk),
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  default_model   TEXT,
  default_skills  JSONB NOT NULL DEFAULT '[]',
  default_mcps    JSONB NOT NULL DEFAULT '[]',
  task_seq        INTEGER NOT NULL DEFAULT 0,
  terminal_status TEXT NOT NULL DEFAULT 'deployed' CHECK (terminal_status IN ('verified','deployed')),
  archived        BOOLEAN NOT NULL DEFAULT FALSE,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_pk, pk),
  UNIQUE (project_pk, key)
);

CREATE TABLE context_sections (
  pk             TEXT NOT NULL,
  project_pk     TEXT NOT NULL REFERENCES projects(pk),
  group_pk       TEXT NOT NULL,
  slug           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL,
  tokens         INTEGER NOT NULL DEFAULT 0,
  always_include BOOLEAN NOT NULL DEFAULT FALSE,
  applies_to     JSONB NOT NULL DEFAULT '[]',
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_pk, pk),
  UNIQUE (project_pk, group_pk, slug),
  FOREIGN KEY (project_pk, group_pk) REFERENCES groups(project_pk, pk) ON DELETE CASCADE
);

CREATE TABLE tasks (
  pk              TEXT NOT NULL,
  project_pk      TEXT NOT NULL REFERENCES projects(pk),
  id              TEXT NOT NULL,
  group_pk        TEXT NOT NULL,
  parent_pk       TEXT,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'todo' CHECK (status IN
                  ('todo','open','inprogress','reopen','verifying','verified','deploying','deployed')),
  priority        INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  preferred_model TEXT,
  skills          JSONB NOT NULL DEFAULT '[]',
  mcps            JSONB NOT NULL DEFAULT '[]',
  tags            JSONB NOT NULL DEFAULT '[]',
  acceptance      JSONB NOT NULL DEFAULT '[]',
  assignee        TEXT,
  claim_owner     TEXT,
  claim_expires   TIMESTAMPTZ,
  desc_tokens     INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  archived        BOOLEAN NOT NULL DEFAULT FALSE,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL,
  search_vector   tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED,
  PRIMARY KEY (project_pk, pk),
  UNIQUE (project_pk, id),
  FOREIGN KEY (project_pk, group_pk) REFERENCES groups(project_pk, pk)
);
CREATE INDEX tasks_group_status ON tasks(project_pk, group_pk, status, priority);
CREATE INDEX tasks_claim ON tasks(project_pk, claim_owner, claim_expires);
CREATE INDEX tasks_claim_pick ON tasks (project_pk, priority, created_at)
  WHERE archived = FALSE AND status IN ('open','reopen');
CREATE INDEX tasks_search ON tasks USING GIN (search_vector);
CREATE INDEX tasks_tags ON tasks USING GIN (tags);
CREATE INDEX tasks_skills ON tasks USING GIN (skills);

CREATE TABLE task_deps (
  project_pk    TEXT NOT NULL,
  task_pk       TEXT NOT NULL,
  depends_on_pk TEXT NOT NULL,
  PRIMARY KEY (project_pk, task_pk, depends_on_pk),
  FOREIGN KEY (project_pk, task_pk) REFERENCES tasks(project_pk, pk) ON DELETE CASCADE,
  FOREIGN KEY (project_pk, depends_on_pk) REFERENCES tasks(project_pk, pk) ON DELETE CASCADE
);

CREATE TABLE comments (
  pk             TEXT NOT NULL,
  project_pk     TEXT NOT NULL,
  id             TEXT NOT NULL,
  task_pk        TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  author         TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'note',
  body           TEXT NOT NULL,
  summary        TEXT NOT NULL,
  tokens         INTEGER NOT NULL DEFAULT 0,
  pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  reply_to_pk    TEXT,
  compacted_into TEXT,
  created_at     TIMESTAMPTZ NOT NULL,
  search_vector  tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED,
  PRIMARY KEY (project_pk, pk),
  UNIQUE (project_pk, id),
  FOREIGN KEY (project_pk, task_pk) REFERENCES tasks(project_pk, pk) ON DELETE CASCADE
) PARTITION BY HASH (project_pk);
CREATE INDEX comments_task ON comments(project_pk, task_pk, seq);
CREATE INDEX comments_search ON comments USING GIN (search_vector);

CREATE TABLE events (
  project_pk TEXT NOT NULL,
  rev        BIGINT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  group_key  TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  diff       JSONB NOT NULL,
  at         TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_pk, rev)
) PARTITION BY HASH (project_pk);
CREATE INDEX events_group_rev ON events(project_pk, group_key, rev);

-- hash partitions (16) for events and comments
DO $$
DECLARE i INT;
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS events_p%s PARTITION OF events FOR VALUES WITH (MODULUS 16, REMAINDER %s)',
      i, i
    );
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS comments_p%s PARTITION OF comments FOR VALUES WITH (MODULUS 16, REMAINDER %s)',
      i, i
    );
  END LOOP;
END $$;

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
ALTER TABLE context_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_sections FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE task_deps ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_deps FORCE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_groups ON groups
  USING (project_pk = current_setting('app.project', true));
CREATE POLICY tenant_sections ON context_sections
  USING (project_pk = current_setting('app.project', true));
CREATE POLICY tenant_tasks ON tasks
  USING (project_pk = current_setting('app.project', true));
CREATE POLICY tenant_task_deps ON task_deps
  USING (project_pk = current_setting('app.project', true));
CREATE POLICY tenant_comments ON comments
  USING (project_pk = current_setting('app.project', true));
CREATE POLICY tenant_events ON events
  USING (project_pk = current_setting('app.project', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO PUBLIC;
