import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { insertUserSchema, insertRoutePointsSchema } from "../shared/schema";
import { sendPasswordResetEmail } from "./email";
import { runMigrations } from "./migrations";

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
  // Run DB migrations on startup
  await runMigrations();

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

  // ─── Auth ────────────────────────────────────────────────────────────────

  app.post("/api/auth/register", async (req: Request, res: Response) => {
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

  app.post("/api/auth/login", async (req: Request, res: Response) => {
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

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    res.json({ id: user.id, username: user.username, displayName: user.displayName, email: user.email ?? null });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => res.json({ message: "Logged out" }));
  });

  app.patch("/api/auth/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const { displayName } = req.body;
      if (!displayName || !displayName.trim()) return res.status(400).json({ message: "Display name required" });
      const trimmed = displayName.trim();
      const existing = await storage.getUserByDisplayName(trimmed);
      if (existing && existing.id !== req.session.userId) return res.status(409).json({ message: "That name is already taken" });
      await storage.updateDisplayName(req.session.userId!, trimmed);
      res.json({ displayName: trimmed });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      const safe = { message: "If that email is registered, a reset code has been sent." };
      if (!user) return res.json(safe);
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
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
      if (!email || !code || !newPassword) return res.status(400).json({ message: "Email, code, and new password are required" });
      if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user) return res.status(400).json({ message: "Invalid or expired code" });
      const resetToken = await storage.getValidResetToken(code);
      if (!resetToken || resetToken.userId !== user.id || resetToken.usedAt) return res.status(400).json({ message: "Invalid or expired code" });
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.id, hashed);
      await storage.markResetTokenUsed(resetToken.id);
      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Churches (groups) ────────────────────────────────────────────────────

  app.get("/api/churches", requireAuth, async (req: Request, res: Response) => {
    try {
      const userGroups = await storage.getUserGroups(req.session.userId!);
      const result = await Promise.all(
        userGroups.map(async (g) => {
          const role = await storage.getMemberRole(req.session.userId!, g.id);
          return { ...g, role: role ?? "participant" };
        }),
      );
      res.json(result);
    } catch (error) {
      console.error("Get churches error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/churches", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) return res.status(400).json({ message: "Church name required" });
      const group = await storage.createGroup(name.trim(), req.session.userId!);
      res.json(group);
    } catch (error) {
      console.error("Create church error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/churches/join", requireAuth, async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Church code required" });
      const group = await storage.getGroupByCode(code);
      if (!group) return res.status(404).json({ message: "Church not found" });
      const isMember = await storage.isGroupMember(req.session.userId!, group.id);
      if (isMember) return res.status(409).json({ message: "Already a member of this church" });
      await storage.joinGroup(req.session.userId!, group.id);
      res.json(group);
    } catch (error) {
      console.error("Join church error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/churches/:id/leave", requireAuth, async (req: Request, res: Response) => {
    try {
      const churchId = req.params.id;
      const isMember = await storage.isGroupMember(req.session.userId!, churchId);
      if (!isMember) return res.status(404).json({ message: "Not a member" });
      await storage.removeChurchMemberCascade(req.session.userId!, churchId);
      res.json({ success: true });
    } catch (error) {
      console.error("Leave church error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/churches/:id/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const churchId = req.params.id;
      const isMember = await storage.isGroupMember(req.session.userId!, churchId);
      if (!isMember) return res.status(403).json({ message: "Not a member" });
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const stats = await storage.getGroupStats(churchId, from, to);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/churches/:id/members", requireAuth, async (req: Request, res: Response) => {
    try {
      const churchId = req.params.id;
      const role = await storage.getMemberRole(req.session.userId!, churchId);
      if (!role) return res.status(403).json({ message: "Not a member" });
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const members = await storage.getGroupMembersWithStats(churchId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/churches/:id/members/:userId/role", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id: churchId, userId: targetUserId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "participant"].includes(role)) return res.status(400).json({ message: "Invalid role" });
      const myRole = await storage.getMemberRole(req.session.userId!, churchId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.setMemberRole(targetUserId, churchId, role);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/churches/:id/members/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id: churchId, userId: targetUserId } = req.params;
      const myRole = await storage.getMemberRole(req.session.userId!, churchId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot remove yourself" });
      await storage.removeChurchMemberCascade(targetUserId as string, churchId as string);
      res.json({ success: true });
    } catch (error) {
      console.error("Remove church member error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Branches ─────────────────────────────────────────────────────────────

  app.get("/api/churches/:churchId/branches", requireAuth, async (req: Request, res: Response) => {
    try {
      const { churchId } = req.params;
      const isMember = await storage.isGroupMember(req.session.userId!, churchId);
      if (!isMember) return res.status(403).json({ message: "Not a church member" });
      const allBranches = await storage.getBranchesByChurch(churchId);
      const result = await Promise.all(
        allBranches.map(async (b) => {
          const role = await storage.getBranchMemberRole(req.session.userId!, b.id);
          const memberCount = (await storage.getBranchMembers(b.id)).length;
          return { ...b, role: role ?? null, memberCount };
        }),
      );
      res.json(result);
    } catch (error) {
      console.error("Get branches error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/churches/:churchId/branches", requireAuth, async (req: Request, res: Response) => {
    try {
      const { churchId } = req.params;
      const role = await storage.getMemberRole(req.session.userId!, churchId);
      if (role !== "admin") return res.status(403).json({ message: "Church admin access required" });
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: "Branch name required" });
      const branch = await storage.createBranch(churchId, name.trim(), req.session.userId!);
      res.json(branch);
    } catch (error) {
      console.error("Create branch error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/churches/:churchId/branches/:branchId/join", requireAuth, async (req: Request, res: Response) => {
    try {
      const { churchId, branchId } = req.params;
      const isMember = await storage.isGroupMember(req.session.userId!, churchId);
      if (!isMember) return res.status(403).json({ message: "Not a church member" });
      const branch = await storage.getBranchById(branchId);
      if (!branch || branch.churchId !== churchId) return res.status(404).json({ message: "Branch not found" });
      const currentBranch = await storage.getUserBranchInChurch(req.session.userId!, churchId);
      if (currentBranch && currentBranch.id !== branchId) {
        return res.status(409).json({ message: "You are already in a branch. Leave it first." });
      }
      const existing = await storage.hasBranchRequest(req.session.userId!, branchId);
      if (existing === "pending") return res.json({ status: "pending", message: "Your join request is awaiting approval." });
      if (existing === "active") return res.json({ status: "active", message: "Already a member." });
      await storage.joinBranch(req.session.userId!, branchId, churchId);
      res.json({ status: "pending", message: "Your join request has been sent and is awaiting approval." });
    } catch (error) {
      console.error("Join branch error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/branches/:branchId/leave", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId } = req.params;
      const isMember = await storage.isBranchMember(req.session.userId!, branchId);
      if (!isMember) return res.status(404).json({ message: "Not a branch member" });
      await storage.leaveBranch(req.session.userId!, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/branches/:branchId/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isBranchMember(req.session.userId!, req.params.branchId);
      if (!isMember) return res.status(403).json({ message: "Not a branch member" });
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      res.json(await storage.getBranchStats(req.params.branchId, from, to));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/branches/:branchId/requests", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId } = req.params;
      const role = await storage.getBranchMemberRole(req.session.userId!, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getPendingBranchRequests(branchId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/branches/:branchId/requests/:userId/approve", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId, userId: targetUserId } = req.params;
      const role = await storage.getBranchMemberRole(req.session.userId!, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.approveBranchRequest(targetUserId, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/branches/:branchId/requests/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId, userId: targetUserId } = req.params;
      const role = await storage.getBranchMemberRole(req.session.userId!, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.rejectBranchRequest(targetUserId, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/branches/:branchId/members", requireAuth, async (req: Request, res: Response) => {
    try {
      const role = await storage.getBranchMemberRole(req.session.userId!, req.params.branchId);
      if (!role) return res.status(403).json({ message: "Not a branch member" });
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getBranchMembersWithStats(req.params.branchId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/branches/:branchId/members/:userId/role", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId, userId: targetUserId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "participant"].includes(role)) return res.status(400).json({ message: "Invalid role" });
      const myRole = await storage.getBranchMemberRole(req.session.userId!, branchId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.setBranchMemberRole(targetUserId, branchId, role);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/branches/:branchId/members/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId, userId: targetUserId } = req.params;
      const myRole = await storage.getBranchMemberRole(req.session.userId!, branchId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot remove yourself" });
      await storage.removeBranchMember(targetUserId, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Branch priority areas
  app.get("/api/branches/:branchId/priority-areas", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isBranchMember(req.session.userId!, req.params.branchId);
      if (!isMember) return res.status(403).json({ message: "Not a branch member" });
      const areas = await storage.getBranchPriorityAreas(req.params.branchId);
      res.json(areas.map((a) => ({ ...a, coordinates: JSON.parse(a.coordinates) })));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/branches/:branchId/priority-areas", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId } = req.params;
      const role = await storage.getBranchMemberRole(req.session.userId!, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const { name, coordinates, color } = req.body;
      if (!name || !coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
        return res.status(400).json({ message: "Name and at least 3 coordinates required" });
      }
      const area = await storage.createPriorityArea(null, branchId, req.session.userId!, name.trim(), coordinates, color || "#FF9500");
      res.json({ ...area, coordinates: JSON.parse(area.coordinates) });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/branches/:branchId/priority-areas/:areaId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId, areaId } = req.params;
      const role = await storage.getBranchMemberRole(req.session.userId!, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.deletePriorityArea(areaId, undefined, branchId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Teams ────────────────────────────────────────────────────────────────

  app.get("/api/branches/:branchId/teams", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId } = req.params;
      const isMember = await storage.isBranchMember(req.session.userId!, branchId);
      if (!isMember) return res.status(403).json({ message: "Not a branch member" });
      const allTeams = await storage.getTeamsByBranch(branchId);
      const result = await Promise.all(
        allTeams.map(async (t) => {
          const role = await storage.getTeamMemberRole(req.session.userId!, t.id);
          const memberCount = (await storage.getTeamMembers(t.id)).length;
          return { ...t, role: role ?? null, memberCount };
        }),
      );
      res.json(result);
    } catch (error) {
      console.error("Get teams error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/branches/:branchId/teams", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId } = req.params;
      const role = await storage.getBranchMemberRole(req.session.userId!, branchId);
      if (role !== "admin") return res.status(403).json({ message: "Branch admin access required" });
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: "Team name required" });
      const team = await storage.createTeam(branchId, name.trim(), req.session.userId!);
      res.json(team);
    } catch (error) {
      console.error("Create team error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/branches/:branchId/teams/:teamId/join", requireAuth, async (req: Request, res: Response) => {
    try {
      const { branchId, teamId } = req.params;
      const isBranchMember = await storage.isBranchMember(req.session.userId!, branchId);
      if (!isBranchMember) return res.status(403).json({ message: "Not a branch member" });
      const team = await storage.getTeamById(teamId);
      if (!team || team.branchId !== branchId) return res.status(404).json({ message: "Team not found" });
      const existing = await storage.hasTeamRequest(req.session.userId!, teamId);
      if (existing === "pending") return res.json({ status: "pending", message: "Your join request is awaiting approval." });
      if (existing === "active") return res.json({ status: "active", message: "Already a member." });
      await storage.joinTeam(req.session.userId!, teamId);
      res.json({ status: "pending", message: "Your join request has been sent and is awaiting approval." });
    } catch (error) {
      console.error("Join team error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/teams/:teamId/leave", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isTeamMember(req.session.userId!, req.params.teamId);
      if (!isMember) return res.status(404).json({ message: "Not a team member" });
      await storage.leaveTeam(req.session.userId!, req.params.teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/teams/:teamId/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isTeamMember(req.session.userId!, req.params.teamId);
      if (!isMember) return res.status(403).json({ message: "Not a team member" });
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      res.json(await storage.getTeamStats(req.params.teamId, from, to));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/teams/:teamId/requests", requireAuth, async (req: Request, res: Response) => {
    try {
      const { teamId } = req.params;
      const role = await storage.getTeamMemberRole(req.session.userId!, teamId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getPendingTeamRequests(teamId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/teams/:teamId/requests/:userId/approve", requireAuth, async (req: Request, res: Response) => {
    try {
      const { teamId, userId: targetUserId } = req.params;
      const role = await storage.getTeamMemberRole(req.session.userId!, teamId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.approveTeamRequest(targetUserId, teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/teams/:teamId/requests/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { teamId, userId: targetUserId } = req.params;
      const role = await storage.getTeamMemberRole(req.session.userId!, teamId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.rejectTeamRequest(targetUserId, teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/teams/:teamId/members", requireAuth, async (req: Request, res: Response) => {
    try {
      const role = await storage.getTeamMemberRole(req.session.userId!, req.params.teamId);
      if (!role) return res.status(403).json({ message: "Not a team member" });
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getTeamMembersWithStats(req.params.teamId));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/teams/:teamId/members/:userId/role", requireAuth, async (req: Request, res: Response) => {
    try {
      const { teamId, userId: targetUserId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "participant"].includes(role)) return res.status(400).json({ message: "Invalid role" });
      const myRole = await storage.getTeamMemberRole(req.session.userId!, teamId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.setTeamMemberRole(targetUserId, teamId, role);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/teams/:teamId/members/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { teamId, userId: targetUserId } = req.params;
      const myRole = await storage.getTeamMemberRole(req.session.userId!, teamId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot remove yourself" });
      await storage.removeTeamMember(targetUserId, teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/teams/:teamId/coverage", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isTeamMember(req.session.userId!, req.params.teamId);
      if (!isMember) return res.status(403).json({ message: "Not a team member" });
      const points = await storage.getTeamRoutePoints(req.params.teamId);
      res.json(points);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── User aggregate queries ──────────────────────────────────────────────

  app.get("/api/my-teams", requireAuth, async (req: Request, res: Response) => {
    try {
      const myTeams = await storage.getMyTeams(req.session.userId!);
      res.json(myTeams);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/my-admin-branches", requireAuth, async (req: Request, res: Response) => {
    try {
      const branches = await storage.getMyAdminBranches(req.session.userId!);
      res.json(branches);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Legacy group routes (backward compat) ───────────────────────────────

  app.get("/api/groups", requireAuth, async (req: Request, res: Response) => {
    try {
      const userGroups = await storage.getUserGroups(req.session.userId!);
      const result = await Promise.all(
        userGroups.map(async (g) => {
          const role = await storage.getMemberRole(req.session.userId!, g.id);
          return { ...g, role: role ?? "participant" };
        }),
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/groups", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) return res.status(400).json({ message: "Group name required" });
      const group = await storage.createGroup(name.trim(), req.session.userId!);
      res.json(group);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/groups/join", requireAuth, async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Group code required" });
      const group = await storage.getGroupByCode(code);
      if (!group) return res.status(404).json({ message: "Group not found" });
      const isMember = await storage.isGroupMember(req.session.userId!, group.id);
      if (isMember) return res.status(409).json({ message: "Already a member of this group" });
      await storage.joinGroup(req.session.userId!, group.id);
      res.json(group);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/groups/:id/leave", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isGroupMember(req.session.userId!, req.params.id);
      if (!isMember) return res.status(404).json({ message: "Not a member" });
      await storage.removeMember(req.session.userId!, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/groups/:id/my-role", requireAuth, async (req: Request, res: Response) => {
    try {
      const role = await storage.getMemberRole(req.session.userId!, req.params.id);
      if (!role) return res.status(403).json({ message: "Not a member" });
      res.json({ role });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/groups/:id/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isGroupMember(req.session.userId!, req.params.id);
      if (!isMember) return res.status(403).json({ message: "Not a member" });
      res.json(await storage.getGroupStats(req.params.id));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/groups/:id/members", requireAuth, async (req: Request, res: Response) => {
    try {
      const role = await storage.getMemberRole(req.session.userId!, req.params.id);
      if (!role) return res.status(403).json({ message: "Not a member" });
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(await storage.getGroupMembersWithStats(req.params.id));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/groups/:id/members/:userId/role", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id: groupId, userId: targetUserId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "participant"].includes(role)) return res.status(400).json({ message: "Invalid role" });
      const myRole = await storage.getMemberRole(req.session.userId!, groupId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.setMemberRole(targetUserId, groupId, role);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/groups/:id/members/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id: groupId, userId: targetUserId } = req.params;
      const myRole = await storage.getMemberRole(req.session.userId!, groupId);
      if (myRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot remove yourself" });
      await storage.removeMember(targetUserId, groupId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/groups/:id/coverage", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isGroupMember(req.session.userId!, req.params.id);
      if (!isMember) return res.status(403).json({ message: "Not a member" });
      res.json(await storage.getGroupRoutePoints(req.params.id));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/groups/:id/priority-areas", requireAuth, async (req: Request, res: Response) => {
    try {
      const isMember = await storage.isGroupMember(req.session.userId!, req.params.id);
      if (!isMember) return res.status(403).json({ message: "Not a member" });
      const areas = await storage.getPriorityAreas(req.params.id);
      res.json(areas.map((a) => ({ ...a, coordinates: JSON.parse(a.coordinates) })));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/groups/:id/priority-areas", requireAuth, async (req: Request, res: Response) => {
    try {
      const groupId = req.params.id;
      const role = await storage.getMemberRole(req.session.userId!, groupId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const { name, coordinates, color } = req.body;
      if (!name || !coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
        return res.status(400).json({ message: "Name and at least 3 coordinates required" });
      }
      const area = await storage.createPriorityArea(groupId, null, req.session.userId!, name.trim(), coordinates, color || "#FF9500");
      res.json({ ...area, coordinates: JSON.parse(area.coordinates) });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/groups/:id/priority-areas/:areaId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id: groupId, areaId } = req.params;
      const role = await storage.getMemberRole(req.session.userId!, groupId);
      if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.deletePriorityArea(areaId, groupId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Priority areas (user-level) ─────────────────────────────────────────

  app.get("/api/my-priority-areas", requireAuth, async (req: Request, res: Response) => {
    try {
      const areas = await storage.getUserPriorityAreas(req.session.userId!);
      res.json(areas.map((a) => ({ ...a, coordinates: JSON.parse(a.coordinates) })));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Sessions ─────────────────────────────────────────────────────────────

  app.post("/api/sessions", requireAuth, async (req: Request, res: Response) => {
    try {
      const session = await storage.createSession(req.session.userId!);
      res.json(session);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/sessions/:id/end", requireAuth, async (req: Request, res: Response) => {
    try {
      const { totalDistance, totalDuration } = req.body;
      const session = await storage.endSession(req.params.id, totalDistance || 0, totalDuration || 0);
      if (!session) return res.status(404).json({ message: "Session not found" });
      res.json(session);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions/:id/points", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = insertRoutePointsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid route points data" });
      const session = await storage.getSessionById(req.params.id);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const points = await storage.addRoutePoints(req.params.id, parsed.data.points);
      res.json(points);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/sessions/:id/points", requireAuth, async (req: Request, res: Response) => {
    try {
      const points = await storage.getSessionRoutePoints(req.params.id);
      res.json(points);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/sessions", requireAuth, async (req: Request, res: Response) => {
    try {
      const sessions = await storage.getUserSessions(req.session.userId!);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/sessions/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteSession(req.params.id, req.session.userId!);
      if (!deleted) return res.status(404).json({ message: "Session not found or not yours" });
      res.json({ message: "Session deleted" });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/coverage", requireAuth, async (req: Request, res: Response) => {
    try {
      const points = await storage.getUserRoutePoints(req.session.userId!);
      res.json(points);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Session Notes (prayer notes during walks) ───────────────────────────

  app.get("/api/sessions/:id/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const session = await storage.getSessionById(req.params.id);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
      const notes = await storage.getSessionNotes(req.params.id);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions/:id/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const session = await storage.getSessionById(req.params.id);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
      const { text, latitude, longitude } = req.body;
      if (!text || typeof text !== "string" || !text.trim()) return res.status(400).json({ message: "Note text required" });
      const note = await storage.createSessionNote(
        req.params.id,
        req.session.userId!,
        text.trim(),
        typeof latitude === "number" ? latitude : null,
        typeof longitude === "number" ? longitude : null,
      );
      res.json(note);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/sessions/:sessionId/notes/:noteId", requireAuth, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteSessionNote(req.params.noteId, req.session.userId!);
      if (!deleted) return res.status(404).json({ message: "Note not found or not yours" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
