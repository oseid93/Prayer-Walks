import {
  type User,
  type InsertUser,
  type Group,
  type GroupMembership,
  type WalkingSession,
  type RoutePoint,
  type PriorityArea,
  type PasswordResetToken,
  users,
  groups,
  groupMemberships,
  walkingSessions,
  routePoints,
  priorityAreas,
  passwordResetTokens,
} from "../shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, inArray, desc, asc, sum, count, gt } from "drizzle-orm";
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
  createResetToken(userId: string, token: string, expiresAt: Date): Promise<PasswordResetToken>;
  getValidResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markResetTokenUsed(tokenId: string): Promise<void>;

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
  getGroupMembersWithStats(groupId: string): Promise<MemberStats[]>;
  getGroupStats(groupId: string): Promise<GroupStats>;

  createSession(userId: string): Promise<WalkingSession>;
  endSession(
    sessionId: string,
    totalDistance: number,
    totalDuration: number,
  ): Promise<WalkingSession | undefined>;
  getUserSessions(userId: string): Promise<WalkingSession[]>;
  getSessionById(id: string): Promise<WalkingSession | undefined>;

  addRoutePoints(
    sessionId: string,
    points: Array<{
      latitude: number;
      longitude: number;
      timestamp: string | Date;
      accuracy?: number | null;
    }>,
  ): Promise<RoutePoint[]>;
  getSessionRoutePoints(sessionId: string): Promise<RoutePoint[]>;
  getUserRoutePoints(userId: string): Promise<RoutePoint[]>;
  getGroupRoutePoints(groupId: string): Promise<RoutePoint[]>;

  getPriorityAreas(groupId: string): Promise<PriorityArea[]>;
  createPriorityArea(
    groupId: string,
    createdById: string,
    name: string,
    coordinates: Array<{ latitude: number; longitude: number }>,
    color: string,
  ): Promise<PriorityArea>;
  deletePriorityArea(areaId: string, groupId: string): Promise<void>;
}

