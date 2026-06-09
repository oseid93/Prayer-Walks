import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Arbitrary but stable application-wide lock key. All instances use the same
// key so that pg_advisory_lock serializes migrations across concurrent boots.
const MIGRATION_LOCK_KEY = 947563012;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyMigrations(client: pg.PoolClient): Promise<void> {
  await client.query("BEGIN");

  // branches table
  await client.query(`
    CREATE TABLE IF NOT EXISTS branches (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      church_id VARCHAR NOT NULL REFERENCES groups(id),
      name TEXT NOT NULL,
      created_by_id VARCHAR NOT NULL REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS branches_church_idx ON branches(church_id)
  `);

  // branch_memberships table (user can only be in one branch per church)
  await client.query(`
    CREATE TABLE IF NOT EXISTS branch_memberships (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      branch_id VARCHAR NOT NULL REFERENCES branches(id),
      church_id VARCHAR NOT NULL REFERENCES groups(id),
      role TEXT NOT NULL DEFAULT 'participant',
      joined_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(user_id, church_id)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS branch_memberships_user_idx ON branch_memberships(user_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS branch_memberships_branch_idx ON branch_memberships(branch_id)
  `);

  // teams table
  await client.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      branch_id VARCHAR NOT NULL REFERENCES branches(id),
      name TEXT NOT NULL,
      created_by_id VARCHAR NOT NULL REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS teams_branch_idx ON teams(branch_id)
  `);

  // team_memberships table (user can be in multiple teams per branch)
  await client.query(`
    CREATE TABLE IF NOT EXISTS team_memberships (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      team_id VARCHAR NOT NULL REFERENCES teams(id),
      role TEXT NOT NULL DEFAULT 'participant',
      joined_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(user_id, team_id)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS team_memberships_user_idx ON team_memberships(user_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS team_memberships_team_idx ON team_memberships(team_id)
  `);

  // Add branch_id to priority_areas (nullable, for new branch-level zones)
  await client.query(`
    ALTER TABLE priority_areas
      ADD COLUMN IF NOT EXISTS branch_id VARCHAR REFERENCES branches(id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS priority_areas_branch_idx ON priority_areas(branch_id)
  `);

  // Make group_id nullable on priority_areas (was NOT NULL before)
  await client.query(`
    ALTER TABLE priority_areas
      ALTER COLUMN group_id DROP NOT NULL
  `).catch(() => {
    // Column may already be nullable
  });

  // session_notes table (prayer notes during walks, pinned to GPS location)
  await client.query(`
    CREATE TABLE IF NOT EXISTS session_notes (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id VARCHAR NOT NULL REFERENCES walking_sessions(id),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS session_notes_session_idx ON session_notes(session_id)
  `);

  // Add status column to branch_memberships for join approval flow
  await client.query(`
    ALTER TABLE branch_memberships
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);

  // Add status column to team_memberships for join approval flow
  await client.query(`
    ALTER TABLE team_memberships
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);

  // Add status column to branches for sub-group creation approval flow
  await client.query(`
    ALTER TABLE branches
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);

  // Add status column to teams for sub-group creation approval flow
  await client.query(`
    ALTER TABLE teams
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);

  // Allow users to be members of multiple branches per church.
  // Drop the old UNIQUE(user_id, church_id) constraint and replace it with
  // UNIQUE(user_id, branch_id) so the same person can join more than one branch.
  await client.query(`
    ALTER TABLE branch_memberships
      DROP CONSTRAINT IF EXISTS branch_memberships_user_id_church_id_key,
      DROP CONSTRAINT IF EXISTS branch_memberships_user_church_unique
  `).catch(() => {});
  await client.query(`
    ALTER TABLE branch_memberships
      ADD CONSTRAINT branch_memberships_user_branch_unique UNIQUE (user_id, branch_id)
  `).catch(() => {});

  await client.query("COMMIT");
}

async function applyIdempotentAlters(client: pg.PoolClient): Promise<void> {
  // Run truly idempotent ALTER TABLE statements in their own transaction so
  // they are never affected by any aborted-transaction state left behind by
  // the constraint operations above (which use .catch() to tolerate
  // "constraint already exists" errors but leave the PG session in an aborted
  // state until COMMIT/ROLLBACK).
  await client.query("BEGIN");
  await client.query(`
    ALTER TABLE password_reset_tokens
      ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0
  `);

  // session_org_visibility: records which orgs a session is visible to.
  // Written at session-creation time so coverage/stats are bounded to org
  // membership at walk time rather than querying all sessions by userId.
  await client.query(`
    CREATE TABLE IF NOT EXISTS session_org_visibility (
      session_id VARCHAR NOT NULL REFERENCES walking_sessions(id) ON DELETE CASCADE,
      org_type   TEXT    NOT NULL,
      org_id     VARCHAR NOT NULL,
      PRIMARY KEY (session_id, org_type, org_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS session_org_visibility_org_idx
      ON session_org_visibility(org_type, org_id)
  `);

  // Backfill: bind existing sessions to orgs using membership join dates.
  // A session is attributed to an org when started_at >= member joined_at.
  await client.query(`
    INSERT INTO session_org_visibility (session_id, org_type, org_id)
    SELECT ws.id, 'church', gm.group_id
    FROM walking_sessions ws
    JOIN group_memberships gm ON gm.user_id = ws.user_id
      AND ws.started_at >= gm.joined_at
    ON CONFLICT DO NOTHING
  `);
  await client.query(`
    INSERT INTO session_org_visibility (session_id, org_type, org_id)
    SELECT ws.id, 'branch', bm.branch_id
    FROM walking_sessions ws
    JOIN branch_memberships bm ON bm.user_id = ws.user_id
      AND bm.status = 'active'
      AND ws.started_at >= bm.joined_at
    ON CONFLICT DO NOTHING
  `);
  await client.query(`
    INSERT INTO session_org_visibility (session_id, org_type, org_id)
    SELECT ws.id, 'team', tm.team_id
    FROM walking_sessions ws
    JOIN team_memberships tm ON tm.user_id = ws.user_id
      AND tm.status = 'active'
      AND ws.started_at >= tm.joined_at
    ON CONFLICT DO NOTHING
  `);

  await client.query("COMMIT");
}

async function runMigrationsOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    // Serialize migrations across concurrent boots. pg_advisory_lock blocks
    // until the lock is free, so additional instances wait rather than running
    // contending DDL transactions that deadlock. The lock is session-scoped and
    // released explicitly below (and automatically when the connection closes).
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    try {
      await applyMigrations(client).catch(async (err) => {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      });
      await applyIdempotentAlters(client).catch(async (err) => {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      });
      console.log("Migrations completed successfully");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [
        MIGRATION_LOCK_KEY,
      ]).catch(() => {
        // Lock is released when the session ends regardless.
      });
    }
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runMigrationsOnce();
      return;
    } catch (err) {
      lastErr = err;
      console.error(
        `Migration attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
        err,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  console.error("Migrations failed after all retries:", lastErr);
  throw lastErr;
}
