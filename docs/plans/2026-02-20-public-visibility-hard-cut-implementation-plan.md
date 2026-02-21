# Public Visibility Hard-Cut Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dual-state public visibility logic with a single canonical state so Public ON/OFF maps directly to actual visibility for everyone (logged-in and anonymous).

**Architecture:** Visibility truth is stored only in `vibeusage_public_views` active state (`revoked_at IS NULL`). A new `vibeusage-public-visibility` endpoint becomes the only write/read facade for toggle state. Leaderboard/profile read paths perform read-time visibility gating from canonical state (not snapshot cache fields), and legacy visibility endpoints are hard-retired with `410 Gone`.

**Tech Stack:** Node.js edge functions (`insforge-src` + generated `insforge-functions`), PostgREST/Insforge client, React dashboard (`dashboard/src`), Node test runner (`node --test`).

---

### Task 1: Add canonical visibility shared service

**Files:**
- Create: `insforge-src/shared/public-visibility.js`
- Test: `test/public-visibility-state.test.js`

**Step 1: Write the failing test**

```js
// test/public-visibility-state.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

// cases:
// - enable => revoked_at null + share_token pv1-<uuid>
// - disable => revoked_at set
// - get state => enabled matches active row
```

**Step 2: Run test to verify it fails**

Run: `node --test test/public-visibility-state.test.js`
Expected: FAIL (`Cannot find module '../insforge-src/shared/public-visibility'`).

**Step 3: Write minimal implementation**

```js
// insforge-src/shared/public-visibility.js
// export getPublicVisibilityState({ db, userId })
// export setPublicVisibilityState({ db, userId, enabled, nowIso })
// export buildPublicShareToken(userId) => `pv1-${uuid}`
```

Use only `vibeusage_public_views` as truth source.

**Step 4: Run test to verify it passes**

Run: `node --test test/public-visibility-state.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/public-visibility-state.test.js insforge-src/shared/public-visibility.js
git commit -m "refactor(visibility): add canonical public visibility service"
```

---

### Task 2: Add new `vibeusage-public-visibility` endpoint

**Files:**
- Create: `insforge-src/functions/vibeusage-public-visibility.js`
- Generated: `insforge-functions/vibeusage-public-visibility.js` (via build)
- Test: `test/edge-functions.test.js` (new tests block)

**Step 1: Write the failing tests**

Add tests:
- `GET /functions/vibeusage-public-visibility` returns `{ enabled, updated_at, share_token }`
- `POST { enabled: true }` activates row and returns enabled true
- `POST { enabled: false }` revokes row and returns enabled false
- rejects missing/invalid bearer

**Step 2: Run targeted tests (fail first)**

Run: `node --test test/edge-functions.test.js --test-name-pattern "vibeusage-public-visibility"`
Expected: FAIL (function missing).

**Step 3: Implement endpoint**

- Require auth.
- Use service from Task 1.
- Enforce body `{ enabled: boolean }` for POST.
- Always respond with effective state readback.

**Step 4: Build generated edge functions + rerun tests**

Run:
```bash
npm run build:insforge
node --test test/edge-functions.test.js --test-name-pattern "vibeusage-public-visibility"
```
Expected: PASS.

**Step 5: Commit**

```bash
git add insforge-src/functions/vibeusage-public-visibility.js insforge-functions/vibeusage-public-visibility.js test/edge-functions.test.js
git commit -m "feat(visibility): add unified public visibility endpoint"
```

---

### Task 3: Hard-retire legacy visibility endpoints (410 Gone)

**Files:**
- Modify: `insforge-src/functions/vibeusage-leaderboard-settings.js`
- Modify: `insforge-src/functions/vibeusage-public-view-status.js`
- Modify: `insforge-src/functions/vibeusage-public-view-issue.js`
- Modify: `insforge-src/functions/vibeusage-public-view-revoke.js`
- Generated: corresponding files under `insforge-functions/`
- Test: `test/edge-functions.test.js`

**Step 1: Write failing tests**

Add tests that each legacy endpoint returns:
- HTTP 410
- stable error payload like `{ error: "Endpoint retired" }`

**Step 2: Run targeted tests (fail first)**

Run: `node --test test/edge-functions.test.js --test-name-pattern "retired|410|public-view|leaderboard-settings"`
Expected: FAIL.

**Step 3: Implement 410 behavior**

Replace handler internals with immediate `410 Gone` response. No compatibility branch.

**Step 4: Build + rerun**

Run:
```bash
npm run build:insforge
node --test test/edge-functions.test.js --test-name-pattern "retired|410|public-view|leaderboard-settings"
```
Expected: PASS.

**Step 5: Commit**

```bash
git add insforge-src/functions/vibeusage-leaderboard-settings.js insforge-src/functions/vibeusage-public-view-status.js insforge-src/functions/vibeusage-public-view-issue.js insforge-src/functions/vibeusage-public-view-revoke.js insforge-functions/vibeusage-leaderboard-settings.js insforge-functions/vibeusage-public-view-status.js insforge-functions/vibeusage-public-view-issue.js insforge-functions/vibeusage-public-view-revoke.js test/edge-functions.test.js
git commit -m "refactor(visibility): retire legacy public-view endpoints with 410"
```

---

### Task 4: Rework leaderboard read path to canonical read-time gating + optional auth

