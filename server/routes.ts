import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { insertUserSchema, insertRoutePointsSchema } from "@shared/schema";
import { sendPasswordResetEmail } from "./email";

const PgStore = connectPg(session);

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(
    session({
      store: new PgStore({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "street-cover-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      },
    }),
  );

  app.post("/api/auth/register", async (req: Request, res: Response) => {
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
        password: hashedPassword,
      });
      req.session.userId = user.id;
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
      });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res
          .status(400)
          .json({ message: "Username and password required" });
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
        displayName: user.displayName,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
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
      displayName: user.displayName,
    });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      // Always respond the same way to prevent email enumeration
      const safe = { message: "If that email is registered, a reset code has been sent." };
      if (!user) return res.json(safe);

      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await storage.createResetToken(user.id, code, expiresAt);
      await sendPasswordResetEmail(email, code);
      res.json(safe);
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
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

  app.post("/api/groups", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ message: "Group name required" });
      }
      const group = await storage.createGroup(
        name.trim(),
        req.session.userId!,
      );
      res.json(group);
    } catch (error) {
      console.error("Create group error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(
    "/api/groups/join",
    requireAuth,
    async (req: Request, res: Response) => {
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
          req.session.userId!,
          group.id,
        );
        if (isMember) {
          return res
            .status(409)
            .json({ message: "Already a member of this group" });
        }
        await storage.joinGroup(req.session.userId!, group.id);
        res.json(group);
      } catch (error) {
        console.error("Join group error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get("/api/groups", requireAuth, async (req: Request, res: Response) => {
    try {
      const userGroups = await storage.getUserGroups(req.session.userId!);
      const groupsWithRole = await Promise.all(
        userGroups.map(async (g) => {
          const role = await storage.getMemberRole(req.session.userId!, g.id);
          return { ...g, role: role ?? "participant" };
        }),
      );
      res.json(groupsWithRole);
    } catch (error) {
      console.error("Get groups error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(
    "/api/groups/:id/my-role",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const groupId = req.params.id;
        const role = await storage.getMemberRole(req.session.userId!, groupId);
        if (!role) {
          return res.status(403).json({ message: "Not a member of this group" });
        }
        res.json({ role });
      } catch (error) {
        console.error("Get role error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/groups/:id/stats",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const groupId = req.params.id;
        const isMember = await storage.isGroupMember(req.session.userId!, groupId);
        if (!isMember) {
          return res.status(403).json({ message: "Not a member of this group" });
        }
        const stats = await storage.getGroupStats(groupId);
        res.json(stats);
      } catch (error) {
        console.error("Get group stats error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/groups/:id/members",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const groupId = req.params.id;
        const role = await storage.getMemberRole(req.session.userId!, groupId);
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
    },
  );

  app.patch(
    "/api/groups/:id/members/:userId/role",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { id: groupId, userId: targetUserId } = req.params;
        const { role } = req.body;
        if (!role || !["admin", "participant"].includes(role)) {
          return res.status(400).json({ message: "Invalid role" });
        }
        const myRole = await storage.getMemberRole(req.session.userId!, groupId);
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
    },
  );

  app.delete(
    "/api/groups/:id/members/:userId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { id: groupId, userId: targetUserId } = req.params;
        const myRole = await storage.getMemberRole(req.session.userId!, groupId);
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
    },
  );

  app.get(
    "/api/groups/:id/coverage",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const groupId = req.params.id;
        const isMember = await storage.isGroupMember(
          req.session.userId!,
          groupId,
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
    },
  );

  app.get(
    "/api/my-priority-areas",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userGroups = await storage.getUserGroups(req.session.userId!);
        const allAreas = await Promise.all(
          userGroups.map((g) => storage.getPriorityAreas(g.id)),
        );
        const flat = allAreas.flat().map((a) => ({
          ...a,
          coordinates: JSON.parse(a.coordinates),
        }));
        res.json(flat);
      } catch (error) {
        console.error("Get my priority areas error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/groups/:id/priority-areas",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const groupId = req.params.id;
        const isMember = await storage.isGroupMember(req.session.userId!, groupId);
        if (!isMember) {
          return res.status(403).json({ message: "Not a member of this group" });
        }
        const areas = await storage.getPriorityAreas(groupId);
        const parsed = areas.map((a) => ({
          ...a,
          coordinates: JSON.parse(a.coordinates),
        }));
        res.json(parsed);
      } catch (error) {
        console.error("Get priority areas error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/groups/:id/priority-areas",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const groupId = req.params.id;
        const role = await storage.getMemberRole(req.session.userId!, groupId);
        if (role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }
        const { name, coordinates, color } = req.body;
        if (!name || !coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
          return res.status(400).json({ message: "Name and at least 3 coordinates required" });
        }
        const area = await storage.createPriorityArea(
          groupId,
          req.session.userId!,
          name.trim(),
          coordinates,
          color || "#FF9500",
        );
        res.json({ ...area, coordinates: JSON.parse(area.coordinates) });
      } catch (error) {
        console.error("Create priority area error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/groups/:id/priority-areas/:areaId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { id: groupId, areaId } = req.params;
        const role = await storage.getMemberRole(req.session.userId!, groupId);
        if (role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }
        await storage.deletePriorityArea(areaId, groupId);
        res.json({ success: true });
      } catch (error) {
        console.error("Delete priority area error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/sessions",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const session = await storage.createSession(req.session.userId!);
        res.json(session);
      } catch (error) {
        console.error("Create session error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/sessions/:id/end",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { totalDistance, totalDuration } = req.body;
        const session = await storage.endSession(
          req.params.id,
          totalDistance || 0,
          totalDuration || 0,
        );
        if (!session) {
          return res.status(404).json({ message: "Session not found" });
        }
        res.json(session);
      } catch (error) {
        console.error("End session error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/sessions/:id/points",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const parsed = insertRoutePointsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid route points data" });
        }
        const session = await storage.getSessionById(req.params.id);
        if (!session) {
          return res.status(404).json({ message: "Session not found" });
        }
        const points = await storage.addRoutePoints(
          req.params.id,
          parsed.data.points,
        );
        res.json(points);
      } catch (error) {
        console.error("Add route points error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/sessions/:id/points",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const points = await storage.getSessionRoutePoints(req.params.id);
        res.json(points);
      } catch (error) {
        console.error("Get session points error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/sessions",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const sessions = await storage.getUserSessions(req.session.userId!);
        res.json(sessions);
      } catch (error) {
        console.error("Get sessions error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/coverage",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const points = await storage.getUserRoutePoints(req.session.userId!);
        res.json(points);
      } catch (error) {
        console.error("Get coverage error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  const httpServer = createServer(app);
  return httpServer;
}
