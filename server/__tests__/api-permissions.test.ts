/**
 * Backend permission & API integration tests.
 *
 * These run the REAL Express app in-process (against the real DATABASE_URL)
 * on an ephemeral port and drive it over HTTP with a cookie jar, so they
 * exercise the same auth/session middleware and authorization checks that run
 * in production. Written in Given/When/Then (BDD) style.
 *
 * The threat model flags server-side authorization as the highest-risk area:
 * a user must never read or mutate another user's walking sessions/location,
 * and admin-only org routes must reject non-admins. These tests lock that in.
 *
 * Run: node --import tsx --test server/__tests__/*.test.ts
 *
 * All rows created here are tagged with a unique per-run prefix and removed in
 * dependency order in the `after` hook, so the shared dev DB is left clean.
 */
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:net";
import { Pool } from "pg";
import { registerRoutes } from "../routes";

// ─── Test harness ───────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;
let pool: Pool;
const createdUserIds: string[] = [];

const PASSWORD = "password123";

type Json = any;

interface Client {
  get(path: string): Promise<{ status: number; body: Json }>;
  post(path: string, body?: unknown): Promise<{ status: number; body: Json }>;
  put(path: string, body?: unknown): Promise<{ status: number; body: Json }>;
  patch(path: string, body?: unknown): Promise<{ status: number; body: Json }>;
  del(path: string, body?: unknown): Promise<{ status: number; body: Json }>;
}

/** A fetch wrapper that remembers the connect.sid cookie (one per "user"). */
function makeClient(): Client {
  let cookie = "";

  async function req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers["cookie"] = cookie;

    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const pair = sc.split(";")[0];
      if (pair.startsWith("connect.sid=")) cookie = pair;
    }

    const text = await res.text();
    let parsed: Json = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  }

  return {
    get: (p) => req("GET", p),
    post: (p, b) => req("POST", p, b),
    put: (p, b) => req("PUT", p, b),
    patch: (p, b) => req("PATCH", p, b),
    del: (p, b) => req("DELETE", p, b),
  };
}

const RUN_TAG = `zz_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
let userSeq = 0;

/** Register a fresh user (register auto-logs-in, sidestepping the login limiter). */
async function newUser(label: string): Promise<{ client: Client; id: string; username: string }> {
  const client = makeClient();
  const username = `${RUN_TAG}_${label}_${userSeq++}`;
  const res = await client.post("/api/auth/register", {
    username,
    password: PASSWORD,
    displayName: username,
  });
  assert.equal(res.status, 200, `register ${label}: ${JSON.stringify(res.body)}`);
  createdUserIds.push(res.body.id);
  return { client, id: res.body.id, username };
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be set for backend tests");
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const app = express();
  app.use(express.json());
  const httpServer = await registerRoutes(app);

  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  // Delete every row created by the test users, in FK dependency order, so the
  // shared dev DB is left exactly as we found it.
  if (createdUserIds.length && pool) {
    const ids = createdUserIds;
    await pool.query(`DELETE FROM session_notes WHERE user_id = ANY($1)`, [ids]);
    await pool.query(
      `DELETE FROM route_points WHERE session_id IN (SELECT id FROM walking_sessions WHERE user_id = ANY($1))`,
      [ids],
    );
    await pool.query(`DELETE FROM walking_sessions WHERE user_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM team_memberships WHERE user_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM branch_memberships WHERE user_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM group_memberships WHERE user_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM priority_areas WHERE created_by_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM teams WHERE created_by_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM branches WHERE created_by_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM groups WHERE created_by_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
  }
  await pool?.end();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

// ─── Authentication ─────────────────────────────────────────────────────────

