import {
  type User,
  type InsertUser,
  type Group,
  type GroupMembership,
  type Branch,
  type BranchMembership,
  type Team,
  type TeamMembership,
  type WalkingSession,
  type RoutePoint,
  type PriorityArea,
  type SessionNote,
  type PasswordResetToken,
  users,
  groups,
  groupMemberships,
  branches,
  branchMemberships,
  teams,
  teamMemberships,
  walkingSessions,
  routePoints,
  priorityAreas,
  sessionNotes,
  passwordResetTokens,
} from "../shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, inArray, desc, asc, sum, count, gt, gte, lte, or, isNull } from "drizzle-orm";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export interface MemberStats {
  userId: string;
  displayName: string;
  role: string;
  sessionCount: number;
  totalDistance: number;
  totalDuration: number;
}

export interface GroupStats {
  memberCount: number;
  sessionCount: number;
  totalDistance: number;
  totalDuration: number;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(userId: string, hashedPassword: string): Promise<void>;
  updateDisplayName(userId: string, displayName: string): Promise<void>;
  getUserByDisplayName(displayName: string): Promise<User | undefined>;
  createResetToken(userId: string, token: string, expiresAt: Date): Promise<PasswordResetToken>;
  getValidResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markResetTokenUsed(tokenId: string): Promise<void>;

  // Churches (groups)
  createGroup(name: string, userId: string): Promise<Group>;
  getGroupByCode(code: string): Promise<Group | undefined>;
  getGroupById(id: string): Promise<Group | undefined>;
  getUserGroups(userId: string): Promise<Group[]>;
  joinGroup(userId: string, groupId: string): Promise<GroupMembership>;
  isGroupMember(userId: string, groupId: string): Promise<boolean>;
  getGroupMembers(groupId: string): Promise<string[]>;
  getMemberRole(userId: string, groupId: string): Promise<string | undefined>;
  setMemberRole(userId: string, groupId: string, role: string): Promise<void>;
  removeMember(userId: string, groupId: string): Promise<void>;
  removeChurchMemberCascade(userId: string, churchId: string): Promise<void>;
  getGroupMembersWithStats(groupId: string): Promise<MemberStats[]>;
  getGroupStats(groupId: string, from?: Date, to?: Date): Promise<GroupStats>;

  // Branches
  createBranch(churchId: string, name: string, userId: string, status?: "active" | "pending"): Promise<Branch>;
  getBranchesByChurch(churchId: string): Promise<Branch[]>;
  getBranchById(id: string): Promise<Branch | undefined>;
  getPendingBranchesByChurch(churchId: string): Promise<Array<Branch & { requestedByName: string }>>;
  approveBranchCreation(branchId: string): Promise<void>;
  rejectBranchCreation(branchId: string): Promise<void>;
  getUserBranchInChurch(userId: string, churchId: string): Promise<Branch | undefined>;
  joinBranch(userId: string, branchId: string, churchId: string): Promise<BranchMembership>;
  leaveBranch(userId: string, branchId: string): Promise<void>;
  isBranchMember(userId: string, branchId: string): Promise<boolean>;
  hasBranchRequest(userId: string, branchId: string): Promise<string | null>;
  getBranchMemberRole(userId: string, branchId: string): Promise<string | undefined>;
  setBranchMemberRole(userId: string, branchId: string, role: string): Promise<void>;
  removeBranchMember(userId: string, branchId: string): Promise<void>;
  getBranchMembersWithStats(branchId: string): Promise<MemberStats[]>;
  getBranchStats(branchId: string, from?: Date, to?: Date): Promise<GroupStats>;
  getBranchMembers(branchId: string): Promise<string[]>;
  getPendingBranchRequests(branchId: string): Promise<Array<{ userId: string; displayName: string; requestedAt: Date }>>;
  approveBranchRequest(userId: string, branchId: string): Promise<void>;
  rejectBranchRequest(userId: string, branchId: string): Promise<void>;

