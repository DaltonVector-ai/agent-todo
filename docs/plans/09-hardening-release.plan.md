---
name: Phase 9 — Hardening and release
overview: Budget regression CI, local load gates, signed release artefacts, docs, and dogfooding checklist for v1.0.
todos:
  - id: budget-ci
    content: Wire full budget regression suite into CI with 10% baseline fail rule
    status: pending
  - id: local-load
    content: Local load test 10k tasks / 100k comments meeting p95 gates
    status: pending
  - id: release-artefacts
    content: Cross-platform binaries, checksums, SBOM, notarisation scripts, container publish workflow
    status: pending
  - id: docs
    content: Quick start, self-hosting guide, generated tool reference, agent conventions
    status: pending
  - id: dogfood
    content: Dogfood checklist — manage remaining project work in agent-todo local then cloud
    status: pending
isProject: true
---

# Phase 9 — Hardening and release

## Goal

**Harden and ship v1.0**: CI budget gates, performance proof on local SQLite, release packaging, documentation, and a dogfood plan using agent-todo for this repo’s own work.

**Runnable outcome:** all CI suites green; release workflow produces signed/checksummed artefacts (scripts ready; live notarisation/publish when credentials exist); docs enable install → init → first task and self-hosting.

## Prerequisites

- Phases 0–8 complete; k6 and cloud kits exist.
- Spec: §9 phase 9, §10.1 budget suite, §10.2 conventions.

## Out of scope

- New product features beyond hardening.
- Implementing a commercial billing portal.
- Guaranteeing Apple notarisation in CI without secrets — provide scripts and document manual/CI-with-secrets path.

## Locked decisions

- Budget CI fails if any measured snapshot grows **&gt; 10%** without an intentional baseline update committed in the same PR.
- Full OS/arch matrix: linux/mac/windows × x64/arm64 via `scripts/build-binaries.ts`.
- Dogfood starts **local**, then **cloud** self-host.

## File tree

```text
test/budgets/
  baselines.json           # schema tokens, list/get/bundle/TOC sizes
  budget.test.ts           # compare vs baselines
test/load/
  local-sqlite-load.test.ts
scripts/
  build-binaries.ts        # complete matrix
  sign-macos.sh
  checksums.ts
  sbom.ts
  generate-tool-reference.ts
docs/
  quick-start.md
  self-hosting.md
  tool-reference.md        # generated — commit or generate in CI artefact
  agent-conventions.md
  dogfood.md
.github/workflows/
  release.yml
  ci.yml                   # ensure budget + load smoke included
```

## Implementation

### 1. Budget regression suite (§10.1)

Snapshot and assert:

| Metric | Notes |
| --- | --- |
| Tool schemas per toolset | core / plan / admin / full |
| `task_list` 20 × `line` | token estimate |
| `task_get` `brief` | |
| Work bundle | |
| Context TOC | |

Store expected values in `baselines.json`. Fail if any &gt; 10% over baseline unless baseline file updated in the same change (document process in README).

Targets from spec remain: full schema ≤ 5k; core ≤ 1.8k.

### 2. Local load test

Seed 10k tasks and 100k comments in SQLite (scripted).

Gates:

- `task_list` p95 &lt; 50 ms
- `task_next` p95 &lt; 30 ms

CI: smaller N smoke; full numbers in nightly or `bun run test:load:local`.

### 3. Release artefacts

- Expand `build-binaries.ts` to all OS/arch targets (cross-compile as Bun supports; otherwise CI matrix jobs).
- Generate SHA256 checksums file.
- Generate SBOM (e.g. CycloneDX from bun.lock).
- macOS: `sign-macos.sh` + notarisation steps documented; wire into `release.yml` when secrets present.
- Publish container image to GHCR (or documented registry) from Dockerfile.
- GitHub Release attaches binaries + checksums + SBOM.

Do not require publishing from a developer laptop without credentials; workflow should be skip-safe when secrets missing.

### 4. Docs

| Doc | Content |
| --- | --- |
| `docs/quick-start.md` | install → init → first task → `task_next` conventions |
| `docs/self-hosting.md` | compose, Helm, Terraform, Fly pointers, env reference |
| `docs/tool-reference.md` | generated from zod schemas |
| `docs/agent-conventions.md` | §10.2 list |
| Root README | link all of the above + `docs/plans/README.md` |

`scripts/generate-tool-reference.ts` dumps tool names, params, one-line descriptions.

### 5. Dogfood (`docs/dogfood.md`)

Checklist:

1. `agent-todo init` in this repo; import remaining work as groups/tasks from `docs/plans` or issues.
2. Use local + daemon for a week; file bugs for data-loss or claim issues.
3. `push` to self-hosted cloud; continue dogfood.
4. Sign-off criteria: no data-loss or claim bugs for one week.

## Tests

- Budget suite in PR CI.
- Local load smoke in CI; full load documented.
- Release workflow dry-run on tag (binaries built).
- Doc links checked optionally (lychee) — nice-to-have.

## Done when

- [ ] All CI suites green including budget regression.
- [ ] Local load gates met (full run documented if not on every PR).
- [ ] Release workflow produces binaries, checksums, SBOM, container image path.
- [ ] Quick start, self-hosting, tool reference, agent conventions published in repo.
- [ ] Dogfood checklist written; kickoff can begin (completion of one-week dogfood may trail the tag — note as release follow-up).
- [ ] Version tagged ready for **v1.0** when dogfood sign-off lands.

Stop here. Project implementation plans are complete; subsequent Agent sessions implement phases 0→9 in order using these files.