describe("Authentication", () => {
  it("Given valid details, When a user registers, Then they get an id and an active session", async () => {
    const { client, id } = await newUser("auth_ok");
    assert.ok(id);
    const me = await client.get("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.id, id);
  });

  it("Given an existing username, When someone registers with it again, Then it is rejected with 409", async () => {
    const { username } = await newUser("dupe");
    const other = makeClient();
    const res = await other.post("/api/auth/register", {
      username,
      password: PASSWORD,
      displayName: "someone else",
    });
    assert.equal(res.status, 409);
  });

  it("Given missing required fields, When registering, Then it is rejected with 400", async () => {
    const client = makeClient();
    const res = await client.post("/api/auth/register", { username: `${RUN_TAG}_nopw` });
    assert.equal(res.status, 400);
  });

  it("Given no session, When calling /api/auth/me, Then it returns 401", async () => {
    const anon = makeClient();
    const res = await anon.get("/api/auth/me");
    assert.equal(res.status, 401);
  });

  it("Given a logged-in user, When they log out, Then protected calls return 401 again", async () => {
    const { client } = await newUser("logout");
    assert.equal((await client.get("/api/auth/me")).status, 200);
    await client.post("/api/auth/logout");
    assert.equal((await client.get("/api/auth/me")).status, 401);
  });
});

// ─── Unauthenticated access ─────────────────────────────────────────────────

describe("Unauthenticated access is blocked", () => {
  const anon = makeClient();

  for (const [method, path] of [
    ["GET", "/api/sessions"],
    ["GET", "/api/coverage"],
    ["GET", "/api/churches"],
    ["POST", "/api/sessions"],
    ["POST", "/api/churches"],
  ] as const) {
    it(`Given no session, When ${method} ${path}, Then 401`, async () => {
      const res =
        method === "GET" ? await anon.get(path) : await anon.post(path, {});
      assert.equal(res.status, 401);
    });
  }
});

// ─── Session ownership (location data isolation) ────────────────────────────

describe("Walking-session ownership", () => {
  it("Given a session owned by user A, When user B tries to read or mutate it, Then every attempt is forbidden", async () => {
    const a = await newUser("owner");
    const b = await newUser("intruder");

    // Given: A starts a walking session
    const created = await a.client.post("/api/sessions");
    assert.equal(created.status, 200);
    const sessionId = created.body.id;
    assert.equal(created.body.userId, a.id);

    // When/Then: B cannot end it, add/read points, or read/add notes
    assert.equal((await b.client.put(`/api/sessions/${sessionId}/end`, { totalDistance: 1, totalDuration: 1 })).status, 403);
    assert.equal((await b.client.post(`/api/sessions/${sessionId}/points`, { points: [{ latitude: 1, longitude: 1, timestamp: new Date().toISOString() }] })).status, 403);
    assert.equal((await b.client.get(`/api/sessions/${sessionId}/points`)).status, 403);
    assert.equal((await b.client.get(`/api/sessions/${sessionId}/notes`)).status, 403);
    assert.equal((await b.client.post(`/api/sessions/${sessionId}/notes`, { text: "hi" })).status, 403);

    // And: B cannot delete it (storage ownership guard → 404 "not yours")
    assert.equal((await b.client.del(`/api/sessions/${sessionId}`)).status, 404);
  });

  it("Given user A's session, When user A operates on it, Then everything succeeds", async () => {
    const a = await newUser("self");
    const created = await a.client.post("/api/sessions");
    const sessionId = created.body.id;

    const points = await a.client.post(`/api/sessions/${sessionId}/points`, {
      points: [{ latitude: 40, longitude: -73, timestamp: new Date().toISOString(), accuracy: 5 }],
    });
    assert.equal(points.status, 200);

    const read = await a.client.get(`/api/sessions/${sessionId}/points`);
    assert.equal(read.status, 200);
    assert.equal(read.body.length, 1);

    const note = await a.client.post(`/api/sessions/${sessionId}/notes`, { text: "Prayed here", latitude: 40, longitude: -73 });
    assert.equal(note.status, 200);

    const ended = await a.client.put(`/api/sessions/${sessionId}/end`, { totalDistance: 0.5, totalDuration: 120 });
    assert.equal(ended.status, 200);
  });

  it("Given two users with their own sessions, When each lists sessions, Then they only see their own", async () => {
    const a = await newUser("list_a");
    const b = await newUser("list_b");
    const aSession = (await a.client.post("/api/sessions")).body.id;
    await b.client.post("/api/sessions");

    const bList = await b.client.get("/api/sessions");
    assert.equal(bList.status, 200);
    assert.ok(!bList.body.some((s: Json) => s.id === aSession), "B must not see A's session");
  });

  it("Given a request for a nonexistent session, When reading points, Then 404 (no info leak)", async () => {
    const a = await newUser("missing");
    const res = await a.client.get("/api/sessions/00000000-0000-0000-0000-000000000000/points");
    assert.equal(res.status, 404);
  });
});

// ─── Church (group) role boundaries ─────────────────────────────────────────

describe("Church role boundaries", () => {
  it("Given a church creator, Then they are an admin; the joiner is only a participant", async () => {
    const admin = await newUser("church_admin");
    const church = (await admin.client.post("/api/churches", { name: `${RUN_TAG} Church` })).body;

    const myChurches = await admin.client.get("/api/churches");
    const mine = myChurches.body.find((c: Json) => c.id === church.id);
    assert.equal(mine.role, "admin");

    const member = await newUser("church_member");
    const joined = await member.client.post("/api/churches/join", { code: church.code });
    assert.equal(joined.status, 200);
    const memberChurches = await member.client.get("/api/churches");
    assert.equal(memberChurches.body.find((c: Json) => c.id === church.id).role, "participant");
  });

  it("Given a participant member, When they call admin-only church routes, Then 403", async () => {
    const admin = await newUser("ca2");
    const church = (await admin.client.post("/api/churches", { name: `${RUN_TAG} Church2` })).body;
    const member = await newUser("cm2");
    await member.client.post("/api/churches/join", { code: church.code });

    assert.equal((await member.client.get(`/api/churches/${church.id}/members`)).status, 403);
    assert.equal((await member.client.patch(`/api/churches/${church.id}/members/${admin.id}/role`, { role: "participant" })).status, 403);
    assert.equal((await member.client.get(`/api/churches/${church.id}/branch-creation-requests`)).status, 403);

    // And: the admin can read members
    assert.equal((await admin.client.get(`/api/churches/${church.id}/members`)).status, 200);
  });

  it("Given a non-member, When they list a church's branches, Then 403 'Not a church member'", async () => {
    const admin = await newUser("ca3");
    const church = (await admin.client.post("/api/churches", { name: `${RUN_TAG} Church3` })).body;
    const outsider = await newUser("outsider");
    const res = await outsider.client.get(`/api/churches/${church.id}/branches`);
    assert.equal(res.status, 403);
  });
});

// ─── Branch / team hierarchy, approvals & effective roles ───────────────────

describe("Branch & team hierarchy with approvals", () => {
  it("Given a church admin and member, When branches/teams are created and joined, Then the approval and effective-role rules hold", async () => {
    // Given: a church with an admin and a participant member
    const admin = await newUser("h_admin");
    const church = (await admin.client.post("/api/churches", { name: `${RUN_TAG} Hierarchy` })).body;
    const member = await newUser("h_member");
    await member.client.post("/api/churches/join", { code: church.code });

    // When: the church admin creates a branch -> it is immediately active
    const branchRes = await admin.client.post(`/api/churches/${church.id}/branches`, { name: "Downtown" });
    assert.equal(branchRes.status, 200);
    assert.equal(branchRes.body.status, "active");
    const branchId = branchRes.body.id;

    // And: a participant creating a branch produces a PENDING request, hidden from the public list
    const pendingBranch = await member.client.post(`/api/churches/${church.id}/branches`, { name: "Suburb (pending)" });
    assert.equal(pendingBranch.body.status, "pending");
    const pendingBranchId = pendingBranch.body.id;
    const publicBranches = await admin.client.get(`/api/churches/${church.id}/branches`);
    assert.ok(!publicBranches.body.some((b: Json) => b.id === pendingBranchId), "pending branch must be hidden");

    // Then: only the church admin sees the branch-creation request, and can approve it
    assert.equal((await member.client.get(`/api/churches/${church.id}/branch-creation-requests`)).status, 403);
    const reqList = await admin.client.get(`/api/churches/${church.id}/branch-creation-requests`);
    assert.equal(reqList.status, 200);
    assert.ok(reqList.body.some((b: Json) => b.id === pendingBranchId));
    const approveCreate = await admin.client.post(`/api/churches/${church.id}/branch-creation-requests/${pendingBranchId}/approve`);
    assert.equal(approveCreate.status, 200);
    const afterApprove = await admin.client.get(`/api/churches/${church.id}/branches`);
    assert.ok(afterApprove.body.some((b: Json) => b.id === pendingBranchId), "approved branch now public");

    // And: a church admin is an EFFECTIVE branch admin even without direct branch membership
    assert.equal((await admin.client.get(`/api/branches/${branchId}/requests`)).status, 200);

    // And: an admin of a DIFFERENT church has NO power over this branch (cross-tenant
    // isolation — guards against an elevation-of-privilege / IDOR path where one
    // church's admin reaches into another church's branch via a known branchId).
    const foreignAdmin = await newUser("h_foreign");
    await foreignAdmin.client.post("/api/churches", { name: `${RUN_TAG} OtherChurch` });
    assert.equal((await foreignAdmin.client.get(`/api/branches/${branchId}/requests`)).status, 403);
    assert.equal((await foreignAdmin.client.get(`/api/branches/${branchId}/team-creation-requests`)).status, 403);
    assert.equal((await foreignAdmin.client.get(`/api/branches/${branchId}/teams`)).status, 403);
    assert.equal((await foreignAdmin.client.post(`/api/branches/${branchId}/requests/${member.id}/approve`)).status, 403);

    // When: the member joins the active branch -> pending; the church admin approves
    const joinBranch = await member.client.post(`/api/churches/${church.id}/branches/${branchId}/join`);
    assert.equal(joinBranch.body.status, "pending");
    const branchReqs = await admin.client.get(`/api/branches/${branchId}/requests`);
    assert.ok(branchReqs.body.some((r: Json) => r.userId === member.id || r.id === member.id), "member appears in branch join requests");
    assert.equal((await member.client.get(`/api/branches/${branchId}/requests`)).status, 403);
    const approveJoin = await admin.client.post(`/api/branches/${branchId}/requests/${member.id}/approve`);
    assert.equal(approveJoin.status, 200);

    // Then: the now-active branch member (a participant) creating a team yields a PENDING team
    const pendingTeam = await member.client.post(`/api/branches/${branchId}/teams`, { name: "Alpha (pending)" });
    assert.equal(pendingTeam.body.status, "pending");
    const pendingTeamId = pendingTeam.body.id;

    // And: the church admin is an effective branch admin -> sees & approves the team-creation request
    assert.equal((await member.client.get(`/api/branches/${branchId}/team-creation-requests`)).status, 403);
    const teamReqs = await admin.client.get(`/api/branches/${branchId}/team-creation-requests`);
    assert.equal(teamReqs.status, 200);
    assert.ok(teamReqs.body.some((t: Json) => t.id === pendingTeamId));
    const approveTeam = await admin.client.post(`/api/branches/${branchId}/team-creation-requests/${pendingTeamId}/approve`);
    assert.equal(approveTeam.status, 200);

    // And: the church admin can administer the team too (effective team role)
    assert.equal((await admin.client.get(`/api/teams/${pendingTeamId}/requests`)).status, 200);

    // But the foreign-church admin still cannot touch this team (cross-tenant isolation)
    assert.equal((await foreignAdmin.client.get(`/api/teams/${pendingTeamId}/requests`)).status, 403);
  });
});
