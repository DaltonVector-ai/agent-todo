# Dogfood checklist (agent-todo repo)

Use agent-todo to manage remaining work on **this** repository before tagging **v1.0**.

## Kickoff

- [ ] Run `agent-todo init` at the repo root (or `bun run cli -- init` during development).
- [ ] Import open work as groups/tasks from `docs/plans/*.plan.md` checklists and open GitHub issues.
- [ ] Confirm MCP wiring via `agent-todo install` for your primary agent (Cursor / Claude Code).

## Phase 1 — local (one week)

- [ ] Daily driver: local SQLite + `serve --mcp` (optionally daemon + board for multi-agent sessions).
- [ ] All task changes go through MCP tools, not ad-hoc markdown task lists.
- [ ] Log bugs for **data loss**, **wrong claim/duplicate claim**, or **version conflict** surprises in GitHub issues with label `dogfood`.

## Phase 2 — cloud (one week)

- [ ] `push` to a self-hosted stack (`deploy/docker-compose.yml` or your Helm/Fly env).
- [ ] Second machine or teammate uses the same project via HTTP MCP token.
- [ ] Continue the same bug logging criteria.

## Sign-off (required before v1.0 tag)

- [ ] **One continuous week** on cloud with **no** data-loss or claim bugs (fix or waive with written rationale).
- [ ] Release artefacts verified: binaries, `SHA256SUMS`, SBOM, container image on GHCR.
- [ ] Docs reviewed: [quick-start](./quick-start.md), [self-hosting](./self-hosting.md), [tool-reference](./tool-reference.md).

## Notes

- Completing the full two-week dogfood may trail the first release candidate; track sign-off here and in the release issue.
- Budget and load gates are enforced in CI (`test/budgets/`, `test/load/local-sqlite-load.test.ts`).
