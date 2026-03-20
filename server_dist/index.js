// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";

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
  index
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
    groupId: varchar("group_id").notNull().references(() => groups.id),
    createdById: varchar("created_by_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    coordinates: text("coordinates").notNull(),
    color: text("color").notNull().default("#FF9500"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("priority_areas_group_idx").on(table.groupId)
  ]
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
import { eq, and, inArray, desc, asc, gt } from "drizzle-orm";
import pg from "pg";
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle(pool);
function generateGroupCode() {
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
  async createResetToken(userId, token, expiresAt) {
    const [resetToken] = await db.insert(passwordResetTokens).values({ userId, token, expiresAt }).returning();
    return resetToken;
  }
  async getValidResetToken(token) {
    const [resetToken] = await db.select().from(passwordResetTokens).where(
      and(
        eq(passwordResetTokens.token, token),
        gt(passwordResetTokens.expiresAt, /* @__PURE__ */ new Date())
      )
    );
    return resetToken;
  }
  async markResetTokenUsed(tokenId) {
    await db.update(passwordResetTokens).set({ usedAt: /* @__PURE__ */ new Date() }).where(eq(passwordResetTokens.id, tokenId));
  }
  async createGroup(name, userId) {
    const code = generateGroupCode();
    const [group] = await db.insert(groups).values({ name, code, createdById: userId }).returning();
    await db.insert(groupMemberships).values({ userId, groupId: group.id, role: "admin" });
    return group;
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
    if (memberships.length === 0)
      return [];
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
    const [membership] = await db.select().from(groupMemberships).where(
      and(
        eq(groupMemberships.userId, userId),
        eq(groupMemberships.groupId, groupId)
      )
    );
    return !!membership;
  }
  async getGroupMembers(groupId) {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    return memberships.map((m) => m.userId);
  }
  async getMemberRole(userId, groupId) {
    const [membership] = await db.select().from(groupMemberships).where(
      and(
        eq(groupMemberships.userId, userId),
        eq(groupMemberships.groupId, groupId)
      )
    );
    return membership?.role;
  }
  async setMemberRole(userId, groupId, role) {
    await db.update(groupMemberships).set({ role }).where(
      and(
        eq(groupMemberships.userId, userId),
        eq(groupMemberships.groupId, groupId)
      )
    );
  }
  async removeMember(userId, groupId) {
    await db.delete(groupMemberships).where(
      and(
        eq(groupMemberships.userId, userId),
        eq(groupMemberships.groupId, groupId)
      )
    );
  }
  async getGroupMembersWithStats(groupId) {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    if (memberships.length === 0)
      return [];
    const results = [];
    for (const membership of memberships) {
      const [user] = await db.select().from(users).where(eq(users.id, membership.userId));
      if (!user)
        continue;
      const sessions = await db.select().from(walkingSessions).where(
        and(
          eq(walkingSessions.userId, membership.userId),
          eq(walkingSessions.isActive, false)
        )
      );
      const sessionCount = sessions.length;
      const totalDistance = sessions.reduce(
        (acc, s) => acc + (s.totalDistance || 0),
        0
      );
      const totalDuration = sessions.reduce(
        (acc, s) => acc + (s.totalDuration || 0),
        0
      );
      results.push({
        userId: membership.userId,
        displayName: user.displayName,
        role: membership.role,
        sessionCount,
        totalDistance,
        totalDuration
      });
    }
    return results;
  }
  async getGroupStats(groupId) {
    const memberships = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    const memberCount = memberships.length;
    if (memberCount === 0) {
      return { memberCount: 0, sessionCount: 0, totalDistance: 0, totalDuration: 0 };
    }
    const memberIds = memberships.map((m) => m.userId);
    const sessions = await db.select().from(walkingSessions).where(
      and(
        inArray(walkingSessions.userId, memberIds),
        eq(walkingSessions.isActive, false)
      )
    );
    const sessionCount = sessions.length;
    const totalDistance = sessions.reduce(
      (acc, s) => acc + (s.totalDistance || 0),
      0
    );
    const totalDuration = sessions.reduce(
      (acc, s) => acc + (s.totalDuration || 0),
      0
    );
    return { memberCount, sessionCount, totalDistance, totalDuration };
  }
  async createSession(userId) {
    const [session2] = await db.insert(walkingSessions).values({ userId }).returning();
    return session2;
  }
  async endSession(sessionId, totalDistance, totalDuration) {
    const [session2] = await db.update(walkingSessions).set({
      endedAt: /* @__PURE__ */ new Date(),
      totalDistance,
      totalDuration,
      isActive: false
    }).where(eq(walkingSessions.id, sessionId)).returning();
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
    if (!session2)
      return false;
    await db.delete(routePoints).where(eq(routePoints.sessionId, sessionId));
    await db.delete(walkingSessions).where(eq(walkingSessions.id, sessionId));
    return true;
  }
  async addRoutePoints(sessionId, points) {
    if (points.length === 0)
      return [];
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
    if (sessions.length === 0)
      return [];
    const sessionIds = sessions.map((s) => s.id);
    return db.select().from(routePoints).where(inArray(routePoints.sessionId, sessionIds)).orderBy(asc(routePoints.timestamp));
  }
  async getGroupRoutePoints(groupId) {
    const memberIds = await this.getGroupMembers(groupId);
    if (memberIds.length === 0)
      return [];
    const sessions = await db.select().from(walkingSessions).where(inArray(walkingSessions.userId, memberIds));
    if (sessions.length === 0)
      return [];
    const sessionIds = sessions.map((s) => s.id);
    return db.select().from(routePoints).where(inArray(routePoints.sessionId, sessionIds)).orderBy(asc(routePoints.timestamp));
  }
  async getPriorityAreas(groupId) {
    return db.select().from(priorityAreas).where(eq(priorityAreas.groupId, groupId)).orderBy(asc(priorityAreas.createdAt));
  }
  async createPriorityArea(groupId, createdById, name, coordinates, color) {
    const [area] = await db.insert(priorityAreas).values({
      groupId,
      createdById,
      name,
      coordinates: JSON.stringify(coordinates),
      color
    }).returning();
    return area;
  }
  async deletePriorityArea(areaId, groupId) {
    await db.delete(priorityAreas).where(
      and(
        eq(priorityAreas.id, areaId),
        eq(priorityAreas.groupId, groupId)
      )
    );
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
  if (!host || !user || !pass)
    return null;
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

// server/routes.ts
var PgStore = connectPg(session);
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}
async function registerRoutes(app2) {
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
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input" });
      }
      const existing = await storage.getUserByUsername(parsed.data.username);
      if (existing) {
        return res.status(409).json({ message: "Username already taken" });
      }
      const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
      const user = await storage.createUser({
        ...parsed.data,
        password: hashedPassword
      });
      req.session.userId = user.id;
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName
      });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.session.userId = user.id;
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName
    });
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });
  app2.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      const safe = { message: "If that email is registered, a reset code has been sent." };
      if (!user)
        return res.json(safe);
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
  app2.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { email, code, newPassword } = req.body;
      if (!email || !code || !newPassword) {
        return res.status(400).json({ message: "Email, code, and new password are required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired code" });
      }
      const resetToken = await storage.getValidResetToken(code);
      if (!resetToken || resetToken.userId !== user.id || resetToken.usedAt) {
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
  app2.post("/api/groups", requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ message: "Group name required" });
      }
      const group = await storage.createGroup(
        name.trim(),
        req.session.userId
      );
      res.json(group);
    } catch (error) {
      console.error("Create group error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.post(
    "/api/groups/join",
    requireAuth,
    async (req, res) => {
      try {
        const { code } = req.body;
        if (!code) {
          return res.status(400).json({ message: "Group code required" });
        }
        const group = await storage.getGroupByCode(code);
        if (!group) {
          return res.status(404).json({ message: "Group not found" });
        }
        const isMember = await storage.isGroupMember(
          req.session.userId,
          group.id
        );
        if (isMember) {
          return res.status(409).json({ message: "Already a member of this group" });
        }
        await storage.joinGroup(req.session.userId, group.id);
        res.json(group);
      } catch (error) {
        console.error("Join group error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get("/api/groups", requireAuth, async (req, res) => {
    try {
      const userGroups = await storage.getUserGroups(req.session.userId);
      const groupsWithRole = await Promise.all(
        userGroups.map(async (g) => {
          const role = await storage.getMemberRole(req.session.userId, g.id);
          return { ...g, role: role ?? "participant" };
        })
      );
      res.json(groupsWithRole);
    } catch (error) {
      console.error("Get groups error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get(
    "/api/groups/:id/my-role",
    requireAuth,
    async (req, res) => {
      try {
        const groupId = req.params.id;
        const role = await storage.getMemberRole(req.session.userId, groupId);
        if (!role) {
          return res.status(403).json({ message: "Not a member of this group" });
        }
        res.json({ role });
      } catch (error) {
        console.error("Get role error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get(
    "/api/groups/:id/stats",
    requireAuth,
    async (req, res) => {
      try {
        const groupId = req.params.id;
        const isMember = await storage.isGroupMember(req.session.userId, groupId);
        if (!isMember) {
          return res.status(403).json({ message: "Not a member of this group" });
        }
        const stats = await storage.getGroupStats(groupId);
        res.json(stats);
      } catch (error) {
        console.error("Get group stats error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get(
    "/api/groups/:id/members",
    requireAuth,
    async (req, res) => {
      try {
        const groupId = req.params.id;
        const role = await storage.getMemberRole(req.session.userId, groupId);
        if (!role) {
          return res.status(403).json({ message: "Not a member of this group" });
        }
        if (role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }
        const members = await storage.getGroupMembersWithStats(groupId);
        res.json(members);
      } catch (error) {
        console.error("Get members error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.patch(
    "/api/groups/:id/members/:userId/role",
    requireAuth,
    async (req, res) => {
      try {
        const { id: groupId, userId: targetUserId } = req.params;
        const { role } = req.body;
        if (!role || !["admin", "participant"].includes(role)) {
          return res.status(400).json({ message: "Invalid role" });
        }
        const myRole = await storage.getMemberRole(req.session.userId, groupId);
        if (myRole !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }
        const targetRole = await storage.getMemberRole(targetUserId, groupId);
        if (!targetRole) {
          return res.status(404).json({ message: "Member not found" });
        }
        await storage.setMemberRole(targetUserId, groupId, role);
        res.json({ success: true });
      } catch (error) {
        console.error("Set role error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.delete(
    "/api/groups/:id/members/:userId",
    requireAuth,
    async (req, res) => {
      try {
        const { id: groupId, userId: targetUserId } = req.params;
        const myRole = await storage.getMemberRole(req.session.userId, groupId);
        if (myRole !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }
        if (targetUserId === req.session.userId) {
          return res.status(400).json({ message: "Cannot remove yourself" });
        }
        const targetRole = await storage.getMemberRole(targetUserId, groupId);
        if (!targetRole) {
          return res.status(404).json({ message: "Member not found" });
        }
        await storage.removeMember(targetUserId, groupId);
        res.json({ success: true });
      } catch (error) {
        console.error("Remove member error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get(
    "/api/groups/:id/coverage",
    requireAuth,
    async (req, res) => {
      try {
        const groupId = req.params.id;
        const isMember = await storage.isGroupMember(
          req.session.userId,
          groupId
        );
        if (!isMember) {
          return res.status(403).json({ message: "Not a member of this group" });
        }
        const points = await storage.getGroupRoutePoints(groupId);
        res.json(points);
      } catch (error) {
        console.error("Get group coverage error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get(
    "/api/my-priority-areas",
    requireAuth,
    async (req, res) => {
      try {
        const userGroups = await storage.getUserGroups(req.session.userId);
        const allAreas = await Promise.all(
          userGroups.map((g) => storage.getPriorityAreas(g.id))
        );
        const flat = allAreas.flat().map((a) => ({
          ...a,
          coordinates: JSON.parse(a.coordinates)
        }));
        res.json(flat);
      } catch (error) {
        console.error("Get my priority areas error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get(
    "/api/groups/:id/priority-areas",
    requireAuth,
    async (req, res) => {
      try {
        const groupId = req.params.id;
        const isMember = await storage.isGroupMember(req.session.userId, groupId);
        if (!isMember) {
          return res.status(403).json({ message: "Not a member of this group" });
        }
        const areas = await storage.getPriorityAreas(groupId);
        const parsed = areas.map((a) => ({
          ...a,
          coordinates: JSON.parse(a.coordinates)
        }));
        res.json(parsed);
      } catch (error) {
        console.error("Get priority areas error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.post(
    "/api/groups/:id/priority-areas",
    requireAuth,
    async (req, res) => {
      try {
        const groupId = req.params.id;
        const role = await storage.getMemberRole(req.session.userId, groupId);
        if (role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }
        const { name, coordinates, color } = req.body;
        if (!name || !coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
          return res.status(400).json({ message: "Name and at least 3 coordinates required" });
        }
        const area = await storage.createPriorityArea(
          groupId,
          req.session.userId,
          name.trim(),
          coordinates,
          color || "#FF9500"
        );
        res.json({ ...area, coordinates: JSON.parse(area.coordinates) });
      } catch (error) {
        console.error("Create priority area error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.delete(
    "/api/groups/:id/priority-areas/:areaId",
    requireAuth,
    async (req, res) => {
      try {
        const { id: groupId, areaId } = req.params;
        const role = await storage.getMemberRole(req.session.userId, groupId);
        if (role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }
        await storage.deletePriorityArea(areaId, groupId);
        res.json({ success: true });
      } catch (error) {
        console.error("Delete priority area error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.post(
    "/api/sessions",
    requireAuth,
    async (req, res) => {
      try {
        const session2 = await storage.createSession(req.session.userId);
        res.json(session2);
      } catch (error) {
        console.error("Create session error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.put(
    "/api/sessions/:id/end",
    requireAuth,
    async (req, res) => {
      try {
        const { totalDistance, totalDuration } = req.body;
        const session2 = await storage.endSession(
          req.params.id,
          totalDistance || 0,
          totalDuration || 0
        );
        if (!session2) {
          return res.status(404).json({ message: "Session not found" });
        }
        res.json(session2);
      } catch (error) {
        console.error("End session error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.post(
    "/api/sessions/:id/points",
    requireAuth,
    async (req, res) => {
      try {
        const parsed = insertRoutePointsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid route points data" });
        }
        const session2 = await storage.getSessionById(req.params.id);
        if (!session2) {
          return res.status(404).json({ message: "Session not found" });
        }
        const points = await storage.addRoutePoints(
          req.params.id,
          parsed.data.points
        );
        res.json(points);
      } catch (error) {
        console.error("Add route points error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get(
    "/api/sessions/:id/points",
    requireAuth,
    async (req, res) => {
      try {
        const points = await storage.getSessionRoutePoints(req.params.id);
        res.json(points);
      } catch (error) {
        console.error("Get session points error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get(
    "/api/sessions",
    requireAuth,
    async (req, res) => {
      try {
        const sessions = await storage.getUserSessions(req.session.userId);
        res.json(sessions);
      } catch (error) {
        console.error("Get sessions error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.delete(
    "/api/sessions/:id",
    requireAuth,
    async (req, res) => {
      try {
        const deleted = await storage.deleteSession(req.params.id, req.session.userId);
        if (!deleted) {
          return res.status(404).json({ message: "Session not found or not yours" });
        }
        res.json({ message: "Session deleted" });
      } catch (error) {
        console.error("Delete session error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  app2.get(
    "/api/coverage",
    requireAuth,
    async (req, res) => {
      try {
        const points = await storage.getUserRoutePoints(req.session.userId);
        res.json(points);
      } catch (error) {
        console.error("Get coverage error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
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
      if (!path2.startsWith("/api"))
        return;
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
