# PR Template (Minimal)

## PR Goal (one sentence)

Update scheduled workflows to call vibeusage endpoints after the rename.

## Commit Narrative

- chore(workflows): switch scheduled workflows to vibeusage endpoints
- docs(pr): record regression command and result

## Regression Test Gate

### Most likely regression surface

- Scheduled workflow endpoints for leaderboard refresh, retention purge, pricing sync.

### Verification method (choose at least one)

- [x] `rg -n "functions/vibescore-" .github/workflows || echo "PASS: no matches"` => PASS (no matches)
- [x] workflow_dispatch: Refresh Leaderboard Snapshots => SUCCESS (`https://github.com/victorGPT/vibeusage/actions/runs/21109932681`)
- [x] workflow_dispatch: Purge Legacy Tracker Events => SUCCESS (`https://github.com/victorGPT/vibeusage/actions/runs/21109934363`)
- [x] workflow_dispatch: Sync Pricing Profiles => SUCCESS (`https://github.com/victorGPT/vibeusage/actions/runs/21109936860`)

### Uncovered scope

- Next scheduled runs (cron) still pending observation.
