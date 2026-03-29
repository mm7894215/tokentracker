## ADDED Requirements

### Requirement: Greenfield cloud backend documentation is canonical for new integrations

The project SHALL treat `openspec/changes/2026-03-28-greenfield-cloud-backend/design.md` as the canonical description of **new** cloud backend contracts (auth, ingest HTTP shape, logical data model, retention expectations) and SHALL NOT require compatibility with legacy in-repo InsForge paths (`insforge-src/`, `insforge-functions/`, historical `vibeusage-*` URLs) unless a separate explicitly approved change says otherwise.

#### Scenario: Engineer avoids legacy Edge slugs

- **GIVEN** an engineer implements a new cloud ingest path
- **WHEN** they choose InsForge or Supabase
- **THEN** they SHALL follow the greenfield `design.md` and platform-specific supplement (`insforge-vendor-checklist.md` or `supabase-baseline.md`) instead of copying deprecated `insforge-functions` URLs or table names from prior iterations.

### Requirement: Usage ingest is idempotent per user and bucket

The system SHALL define idempotency for half-hour usage buckets such that duplicate submissions for the same `(user_id, bucket_start, source)` do not double-count stored totals.

#### Scenario: Duplicate batch upload

- **GIVEN** a usage batch for `bucket_start = T` and `source = S` was already accepted for `user_id = U`
- **WHEN** the same logical batch is submitted again with the same keys
- **THEN** the stored totals for that bucket SHALL remain unchanged.

### Requirement: InsForge production readiness requires vendor confirmation

If InsForge is selected as the hosted database provider, the team SHALL complete the written checklist in `insforge-vendor-checklist.md` (backups, retention, PITR, region, deletion) before claiming production-grade data durability.

#### Scenario: Checklist before launch

- **GIVEN** a release candidate depends on InsForge Postgres
- **WHEN** preparing go-live
- **THEN** the items in `insforge-vendor-checklist.md` SHALL be confirmed with InsForge or documented as explicitly accepted risks.

### Requirement: Supabase option follows RLS-secured ingest pattern

If Supabase is selected, the team SHALL use Row Level Security on `user_id`-scoped usage tables and validate JWTs in Edge Functions as described in `supabase-baseline.md`, aligned with official Supabase documentation.

#### Scenario: Edge function writes as user

- **GIVEN** a Supabase Edge Function handles `POST /usage/v1/batches`
- **WHEN** a valid user JWT is present
- **THEN** database writes SHALL enforce `auth.uid()` (or equivalent policy) matching the row’s `user_id`.
