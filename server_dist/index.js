// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";

// shared/schema.ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  real,
  integer,
  boolean,
  index,
  unique,
  primaryKey
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var groupMemberships = pgTable(
  "group_memberships",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    groupId: varchar("group_id").notNull().references(() => groups.id),
    role: text("role").notNull().default("participant"),
    joinedAt: timestamp("joined_at").defaultNow().notNull()
  },
  (table) => [
    index("group_memberships_user_idx").on(table.userId),
    index("group_memberships_group_idx").on(table.groupId)
  ]
);
var branches = pgTable(
  "branches",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    churchId: varchar("church_id").notNull().references(() => groups.id),
    name: text("name").notNull(),
    createdById: varchar("created_by_id").notNull().references(() => users.id),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [index("branches_church_idx").on(table.churchId)]
);
var branchMemberships = pgTable(
  "branch_memberships",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    branchId: varchar("branch_id").notNull().references(() => branches.id),
    churchId: varchar("church_id").notNull().references(() => groups.id),
    role: text("role").notNull().default("participant"),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at").defaultNow().notNull()
  },
  (table) => [
    index("branch_memberships_user_idx").on(table.userId),
    index("branch_memberships_branch_idx").on(table.branchId),
    unique("branch_memberships_user_branch_unique").on(table.userId, table.branchId)
  ]
);
var teams = pgTable(
  "teams",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: varchar("branch_id").notNull().references(() => branches.id),
    name: text("name").notNull(),
    createdById: varchar("created_by_id").notNull().references(() => users.id),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [index("teams_branch_idx").on(table.branchId)]
);
var teamMemberships = pgTable(
  "team_memberships",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    teamId: varchar("team_id").notNull().references(() => teams.id),
    role: text("role").notNull().default("participant"),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at").defaultNow().notNull()
  },
  (table) => [
    index("team_memberships_user_idx").on(table.userId),
    index("team_memberships_team_idx").on(table.teamId),
    unique("team_memberships_user_team_unique").on(table.userId, table.teamId)
  ]
);
var walkingSessions = pgTable(
  "walking_sessions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    totalDistance: real("total_distance").default(0).notNull(),
    totalDuration: integer("total_duration").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull()
  },
  (table) => [index("walking_sessions_user_idx").on(table.userId)]
);
var routePoints = pgTable(
  "route_points",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: varchar("session_id").notNull().references(() => walkingSessions.id),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    accuracy: real("accuracy")
  },
  (table) => [index("route_points_session_idx").on(table.sessionId)]
);
var priorityAreas = pgTable(
  "priority_areas",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    groupId: varchar("group_id").references(() => groups.id),
    branchId: varchar("branch_id").references(() => branches.id),
    createdById: varchar("created_by_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    coordinates: text("coordinates").notNull(),
    color: text("color").notNull().default("#FF9500"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("priority_areas_group_idx").on(table.groupId),
    index("priority_areas_branch_idx").on(table.branchId)
  ]
);
var sessionNotes = pgTable(
  "session_notes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: varchar("session_id").notNull().references(() => walkingSessions.id),
    userId: varchar("user_id").notNull().references(() => users.id),
    text: text("text").notNull(),
    latitude: real("latitude"),
    longitude: real("longitude"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [index("session_notes_session_idx").on(table.sessionId)]
);
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
  email: true
}).extend({
  email: z.string().email().optional()
});
var insertGroupSchema = createInsertSchema(groups).pick({
  name: true
});
var sessionOrgVisibility = pgTable(
  "session_org_visibility",
  {
    sessionId: varchar("session_id").notNull().references(() => walkingSessions.id, { onDelete: "cascade" }),
    orgType: text("org_type").notNull(),
    orgId: varchar("org_id").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.orgType, table.orgId] }),
    index("session_org_visibility_org_idx").on(table.orgType, table.orgId)
  ]
);
var insertSessionSchema = createInsertSchema(walkingSessions).pick({});
var insertRoutePointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timestamp: z.string().or(z.date()),
  accuracy: z.number().nullable().optional()
});
var insertRoutePointsSchema = z.object({
  points: z.array(insertRoutePointSchema)
});

