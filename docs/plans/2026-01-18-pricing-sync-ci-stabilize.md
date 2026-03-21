# Pricing Sync CI Stabilization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure the Sync Pricing Profiles workflow calls the correct endpoint on the default branch, verify it succeeds, and deprecate the legacy `vibescore-pricing-sync` endpoint with OpenSpec updates.

**Architecture:** GitHub Actions triggers an Insforge edge function to sync OpenRouter pricing into the database. We will (1) verify main uses `/functions/vibeusage-pricing-sync`, (2) validate workflow success, (3) deprecate the legacy endpoint in Insforge2, and (4) update OpenSpec and ops docs to keep `vibeusage` as the single source of truth.

**Tech Stack:** GitHub Actions (gh CLI), Insforge2 MCP, OpenSpec, curl.

---

## Module Brief (Pricing Sync Endpoint Deprecation)

- **Scope (IN):** GitHub Actions workflow verification; deprecate `vibescore-pricing-sync` in Insforge2; update OpenSpec + ops docs.
- **Scope (OUT):** Any new pricing sync behavior, data model changes, or compatibility shims.
- **Interfaces:** `POST /functions/vibeusage-pricing-sync` (active), `POST /functions/vibescore-pricing-sync` (to deprecate), GitHub Actions `Sync Pricing Profiles` workflow.
- **Data flow:** Actions -> Insforge edge function -> PostgREST -> `vibeusage_pricing_*` tables.
- **Non‑negotiables:** No compatibility shims; single source of truth remains `vibeusage` naming; verify success on default branch.
- **Test strategy:** Manual regression runbook (curl + GH Actions) with explicit expected HTTP codes.
- **Milestones:** (1) Verify main + successful run; (2) Deprecate old endpoint; (3) OpenSpec + ops docs updated; (4) Re‑verify.
- **Plan B triggers:** Any external caller detected hitting the old endpoint; if so, pause deprecation and add a migration notice.
- **Upgrade plan:** Disabled (not applicable).

---

### Task 1: Verify default branch workflow is correct

**Files:**

- Modify: none

**Step 1: Fetch workflow file from default branch**

Run:

```
repo=$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')
branch=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')
gh api -H "Accept: application/vnd.github.raw" "repos/$repo/contents/.github/workflows/vibescore-pricing-sync.yml?ref=$branch" | sed -n '40,90p'
```

Expected: curl target is `/functions/vibeusage-pricing-sync`.

**Step 2: Record latest runs**

Run:

```
gh run list -w "Sync Pricing Profiles" -L 3
```

Expected: at least one recent success on the default branch.

---

### Task 2: Manual regression run for the workflow

**Files:**

- Modify: none

**Step 1: Trigger workflow**

Run:

```
gh workflow run "Sync Pricing Profiles" -f retention_days=90
```

Expected: workflow dispatch accepted.

**Step 2: Confirm success**

Run:

```
gh run list -w "Sync Pricing Profiles" -L 1
```

Expected: latest run `completed success`.

---

### Task 3: Deprecate the legacy endpoint in Insforge2

**Files:**

- Modify: none (Insforge2 function change via MCP)

**Step 1: Capture existing function metadata (snapshot)**

Run:

```
# MCP: get-function vibescore-pricing-sync
```

Expected: function details are returned for audit trail.

**Step 2: Pre‑deprecation check (old endpoint returns 500)**

Run:

```
curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/functions/vibescore-pricing-sync" \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  --data '{"retention_days":90}'
```

Expected: `500` (current behavior).

**Step 3: Deprecate endpoint**

Choose **one**:

- **Delete function:** MCP `delete-function` with slug `vibescore-pricing-sync`.
- **Disable function:** MCP `update-function` set status `inactive` (if supported by Insforge2).

**Step 4: Post‑deprecation check**

Run the same curl as Step 2.
Expected: `404` or `410` (document the returned code as the new contract).

---

### Task 4: OpenSpec update (single source of truth)

**Files:**

- Create: `openspec/changes/deprecate-vibescore-pricing-sync/proposal.md`
- Create: `openspec/changes/deprecate-vibescore-pricing-sync/tasks.md`
- Create: `openspec/changes/deprecate-vibescore-pricing-sync/specs/vibeusage-tracker/spec.md`
- Modify: `openspec/specs/vibeusage-tracker/spec.md`

**Step 1: Create change scaffold**

Run:

```
CHANGE=deprecate-vibescore-pricing-sync
mkdir -p openspec/changes/$CHANGE/specs/vibeusage-tracker
```

**Step 2: Draft proposal + tasks**

Populate proposal and tasks with:

- Why: old endpoint writes to non‑existent tables.
- What: remove `vibescore-pricing-sync`, confirm `vibeusage-pricing-sync` is sole endpoint.
- Impact: pricing sync operations, documentation.

**Step 3: Add spec delta**

Add a **MODIFIED** requirement or **ADDED** requirement clarifying the pricing sync endpoint is `/functions/vibeusage-pricing-sync` and legacy endpoint is removed.

**Step 4: Validate**

Run:

```
openspec validate deprecate-vibescore-pricing-sync --strict
```

Expected: validation passes.

---

### Task 5: Ops docs update

**Files:**

- Modify: `docs/ops/pricing-sync-health.md`

**Step 1: Update env var names to VIBEUSAGE**

- Replace `VIBESCORE_PRICING_SOURCE/MODEL` with `VIBEUSAGE_PRICING_SOURCE/MODEL`.
- Keep `OPENROUTER_API_KEY` unchanged.
- Keep curl target `/functions/vibeusage-pricing-sync`.

**Step 2: Add a deprecation note**

- Note that `vibescore-pricing-sync` is removed and should not be used.

---

### Task 6: Final verification + commit

**Files:**

- Modify: (from Tasks 4–5)

**Step 1: Re‑run workflow check**

Run:

```
gh run list -w "Sync Pricing Profiles" -L 1
```

Expected: latest run success.

**Step 2: Commit doc/spec updates**

Run:

```
git add openspec/changes/deprecate-vibescore-pricing-sync openspec/specs/vibeusage-tracker/spec.md docs/ops/pricing-sync-health.md
git commit -m "docs: deprecate vibescore pricing sync"
```

---

## Notes

- Do **not** edit `docs/retrospective/**` or `openspec/changes/archive/**` (historical records).
- If any external caller is detected on the legacy endpoint, pause deprecation and add a migration notice.
