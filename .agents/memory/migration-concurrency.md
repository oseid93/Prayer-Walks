---
name: Migration concurrency on boot
description: Why runMigrations() uses a Postgres advisory lock + retry, and the constraint to preserve.
---

# Migrations run on every server boot

`runMigrations()` (server/migrations.ts) executes idempotent DDL on every
Express startup, called from server/routes.ts. Production cycles deployments and
can boot multiple instances at once.

## Rule
Keep migrations serialized with a **session-level** `pg_advisory_lock` (fixed
app-wide key) acquired *outside* the BEGIN/COMMIT transaction, and released via
`pg_advisory_unlock` in a finally. Keep the retry-with-backoff wrapper.

**Why:** Concurrent boots running the same `CREATE TABLE`/`ALTER TABLE` DDL
transactions contend for table locks and one fails with "deadlock detected",
making restarts fragile. The advisory lock makes extra instances wait instead.

**How to apply:** When adding new DDL, append idempotent statements inside
`applyMigrations()`. Do NOT use a transaction-level advisory lock
(`pg_advisory_xact_lock`) unless the lock is acquired inside the same txn — and
do not move the lock acquisition inside the BEGIN/COMMIT block.
