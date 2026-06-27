---
name: Running the test suites in this Expo + Express repo
description: How to run the BDD/TDD suites given there is no npm test script, and the in-process Express harness pattern for backend tests
---

# Running tests

There is **no test runner installed and no `test` script** in package.json, and
package.json must not be edited (Expo constraint). Tests use Node's built-in
runner with the already-present `tsx` loader. Two suites exist:

```
node --import tsx --test lib/__tests__/*.test.ts        # pure frontend logic
node --import tsx --test server/__tests__/*.test.ts     # backend API/permissions
```

The registered `test` validation step runs both globs together.

**Why:** installing jest/ts-jest into an Expo SDK 54 project is heavy and risks
dependency drift; `node:test` + `tsx` runs TypeScript with zero new deps.

## Frontend: keep logic pure and import it back

Keep pure, testable logic in dependency-free modules (e.g. `lib/tracking-math.ts`,
`lib/tracking-buffer.ts`) that import nothing from React/expo-location, and have
the React context import those helpers so tests exercise the real code path, not
a copy. The context itself can't run under `node:test`.

## Backend: run the real Express app in-process

`server/__tests__/api-permissions.test.ts` calls `registerRoutes(app)` on an
`express()` instance, `listen(0)` for an ephemeral port, and drives it over real
HTTP with a hand-rolled cookie jar (capture `connect.sid` from
`res.headers.getSetCookie()`, works on Node 22). This exercises the real session
middleware and authorization guards.

**Why:** authorization is the highest-risk area (threat model); testing through
real HTTP + sessions catches broken ownership/role checks a unit test would miss.

**How to apply:**
- Use `/api/auth/register` (it auto-creates the session) to avoid the login
  rate limiter.
- Tag every created row with a unique per-run prefix and delete in FK
  dependency order in an `after()` hook — the schema has almost no cascades.
- Note: "churches" is the `groups` table (schema comment: "Groups table is now
  Churches conceptually"); there is no separate churches/church_memberships
  table. Clean up churches via `DELETE FROM groups WHERE created_by_id = ...`.
