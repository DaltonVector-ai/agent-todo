-- Phase 8: durable rate-limit counters (Postgres-backed quotas v1)

CREATE TABLE rate_limit_counters (
  scope        TEXT NOT NULL,
  bucket       TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket, window_start)
);

CREATE INDEX rate_limit_counters_scope_bucket ON rate_limit_counters (scope, bucket, window_start DESC);
