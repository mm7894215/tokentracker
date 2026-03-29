# Change: Greenfield cloud backend (InsForge vs Supabase) architecture

## Why

Legacy in-repo InsForge integration paths (`insforge-src/`, generated `insforge-functions/`, historical `vibeusage-*` HTTP contracts, and `BACKEND_API.md` as a living contract) are treated as **deprecated** for future product decisions. The product still needs a **documented greenfield** model for login, authenticated usage ingest, and data retention expectations—without inheriting obsolete Edge slugs or table names from prior iterations.

## What Changes

- Add canonical planning artifacts under this change:
  - `design.md`: target HTTP ingest shape, logical data model, JWT and device-credential boundaries (no legacy path names).
  - `insforge-vendor-checklist.md`: items to confirm with InsForge (SLA/backup/region/deletion)—not inferable from public docs alone.
  - `supabase-baseline.md`: Supabase-official backup windows, PITR, and Edge Function + RLS patterns for the same logical ingest.
- Add OpenSpec requirements in `specs/cloud-backend-greenfield/spec.md` so the capability is tracked.
- Supersede planning-only reliance on `2026-01-15-adopt-insforge-hosted-auth` for “hosted auth rollout” as the driver of cloud architecture (see that change’s `STATUS.md`).

## Impact

- Affected specs: new capability `cloud-backend-greenfield` (delta only).
- Affected code: **none in this change** (documentation and OpenSpec only).
- **BREAKING**: N/A (no runtime change).

## Risks & Mitigations

- Risk: Documentation drifts from a future chosen vendor.
  - Mitigation: Version under `openspec/changes/2026-03-28-greenfield-cloud-backend/`; update or archive when implementation lands.