function generateGroupCode(): string {
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
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
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

  async createResetToken(userId: string, token: string, expiresAt: Date): Promise<PasswordResetToken> {
    const [resetToken] = await db
      .insert(passwordResetTokens)
      .values({ userId, token, expiresAt })
      .returning();
    return resetToken;
  }

  async getValidResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      );
    return resetToken;
  }

  async markResetTokenUsed(tokenId: string): Promise<void> {
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, tokenId));
  }

  async createGroup(name: string, userId: string): Promise<Group> {
    const code = generateGroupCode();
    const [group] = await db
      .insert(groups)
      .values({ name, code, createdById: userId })
      .returning();
    await db
      .insert(groupMemberships)
      .values({ userId, groupId: group.id, role: "admin" });
    return group;
  }

  async getGroupByCode(code: string): Promise<Group | undefined> {
    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.code, code.toUpperCase()));
    return group;
  }

  async getGroupById(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  async getUserGroups(userId: string): Promise<Group[]> {
    const memberships = await db
      .select()
      .from(groupMemberships)
      .where(eq(groupMemberships.userId, userId));
    if (memberships.length === 0) return [];
    const groupIds = memberships.map((m) => m.groupId);
    return db.select().from(groups).where(inArray(groups.id, groupIds));
  }

  async joinGroup(
    userId: string,
    groupId: string,
  ): Promise<GroupMembership> {
    const group = await this.getGroupById(groupId);
    const role = group?.createdById === userId ? "admin" : "participant";
    const [membership] = await db
      .insert(groupMemberships)
      .values({ userId, groupId, role })
      .returning();
    return membership;
  }

  async isGroupMember(userId: string, groupId: string): Promise<boolean> {
    const [membership] = await db
      .select()
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.userId, userId),
          eq(groupMemberships.groupId, groupId),
        ),
      );
    return !!membership;
  }

  async getGroupMembers(groupId: string): Promise<string[]> {
    const memberships = await db
      .select()
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, groupId));
    return memberships.map((m) => m.userId);
  }

  async getMemberRole(
    userId: string,
    groupId: string,
  ): Promise<string | undefined> {
    const [membership] = await db
      .select()
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.userId, userId),
          eq(groupMemberships.groupId, groupId),
        ),
      );
    return membership?.role;
  }

  async setMemberRole(
    userId: string,
    groupId: string,
    role: string,
  ): Promise<void> {
    await db
      .update(groupMemberships)
      .set({ role })
      .where(
        and(
          eq(groupMemberships.userId, userId),
          eq(groupMemberships.groupId, groupId),
        ),
      );
  }

  async removeMember(userId: string, groupId: string): Promise<void> {
    await db
      .delete(groupMemberships)
      .where(
        and(
          eq(groupMemberships.userId, userId),
          eq(groupMemberships.groupId, groupId),
        ),
      );
  }

  async getGroupMembersWithStats(groupId: string): Promise<MemberStats[]> {
    const memberships = await db
      .select()
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, groupId));

    if (memberships.length === 0) return [];

    const results: MemberStats[] = [];
    for (const membership of memberships) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, membership.userId));
      if (!user) continue;

      const sessions = await db
        .select()
        .from(walkingSessions)
        .where(
          and(
            eq(walkingSessions.userId, membership.userId),
            eq(walkingSessions.isActive, false),
          ),
        );

      const sessionCount = sessions.length;
      const totalDistance = sessions.reduce(
        (acc, s) => acc + (s.totalDistance || 0),
        0,
      );
      const totalDuration = sessions.reduce(
        (acc, s) => acc + (s.totalDuration || 0),
        0,
      );

      results.push({
        userId: membership.userId,
        displayName: user.displayName,
        role: membership.role,
        sessionCount,
        totalDistance,
        totalDuration,
      });
    }

    return results;
  }

  async getGroupStats(groupId: string): Promise<GroupStats> {
    const memberships = await db
      .select()
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, groupId));

    const memberCount = memberships.length;
    if (memberCount === 0) {
      return { memberCount: 0, sessionCount: 0, totalDistance: 0, totalDuration: 0 };
    }

    const memberIds = memberships.map((m) => m.userId);
    const sessions = await db
      .select()
      .from(walkingSessions)
      .where(
        and(
          inArray(walkingSessions.userId, memberIds),
          eq(walkingSessions.isActive, false),
        ),
      );

    const sessionCount = sessions.length;
    const totalDistance = sessions.reduce(
      (acc, s) => acc + (s.totalDistance || 0),
      0,
    );
    const totalDuration = sessions.reduce(
      (acc, s) => acc + (s.totalDuration || 0),
      0,
    );

    return { memberCount, sessionCount, totalDistance, totalDuration };
  }

  async createSession(userId: string): Promise<WalkingSession> {
    const [session] = await db
      .insert(walkingSessions)
      .values({ userId })
      .returning();
    return session;
  }

  async endSession(
    sessionId: string,
    totalDistance: number,
    totalDuration: number,
  ): Promise<WalkingSession | undefined> {
    const [session] = await db
      .update(walkingSessions)
      .set({
        endedAt: new Date(),
        totalDistance,
        totalDuration,
        isActive: false,
      })
      .where(eq(walkingSessions.id, sessionId))
      .returning();
    return session;
  }

  async getUserSessions(userId: string): Promise<WalkingSession[]> {
    return db
      .select()
      .from(walkingSessions)
      .where(eq(walkingSessions.userId, userId))
      .orderBy(desc(walkingSessions.startedAt));
  }

  async getSessionById(id: string): Promise<WalkingSession | undefined> {
    const [session] = await db
      .select()
      .from(walkingSessions)
      .where(eq(walkingSessions.id, id));
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
    points: Array<{
      latitude: number;
      longitude: number;
      timestamp: string | Date;
      accuracy?: number | null;
    }>,
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
    return db
      .select()
      .from(routePoints)
      .where(eq(routePoints.sessionId, sessionId))
      .orderBy(asc(routePoints.timestamp));
  }

  async getUserRoutePoints(userId: string): Promise<RoutePoint[]> {
    const sessions = await db
      .select()
      .from(walkingSessions)
      .where(eq(walkingSessions.userId, userId));
    if (sessions.length === 0) return [];
    const sessionIds = sessions.map((s) => s.id);
    return db
      .select()
      .from(routePoints)
      .where(inArray(routePoints.sessionId, sessionIds))
      .orderBy(asc(routePoints.timestamp));
  }

  async getGroupRoutePoints(groupId: string): Promise<RoutePoint[]> {
    const memberIds = await this.getGroupMembers(groupId);
    if (memberIds.length === 0) return [];
    const sessions = await db
      .select()
      .from(walkingSessions)
      .where(inArray(walkingSessions.userId, memberIds));
    if (sessions.length === 0) return [];
    const sessionIds = sessions.map((s) => s.id);
    return db
      .select()
      .from(routePoints)
      .where(inArray(routePoints.sessionId, sessionIds))
      .orderBy(asc(routePoints.timestamp));
  }

  async getPriorityAreas(groupId: string): Promise<PriorityArea[]> {
    return db
      .select()
      .from(priorityAreas)
      .where(eq(priorityAreas.groupId, groupId))
      .orderBy(asc(priorityAreas.createdAt));
  }

  async createPriorityArea(
    groupId: string,
    createdById: string,
    name: string,
    coordinates: Array<{ latitude: number; longitude: number }>,
    color: string,
  ): Promise<PriorityArea> {
    const [area] = await db
      .insert(priorityAreas)
      .values({
        groupId,
        createdById,
        name,
        coordinates: JSON.stringify(coordinates),
        color,
      })
      .returning();
    return area;
  }

  async deletePriorityArea(areaId: string, groupId: string): Promise<void> {
    await db
      .delete(priorityAreas)
      .where(
        and(
          eq(priorityAreas.id, areaId),
          eq(priorityAreas.groupId, groupId),
        ),
      );
  }
}

export const storage = new DatabaseStorage();