// server/storage.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, inArray, desc, asc, gt, isNull, sql as sql2 } from "drizzle-orm";
import pg from "pg";
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle(pool);
function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
var DatabaseStorage = class {
  async getUser(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByUsername(username) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }
  async createUser(insertUser) {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }
  async getUserByEmail(email) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }
  async updateUserPassword(userId, hashedPassword) {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
  }
  async updateDisplayName(userId, displayName) {
    await db.update(users).set({ displayName }).where(eq(users.id, userId));
  }
  async getUserByDisplayName(displayName) {
    const [user] = await db.select().from(users).where(eq(users.displayName, displayName));
    return user;
  }
  async createResetToken(userId, token, expiresAt) {
    const [resetToken] = await db.insert(passwordResetTokens).values({ userId, token, expiresAt }).returning();
    return resetToken;
  }
  async getValidResetToken(token) {
    const [resetToken] = await db.select().from(passwordResetTokens).where(and(eq(passwordResetTokens.token, token), gt(passwordResetTokens.expiresAt, /* @__PURE__ */ new Date())));
    return resetToken;
  }
  async getLatestUnusedResetTokenForUser(userId) {
    const [resetToken] = await db.select().from(passwordResetTokens).where(
      and(
        eq(passwordResetTokens.userId, userId),
        gt(passwordResetTokens.expiresAt, /* @__PURE__ */ new Date()),
        isNull(passwordResetTokens.usedAt)
      )
    ).orderBy(desc(passwordResetTokens.createdAt)).limit(1);
    return resetToken;
  }
  async markResetTokenUsed(tokenId) {
    await db.update(passwordResetTokens).set({ usedAt: /* @__PURE__ */ new Date() }).where(eq(passwordResetTokens.id, tokenId));
  }
  async incrementResetTokenAttempts(tokenId) {
    const [updated] = await db.update(passwordResetTokens).set({ attempts: sql2`${passwordResetTokens.attempts} + 1` }).where(eq(passwordResetTokens.id, tokenId)).returning({ attempts: passwordResetTokens.attempts });
    return updated?.attempts ?? 0;
  }
  async deleteResetToken(tokenId) {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, tokenId));
  }
  // ─── Churches (groups) ────────────────────────────────────────────────────
  async createGroup(name, userId) {
    const code = generateCode();
    const [group] = await db.insert(groups).values({ name, code, createdById: userId }).returning();
    await db.insert(groupMemberships).values({ userId, groupId: group.id, role: "admin" });
    return group;
  }
  async updateGroupCode(groupId, code) {
    const newCode = (code ?? generateCode()).toUpperCase();
    const [updated] = await db.update(groups).set({ code: newCode }).where(eq(groups.id, groupId)).returning();
    return updated;
  }
  async getGroupByCode(code) {
    const [group] = await db.select().from(groups).where(eq(groups.code, code.toUpperCase()));
    return group;
  }
  async getGroupById(id) {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }
  async getUserGroups(userId) {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.userId, userId));
    if (memberships.length === 0) return [];
    const groupIds = memberships.map((m) => m.groupId);
    return db.select().from(groups).where(inArray(groups.id, groupIds));
  }
  async joinGroup(userId, groupId) {
    const group = await this.getGroupById(groupId);
    const role = group?.createdById === userId ? "admin" : "participant";
    const [membership] = await db.insert(groupMemberships).values({ userId, groupId, role }).returning();
    return membership;
  }
  async isGroupMember(userId, groupId) {
    const [membership] = await db.select().from(groupMemberships).where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, groupId)));
    return !!membership;
  }
  async getGroupMembers(groupId) {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    return memberships.map((m) => m.userId);
  }
  async getMemberRole(userId, groupId) {
    const [membership] = await db.select().from(groupMemberships).where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, groupId)));
    return membership?.role;
  }
  async setMemberRole(userId, groupId, role) {
    await db.update(groupMemberships).set({ role }).where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, groupId)));
  }
  async removeMember(userId, groupId) {
    await db.delete(groupMemberships).where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, groupId)));
  }
  async removeChurchMemberCascade(userId, churchId) {
    const userBranchesInChurch = await db.select().from(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.churchId, churchId)));
    for (const bm of userBranchesInChurch) {
      await this.leaveBranch(userId, bm.branchId);
    }
    await this.removeMember(userId, churchId);
  }
  async getGroupMembersWithStats(groupId) {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    if (memberships.length === 0) return [];
    const results = [];
    for (const membership of memberships) {
      const [user] = await db.select().from(users).where(eq(users.id, membership.userId));
      if (!user) continue;
      const sessions = await db.select({ id: walkingSessions.id, totalDistance: walkingSessions.totalDistance, totalDuration: walkingSessions.totalDuration }).from(walkingSessions).innerJoin(
        sessionOrgVisibility,
        and(
          eq(sessionOrgVisibility.sessionId, walkingSessions.id),
          eq(sessionOrgVisibility.orgType, "church"),
          eq(sessionOrgVisibility.orgId, groupId)
        )
      ).where(and(eq(walkingSessions.userId, membership.userId), eq(walkingSessions.isActive, false)));
      results.push({
        userId: membership.userId,
        displayName: user.displayName,
        role: membership.role,
        sessionCount: sessions.length,
        totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
        totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0)
      });
    }
    return results;
  }
  async getGroupStats(groupId, from, to) {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    const memberCount = memberships.length;
    if (memberCount === 0) return { memberCount: 0, sessionCount: 0, totalDistance: 0, totalDuration: 0 };
    const params = [groupId];
    let dateFilter = "";
    if (from) {
      params.push(from);
      dateFilter += ` AND ws.started_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      dateFilter += ` AND ws.started_at <= $${params.length}`;
    }
    const result = await pool.query(
      `SELECT COUNT(*) AS session_count, COALESCE(SUM(ws.total_distance), 0) AS total_distance, COALESCE(SUM(ws.total_duration), 0) AS total_duration
       FROM walking_sessions ws
       JOIN session_org_visibility sov ON sov.session_id = ws.id AND sov.org_type = 'church' AND sov.org_id = $1
       WHERE ws.is_active = false${dateFilter}`,
      params
    );
    const row = result.rows[0];
    return {
      memberCount,
      sessionCount: parseInt(row.session_count, 10),
      totalDistance: parseFloat(row.total_distance),
      totalDuration: parseInt(row.total_duration, 10)
    };
  }
  // ─── Branches ─────────────────────────────────────────────────────────────
  async createBranch(churchId, name, userId, status = "active") {
    const [branch] = await db.insert(branches).values({ churchId, name, createdById: userId, status }).returning();
    if (status === "active") {
      await db.insert(branchMemberships).values({ userId, branchId: branch.id, churchId, role: "admin" }).onConflictDoNothing({ target: [branchMemberships.userId, branchMemberships.branchId] });
    }
    return branch;
  }
  async getBranchesByChurch(churchId) {
    return db.select().from(branches).where(and(eq(branches.churchId, churchId), eq(branches.status, "active"))).orderBy(asc(branches.createdAt));
  }
  async getBranchById(id) {
    const [branch] = await db.select().from(branches).where(eq(branches.id, id));
    return branch;
  }
  async getPendingBranchesByChurch(churchId) {
    const pending = await db.select().from(branches).where(and(eq(branches.churchId, churchId), eq(branches.status, "pending"))).orderBy(asc(branches.createdAt));
    const results = [];
    for (const b of pending) {
      const [u] = await db.select().from(users).where(eq(users.id, b.createdById));
      results.push({ ...b, requestedByName: u?.displayName ?? "Unknown" });
    }
    return results;
  }
  async approveBranchCreation(branchId) {
    const [branch] = await db.select().from(branches).where(eq(branches.id, branchId));
    if (!branch) return;
    await db.update(branches).set({ status: "active" }).where(eq(branches.id, branchId));
    await db.insert(branchMemberships).values({ userId: branch.createdById, branchId: branch.id, churchId: branch.churchId, role: "admin", status: "active" }).onConflictDoNothing({ target: [branchMemberships.userId, branchMemberships.branchId] });
  }
  async rejectBranchCreation(branchId) {
    await db.delete(branchMemberships).where(eq(branchMemberships.branchId, branchId));
    await db.delete(branches).where(eq(branches.id, branchId));
  }
  async getUserBranchInChurch(userId, churchId) {
    const [membership] = await db.select().from(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.churchId, churchId), eq(branchMemberships.status, "active")));
    if (!membership) return void 0;
    return this.getBranchById(membership.branchId);
  }
  // Creates a pending join request; branch admin must approve
  async joinBranch(userId, branchId, churchId) {
    const [membership] = await db.insert(branchMemberships).values({ userId, branchId, churchId, role: "participant", status: "pending" }).onConflictDoNothing().returning();
    if (!membership) {
      const [existing] = await db.select().from(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
      return existing;
    }
    return membership;
  }
  async leaveBranch(userId, branchId) {
    const branchTeams = await db.select().from(teams).where(eq(teams.branchId, branchId));
    const teamIds = branchTeams.map((t) => t.id);
    if (teamIds.length > 0) {
      for (const teamId of teamIds) {
        await db.delete(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
      }
    }
    await db.delete(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
  }
  async isBranchMember(userId, branchId) {
    const [m] = await db.select().from(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "active")));
    return !!m;
  }
  async hasBranchRequest(userId, branchId) {
    const [m] = await db.select().from(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
    return m?.status ?? null;
  }
  async getBranchMemberRole(userId, branchId) {
    const [m] = await db.select().from(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "active")));
    return m?.role;
  }
  async setBranchMemberRole(userId, branchId, role) {
    await db.update(branchMemberships).set({ role }).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
  }
  async removeBranchMember(userId, branchId) {
    await this.leaveBranch(userId, branchId);
  }
  async getBranchMembers(branchId) {
    const memberships = await db.select().from(branchMemberships).where(and(eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "active")));
    return memberships.map((m) => m.userId);
  }
  async getBranchMembersWithStats(branchId) {
    const memberships = await db.select().from(branchMemberships).where(and(eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "active")));
    if (memberships.length === 0) return [];
    const results = [];
    for (const membership of memberships) {
      const [user] = await db.select().from(users).where(eq(users.id, membership.userId));
      if (!user) continue;
      const sessions = await db.select({ id: walkingSessions.id, totalDistance: walkingSessions.totalDistance, totalDuration: walkingSessions.totalDuration }).from(walkingSessions).innerJoin(
        sessionOrgVisibility,
        and(
          eq(sessionOrgVisibility.sessionId, walkingSessions.id),
          eq(sessionOrgVisibility.orgType, "branch"),
          eq(sessionOrgVisibility.orgId, branchId)
        )
      ).where(and(eq(walkingSessions.userId, membership.userId), eq(walkingSessions.isActive, false)));
      results.push({
        userId: membership.userId,
        displayName: user.displayName,
        role: membership.role,
        sessionCount: sessions.length,
        totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
        totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0)
      });
    }
    return results;
  }
  async getBranchStats(branchId, from, to) {
    const memberIds = await this.getBranchMembers(branchId);
    if (memberIds.length === 0) return { memberCount: 0, sessionCount: 0, totalDistance: 0, totalDuration: 0 };
    const params = [branchId];
    let dateFilter = "";
    if (from) {
      params.push(from);
      dateFilter += ` AND ws.started_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      dateFilter += ` AND ws.started_at <= $${params.length}`;
    }
    const result = await pool.query(
      `SELECT COUNT(*) AS session_count, COALESCE(SUM(ws.total_distance), 0) AS total_distance, COALESCE(SUM(ws.total_duration), 0) AS total_duration
       FROM walking_sessions ws
       JOIN session_org_visibility sov ON sov.session_id = ws.id AND sov.org_type = 'branch' AND sov.org_id = $1
       WHERE ws.is_active = false${dateFilter}`,
      params
    );
    const row = result.rows[0];
    return {
      memberCount: memberIds.length,
      sessionCount: parseInt(row.session_count, 10),
      totalDistance: parseFloat(row.total_distance),
      totalDuration: parseInt(row.total_duration, 10)
    };
  }
  async getPendingBranchRequests(branchId) {
    const memberships = await db.select().from(branchMemberships).where(and(eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "pending")));
    const results = [];
    for (const m of memberships) {
      const [u] = await db.select().from(users).where(eq(users.id, m.userId));
      if (u) results.push({ userId: m.userId, displayName: u.displayName, requestedAt: m.joinedAt });
    }
    return results;
  }
  async approveBranchRequest(userId, branchId) {
    await db.update(branchMemberships).set({ status: "active" }).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
  }
  async rejectBranchRequest(userId, branchId) {
    await db.delete(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
  }
  // ─── Teams ────────────────────────────────────────────────────────────────
  async createTeam(branchId, name, userId, status = "active") {
    const [team] = await db.insert(teams).values({ branchId, name, createdById: userId, status }).returning();
    if (status === "active") {
      await db.insert(teamMemberships).values({ userId, teamId: team.id, role: "admin" });
    }
    return team;
  }
  async getTeamsByBranch(branchId) {
    return db.select().from(teams).where(and(eq(teams.branchId, branchId), eq(teams.status, "active"))).orderBy(asc(teams.createdAt));
  }
  async getTeamById(id) {
    const [team] = await db.select().from(teams).where(eq(teams.id, id));
    return team;
  }
  async getPendingTeamsByBranch(branchId) {
    const pending = await db.select().from(teams).where(and(eq(teams.branchId, branchId), eq(teams.status, "pending"))).orderBy(asc(teams.createdAt));
    const results = [];
    for (const t of pending) {
      const [u] = await db.select().from(users).where(eq(users.id, t.createdById));
      results.push({ ...t, requestedByName: u?.displayName ?? "Unknown" });
    }
    return results;
  }
  async approveTeamCreation(teamId) {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) return;
    await db.update(teams).set({ status: "active" }).where(eq(teams.id, teamId));
    await db.insert(teamMemberships).values({ userId: team.createdById, teamId: team.id, role: "admin", status: "active" }).onConflictDoNothing();
  }
  async rejectTeamCreation(teamId) {
    await db.delete(teamMemberships).where(eq(teamMemberships.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  }
  async getUserTeamsInBranch(userId, branchId) {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.status, "active")));
    if (memberships.length === 0) return [];
    const teamIds = memberships.map((m) => m.teamId);
    const allTeams = await db.select().from(teams).where(inArray(teams.id, teamIds));
    return allTeams.filter((t) => t.branchId === branchId);
  }
  // Creates a pending join request; team admin must approve
  async joinTeam(userId, teamId) {
    const [membership] = await db.insert(teamMemberships).values({ userId, teamId, role: "participant", status: "pending" }).onConflictDoNothing().returning();
    if (!membership) {
      const [existing] = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
      return existing;
    }
    return membership;
  }
  async leaveTeam(userId, teamId) {
    await db.delete(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
  }
  async isTeamMember(userId, teamId) {
    const [m] = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "active")));
    return !!m;
  }
  async hasTeamRequest(userId, teamId) {
    const [m] = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
    return m?.status ?? null;
  }
  async getTeamMemberRole(userId, teamId) {
    const [m] = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "active")));
    return m?.role;
  }
  async setTeamMemberRole(userId, teamId, role) {
    await db.update(teamMemberships).set({ role }).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
  }
  async removeTeamMember(userId, teamId) {
    await this.leaveTeam(userId, teamId);
  }
  async getTeamMembers(teamId) {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "active")));
    return memberships.map((m) => m.userId);
  }
  async getPendingTeamRequests(teamId) {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "pending")));
    const results = [];
    for (const m of memberships) {
      const [u] = await db.select().from(users).where(eq(users.id, m.userId));
      if (u) results.push({ userId: m.userId, displayName: u.displayName, requestedAt: m.joinedAt });
    }
    return results;
  }
  async approveTeamRequest(userId, teamId) {
    await db.update(teamMemberships).set({ status: "active" }).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
  }
  async rejectTeamRequest(userId, teamId) {
    await db.delete(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
  }
  async getMyTeams(userId) {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.status, "active")));
    const result = [];
    for (const m of memberships) {
      const team = await this.getTeamById(m.teamId);
      if (!team) continue;
      const branch = await this.getBranchById(team.branchId);
      if (!branch) continue;
      result.push({ ...team, role: m.role, branchName: branch.name, churchId: branch.churchId });
    }
    return result;
  }
  async getMyAdminBranches(userId) {
    const memberships = await db.select().from(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.role, "admin"), eq(branchMemberships.status, "active")));
    const result = [];
    for (const m of memberships) {
      const branch = await this.getBranchById(m.branchId);
      if (branch) result.push({ ...branch, role: m.role });
    }
    return result;
  }
  async getMyAdminTeams(userId) {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.role, "admin"), eq(teamMemberships.status, "active")));
    const result = [];
    for (const m of memberships) {
      const team = await this.getTeamById(m.teamId);
      if (team) result.push({ ...team, role: m.role });
    }
    return result;
  }
  async getPendingRequestsSummary(userId) {
    const adminBranches = await this.getMyAdminBranches(userId);
    const adminTeams = await this.getMyAdminTeams(userId);
    const branchCounts = [];
    let total = 0;
    for (const b of adminBranches) {
      const reqs = await this.getPendingBranchRequests(b.id);
      if (reqs.length > 0) {
        branchCounts.push({ branchId: b.id, name: b.name, count: reqs.length });
        total += reqs.length;
      }
    }
    const teamCounts = [];
    for (const t of adminTeams) {
      const reqs = await this.getPendingTeamRequests(t.id);
      if (reqs.length > 0) {
        teamCounts.push({ teamId: t.id, name: t.name, count: reqs.length });
        total += reqs.length;
      }
    }
    return { total, branches: branchCounts, teams: teamCounts };
  }
  async getTeamMembersWithStats(teamId) {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "active")));
    if (memberships.length === 0) return [];
    const results = [];
    for (const membership of memberships) {
      const [user] = await db.select().from(users).where(eq(users.id, membership.userId));
      if (!user) continue;
      const sessions = await db.select({ id: walkingSessions.id, totalDistance: walkingSessions.totalDistance, totalDuration: walkingSessions.totalDuration }).from(walkingSessions).innerJoin(
        sessionOrgVisibility,
        and(
          eq(sessionOrgVisibility.sessionId, walkingSessions.id),
          eq(sessionOrgVisibility.orgType, "team"),
          eq(sessionOrgVisibility.orgId, teamId)
        )
      ).where(and(eq(walkingSessions.userId, membership.userId), eq(walkingSessions.isActive, false)));
      results.push({
        userId: membership.userId,
        displayName: user.displayName,
        role: membership.role,
        sessionCount: sessions.length,
        totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
        totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0)
      });
    }
    return results;
  }
  async getTeamStats(teamId, from, to) {
    const memberIds = await this.getTeamMembers(teamId);
    if (memberIds.length === 0) return { memberCount: 0, sessionCount: 0, totalDistance: 0, totalDuration: 0 };
    const params = [teamId];
    let dateFilter = "";
    if (from) {
      params.push(from);
      dateFilter += ` AND ws.started_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      dateFilter += ` AND ws.started_at <= $${params.length}`;
    }
    const result = await pool.query(
      `SELECT COUNT(*) AS session_count, COALESCE(SUM(ws.total_distance), 0) AS total_distance, COALESCE(SUM(ws.total_duration), 0) AS total_duration
       FROM walking_sessions ws
       JOIN session_org_visibility sov ON sov.session_id = ws.id AND sov.org_type = 'team' AND sov.org_id = $1
       WHERE ws.is_active = false${dateFilter}`,
      params
    );
    const row = result.rows[0];
    return {
      memberCount: memberIds.length,
      sessionCount: parseInt(row.session_count, 10),
      totalDistance: parseFloat(row.total_distance),
      totalDuration: parseInt(row.total_duration, 10)
    };
  }
  // ─── Sessions ─────────────────────────────────────────────────────────────
  async createSession(userId) {
    const [session2] = await db.insert(walkingSessions).values({ userId }).returning();
    const [churchMems, branchMems, teamMems] = await Promise.all([
      db.select().from(groupMemberships).where(eq(groupMemberships.userId, userId)),
      db.select().from(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.status, "active"))),
      db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.status, "active")))
    ]);
    const rows = [
      ...churchMems.map((m) => ({ sessionId: session2.id, orgType: "church", orgId: m.groupId })),
      ...branchMems.map((m) => ({ sessionId: session2.id, orgType: "branch", orgId: m.branchId })),
      ...teamMems.map((m) => ({ sessionId: session2.id, orgType: "team", orgId: m.teamId }))
    ];
    if (rows.length > 0) {
      await db.insert(sessionOrgVisibility).values(rows).onConflictDoNothing();
    }
    return session2;
  }
  async endSession(sessionId, userId, totalDistance, totalDuration) {
    const [session2] = await db.update(walkingSessions).set({ endedAt: /* @__PURE__ */ new Date(), totalDistance, totalDuration, isActive: false }).where(and(eq(walkingSessions.id, sessionId), eq(walkingSessions.userId, userId))).returning();
    return session2;
  }
  async getUserSessions(userId) {
    return db.select().from(walkingSessions).where(eq(walkingSessions.userId, userId)).orderBy(desc(walkingSessions.startedAt));
  }
  async getSessionById(id) {
    const [session2] = await db.select().from(walkingSessions).where(eq(walkingSessions.id, id));
    return session2;
  }
  async deleteSession(sessionId, userId) {
    const [session2] = await db.select().from(walkingSessions).where(and(eq(walkingSessions.id, sessionId), eq(walkingSessions.userId, userId)));
    if (!session2) return false;
    await db.delete(routePoints).where(eq(routePoints.sessionId, sessionId));
    await db.delete(walkingSessions).where(eq(walkingSessions.id, sessionId));
    return true;
  }
  async addRoutePoints(sessionId, points) {
    if (points.length === 0) return [];
    const values = points.map((p) => ({
      sessionId,
      latitude: p.latitude,
      longitude: p.longitude,
      timestamp: new Date(p.timestamp),
      accuracy: p.accuracy ?? null
    }));
    return db.insert(routePoints).values(values).returning();
  }
  async getSessionRoutePoints(sessionId) {
    return db.select().from(routePoints).where(eq(routePoints.sessionId, sessionId)).orderBy(asc(routePoints.timestamp));
  }
  async getUserRoutePoints(userId) {
    const sessions = await db.select().from(walkingSessions).where(eq(walkingSessions.userId, userId));
    if (sessions.length === 0) return [];
    const sessionIds = sessions.map((s) => s.id);
    return db.select().from(routePoints).where(inArray(routePoints.sessionId, sessionIds)).orderBy(asc(routePoints.timestamp));
  }
  async getGroupRoutePoints(groupId) {
    return db.select({
      id: routePoints.id,
      sessionId: routePoints.sessionId,
      latitude: routePoints.latitude,
      longitude: routePoints.longitude,
      timestamp: routePoints.timestamp,
      accuracy: routePoints.accuracy
    }).from(routePoints).innerJoin(
      sessionOrgVisibility,
      and(
        eq(routePoints.sessionId, sessionOrgVisibility.sessionId),
        eq(sessionOrgVisibility.orgType, "church"),
        eq(sessionOrgVisibility.orgId, groupId)
      )
    ).innerJoin(walkingSessions, and(eq(routePoints.sessionId, walkingSessions.id), eq(walkingSessions.isActive, false))).orderBy(asc(routePoints.timestamp));
  }
  async getTeamRoutePoints(teamId) {
    return db.select({
      id: routePoints.id,
      sessionId: routePoints.sessionId,
      latitude: routePoints.latitude,
      longitude: routePoints.longitude,
      timestamp: routePoints.timestamp,
      accuracy: routePoints.accuracy
    }).from(routePoints).innerJoin(
      sessionOrgVisibility,
      and(
        eq(routePoints.sessionId, sessionOrgVisibility.sessionId),
        eq(sessionOrgVisibility.orgType, "team"),
        eq(sessionOrgVisibility.orgId, teamId)
      )
    ).innerJoin(walkingSessions, and(eq(routePoints.sessionId, walkingSessions.id), eq(walkingSessions.isActive, false))).orderBy(asc(routePoints.timestamp));
  }
  // ─── Priority Areas ───────────────────────────────────────────────────────
  async getPriorityAreas(groupId) {
    return db.select().from(priorityAreas).where(eq(priorityAreas.groupId, groupId)).orderBy(asc(priorityAreas.createdAt));
  }
  async getBranchPriorityAreas(branchId) {
    return db.select().from(priorityAreas).where(eq(priorityAreas.branchId, branchId)).orderBy(asc(priorityAreas.createdAt));
  }
  async getUserPriorityAreas(userId) {
    const userGroups = await this.getUserGroups(userId);
    const userBranchMemberships = await db.select().from(branchMemberships).where(eq(branchMemberships.userId, userId));
    const areas = [];
    for (const g of userGroups) {
      const groupAreas = await db.select().from(priorityAreas).where(eq(priorityAreas.groupId, g.id));
      areas.push(...groupAreas);
    }
    for (const bm of userBranchMemberships) {
      const branchAreas = await db.select().from(priorityAreas).where(eq(priorityAreas.branchId, bm.branchId));
      areas.push(...branchAreas);
    }
    const seen = /* @__PURE__ */ new Set();
    return areas.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }
  async createPriorityArea(groupId, branchId, createdById, name, coordinates, color) {
    const [area] = await db.insert(priorityAreas).values({ groupId, branchId, createdById, name, coordinates: JSON.stringify(coordinates), color }).returning();
    return area;
  }
  async deletePriorityArea(areaId, groupId, branchId) {
    if (branchId) {
      await db.delete(priorityAreas).where(and(eq(priorityAreas.id, areaId), eq(priorityAreas.branchId, branchId)));
    } else if (groupId) {
      await db.delete(priorityAreas).where(and(eq(priorityAreas.id, areaId), eq(priorityAreas.groupId, groupId)));
    } else {
      await db.delete(priorityAreas).where(eq(priorityAreas.id, areaId));
    }
  }
  // ─── Session Notes ────────────────────────────────────────────────────────
  async createSessionNote(sessionId, userId, text2, latitude, longitude) {
    const [note] = await db.insert(sessionNotes).values({ sessionId, userId, text: text2, latitude, longitude }).returning();
    return note;
  }
  async getSessionNotes(sessionId) {
    return db.select().from(sessionNotes).where(eq(sessionNotes.sessionId, sessionId)).orderBy(asc(sessionNotes.createdAt));
  }
  async deleteSessionNote(noteId, userId) {
    const [note] = await db.select().from(sessionNotes).where(eq(sessionNotes.id, noteId));
    if (!note || note.userId !== userId) return false;
    await db.delete(sessionNotes).where(eq(sessionNotes.id, noteId));
    return true;
  }
};
var storage = new DatabaseStorage();

// server/email.ts
import nodemailer from "nodemailer";
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}
async function sendPasswordResetEmail(to, code) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("SMTP not configured \u2014 reset code:", code);
    return false;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await transporter.sendMail({
      from: `StreetCover <${from}>`,
      to,
      subject: "Your StreetCover password reset code",
      text: `Your password reset code is: ${code}

It expires in 1 hour. If you didn't request this, you can ignore this email.`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;">
          <h2 style="color:#33C3F0;">StreetCover</h2>
          <p>Here is your password reset code:</p>
          <div style="background:#1A1A2E;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
            <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#ffffff;">${code}</span>
          </div>
          <p style="color:#9CA3AF;font-size:14px;">This code expires in 1 hour. If you didn't request a password reset you can safely ignore this email.</p>
        </div>
      `
    });
    return true;
  } catch (err) {
    console.error("Failed to send reset email:", err);
    return false;
  }
}

// server/migrations.ts
import pg2 from "pg";
var pool2 = new pg2.Pool({ connectionString: process.env.DATABASE_URL });
var MIGRATION_LOCK_KEY = 947563012;
var MAX_ATTEMPTS = 3;
var RETRY_DELAY_MS = 2e3;
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
async function applyMigrations(client) {
  await client.query("BEGIN");
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
  await client.query(`
    ALTER TABLE priority_areas
      ADD COLUMN IF NOT EXISTS branch_id VARCHAR REFERENCES branches(id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS priority_areas_branch_idx ON priority_areas(branch_id)
  `);
  await client.query(`
    ALTER TABLE priority_areas
      ALTER COLUMN group_id DROP NOT NULL
  `).catch(() => {
  });
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
  await client.query(`
    ALTER TABLE branch_memberships
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);
  await client.query(`
    ALTER TABLE team_memberships
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);
  await client.query(`
    ALTER TABLE branches
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);
  await client.query(`
    ALTER TABLE teams
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);
  await client.query(`
    ALTER TABLE branch_memberships
      DROP CONSTRAINT IF EXISTS branch_memberships_user_id_church_id_key,
      DROP CONSTRAINT IF EXISTS branch_memberships_user_church_unique
  `).catch(() => {
  });
  await client.query(`
    ALTER TABLE branch_memberships
      ADD CONSTRAINT branch_memberships_user_branch_unique UNIQUE (user_id, branch_id)
  `).catch(() => {
  });
  await client.query("COMMIT");
}
async function applyIdempotentAlters(client) {
  await client.query("BEGIN");
  await client.query(`
    ALTER TABLE password_reset_tokens
      ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0
  `);
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
async function runMigrationsOnce() {
  const client = await pool2.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await applyMigrations(client).catch(async (err) => {
        await client.query("ROLLBACK").catch(() => {
        });
        throw err;
      });
      await applyIdempotentAlters(client).catch(async (err) => {
        await client.query("ROLLBACK").catch(() => {
        });
        throw err;
      });
      console.log("Migrations completed successfully");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [
        MIGRATION_LOCK_KEY
      ]).catch(() => {
      });
    }
  } finally {
    client.release();
  }
}
async function runMigrations() {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runMigrationsOnce();
      return;
    } catch (err) {
      lastErr = err;
      console.error(
        `Migration attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
        err
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  console.error("Migrations failed after all retries:", lastErr);
  throw lastErr;
}

// server/routes.ts
function opaqueSessionIds(points) {
  const idMap = /* @__PURE__ */ new Map();
  let counter = 0;
  return points.map((p) => {
    if (!idMap.has(p.sessionId)) idMap.set(p.sessionId, String(++counter));
    return { ...p, sessionId: idMap.get(p.sessionId) };
  });
}
var loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again later." },
  skipSuccessfulRequests: true
});
var forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1e3,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset requests. Please try again later." }
});
var resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many reset attempts. Please try again later." }
});
var PgStore = connectPg(session);
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}
async function effectiveBranchRole(userId, branchId) {
  const direct = await storage.getBranchMemberRole(userId, branchId);
  if (direct) return direct;
  const branch = await storage.getBranchById(branchId);
  if (!branch) return void 0;
  const churchRole = await storage.getMemberRole(userId, branch.churchId);
  return churchRole === "admin" ? "admin" : void 0;
}
async function effectiveTeamRole(userId, teamId) {
  const direct = await storage.getTeamMemberRole(userId, teamId);
  if (direct) return direct;
  const team = await storage.getTeamById(teamId);
  if (!team) return void 0;
  return effectiveBranchRole(userId, team.branchId);
}
async function registerRoutes(app2) {
  await runMigrations();
  app2.use(
    session({
      store: new PgStore({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true
      }),
      secret: process.env.SESSION_SECRET || "street-cover-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1e3,
        httpOnly: true,
        secure: false,
        sameSite: "lax"
      }
    })
  );
  app2.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
      const existing = await storage.getUserByUsername(parsed.data.username);
      if (existing) return res.status(409).json({ message: "Username already taken" });
      const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
      const user = await storage.createUser({ ...parsed.data, password: hashedPassword });
      req.session.userId = user.id;
      res.json({ id: user.id, username: user.username, displayName: user.displayName });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ message: "Username and password required" });
      const user = await storage.getUserByUsername(username);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ message: "Invalid credentials" });
      req.session.userId = user.id;
      res.json({ id: user.id, username: user.username, displayName: user.displayName });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    res.json({ id: user.id, username: user.username, displayName: user.displayName, email: user.email ?? null });
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ message: "Logged out" }));
  });
  app2.patch("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const { displayName } = req.body;
      if (!displayName || !displayName.trim()) return res.status(400).json({ message: "Display name required" });
      const trimmed = displayName.trim();
      const existing = await storage.getUserByDisplayName(trimmed);
      if (existing && existing.id !== req.session.userId) return res.status(409).json({ message: "That name is already taken" });
      await storage.updateDisplayName(req.session.userId, trimmed);
      res.json({ displayName: trimmed });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/auth/forgot-password", forgotPasswordLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      const safe = { message: "If that email is registered, a reset code has been sent." };
      if (!user) return res.json(safe);
      const code = Math.floor(1e5 + Math.random() * 9e5).toString();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1e3);
      await storage.createResetToken(user.id, code, expiresAt);
      await sendPasswordResetEmail(email, code);
      res.json(safe);
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/auth/reset-password", resetPasswordLimiter, async (req, res) => {
    try {
      const { email, code, newPassword } = req.body;
      if (!email || !code || !newPassword) return res.status(400).json({ message: "Email, code, and new password are required" });
      if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user) return res.status(400).json({ message: "Invalid or expired code" });
      const resetToken = await storage.getValidResetToken(code);
      if (!resetToken || resetToken.userId !== user.id || resetToken.usedAt) {
        const candidateToken = await storage.getLatestUnusedResetTokenForUser(user.id);
        if (candidateToken) {
          const attempts = await storage.incrementResetTokenAttempts(candidateToken.id);
          if (attempts >= 5) {
            await storage.deleteResetToken(candidateToken.id);
          }
        }
        return res.status(400).json({ message: "Invalid or expired code" });
      }
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.id, hashed);
      await storage.markResetTokenUsed(resetToken.id);
      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/churches", requireAuth, async (req, res) => {
    try {
      const userGroups = await storage.getUserGroups(req.session.userId);
      const result = await Promise.all(
        userGroups.map(async (g) => {
          const role = await storage.getMemberRole(req.session.userId, g.id);
          return { ...g, role: role ?? "participant" };
        })
      );
      res.json(result);
    } catch (error) {
      console.error("Get churches error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/churches", requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) return res.status(400).json({ message: "Church name required" });
      const group = await storage.createGroup(name.trim(), req.session.userId);
      res.json(group);
    } catch (error) {
      console.error("Create church error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.patch("/api/churches/:id/code", requireAuth, async (req, res) => {
    try {
      const churchId = req.params.id;
      const role = await storage.getMemberRole(req.session.userId, churchId);
      if (role !== "admin") return res.status(403).json({ message: "Church admin access required" });
      const { code } = req.body;
      if (code !== void 0) {
        const trimmed = code.trim().toUpperCase();
        if (trimmed.length < 3 || trimmed.length > 10) return res.status(400).json({ message: "Code must be 3\u201310 characters" });
        if (!/^[A-Z0-9]+$/.test(trimmed)) return res.status(400).json({ message: "Code can only contain letters and numbers" });
        const existing = await storage.getGroupByCode(trimmed);
        if (existing && existing.id !== churchId) return res.status(409).json({ message: "That code is already in use" });
      }
      const group = await storage.updateGroupCode(churchId, code?.trim());
      res.json(group);
    } catch (error) {
      console.error("Update church code error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/churches/join", requireAuth, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Church code required" });
      const group = await storage.getGroupByCode(code);
      if (!group) return res.status(404).json({ message: "Church not found" });
      const isMember = await storage.isGroupMember(req.session.userId, group.id);
      if (isMember) return res.status(409).json({ message: "Already a member of this church" });
      await storage.joinGroup(req.session.userId, group.id);
      res.json(group);
    } catch (error) {
      console.error("Join church error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/churches/:id/leave", requireAuth, async (req, res) => {
    try {
      const churchId = req.params.id;
      const isMember = await storage.isGroupMember(req.session.userId, churchId);
      if (!isMember) return res.status(404).json({ message: "Not a member" });
      await storage.removeChurchMemberCascade(req.session.userId, churchId);
      res.json({ success: true });
    } catch (error) {
      console.error("Leave church error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/churches/:id/stats", requireAuth, async (req, res) => {
    try {
      const churchId = req.params.id;
      const isMember = await storage.isGroupMember(req.session.userId, churchId);
      if (!isMember) return res.status(403).json({ message: "Not a member" });
      const from = req.query.from ? new Date(req.query.from) : void 0;
      const to = req.query.to ? new Date(req.query.to) : void 0;
      const stats = await storage.getGroupStats(churchId, from, to);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/churches/:id/members", requireAuth, async (req, res) => {
    try {
      const churchId = req.params.id;
      const role = await storage.getMemberRole(req.session.userId, churchId);
      if (!role) return res.status(403).json({ message: "Not a member" });
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const members = await storage.getGroupMembersWithStats(churchId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.patch("/api/churches/:id/members/:userId/role", requireAuth, async (req, res) => {
    try {
      const { id: churchId, userId: targetUserId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "participant"].includes(role)) return res.status(400).json({ message: "Invalid role" });
      const myRole = await storage.getMemberRole(req.session.userId, churchId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.setMemberRole(targetUserId, churchId, role);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/churches/:id/members/:userId", requireAuth, async (req, res) => {
    try {
      const { id: churchId, userId: targetUserId } = req.params;
      const myRole = await storage.getMemberRole(req.session.userId, churchId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot remove yourself" });
      await storage.removeChurchMemberCascade(targetUserId, churchId);
      res.json({ success: true });
    } catch (error) {
      console.error("Remove church member error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/churches/:churchId/branches", requireAuth, async (req, res) => {
    try {
      const { churchId } = req.params;
      const isMember = await storage.isGroupMember(req.session.userId, churchId);
      if (!isMember) return res.status(403).json({ message: "Not a church member" });
      const allBranches = await storage.getBranchesByChurch(churchId);
      const churchRole = await storage.getMemberRole(req.session.userId, churchId);
      const isChurchAdmin = churchRole === "admin";
      const result = await Promise.all(
        allBranches.map(async (b) => {
          const direct = await storage.getBranchMemberRole(req.session.userId, b.id);
          const role = direct ?? (isChurchAdmin ? "admin" : null);
          const stats = await storage.getBranchStats(b.id);
          const myStatus = await storage.hasBranchRequest(req.session.userId, b.id);
          return {
            ...b,
            role,
            memberCount: stats.memberCount,
            sessionCount: stats.sessionCount,
            totalDistance: stats.totalDistance,
            myStatus
          };
        })
      );
      res.json(result);
    } catch (error) {
      console.error("Get branches error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/churches/:churchId/branches", requireAuth, async (req, res) => {
    try {
      const { churchId } = req.params;
      const role = await storage.getMemberRole(req.session.userId, churchId);
      if (!role) return res.status(403).json({ message: "Not a church member" });
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: "Branch name required" });
      if (role === "admin") {
        const branch2 = await storage.createBranch(churchId, name.trim(), req.session.userId, "active");
        return res.json({ ...branch2, status: "active" });
      }
      const branch = await storage.createBranch(churchId, name.trim(), req.session.userId, "pending");
      res.json({ ...branch, status: "pending", message: "Your branch request has been sent and is awaiting church admin approval." });
    } catch (error) {
      console.error("Create branch error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/churches/:churchId/branch-creation-requests", requireAuth, async (req, res) => {
    try {
      const { churchId } = req.params;
      const role = await storage.getMemberRole(req.session.userId, churchId);
      if (role !== "admin") return res.status(403).json({ message: "Church admin access required" });
      res.json(await storage.getPendingBranchesByChurch(churchId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/churches/:churchId/branch-creation-requests/:branchId/approve", requireAuth, async (req, res) => {
    try {
      const { churchId, branchId } = req.params;
      const role = await storage.getMemberRole(req.session.userId, churchId);
      if (role !== "admin") return res.status(403).json({ message: "Church admin access required" });
      const branch = await storage.getBranchById(branchId);
      if (!branch || branch.churchId !== churchId || branch.status !== "pending") {
        return res.status(404).json({ message: "Pending branch not found" });
      }
      await storage.approveBranchCreation(branchId);
      res.json({ success: true });
    } catch (error) {
      console.error("Approve branch creation error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/churches/:churchId/branch-creation-requests/:branchId", requireAuth, async (req, res) => {
    try {
      const { churchId, branchId } = req.params;
      const role = await storage.getMemberRole(req.session.userId, churchId);
      if (role !== "admin") return res.status(403).json({ message: "Church admin access required" });
      const branch = await storage.getBranchById(branchId);
      if (!branch || branch.churchId !== churchId || branch.status !== "pending") {
        return res.status(404).json({ message: "Pending branch not found" });
      }
      await storage.rejectBranchCreation(branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/churches/:churchId/branches/:branchId/join", requireAuth, async (req, res) => {
    try {
      const { churchId, branchId } = req.params;
      const isMember = await storage.isGroupMember(req.session.userId, churchId);
      if (!isMember) return res.status(403).json({ message: "Not a church member" });
      const branch = await storage.getBranchById(branchId);
      if (!branch || branch.churchId !== churchId || branch.status !== "active") return res.status(404).json({ message: "Branch not found" });
      const existing = await storage.hasBranchRequest(req.session.userId, branchId);
      if (existing === "pending") return res.json({ status: "pending", message: "Your join request is awaiting approval." });
      if (existing === "active") return res.json({ status: "active", message: "Already a member." });
      await storage.joinBranch(req.session.userId, branchId, churchId);
      res.json({ status: "pending", message: "Your join request has been sent and is awaiting approval." });
    } catch (error) {
      console.error("Join branch error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/branches/:branchId/leave", requireAuth, async (req, res) => {
    try {
      const { branchId } = req.params;
      const isMember = await storage.isBranchMember(req.session.userId, branchId);
      if (!isMember) return res.status(404).json({ message: "Not a branch member" });
      await storage.leaveBranch(req.session.userId, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/branches/:branchId/my-request", requireAuth, async (req, res) => {
    try {
      const { branchId } = req.params;
      const status = await storage.hasBranchRequest(req.session.userId, branchId);
      if (status !== "pending") return res.status(404).json({ message: "No pending request" });
      await storage.leaveBranch(req.session.userId, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/branches/:branchId/stats", requireAuth, async (req, res) => {
    try {
      const role = await effectiveBranchRole(req.session.userId, req.params.branchId);
      if (!role) return res.status(403).json({ message: "Not a branch member" });
      const from = req.query.from ? new Date(req.query.from) : void 0;
      const to = req.query.to ? new Date(req.query.to) : void 0;
      res.json(await storage.getBranchStats(req.params.branchId, from, to));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/branches/:branchId/requests", requireAuth, async (req, res) => {
    try {
      const { branchId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getPendingBranchRequests(branchId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/branches/:branchId/requests/:userId/approve", requireAuth, async (req, res) => {
    try {
      const { branchId, userId: targetUserId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.approveBranchRequest(targetUserId, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/branches/:branchId/requests/:userId", requireAuth, async (req, res) => {
    try {
      const { branchId, userId: targetUserId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.rejectBranchRequest(targetUserId, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/branches/:branchId/members", requireAuth, async (req, res) => {
    try {
      const role = await effectiveBranchRole(req.session.userId, req.params.branchId);
      if (!role) return res.status(403).json({ message: "Not a branch member" });
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getBranchMembersWithStats(req.params.branchId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.patch("/api/branches/:branchId/members/:userId/role", requireAuth, async (req, res) => {
    try {
      const { branchId, userId: targetUserId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "participant"].includes(role)) return res.status(400).json({ message: "Invalid role" });
      const myRole = await effectiveBranchRole(req.session.userId, branchId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.setBranchMemberRole(targetUserId, branchId, role);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/branches/:branchId/members/:userId", requireAuth, async (req, res) => {
    try {
      const { branchId, userId: targetUserId } = req.params;
      const myRole = await effectiveBranchRole(req.session.userId, branchId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot remove yourself" });
      await storage.removeBranchMember(targetUserId, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/branches/:branchId/priority-areas", requireAuth, async (req, res) => {
    try {
      const role = await effectiveBranchRole(req.session.userId, req.params.branchId);
      if (!role) return res.status(403).json({ message: "Not a branch member" });
      const areas = await storage.getBranchPriorityAreas(req.params.branchId);
      res.json(areas.map((a) => ({ ...a, coordinates: JSON.parse(a.coordinates) })));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/branches/:branchId/priority-areas", requireAuth, async (req, res) => {
    try {
      const { branchId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const { name, coordinates, color } = req.body;
      if (!name || !coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
        return res.status(400).json({ message: "Name and at least 3 coordinates required" });
      }
      const area = await storage.createPriorityArea(null, branchId, req.session.userId, name.trim(), coordinates, color || "#FF9500");
      res.json({ ...area, coordinates: JSON.parse(area.coordinates) });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/branches/:branchId/priority-areas/:areaId", requireAuth, async (req, res) => {
    try {
      const { branchId, areaId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.deletePriorityArea(areaId, void 0, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/branches/:branchId/teams", requireAuth, async (req, res) => {
    try {
      const { branchId } = req.params;
      const branchRole = await effectiveBranchRole(req.session.userId, branchId);
      if (!branchRole) return res.status(403).json({ message: "Not a branch member" });
      const allTeams = await storage.getTeamsByBranch(branchId);
      const isBranchAdmin = branchRole === "admin";
      const result = await Promise.all(
        allTeams.map(async (t) => {
          const direct = await storage.getTeamMemberRole(req.session.userId, t.id);
          const role = direct ?? (isBranchAdmin ? "admin" : null);
          const stats = await storage.getTeamStats(t.id);
          const myStatus = await storage.hasTeamRequest(req.session.userId, t.id);
          return {
            ...t,
            role,
            memberCount: stats.memberCount,
            sessionCount: stats.sessionCount,
            totalDistance: stats.totalDistance,
            myStatus
          };
        })
      );
      res.json(result);
    } catch (error) {
      console.error("Get teams error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/branches/:branchId/teams", requireAuth, async (req, res) => {
    try {
      const { branchId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (!role) return res.status(403).json({ message: "Not a branch member" });
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: "Team name required" });
      if (role === "admin") {
        const team2 = await storage.createTeam(branchId, name.trim(), req.session.userId, "active");
        return res.json({ ...team2, status: "active" });
      }
      const team = await storage.createTeam(branchId, name.trim(), req.session.userId, "pending");
      res.json({ ...team, status: "pending", message: "Your team request has been sent and is awaiting branch admin approval." });
    } catch (error) {
      console.error("Create team error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/branches/:branchId/team-creation-requests", requireAuth, async (req, res) => {
    try {
      const { branchId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Branch admin access required" });
      res.json(await storage.getPendingTeamsByBranch(branchId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/branches/:branchId/team-creation-requests/:teamId/approve", requireAuth, async (req, res) => {
    try {
      const { branchId, teamId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Branch admin access required" });
      const team = await storage.getTeamById(teamId);
      if (!team || team.branchId !== branchId || team.status !== "pending") {
        return res.status(404).json({ message: "Pending team not found" });
      }
      await storage.approveTeamCreation(teamId);
      res.json({ success: true });
    } catch (error) {
      console.error("Approve team creation error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/branches/:branchId/team-creation-requests/:teamId", requireAuth, async (req, res) => {
    try {
      const { branchId, teamId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Branch admin access required" });
      const team = await storage.getTeamById(teamId);
      if (!team || team.branchId !== branchId || team.status !== "pending") {
        return res.status(404).json({ message: "Pending team not found" });
      }
      await storage.rejectTeamCreation(teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/branches/:branchId/teams/:teamId/join", requireAuth, async (req, res) => {
    try {
      const { branchId, teamId } = req.params;
      const role = await effectiveBranchRole(req.session.userId, branchId);
      if (!role) return res.status(403).json({ message: "Not a branch member" });
      const team = await storage.getTeamById(teamId);
      if (!team || team.branchId !== branchId || team.status !== "active") return res.status(404).json({ message: "Team not found" });
      const existing = await storage.hasTeamRequest(req.session.userId, teamId);
      if (existing === "pending") return res.json({ status: "pending", message: "Your join request is awaiting approval." });
      if (existing === "active") return res.json({ status: "active", message: "Already a member." });
      await storage.joinTeam(req.session.userId, teamId);
      res.json({ status: "pending", message: "Your join request has been sent and is awaiting approval." });
    } catch (error) {
      console.error("Join team error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/teams/:teamId/leave", requireAuth, async (req, res) => {
    try {
      const isMember = await storage.isTeamMember(req.session.userId, req.params.teamId);
      if (!isMember) return res.status(404).json({ message: "Not a team member" });
      await storage.leaveTeam(req.session.userId, req.params.teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/teams/:teamId/my-request", requireAuth, async (req, res) => {
    try {
      const { teamId } = req.params;
      const status = await storage.hasTeamRequest(req.session.userId, teamId);
      if (status !== "pending") return res.status(404).json({ message: "No pending request" });
      await storage.leaveTeam(req.session.userId, teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/teams/:teamId/stats", requireAuth, async (req, res) => {
    try {
      const role = await effectiveTeamRole(req.session.userId, req.params.teamId);
      if (!role) return res.status(403).json({ message: "Not a team member" });
      const from = req.query.from ? new Date(req.query.from) : void 0;
      const to = req.query.to ? new Date(req.query.to) : void 0;
      res.json(await storage.getTeamStats(req.params.teamId, from, to));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/teams/:teamId/requests", requireAuth, async (req, res) => {
    try {
      const { teamId } = req.params;
      const role = await effectiveTeamRole(req.session.userId, teamId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getPendingTeamRequests(teamId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/teams/:teamId/requests/:userId/approve", requireAuth, async (req, res) => {
    try {
      const { teamId, userId: targetUserId } = req.params;
      const role = await effectiveTeamRole(req.session.userId, teamId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.approveTeamRequest(targetUserId, teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/teams/:teamId/requests/:userId", requireAuth, async (req, res) => {
    try {
      const { teamId, userId: targetUserId } = req.params;
      const role = await effectiveTeamRole(req.session.userId, teamId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.rejectTeamRequest(targetUserId, teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/teams/:teamId/members", requireAuth, async (req, res) => {
    try {
      const role = await effectiveTeamRole(req.session.userId, req.params.teamId);
      if (!role) return res.status(403).json({ message: "Not a team member" });
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getTeamMembersWithStats(req.params.teamId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.patch("/api/teams/:teamId/members/:userId/role", requireAuth, async (req, res) => {
    try {
      const { teamId, userId: targetUserId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "participant"].includes(role)) return res.status(400).json({ message: "Invalid role" });
      const myRole = await effectiveTeamRole(req.session.userId, teamId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.setTeamMemberRole(targetUserId, teamId, role);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/teams/:teamId/members/:userId", requireAuth, async (req, res) => {
    try {
      const { teamId, userId: targetUserId } = req.params;
      const myRole = await effectiveTeamRole(req.session.userId, teamId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot remove yourself" });
      await storage.removeTeamMember(targetUserId, teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/teams/:teamId/coverage", requireAuth, async (req, res) => {
    try {
      const role = await effectiveTeamRole(req.session.userId, req.params.teamId);
      if (!role) return res.status(403).json({ message: "Not a team member" });
      const points = await storage.getTeamRoutePoints(req.params.teamId);
      res.json(opaqueSessionIds(points));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/my-teams", requireAuth, async (req, res) => {
    try {
      const myTeams = await storage.getMyTeams(req.session.userId);
      res.json(myTeams);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/my-admin-branches", requireAuth, async (req, res) => {
    try {
      const branches2 = await storage.getMyAdminBranches(req.session.userId);
      res.json(branches2);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/my-pending-requests", requireAuth, async (req, res) => {
    try {
      const summary = await storage.getPendingRequestsSummary(req.session.userId);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/groups", requireAuth, async (req, res) => {
    try {
      const userGroups = await storage.getUserGroups(req.session.userId);
      const result = await Promise.all(
        userGroups.map(async (g) => {
          const role = await storage.getMemberRole(req.session.userId, g.id);
          return { ...g, role: role ?? "participant" };
        })
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/groups", requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) return res.status(400).json({ message: "Group name required" });
      const group = await storage.createGroup(name.trim(), req.session.userId);
      res.json(group);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/groups/join", requireAuth, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Group code required" });
      const group = await storage.getGroupByCode(code);
      if (!group) return res.status(404).json({ message: "Group not found" });
      const isMember = await storage.isGroupMember(req.session.userId, group.id);
      if (isMember) return res.status(409).json({ message: "Already a member of this group" });
      await storage.joinGroup(req.session.userId, group.id);
      res.json(group);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/groups/:id/leave", requireAuth, async (req, res) => {
    try {
      const isMember = await storage.isGroupMember(req.session.userId, req.params.id);
      if (!isMember) return res.status(404).json({ message: "Not a member" });
      await storage.removeMember(req.session.userId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/groups/:id/my-role", requireAuth, async (req, res) => {
    try {
      const role = await storage.getMemberRole(req.session.userId, req.params.id);
      if (!role) return res.status(403).json({ message: "Not a member" });
      res.json({ role });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/groups/:id/stats", requireAuth, async (req, res) => {
    try {
      const isMember = await storage.isGroupMember(req.session.userId, req.params.id);
      if (!isMember) return res.status(403).json({ message: "Not a member" });
      res.json(await storage.getGroupStats(req.params.id));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/groups/:id/members", requireAuth, async (req, res) => {
    try {
      const role = await storage.getMemberRole(req.session.userId, req.params.id);
      if (!role) return res.status(403).json({ message: "Not a member" });
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getGroupMembersWithStats(req.params.id));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.patch("/api/groups/:id/members/:userId/role", requireAuth, async (req, res) => {
    try {
      const { id: groupId, userId: targetUserId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "participant"].includes(role)) return res.status(400).json({ message: "Invalid role" });
      const myRole = await storage.getMemberRole(req.session.userId, groupId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.setMemberRole(targetUserId, groupId, role);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/groups/:id/members/:userId", requireAuth, async (req, res) => {
    try {
      const { id: groupId, userId: targetUserId } = req.params;
      const myRole = await storage.getMemberRole(req.session.userId, groupId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot remove yourself" });
      await storage.removeMember(targetUserId, groupId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/groups/:id/coverage", requireAuth, async (req, res) => {
    try {
      const isMember = await storage.isGroupMember(req.session.userId, req.params.id);
      if (!isMember) return res.status(403).json({ message: "Not a member" });
      res.json(opaqueSessionIds(await storage.getGroupRoutePoints(req.params.id)));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/groups/:id/priority-areas", requireAuth, async (req, res) => {
    try {
      const isMember = await storage.isGroupMember(req.session.userId, req.params.id);
      if (!isMember) return res.status(403).json({ message: "Not a member" });
      const areas = await storage.getPriorityAreas(req.params.id);
      res.json(areas.map((a) => ({ ...a, coordinates: JSON.parse(a.coordinates) })));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/groups/:id/priority-areas", requireAuth, async (req, res) => {
    try {
      const groupId = req.params.id;
      const role = await storage.getMemberRole(req.session.userId, groupId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const { name, coordinates, color } = req.body;
      if (!name || !coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
        return res.status(400).json({ message: "Name and at least 3 coordinates required" });
      }
      const area = await storage.createPriorityArea(groupId, null, req.session.userId, name.trim(), coordinates, color || "#FF9500");
      res.json({ ...area, coordinates: JSON.parse(area.coordinates) });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/groups/:id/priority-areas/:areaId", requireAuth, async (req, res) => {
    try {
      const { id: groupId, areaId } = req.params;
      const role = await storage.getMemberRole(req.session.userId, groupId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.deletePriorityArea(areaId, groupId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/my-priority-areas", requireAuth, async (req, res) => {
    try {
      const areas = await storage.getUserPriorityAreas(req.session.userId);
      res.json(areas.map((a) => ({ ...a, coordinates: JSON.parse(a.coordinates) })));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/telemetry/tracking", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const events = Array.isArray(req.body?.events) ? req.body.events : [{ event: req.body?.event, data: req.body?.data }];
      for (const e of events) {
        if (!e || !e.event) continue;
        console.log(
          `[tracking-telemetry] user=${userId} event=${e.event}`,
          e.data ? JSON.stringify(e.data) : ""
        );
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/sessions", requireAuth, async (req, res) => {
    try {
      const session2 = await storage.createSession(req.session.userId);
      res.json(session2);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.put("/api/sessions/:id/end", requireAuth, async (req, res) => {
    try {
      const { totalDistance, totalDuration } = req.body;
      const session2 = await storage.getSessionById(req.params.id);
      if (!session2) return res.status(404).json({ message: "Session not found" });
      if (session2.userId !== req.session.userId) return res.status(403).json({ message: "Not authorized" });
      const ended = await storage.endSession(req.params.id, req.session.userId, totalDistance || 0, totalDuration || 0);
      if (!ended) return res.status(404).json({ message: "Session not found" });
      res.json(ended);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/sessions/:id/points", requireAuth, async (req, res) => {
    try {
      const parsed = insertRoutePointsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid route points data" });
      const session2 = await storage.getSessionById(req.params.id);
      if (!session2) return res.status(404).json({ message: "Session not found" });
      if (session2.userId !== req.session.userId) return res.status(403).json({ message: "Not authorized" });
      const points = await storage.addRoutePoints(req.params.id, parsed.data.points);
      res.json(points);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/sessions/:id/points", requireAuth, async (req, res) => {
    try {
      const session2 = await storage.getSessionById(req.params.id);
      if (!session2) return res.status(404).json({ message: "Session not found" });
      if (session2.userId !== req.session.userId) return res.status(403).json({ message: "Not authorized" });
      const points = await storage.getSessionRoutePoints(req.params.id);
      res.json(points);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/sessions", requireAuth, async (req, res) => {
    try {
      const sessions = await storage.getUserSessions(req.session.userId);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/sessions/:id", requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteSession(req.params.id, req.session.userId);
      if (!deleted) return res.status(404).json({ message: "Session not found or not yours" });
      res.json({ message: "Session deleted" });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/coverage", requireAuth, async (req, res) => {
    try {
      const points = await storage.getUserRoutePoints(req.session.userId);
      res.json(points);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/sessions/:id/notes", requireAuth, async (req, res) => {
    try {
      const session2 = await storage.getSessionById(req.params.id);
      if (!session2) return res.status(404).json({ message: "Session not found" });
      if (session2.userId !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
      const notes = await storage.getSessionNotes(req.params.id);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/sessions/:id/notes", requireAuth, async (req, res) => {
    try {
      const session2 = await storage.getSessionById(req.params.id);
      if (!session2) return res.status(404).json({ message: "Session not found" });
      if (session2.userId !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
      const { text: text2, latitude, longitude } = req.body;
      if (!text2 || typeof text2 !== "string" || !text2.trim()) return res.status(400).json({ message: "Note text required" });
      const note = await storage.createSessionNote(
        req.params.id,
        req.session.userId,
        text2.trim(),
        typeof latitude === "number" ? latitude : null,
        typeof longitude === "number" ? longitude : null
      );
      res.json(note);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.delete("/api/sessions/:sessionId/notes/:noteId", requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteSessionNote(req.params.noteId, req.session.userId);
      if (!deleted) return res.status(404).json({ message: "Note not found or not yours" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express();
app.set("etag", false);
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