**Files:**
- Modify: `insforge-src/functions/vibeusage-leaderboard.js`
- Generated: `insforge-functions/vibeusage-leaderboard.js`
- Test: `test/edge-functions.test.js`

**Step 1: Write failing tests**

Add/adjust tests:
- Anonymous request succeeds and returns only public rows.
- Private rows never expose `user_id`.
- Authenticated request still returns `me`.
- Read-time canonical visibility wins even if snapshot `is_public` is stale.

**Step 2: Run targeted tests (fail first)**

Run: `node --test test/edge-functions.test.js --test-name-pattern "leaderboard.*anonymous|leaderboard.*is_public|read-time"`
Expected: FAIL.

**Step 3: Implement minimal changes**

- Bearer optional.
- If bearer valid => resolve `auth.userId`; if absent => proceed as guest.
- For rows in page result, batch load active public state from `vibeusage_public_views` and compute output exposure from that set.

**Step 4: Build + rerun**

Run:
```bash
npm run build:insforge
node --test test/edge-functions.test.js --test-name-pattern "leaderboard.*anonymous|leaderboard.*is_public|read-time"
```
Expected: PASS.

**Step 5: Commit**

```bash
git add insforge-src/functions/vibeusage-leaderboard.js insforge-functions/vibeusage-leaderboard.js test/edge-functions.test.js
git commit -m "refactor(leaderboard): read-time canonical visibility with guest support"
```

---

### Task 5: Rework leaderboard profile endpoint for canonical visibility + guest access

**Files:**
- Modify: `insforge-src/functions/vibeusage-leaderboard-profile.js`
- Generated: `insforge-functions/vibeusage-leaderboard-profile.js`
- Test: `test/edge-functions.test.js`

**Step 1: Write failing tests**

Add tests:
- Anonymous can read public profile rows.
- Anonymous/non-self cannot read non-public rows.
- Authenticated self can still read own row.
- Visibility check uses canonical active row, not legacy settings.

**Step 2: Run targeted tests (fail first)**

Run: `node --test test/edge-functions.test.js --test-name-pattern "leaderboard-profile.*anonymous|leaderboard-profile.*self|leaderboard-profile.*public"`
Expected: FAIL.

**Step 3: Implement endpoint update**

- Bearer optional for non-self public reads.
- Self reads require valid bearer.
- Non-self visibility gate strictly by active `vibeusage_public_views` row.

**Step 4: Build + rerun**

Run:
```bash
npm run build:insforge
node --test test/edge-functions.test.js --test-name-pattern "leaderboard-profile.*anonymous|leaderboard-profile.*self|leaderboard-profile.*public"
```
Expected: PASS.

**Step 5: Commit**

```bash
git add insforge-src/functions/vibeusage-leaderboard-profile.js insforge-functions/vibeusage-leaderboard-profile.js test/edge-functions.test.js
git commit -m "refactor(profile): canonical public visibility with guest reads"
```

---

### Task 6: Switch frontend to new hard-cut visibility contract

**Files:**
- Modify: `dashboard/src/lib/vibeusage-api.ts`
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/content/copy.csv` (only if copy key changes are needed)

**Step 1: Write failing frontend behavior tests (or source assertions)**

Add tests/assertions for:
- usage of `vibeusage-public-visibility` instead of retired endpoints
- guest leaderboard load path
- no dependency on `leaderboard_public` old field

**Step 2: Run tests (fail first)**

Run relevant test command (source-check/unit):
`node --test test/*.test.js --test-name-pattern "public-visibility|leaderboard|dashboard"`
Expected: FAIL.

**Step 3: Implement minimal frontend changes**

- Add `getPublicVisibility`/`setPublicVisibility` API helpers.
- Replace legacy toggle/load calls in Dashboard and Leaderboard.
- Allow leaderboard list to load without auth token (public mode), but keep signed-in enhancements (`me`).

**Step 4: Verify frontend + regression tests**

Run:
```bash
node --test test/*.test.js
npm run validate:ui-hardcode
```
Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/lib/vibeusage-api.ts dashboard/src/pages/DashboardPage.jsx dashboard/src/pages/LeaderboardPage.jsx dashboard/src/content/copy.csv
git commit -m "feat(frontend): adopt hard-cut public visibility contract"
```

---

### Task 7: Docs + final verification gate

**Files:**
- Modify: `BACKEND_API.md`
- Modify: `docs/plans/2026-02-20-public-visibility-hard-cut-design.md` (if needed from implementation deltas)

**Step 1: Update API docs**

- Add new `vibeusage-public-visibility` endpoint.
- Mark legacy endpoints retired (410).
- Document optional-auth/guest behavior for leaderboard list/profile.

**Step 2: Run full verification**

Run:
```bash
npm run build:insforge:check
node --test test/*.test.js
npm run ci:local
```
Expected: all PASS.

**Step 3: Capture manual acceptance checks**

- Dual-account ON => mutual visibility <=3s.
- Any one OFF => immediate hide + link/profile deny <=3s.
- Anonymous browser session sees same public set.

**Step 4: Commit docs + test evidence**

```bash
git add BACKEND_API.md docs/plans/2026-02-20-public-visibility-hard-cut-design.md
git commit -m "docs(api): document hard-cut public visibility contracts"
```

---

## Notes for Executor
- Keep changes small and commit at each task boundary.
- Do not push; local commits only unless explicitly requested.
- No compatibility code paths.
- If a task implies public API schema change, ensure OpenSpec delta/check is updated before merge.