  // Teams
  createTeam(branchId: string, name: string, userId: string, status?: "active" | "pending"): Promise<Team>;
  getTeamsByBranch(branchId: string): Promise<Team[]>;
  getTeamById(id: string): Promise<Team | undefined>;
  getPendingTeamsByBranch(branchId: string): Promise<Array<Team & { requestedByName: string }>>;
  approveTeamCreation(teamId: string): Promise<void>;
  rejectTeamCreation(teamId: string): Promise<void>;
  getUserTeamsInBranch(userId: string, branchId: string): Promise<Team[]>;
  joinTeam(userId: string, teamId: string): Promise<TeamMembership>;
  leaveTeam(userId: string, teamId: string): Promise<void>;
  isTeamMember(userId: string, teamId: string): Promise<boolean>;
  hasTeamRequest(userId: string, teamId: string): Promise<string | null>;
  getTeamMemberRole(userId: string, teamId: string): Promise<string | undefined>;
  setTeamMemberRole(userId: string, teamId: string, role: string): Promise<void>;
  removeTeamMember(userId: string, teamId: string): Promise<void>;
  getTeamMembersWithStats(teamId: string): Promise<MemberStats[]>;
  getTeamStats(teamId: string, from?: Date, to?: Date): Promise<GroupStats>;
  getTeamMembers(teamId: string): Promise<string[]>;
  getPendingTeamRequests(teamId: string): Promise<Array<{ userId: string; displayName: string; requestedAt: Date }>>;
  approveTeamRequest(userId: string, teamId: string): Promise<void>;
  rejectTeamRequest(userId: string, teamId: string): Promise<void>;
  getMyTeams(userId: string): Promise<Array<Team & { role: string; branchName: string; churchId: string }>>;
  getMyAdminBranches(userId: string): Promise<Array<Branch & { role: string }>>;
  getMyAdminTeams(userId: string): Promise<Array<Team & { role: string }>>;
  getPendingRequestsSummary(userId: string): Promise<{
    total: number;
    branches: Array<{ branchId: string; name: string; count: number }>;
    teams: Array<{ teamId: string; name: string; count: number }>;
  }>;

  // Sessions
  createSession(userId: string): Promise<WalkingSession>;
  endSession(sessionId: string, totalDistance: number, totalDuration: number): Promise<WalkingSession | undefined>;
  getUserSessions(userId: string): Promise<WalkingSession[]>;
  getSessionById(id: string): Promise<WalkingSession | undefined>;
  deleteSession(sessionId: string, userId: string): Promise<boolean>;

  addRoutePoints(
    sessionId: string,
    points: Array<{ latitude: number; longitude: number; timestamp: string | Date; accuracy?: number | null }>,
  ): Promise<RoutePoint[]>;
  getSessionRoutePoints(sessionId: string): Promise<RoutePoint[]>;
  getUserRoutePoints(userId: string): Promise<RoutePoint[]>;
  getGroupRoutePoints(groupId: string): Promise<RoutePoint[]>;
  getTeamRoutePoints(teamId: string): Promise<RoutePoint[]>;

