import {
  type User,
  type InsertUser,
  type Group,
  type GroupMembership,
  type WalkingSession,
  type RoutePoint,
  users,
  groups,
  groupMemberships,
  walkingSessions,
  routePoints,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, inArray, desc } from "drizzle-orm";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  createGroup(name: string, userId: string): Promise<Group>;
  getGroupByCode(code: string): Promise<Group | undefined>;
  getGroupById(id: string): Promise<Group | undefined>;
  getUserGroups(userId: string): Promise<Group[]>;
  joinGroup(userId: string, groupId: string): Promise<GroupMembership>;
  isGroupMember(userId: string, groupId: string): Promise<boolean>;
  getGroupMembers(groupId: string): Promise<string[]>;

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

  async createGroup(name: string, userId: string): Promise<Group> {
    const code = generateGroupCode();
    const [group] = await db
      .insert(groups)
      .values({ name, code, createdById: userId })
      .returning();
    await db
      .insert(groupMemberships)
      .values({ userId, groupId: group.id });
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
    const [membership] = await db
      .insert(groupMemberships)
      .values({ userId, groupId })
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
      .where(eq(routePoints.sessionId, sessionId));
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
      .where(inArray(routePoints.sessionId, sessionIds));
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
      .where(inArray(routePoints.sessionId, sessionIds));
  }
}

export const storage = new DatabaseStorage();
