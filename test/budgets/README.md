# Budget regression

Snapshots token estimates for MCP tool schemas and shaped read paths (see `project_doc.md` §10.1).

## CI rule

`budget.test.ts` compares live metrics to `baselines.json`. Any metric **more than 10% above** its baseline fails the build.

To intentionally increase a budget:

1. Make the schema or shaper change.
2. Run `bun run scripts/update-budget-baselines.ts`.
3. Commit `baselines.json` in the **same PR** as the code change.

Hard caps in `baselines.json` (`hardCaps`) still enforce spec targets (e.g. core schemas ≤ 1.8k, full ≤ 5k).

## Refresh baselines locally

```bash
bun run scripts/update-budget-baselines.ts
```
