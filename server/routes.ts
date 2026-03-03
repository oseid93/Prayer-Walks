import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { insertUserSchema, insertRoutePointsSchema } from "@shared/schema";

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
      res.json(userGroups);
    } catch (error) {
      console.error("Get groups error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

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
