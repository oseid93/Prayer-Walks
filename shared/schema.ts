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
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groups = pgTable("groups", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  createdById: varchar("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groupMemberships = pgTable(
  "group_memberships",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id),
    groupId: varchar("group_id")
      .notNull()
      .references(() => groups.id),
    role: text("role").notNull().default("participant"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    index("group_memberships_user_idx").on(table.userId),
    index("group_memberships_group_idx").on(table.groupId),
  ],
);

export const walkingSessions = pgTable(
  "walking_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    totalDistance: real("total_distance").default(0).notNull(),
    totalDuration: integer("total_duration").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [index("walking_sessions_user_idx").on(table.userId)],
);

export const routePoints = pgTable(
  "route_points",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: varchar("session_id")
      .notNull()
      .references(() => walkingSessions.id),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    accuracy: real("accuracy"),
  },
  (table) => [index("route_points_session_idx").on(table.sessionId)],
);

export const priorityAreas = pgTable(
  "priority_areas",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    groupId: varchar("group_id")
      .notNull()
      .references(() => groups.id),
    createdById: varchar("created_by_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    coordinates: text("coordinates").notNull(),
    color: text("color").notNull().default("#FF9500"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("priority_areas_group_idx").on(table.groupId),
  ],
);

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
  email: true,
}).extend({
  email: z.string().email().optional(),
});

export const insertGroupSchema = createInsertSchema(groups).pick({
  name: true,
});

export const insertSessionSchema = createInsertSchema(walkingSessions).pick({});

export const insertRoutePointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timestamp: z.string().or(z.date()),
  accuracy: z.number().nullable().optional(),
});

export const insertRoutePointsSchema = z.object({
  points: z.array(insertRoutePointSchema),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type GroupMembership = typeof groupMemberships.$inferSelect;
export type WalkingSession = typeof walkingSessions.$inferSelect;
export type RoutePoint = typeof routePoints.$inferSelect;
export type PriorityArea = typeof priorityAreas.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
