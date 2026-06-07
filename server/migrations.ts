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
      await applyMigrations(client);
      console.log("Migrations completed successfully");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // Ignore rollback errors; the original error is what matters.
      });
      throw err;
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