  // Priority areas
  getPriorityAreas(groupId: string): Promise<PriorityArea[]>;
  getBranchPriorityAreas(branchId: string): Promise<PriorityArea[]>;
  getUserPriorityAreas(userId: string): Promise<PriorityArea[]>;
  createPriorityArea(
    groupId: string | null,
    branchId: string | null,
    createdById: string,
    name: string,
    coordinates: Array<{ latitude: number; longitude: number }>,
    color: string,
  ): Promise<PriorityArea>;
  deletePriorityArea(areaId: string, groupId?: string, branchId?: string): Promise<void>;
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
  }

  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    await db.update(users).set({ displayName }).where(eq(users.id, userId));
  }

  async getUserByDisplayName(displayName: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.displayName, displayName));
    return user;
  }

  async createResetToken(userId: string, token: string, expiresAt: Date): Promise<PasswordResetToken> {
    const [resetToken] = await db.insert(passwordResetTokens).values({ userId, token, expiresAt }).returning();
    return resetToken;
  }

  async getValidResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.token, token), gt(passwordResetTokens.expiresAt, new Date())));
    return resetToken;
  }

  async markResetTokenUsed(tokenId: string): Promise<void> {
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, tokenId));
  }

  // ─── Churches (groups) ────────────────────────────────────────────────────

  async createGroup(name: string, userId: string): Promise<Group> {
    const code = generateCode();
    const [group] = await db.insert(groups).values({ name, code, createdById: userId }).returning();
    await db.insert(groupMemberships).values({ userId, groupId: group.id, role: "admin" });
    return group;
  }

  async getGroupByCode(code: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.code, code.toUpperCase()));
    return group;
  }

  async getGroupById(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  async getUserGroups(userId: string): Promise<Group[]> {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.userId, userId));
    if (memberships.length === 0) return [];
    const groupIds = memberships.map((m) => m.groupId);
    return db.select().from(groups).where(inArray(groups.id, groupIds));
  }

  async joinGroup(userId: string, groupId: string): Promise<GroupMembership> {
    const group = await this.getGroupById(groupId);
    const role = group?.createdById === userId ? "admin" : "participant";
    const [membership] = await db.insert(groupMemberships).values({ userId, groupId, role }).returning();
    return membership;
  }

  async isGroupMember(userId: string, groupId: string): Promise<boolean> {
    const [membership] = await db
      .select()
      .from(groupMemberships)
      .where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, groupId)));
    return !!membership;
  }

  async getGroupMembers(groupId: string): Promise<string[]> {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    return memberships.map((m) => m.userId);
  }

  async getMemberRole(userId: string, groupId: string): Promise<string | undefined> {
    const [membership] = await db
      .select()
      .from(groupMemberships)
      .where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, groupId)));
    return membership?.role;
  }

  async setMemberRole(userId: string, groupId: string, role: string): Promise<void> {
    await db
      .update(groupMemberships)
      .set({ role })
      .where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, groupId)));
  }

  async removeMember(userId: string, groupId: string): Promise<void> {
    await db
      .delete(groupMemberships)
      .where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, groupId)));
  }

  async removeChurchMemberCascade(userId: string, churchId: string): Promise<void> {
    // Remove from all branches (which also cascades to teams within each branch)
    const userBranchesInChurch = await db
      .select()
      .from(branchMemberships)
      .where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.churchId, churchId)));
    for (const bm of userBranchesInChurch) {
      await this.leaveBranch(userId, bm.branchId);
    }
    // Remove from church (legacy group_memberships table)
    await this.removeMember(userId, churchId);
  }

  async getGroupMembersWithStats(groupId: string): Promise<MemberStats[]> {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    if (memberships.length === 0) return [];
    const results: MemberStats[] = [];
    for (const membership of memberships) {
      const [user] = await db.select().from(users).where(eq(users.id, membership.userId));
      if (!user) continue;
      const sessions = await db
        .select()
        .from(walkingSessions)
        .where(and(eq(walkingSessions.userId, membership.userId), eq(walkingSessions.isActive, false)));
      results.push({
        userId: membership.userId,
        displayName: user.displayName,
        role: membership.role,
        sessionCount: sessions.length,
        totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
        totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0),
      });
    }
    return results;
  }

  async getGroupStats(groupId: string, from?: Date, to?: Date): Promise<GroupStats> {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    const memberCount = memberships.length;
    if (memberCount === 0) return { memberCount: 0, sessionCount: 0, totalDistance: 0, totalDuration: 0 };
    const memberIds = memberships.map((m) => m.userId);
    const conditions = [inArray(walkingSessions.userId, memberIds), eq(walkingSessions.isActive, false)];
    if (from) conditions.push(gte(walkingSessions.startedAt, from));
    if (to) conditions.push(lte(walkingSessions.startedAt, to));
    const sessions = await db.select().from(walkingSessions).where(and(...conditions));
    return {
      memberCount,
      sessionCount: sessions.length,
      totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
      totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0),
    };
  }

  // ─── Branches ─────────────────────────────────────────────────────────────

  async createBranch(churchId: string, name: string, userId: string, status: "active" | "pending" = "active"): Promise<Branch> {
    const [branch] = await db.insert(branches).values({ churchId, name, createdById: userId, status }).returning();
    if (status === "active") {
      await db.insert(branchMemberships).values({ userId, branchId: branch.id, churchId, role: "admin" });
    }
    return branch;
  }

  async getBranchesByChurch(churchId: string): Promise<Branch[]> {
    return db
      .select()
      .from(branches)
      .where(and(eq(branches.churchId, churchId), eq(branches.status, "active")))
      .orderBy(asc(branches.createdAt));
  }

  async getBranchById(id: string): Promise<Branch | undefined> {
    const [branch] = await db.select().from(branches).where(eq(branches.id, id));
    return branch;
  }

  async getPendingBranchesByChurch(churchId: string): Promise<Array<Branch & { requestedByName: string }>> {
    const pending = await db
      .select()
      .from(branches)
      .where(and(eq(branches.churchId, churchId), eq(branches.status, "pending")))
      .orderBy(asc(branches.createdAt));
    const results: Array<Branch & { requestedByName: string }> = [];
    for (const b of pending) {
      const [u] = await db.select().from(users).where(eq(users.id, b.createdById));
      results.push({ ...b, requestedByName: u?.displayName ?? "Unknown" });
    }
    return results;
  }

  async approveBranchCreation(branchId: string): Promise<void> {
    const [branch] = await db.select().from(branches).where(eq(branches.id, branchId));
    if (!branch) return;
    // Make sure the requester isn't already in another branch in this church
    await db
      .delete(branchMemberships)
      .where(and(eq(branchMemberships.userId, branch.createdById), eq(branchMemberships.churchId, branch.churchId)));
    await db.update(branches).set({ status: "active" }).where(eq(branches.id, branchId));
    await db.insert(branchMemberships).values({
      userId: branch.createdById,
      branchId: branch.id,
      churchId: branch.churchId,
      role: "admin",
      status: "active",
    });
  }

  async rejectBranchCreation(branchId: string): Promise<void> {
    // Defensive cleanup of any memberships (none should exist for pending), then delete the branch
    await db.delete(branchMemberships).where(eq(branchMemberships.branchId, branchId));
    await db.delete(branches).where(eq(branches.id, branchId));
  }

  async getUserBranchInChurch(userId: string, churchId: string): Promise<Branch | undefined> {
    const [membership] = await db
      .select()
      .from(branchMemberships)
      .where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.churchId, churchId), eq(branchMemberships.status, "active")));
    if (!membership) return undefined;
    return this.getBranchById(membership.branchId);
  }

  // Creates a pending join request; branch admin must approve
  async joinBranch(userId: string, branchId: string, churchId: string): Promise<BranchMembership> {
    const [membership] = await db
      .insert(branchMemberships)
      .values({ userId, branchId, churchId, role: "participant", status: "pending" })
      .onConflictDoNothing()
      .returning();
    if (!membership) {
      const [existing] = await db
        .select()
        .from(branchMemberships)
        .where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.churchId, churchId)));
      return existing;
    }
    return membership;
  }

  async leaveBranch(userId: string, branchId: string): Promise<void> {
    // Also remove all team memberships within this branch
    const branchTeams = await db.select().from(teams).where(eq(teams.branchId, branchId));
    const teamIds = branchTeams.map((t) => t.id);
    if (teamIds.length > 0) {
      for (const teamId of teamIds) {
        await db.delete(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
      }
    }
    await db.delete(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
  }

  async isBranchMember(userId: string, branchId: string): Promise<boolean> {
    const [m] = await db
      .select()
      .from(branchMemberships)
      .where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "active")));
    return !!m;
  }

  async hasBranchRequest(userId: string, branchId: string): Promise<string | null> {
    const [m] = await db
      .select()
      .from(branchMemberships)
      .where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
    return m?.status ?? null;
  }

  async getBranchMemberRole(userId: string, branchId: string): Promise<string | undefined> {
    const [m] = await db
      .select()
      .from(branchMemberships)
      .where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "active")));
    return m?.role;
  }

  async setBranchMemberRole(userId: string, branchId: string, role: string): Promise<void> {
    await db
      .update(branchMemberships)
      .set({ role })
      .where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
  }

  async removeBranchMember(userId: string, branchId: string): Promise<void> {
    await this.leaveBranch(userId, branchId);
  }

  async getBranchMembers(branchId: string): Promise<string[]> {
    const memberships = await db.select().from(branchMemberships).where(and(eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "active")));
    return memberships.map((m) => m.userId);
  }

  async getBranchMembersWithStats(branchId: string): Promise<MemberStats[]> {
    const memberships = await db.select().from(branchMemberships).where(and(eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "active")));
    if (memberships.length === 0) return [];
    const results: MemberStats[] = [];
    for (const membership of memberships) {
      const [user] = await db.select().from(users).where(eq(users.id, membership.userId));
      if (!user) continue;
      const sessions = await db
        .select()
        .from(walkingSessions)
        .where(and(eq(walkingSessions.userId, membership.userId), eq(walkingSessions.isActive, false)));
      results.push({
        userId: membership.userId,
        displayName: user.displayName,
        role: membership.role,
        sessionCount: sessions.length,
        totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
        totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0),
      });
    }
    return results;
  }

  async getBranchStats(branchId: string, from?: Date, to?: Date): Promise<GroupStats> {
    const memberIds = await this.getBranchMembers(branchId);
    if (memberIds.length === 0) return { memberCount: 0, sessionCount: 0, totalDistance: 0, totalDuration: 0 };
    const conditions = [inArray(walkingSessions.userId, memberIds), eq(walkingSessions.isActive, false)];
    if (from) conditions.push(gte(walkingSessions.startedAt, from));
    if (to) conditions.push(lte(walkingSessions.startedAt, to));
    const sessions = await db.select().from(walkingSessions).where(and(...conditions));
    return {
      memberCount: memberIds.length,
      sessionCount: sessions.length,
      totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
      totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0),
    };
  }

  async getPendingBranchRequests(branchId: string): Promise<Array<{ userId: string; displayName: string; requestedAt: Date }>> {
    const memberships = await db.select().from(branchMemberships).where(and(eq(branchMemberships.branchId, branchId), eq(branchMemberships.status, "pending")));
    const results: Array<{ userId: string; displayName: string; requestedAt: Date }> = [];
    for (const m of memberships) {
      const [u] = await db.select().from(users).where(eq(users.id, m.userId));
      if (u) results.push({ userId: m.userId, displayName: u.displayName, requestedAt: m.joinedAt });
    }
    return results;
  }

  async approveBranchRequest(userId: string, branchId: string): Promise<void> {
    await db.update(branchMemberships).set({ status: "active" }).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
  }

  async rejectBranchRequest(userId: string, branchId: string): Promise<void> {
    await db.delete(branchMemberships).where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.branchId, branchId)));
  }

  // ─── Teams ────────────────────────────────────────────────────────────────

  async createTeam(branchId: string, name: string, userId: string, status: "active" | "pending" = "active"): Promise<Team> {
    const [team] = await db.insert(teams).values({ branchId, name, createdById: userId, status }).returning();
    if (status === "active") {
      await db.insert(teamMemberships).values({ userId, teamId: team.id, role: "admin" });
    }
    return team;
  }

  async getTeamsByBranch(branchId: string): Promise<Team[]> {
    return db
      .select()
      .from(teams)
      .where(and(eq(teams.branchId, branchId), eq(teams.status, "active")))
      .orderBy(asc(teams.createdAt));
  }

  async getTeamById(id: string): Promise<Team | undefined> {
    const [team] = await db.select().from(teams).where(eq(teams.id, id));
    return team;
  }

  async getPendingTeamsByBranch(branchId: string): Promise<Array<Team & { requestedByName: string }>> {
    const pending = await db
      .select()
      .from(teams)
      .where(and(eq(teams.branchId, branchId), eq(teams.status, "pending")))
      .orderBy(asc(teams.createdAt));
    const results: Array<Team & { requestedByName: string }> = [];
    for (const t of pending) {
      const [u] = await db.select().from(users).where(eq(users.id, t.createdById));
      results.push({ ...t, requestedByName: u?.displayName ?? "Unknown" });
    }
    return results;
  }

  async approveTeamCreation(teamId: string): Promise<void> {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) return;
    await db.update(teams).set({ status: "active" }).where(eq(teams.id, teamId));
    // Add the requester as team admin (no church-uniqueness constraint on teams)
    await db
      .insert(teamMemberships)
      .values({ userId: team.createdById, teamId: team.id, role: "admin", status: "active" })
      .onConflictDoNothing();
  }

  async rejectTeamCreation(teamId: string): Promise<void> {
    await db.delete(teamMemberships).where(eq(teamMemberships.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  }

  async getUserTeamsInBranch(userId: string, branchId: string): Promise<Team[]> {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.status, "active")));
    if (memberships.length === 0) return [];
    const teamIds = memberships.map((m) => m.teamId);
    const allTeams = await db.select().from(teams).where(inArray(teams.id, teamIds));
    return allTeams.filter((t) => t.branchId === branchId);
  }

  // Creates a pending join request; team admin must approve
  async joinTeam(userId: string, teamId: string): Promise<TeamMembership> {
    const [membership] = await db
      .insert(teamMemberships)
      .values({ userId, teamId, role: "participant", status: "pending" })
      .onConflictDoNothing()
      .returning();
    if (!membership) {
      const [existing] = await db
        .select()
        .from(teamMemberships)
        .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
      return existing;
    }
    return membership;
  }

  async leaveTeam(userId: string, teamId: string): Promise<void> {
    await db.delete(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
  }

  async isTeamMember(userId: string, teamId: string): Promise<boolean> {
    const [m] = await db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "active")));
    return !!m;
  }

  async hasTeamRequest(userId: string, teamId: string): Promise<string | null> {
    const [m] = await db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
    return m?.status ?? null;
  }

  async getTeamMemberRole(userId: string, teamId: string): Promise<string | undefined> {
    const [m] = await db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "active")));
    return m?.role;
  }

  async setTeamMemberRole(userId: string, teamId: string, role: string): Promise<void> {
    await db
      .update(teamMemberships)
      .set({ role })
      .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
  }

  async removeTeamMember(userId: string, teamId: string): Promise<void> {
    await this.leaveTeam(userId, teamId);
  }

  async getTeamMembers(teamId: string): Promise<string[]> {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "active")));
    return memberships.map((m) => m.userId);
  }

  async getPendingTeamRequests(teamId: string): Promise<Array<{ userId: string; displayName: string; requestedAt: Date }>> {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "pending")));
    const results: Array<{ userId: string; displayName: string; requestedAt: Date }> = [];
    for (const m of memberships) {
      const [u] = await db.select().from(users).where(eq(users.id, m.userId));
      if (u) results.push({ userId: m.userId, displayName: u.displayName, requestedAt: m.joinedAt });
    }
    return results;
  }

  async approveTeamRequest(userId: string, teamId: string): Promise<void> {
    await db.update(teamMemberships).set({ status: "active" }).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
  }

  async rejectTeamRequest(userId: string, teamId: string): Promise<void> {
    await db.delete(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)));
  }

  async getMyTeams(userId: string): Promise<Array<Team & { role: string; branchName: string; churchId: string }>> {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.status, "active")));
    const result: Array<Team & { role: string; branchName: string; churchId: string }> = [];
    for (const m of memberships) {
      const team = await this.getTeamById(m.teamId);
      if (!team) continue;
      const branch = await this.getBranchById(team.branchId);
      if (!branch) continue;
      result.push({ ...team, role: m.role, branchName: branch.name, churchId: branch.churchId });
    }
    return result;
  }

  async getMyAdminBranches(userId: string): Promise<Array<Branch & { role: string }>> {
    const memberships = await db
      .select()
      .from(branchMemberships)
      .where(and(eq(branchMemberships.userId, userId), eq(branchMemberships.role, "admin"), eq(branchMemberships.status, "active")));
    const result: Array<Branch & { role: string }> = [];
    for (const m of memberships) {
      const branch = await this.getBranchById(m.branchId);
      if (branch) result.push({ ...branch, role: m.role });
    }
    return result;
  }

  async getMyAdminTeams(userId: string): Promise<Array<Team & { role: string }>> {
    const memberships = await db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.role, "admin"), eq(teamMemberships.status, "active")));
    const result: Array<Team & { role: string }> = [];
    for (const m of memberships) {
      const team = await this.getTeamById(m.teamId);
      if (team) result.push({ ...team, role: m.role });
    }
    return result;
  }

  async getPendingRequestsSummary(userId: string): Promise<{
    total: number;
    branches: Array<{ branchId: string; name: string; count: number }>;
    teams: Array<{ teamId: string; name: string; count: number }>;
  }> {
    const adminBranches = await this.getMyAdminBranches(userId);
    const adminTeams = await this.getMyAdminTeams(userId);

    const branchCounts: Array<{ branchId: string; name: string; count: number }> = [];
    let total = 0;
    for (const b of adminBranches) {
      const reqs = await this.getPendingBranchRequests(b.id);
      if (reqs.length > 0) {
        branchCounts.push({ branchId: b.id, name: b.name, count: reqs.length });
        total += reqs.length;
      }
    }

    const teamCounts: Array<{ teamId: string; name: string; count: number }> = [];
    for (const t of adminTeams) {
      const reqs = await this.getPendingTeamRequests(t.id);
      if (reqs.length > 0) {
        teamCounts.push({ teamId: t.id, name: t.name, count: reqs.length });
        total += reqs.length;
      }
    }

    return { total, branches: branchCounts, teams: teamCounts };
  }

  async getTeamMembersWithStats(teamId: string): Promise<MemberStats[]> {
    const memberships = await db.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.status, "active")));
    if (memberships.length === 0) return [];
    const results: MemberStats[] = [];
    for (const membership of memberships) {
      const [user] = await db.select().from(users).where(eq(users.id, membership.userId));
      if (!user) continue;
      const sessions = await db
        .select()
        .from(walkingSessions)
        .where(and(eq(walkingSessions.userId, membership.userId), eq(walkingSessions.isActive, false)));
      results.push({
        userId: membership.userId,
        displayName: user.displayName,
        role: membership.role,
        sessionCount: sessions.length,
        totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
        totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0),
      });
    }
    return results;
  }

  async getTeamStats(teamId: string, from?: Date, to?: Date): Promise<GroupStats> {
    const memberIds = await this.getTeamMembers(teamId);
    if (memberIds.length === 0) return { memberCount: 0, sessionCount: 0, totalDistance: 0, totalDuration: 0 };
    const conditions = [inArray(walkingSessions.userId, memberIds), eq(walkingSessions.isActive, false)];
    if (from) conditions.push(gte(walkingSessions.startedAt, from));
    if (to) conditions.push(lte(walkingSessions.startedAt, to));
    const sessions = await db.select().from(walkingSessions).where(and(...conditions));
    return {
      memberCount: memberIds.length,
      sessionCount: sessions.length,
      totalDistance: sessions.reduce((acc, s) => acc + (s.totalDistance || 0), 0),
      totalDuration: sessions.reduce((acc, s) => acc + (s.totalDuration || 0), 0),
    };
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async createSession(userId: string): Promise<WalkingSession> {
    const [session] = await db.insert(walkingSessions).values({ userId }).returning();
    return session;
  }

  async endSession(sessionId: string, totalDistance: number, totalDuration: number): Promise<WalkingSession | undefined> {
    const [session] = await db
      .update(walkingSessions)
      .set({ endedAt: new Date(), totalDistance, totalDuration, isActive: false })
      .where(eq(walkingSessions.id, sessionId))
      .returning();
    return session;
  }

  async getUserSessions(userId: string): Promise<WalkingSession[]> {
    return db.select().from(walkingSessions).where(eq(walkingSessions.userId, userId)).orderBy(desc(walkingSessions.startedAt));
  }

  async getSessionById(id: string): Promise<WalkingSession | undefined> {
    const [session] = await db.select().from(walkingSessions).where(eq(walkingSessions.id, id));
    return session;
  }

  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    const [session] = await db
      .select()
      .from(walkingSessions)
      .where(and(eq(walkingSessions.id, sessionId), eq(walkingSessions.userId, userId)));
    if (!session) return false;
    await db.delete(routePoints).where(eq(routePoints.sessionId, sessionId));
    await db.delete(walkingSessions).where(eq(walkingSessions.id, sessionId));
    return true;
  }

  async addRoutePoints(
    sessionId: string,
    points: Array<{ latitude: number; longitude: number; timestamp: string | Date; accuracy?: number | null }>,
  ): Promise<RoutePoint[]> {
    if (points.length === 0) return [];
    const values = points.map((p) => ({
      sessionId,
      latitude: p.latitude,
      longitude: p.longitude,
      timestamp: new Date(p.timestamp),
      accuracy: p.accuracy ?? null,
    }));
    return db.insert(routePoints).values(values).returning();
  }

  async getSessionRoutePoints(sessionId: string): Promise<RoutePoint[]> {
    return db.select().from(routePoints).where(eq(routePoints.sessionId, sessionId)).orderBy(asc(routePoints.timestamp));
  }

  async getUserRoutePoints(userId: string): Promise<RoutePoint[]> {
    const sessions = await db.select().from(walkingSessions).where(eq(walkingSessions.userId, userId));
    if (sessions.length === 0) return [];
    const sessionIds = sessions.map((s) => s.id);
    return db.select().from(routePoints).where(inArray(routePoints.sessionId, sessionIds)).orderBy(asc(routePoints.timestamp));
  }

  async getGroupRoutePoints(groupId: string): Promise<RoutePoint[]> {
    const memberIds = await this.getGroupMembers(groupId);
    if (memberIds.length === 0) return [];
    const sessions = await db.select().from(walkingSessions).where(inArray(walkingSessions.userId, memberIds));
    if (sessions.length === 0) return [];
    const sessionIds = sessions.map((s) => s.id);
    return db.select().from(routePoints).where(inArray(routePoints.sessionId, sessionIds)).orderBy(asc(routePoints.timestamp));
  }

  async getTeamRoutePoints(teamId: string): Promise<RoutePoint[]> {
    const memberIds = await this.getTeamMembers(teamId);
    if (memberIds.length === 0) return [];
    const sessions = await db.select().from(walkingSessions).where(inArray(walkingSessions.userId, memberIds));
    if (sessions.length === 0) return [];
    const sessionIds = sessions.map((s) => s.id);
    return db.select().from(routePoints).where(inArray(routePoints.sessionId, sessionIds)).orderBy(asc(routePoints.timestamp));
  }

  // ─── Priority Areas ───────────────────────────────────────────────────────

  async getPriorityAreas(groupId: string): Promise<PriorityArea[]> {
    return db.select().from(priorityAreas).where(eq(priorityAreas.groupId, groupId)).orderBy(asc(priorityAreas.createdAt));
  }

  async getBranchPriorityAreas(branchId: string): Promise<PriorityArea[]> {
    return db.select().from(priorityAreas).where(eq(priorityAreas.branchId, branchId)).orderBy(asc(priorityAreas.createdAt));
  }

  async getUserPriorityAreas(userId: string): Promise<PriorityArea[]> {
    const userGroups = await this.getUserGroups(userId);
    const userBranchMemberships = await db.select().from(branchMemberships).where(eq(branchMemberships.userId, userId));

    const areas: PriorityArea[] = [];

    // Legacy: church-level priority areas
    for (const g of userGroups) {
      const groupAreas = await db.select().from(priorityAreas).where(eq(priorityAreas.groupId, g.id));
      areas.push(...groupAreas);
    }

    // New: branch-level priority areas
    for (const bm of userBranchMemberships) {
      const branchAreas = await db.select().from(priorityAreas).where(eq(priorityAreas.branchId, bm.branchId));
      areas.push(...branchAreas);
    }

    // Deduplicate by id
    const seen = new Set<string>();
    return areas.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }

  async createPriorityArea(
    groupId: string | null,
    branchId: string | null,
    createdById: string,
    name: string,
    coordinates: Array<{ latitude: number; longitude: number }>,
    color: string,
  ): Promise<PriorityArea> {
    const [area] = await db
      .insert(priorityAreas)
      .values({ groupId, branchId, createdById, name, coordinates: JSON.stringify(coordinates), color })
      .returning();
    return area;
  }

  async deletePriorityArea(areaId: string, groupId?: string, branchId?: string): Promise<void> {
    if (branchId) {
      await db.delete(priorityAreas).where(and(eq(priorityAreas.id, areaId), eq(priorityAreas.branchId, branchId)));
    } else if (groupId) {
      await db.delete(priorityAreas).where(and(eq(priorityAreas.id, areaId), eq(priorityAreas.groupId, groupId)));
    } else {
      await db.delete(priorityAreas).where(eq(priorityAreas.id, areaId));
    }
  }

  // ─── Session Notes ────────────────────────────────────────────────────────

  async createSessionNote(
    sessionId: string,
    userId: string,
    text: string,
    latitude: number | null,
    longitude: number | null,
  ): Promise<SessionNote> {
    const [note] = await db
      .insert(sessionNotes)
      .values({ sessionId, userId, text, latitude, longitude })
      .returning();
    return note;
  }

  async getSessionNotes(sessionId: string): Promise<SessionNote[]> {
    return db.select().from(sessionNotes).where(eq(sessionNotes.sessionId, sessionId)).orderBy(asc(sessionNotes.createdAt));
  }

  async deleteSessionNote(noteId: string, userId: string): Promise<boolean> {
    const [note] = await db.select().from(sessionNotes).where(eq(sessionNotes.id, noteId));
    if (!note || note.userId !== userId) return false;
    await db.delete(sessionNotes).where(eq(sessionNotes.id, noteId));
    return true;
  }
}

export const storage = new DatabaseStorage();
