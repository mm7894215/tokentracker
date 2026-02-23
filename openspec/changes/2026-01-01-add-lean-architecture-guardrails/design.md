## Context

- VibeScore is a small-team product with a CLI + Edge Functions + Dashboard architecture.
- Cost and operational simplicity are critical; InsForge provides Postgres-backed functions.

## Goals / Non-Goals

- Goals:
  - Lean, modular boundaries with minimal redundancy.
  - PostgreSQL-first data model with strong constraints and indices.
  - Security boundaries that prevent data leakage and privilege escalation.
- Non-Goals:
  - New product features or UI changes.
  - Major infra migrations or service decomposition.

## Decisions

- Decision: Keep a monolith-like architecture around Edge Functions + Postgres.
  - Why: Small team and budget favor fewer moving parts.
- Decision: Enforce PostgreSQL guardrails (3NF by default, explicit indices, `timestamptz`).
  - Why: Prevent long-term schema debt and query regressions.
- Decision: Maintain strict data minimization (token counts only).
  - Why: Reduces privacy risk and storage cost.

## Alternatives Considered

- Microservices split for CLI/ingest/analytics.
  - Rejected: Higher operational cost and coordination overhead.
- Denormalized multi-store pipeline.
  - Rejected: Redundancy increases inconsistency risk without measured benefit.

## Risks / Trade-offs

- Guardrails can slow experimentation.
  - Mitigation: Require measurements only for new redundant stores, not for normal changes.

## Migration Plan

- Documentation-only change; no data migration in this phase.

## Open Questions

- Expected scale (DAU and ingest volume) for the next 6–12 months?
- Target latency budget for dashboard endpoints?
