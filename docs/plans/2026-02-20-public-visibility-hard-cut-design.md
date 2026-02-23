# Public Visibility Hard-Cut Design (No Backward Compatibility)

## Summary

This design removes the dual-state visibility model and hard-cuts to a single source of truth:

- **Public visibility truth** = active row in `vibeusage_public_views` (`revoked_at IS NULL`)
- No backward-compatible runtime path
- No legacy behavior bridging

Product semantics (confirmed):

- **ON**: visible immediately
- **OFF**: hidden immediately + share access revoked immediately
- Target consistency: **end-to-end within ~3 seconds**
- “Others” means **anyone** (logged-in or not logged-in)

## Goals

1. Eliminate state divergence between settings flag and effective visibility.
2. Guarantee toggle semantics map 1:1 to actual visibility.
3. Support public visibility to unauthenticated users (public rows only).
4. Remove legacy visibility endpoints/semantics via hard cut.

## Non-Goals

- Preserve legacy contract behavior.
- Keep old “settings + issue/revoke” split model.
- Introduce delayed async reconciliation as the primary path.

## First-Principles Invariants

1. Authorization/visibility decisions MUST be derived from one canonical state.
2. Display cache fields (e.g. snapshot `is_public`) MUST NOT be authorization truth.
3. User-facing toggle response MUST reflect effective post-write state, not intent.
4. Public read endpoints MUST expose only public rows and never leak private identifiers.

## Contract Reset (Breaking)

### New visibility endpoint (single write/read facade)

`GET/POST /functions/vibeusage-public-visibility`

- Auth required
- `GET` response:
  - `enabled` (effective public state)
  - `updated_at`
  - `share_token` (`pv1-<user_id>`) when enabled
- `POST` request:
  - `{ enabled: boolean }`
- `POST` behavior:
  - `enabled=true`: upsert active row (`revoked_at=null`)
  - `enabled=false`: revoke row (`revoked_at=now`)
- `POST` response returns actual effective state after write.

### Legacy endpoint hard retirement (410 Gone)

The following endpoints are retired with no compatibility mode:

- `/functions/vibeusage-leaderboard-settings`
- `/functions/vibeusage-public-view-status`
- `/functions/vibeusage-public-view-issue`
- `/functions/vibeusage-public-view-revoke`

## Read Path Design (Strong Consistency)

### Leaderboard list

`/functions/vibeusage-leaderboard`

- Supports public visibility for both logged-in and anonymous consumers.
- Auth becomes optional:
  - Authenticated: includes `me` when available.
  - Anonymous: `me=null`, public rows only.
- Row visibility is resolved **at read time** from current active public-view state for relevant user_ids.
- Snapshot fields may be used for ranking/aggregation data, but public gating is read-time canonical.

### Leaderboard profile

`/functions/vibeusage-leaderboard-profile`

- Anonymous and authenticated non-self access: allowed only when target has active public state.
- Self access: requires auth and remains available regardless of public state.

## Data Model Role Changes

- `vibeusage_public_views`: canonical state store for public visibility.
- `vibeusage_user_settings.leaderboard_public`: no longer read/written for visibility decisions (candidate for removal in follow-up migration).
- `vibeusage_leaderboard_snapshots.is_public`: cache/display hint only, not auth truth.

## Frontend Behavior

- Dashboard and Leaderboard toggle UI use only `vibeusage-public-visibility` (`enabled`).
- Public copy-link action uses returned `share_token` directly.
- Leaderboard page is readable in guest mode (public rows only).

## Error Handling

- Toggle endpoint writes are idempotent.
- Concurrent toggles follow last-write-wins with post-write readback in response.
- Public read endpoints never return private rows due to stale snapshot flags.

## Verification Strategy

1. **Contract tests**
   - New endpoint GET/POST semantics.
   - ON/OFF idempotency.
   - Legacy endpoints return 410.

2. **Visibility consistency tests**
   - Read-time gating overrides stale snapshot `is_public`.
   - Non-public rows never expose stable `user_id` in list output.

3. **Dual-account E2E**
   - A/B both ON -> mutual visibility within <=3s.
   - Either OFF -> both directions hidden within <=3s, profile/share denied.
   - Logged-in + anonymous readers both see same public set.

4. **Regression scope**
   - week/month/total periods
   - pagination
   - profile deep-link behavior

## Risks and Mitigations

- **Risk:** Existing clients still call retired endpoints.
  - **Mitigation:** Explicit 410 + fast frontend rollout + release note.
- **Risk:** Optional-auth leaderboard path introduces accidental data leak.
  - **Mitigation:** strict output assertions in tests for public-only rows.
- **Risk:** Runtime query overhead from read-time visibility checks.
  - **Mitigation:** batch lookup on page user_ids only.

## Release Plan (Hard Cut)

1. Deploy backend endpoint reset + read-time gating.
2. Deploy frontend switch to new endpoint and guest-readable leaderboard.
3. Observe 30 minutes:
   - toggle-to-visibility latency
   - 410 hit counts
   - profile 404/403 behavior
4. No compatibility rollback path; rollback means full revert.

## Acceptance Criteria

- Public ON makes user visible to everyone (logged-in and anonymous) within <=3s.
- Public OFF removes visibility and invalidates public profile access within <=3s.
- No endpoint in production depends on legacy dual-state logic.
- Legacy visibility endpoints are retired and return 410.
